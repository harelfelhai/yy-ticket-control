/**
 * הסרת קישורי הקסם של הקבלנים מכל אירוע שנשלח ל-Sentry.
 *
 * **הבעיה.** הטוקן של הקבלן הוא סוד נושא (bearer) ללא תפוגה, והוא יושב
 * ב**כתובת עצמה** — גם בנתיב (`/p/<token>`) וגם ב-query string
 * (`/api/media/<id>?t=<token>`). ‏Sentry אוסף את הכתובת המלאה בכל אירוע
 * ובכל transaction, ללא תנאי: ראה `winterCGRequestToRequestData` ב-
 * ‏`@sentry/core`, שמחזיר `url: req.url` ו-`query_string` כשדות נפרדים.
 * הדגל `sendDefaultPii` **אינו** מגן על זה — הוא שולט בכותרות, בעוגיות
 * וב-IP בלבד.
 *
 * מכיוון ש-`tracesSampleRate` הוא 1.0, זה אינו מותנה בשגיאה: כל בקשה
 * לפורטל מייצרת transaction, ולכן הטוקנים הקבועים של כל הקבלנים היו זולגים
 * באופן שוטף לשירות חיצוני ונשמרים שם.
 *
 * **למה מודול משותף.** הלקוח והשרת שולחים שניהם, ושתי הגדרות נפרדות שמנסחות
 * את אותה הסרה היו נפרדות בשקט ברגע שאחת מהן תתעדכן. הקובץ אינו מייבא דבר
 * (בוודאי לא `node:`), כדי שיוכל לרוץ גם בדפדפן.
 */

/**
 * הטוקן הוא base64url של 16 בתים, כלומר 22 תווים מהקבוצה `[A-Za-z0-9_-]`.
 * הביטוי מכוון למקטע שאחרי `/p/` בלי לקבוע אורך, כדי שגם טוקן בפורמט אחר
 * (ישן, או עתידי) יוסר ולא ידלוף בגלל אי-התאמת אורך.
 */
const PORTAL_PATH = /\/p\/[A-Za-z0-9_-]+/g;

/**
 * הטוקן כפרמטר שאילתה — מסלול המדיה מעביר אותו כך.
 *
 * ‏`(^|[?&])` ולא `[?&]` בלבד: ‏Sentry שומר את ה-query בשדה `query_string`
 * **בלי סימן השאלה המוביל**, ולכן `t=<טוקן>` מופיע שם בתחילת המחרוזת. ביטוי
 * שדרש תו מפריד לפניו החמיץ בדיוק את הנשא המסוכן ביותר.
 */
const TOKEN_QUERY = /(^|[?&])t=[^&#]*/g;

/** שמות פרמטרים שהערך שלהם הוא הסוד עצמו, כשהשאילתה מגיעה כמפה ולא כמחרוזת */
const SECRET_PARAMS = new Set(["t", "token"]);

export const REDACTED = "[redacted]";

/**
 * מסיר טוקנים ממחרוזת שעשויה להיות כתובת.
 *
 * אידמפוטנטי: `[redacted]` אינו תואם את מחלקת התווים של הטוקן, ולכן הרצה
 * חוזרת אינה משנה דבר. שומר על צורת הנתיב (`/p/[redacted]/<ticketId>`), כדי
 * שעדיין יהיה אפשר לראות באיזה מסך מדובר.
 */
export function redactTokens(value: string): string {
  return value.replace(PORTAL_PATH, `/p/${REDACTED}`).replace(TOKEN_QUERY, `$1t=${REDACTED}`);
}

/** מנקה ערך שעשוי להיות מחרוזת, ומחזיר כל דבר אחר כמות שהוא */
function clean<T>(value: T): T {
  return (typeof value === "string" ? redactTokens(value) : value) as T;
}

/**
 * מנקה מפה של ערכים (‏`span.data`, `breadcrumb.data`, `contexts.trace.data`).
 * רק מחרוזות נוגעות — מספרים ובוליאנים אינם יכולים לשאת טוקן.
 */
function cleanRecord(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  for (const key of Object.keys(data)) {
    data[key] = clean(data[key]);
  }
}

/**
 * מבנה מינימלי של אירוע Sentry — רק השדות שאנחנו נוגעים בהם.
 *
 * מוגדר כאן ולא מיובא מה-SDK בכוונה: הטיפוסים של Sentry משתנים בין גרסאות,
 * והמודול הזה צריך להישאר נכון גם אחרי שדרוג. ההסרה עובדת על מה שקיים
 * ומתעלמת בשקט ממה שאינו.
 */
interface ScrubbableEvent {
  transaction?: string;
  request?: {
    url?: string;
    query_string?: unknown;
    headers?: Record<string, string>;
  };
  breadcrumbs?: { data?: Record<string, unknown>; message?: string }[];
  spans?: { description?: string; data?: Record<string, unknown> }[];
  contexts?: { trace?: { data?: Record<string, unknown> } };
}

/**
 * מסיר טוקנים מאירוע במקום (in-place) ומחזיר אותו, כדי שיתאים ישירות
 * לחתימה של `beforeSend` ו-`beforeSendTransaction`.
 *
 * נוגע בכל הנשאים שבהם כתובת מגיעה ל-Sentry:
 * שם ה-transaction, `request.url`, ה-query string, כותרת ה-Referer,
 * פירורי הלחם (ניווטים ובקשות fetch), ה-spans והקשר ה-trace.
 */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.transaction) event.transaction = redactTokens(event.transaction);

  if (event.request) {
    if (event.request.url) event.request.url = redactTokens(event.request.url);

    // ‏query_string מגיע כמחרוזת, כמפה, או כמערך זוגות — תלוי במקור.
    //
    // בשתי הצורות המובנות הטוקן הוא ה**ערך**, לא חלק ממחרוזת `t=...`, ולכן
    // ההסרה שם היא לפי שם הפרמטר. הסרה שנשענה על התבנית בלבד הייתה מחזירה
    // אותם כמות שהם — כלומר מדליפה.
    const query = event.request.query_string;
    if (typeof query === "string") {
      event.request.query_string = redactTokens(query);
    } else if (Array.isArray(query)) {
      event.request.query_string = query.map((pair) =>
        Array.isArray(pair) && typeof pair[0] === "string" && SECRET_PARAMS.has(pair[0])
          ? [pair[0], REDACTED]
          : Array.isArray(pair)
            ? pair.map(clean)
            : clean(pair),
      );
    } else if (query && typeof query === "object") {
      const record = query as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        record[key] = SECRET_PARAMS.has(key) ? REDACTED : clean(record[key]);
      }
    }

    // ה-Referer של בקשה בתוך הפורטל הוא כתובת הפורטל — כלומר הטוקן.
    const headers = event.request.headers;
    if (headers) {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === "referer" || key.toLowerCase() === "referrer") {
          headers[key] = redactTokens(headers[key]);
        }
      }
    }
  }

  for (const breadcrumb of event.breadcrumbs ?? []) {
    if (breadcrumb.message) breadcrumb.message = redactTokens(breadcrumb.message);
    cleanRecord(breadcrumb.data);
  }

  for (const span of event.spans ?? []) {
    if (span.description) span.description = redactTokens(span.description);
    cleanRecord(span.data);
  }

  cleanRecord(event.contexts?.trace?.data);

  return event;
}
