import { createAccessTokenProvider, GoogleTokenError, type GoogleOAuthConfig } from "@/lib/google/gmail-token";
import { decodeRfc2047, headerMap, normalizeMessageId, parseAddress, parseAddressList, parseMessageIds } from "./headers";
import { walkPayload, type GmailMessagePart } from "./mime";
import { classifyMailError, MailSourceError, type MailErrorKind, type MailSource } from "./source";
import type { MailEnvelope } from "./types";

/**
 * המתאם ל-Gmail: המקום היחיד בקוד שיודע איך ה-API הזה נראה.
 *
 * **כל בקשה כאן היא GET, ואין מסלול שיכול לשלוח אחרת.** זו אינה מוסכמה
 * אלא מבנה: יש עוזר אחד (`gmailGet`) שבונה בקשה, והוא קובע `method: "GET"`
 * בעצמו. אין ל-`gmailGet` פרמטר שיטה, ואין קריאת `fetch` שנייה בקובץ, ולכן
 * "לשלוח POST לתיבה" אינו שינוי קטן אלא כתיבת מסלול חדש — שסריקת המקור
 * (`tests/conformance/source/email-intake.test.ts`) תתפוס. הסיבה ב-`source.ts`:
 * התיבה משותפת, ושינוי מצדנו נעלם בשקט אצל מערכת אחרת (EM-20).
 *
 * המתאם אינו מחליט דבר על התוכן — לא אם המייל הוא בקשה, לא מי שלח אותו ולא
 * מה סוגו האמיתי של קובץ. הוא ממיר את צורת ה-JSON של Gmail ל-`MailEnvelope`
 * ומוסר אותה הלאה. כל השאר טהור ונבדק בלי רשת.
 */

const GMAIL_USER_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * גג לבקשה יחידה. הסבב מנוקז בזו אחר זו, ולכן בקשה שאינה חוזרת אינה מעכבת
 * רק את עצמה אלא עוצרת את קליטת כל המיילים שאחריה. גבוה מגג השליחה
 * (10 שניות), כי הורדת קובץ מצורף גדול לגיטימית ואיטית.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * כמה מזהים בעמוד. Gmail מתיר עד 500, אבל העמוד אינו נשמר בזיכרון בלבד —
 * כל מזהה הופך לקריאת הודעה מלאה. 100 שומר על סבב שמתקדם ומדווח, ועל
 * תשובה שחוזרת מהר גם בתיבה עמוסה.
 */
const MAX_LIST_RESULTS = 100;

export interface GmailSourceDeps {
  /** לבדיקות בלבד. ברירת המחדל היא `fetch` הגלובלי. */
  fetch?: typeof globalThis.fetch;
  /** לבדיקות בלבד; אחרת מונפק מטמון טוקן משלו מה-`config` */
  getAccessToken?: () => Promise<string>;
}

/** הודעה כפי ש-`users.messages.get?format=full` מחזיר אותה */
export interface GmailMessage {
  id: string;
  threadId: string;
  /** זמן הקבלה במילישניות מהאפוק, כמחרוזת */
  internalDate?: string;
  payload?: GmailMessagePart;
}

interface GmailListResponse {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
}

// ─────────────────────────────── מעטפה ───────────────────────────────

/**
 * מ-JSON של Gmail למעטפה (`MailEnvelope`) — הגבול שממנו והלאה הקוד אינו
 * יודע מאיזה ערוץ הגיעה ההודעה.
 *
 * הפונקציה טהורה ומיוצאת כדי שכל ההמרה תיבדק בלי רשת. שלוש החלטות בה:
 *
 * - **הכותרות נקראות דרך `headers.ts`** ולא ביד. כתובת שפוענחה אחרת כאן
 *   ובמקום אחר היא בדיוק הכשל השקט של EM-04 ו-EM-14: השולח אינו מזוהה,
 *   או שתשובה אינה מוצאת את הטיוטה שלה.
 * - **הכותרת (Subject) מפוענחת כאן** (RFC 2047) — `subject.ts` מקבל טקסט
 *   קריא ומניח זאת במפורש.
 * - **`raw` ו-`fullText` אינם כאן.** מה ייקרא כטקסט של ההודעה — גוף, ציטוט
 *   שהוסר, טקסט שחולץ מקובץ — הוא החלטה של השירות, ולמתאם אין בה חלק.
 */
export function toEnvelope(message: GmailMessage): MailEnvelope {
  const payload = message.payload ?? {};
  const headers = headerMap(payload.headers ?? []);
  const walked = walkPayload(payload);

  return {
    sourceId: message.id,
    sourceThreadId: message.threadId,
    rfcMessageId: normalizeMessageId(headers["message-id"]),
    inReplyTo: normalizeMessageId(headers["in-reply-to"]),
    references: parseMessageIds(headers["references"]),
    from: parseAddress(headers["from"]),
    to: parseAddressList(headers["to"]),
    cc: parseAddressList(headers["cc"]),
    subject: unfold(decodeRfc2047(headers["subject"] ?? "")),
    receivedAt: receivedAtOf(message, headers),
    headers,
    contentType: walked.contentType,
    text: walked.text,
    html: walked.html,
    parts: walked.parts,
  };
}

/**
 * כותרת לשורה לוגית אחת: קיפול (CRLF + רווח) הופך לרווח יחיד.
 *
 * זה אינו קוסמטי בשני קצוות. בכניסה, כלל הכותרת (`isIntakeSubject`) בודק
 * גבולות מילה, ושארית קיפול באמצע "תק\r\n לה" הייתה מפילה אותו; ביציאה,
 * הכותרת חוזרת לכותרת `Subject` של המייל החוזר, ו-CRLF שנשאר בה פותח שם
 * שורת כותרת חדשה (header injection).
 */
function unfold(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * זמן הקבלה: `internalDate` של Gmail, ובלעדיו כותרת `Date`.
 *
 * הסדר הזה ולא ההפוך — `internalDate` הוא הזמן שבו התיבה קיבלה את ההודעה,
 * וזה הזמן ש-`after:` בשאילתה מסנן לפיו; כותרת `Date` נכתבת אצל השולח,
 * ושעון מוטה אצלו היה מזיז מייל אל מחוץ לחלון ההפעלה (EM-22).
 *
 * כששניהם חסרים ההודעה **נזרקת ברעש** ולא מקבלת "עכשיו": הזמן הזה מכריע
 * אם המייל קדם להפעלת היכולת, ומי מאוחר יותר — התשובה או עריכה במערכת
 * (§5.ה4). ניחוש בשני המקומות האלה משנה נתונים בלי שאיש יראה.
 */
function receivedAtOf(message: GmailMessage, headers: Record<string, string>): Date {
  const fromInternal = message.internalDate ? new Date(Number(message.internalDate)) : null;
  if (fromInternal && isRealDate(fromInternal)) return fromInternal;

  const fromHeader = new Date(Date.parse(headers["date"] ?? ""));
  if (isRealDate(fromHeader)) return fromHeader;

  throw new MailSourceError(`להודעה ${message.id} אין internalDate ואין כותרת Date תקינה`, "permanent");
}

/**
 * האם זה `Date` שאפשר להשתמש בו.
 *
 * הבדיקה על ה-`Date` ולא על המספר, כי `new Date` אינו זורק על קלט שגוי אלא
 * מחזיר **Invalid Date בשקט** — גם על NaN וגם על מספר שמחוץ לטווח (למשל
 * `internalDate` משובש). תאריך כזה שממשיך הלאה נכשל בשקט בכל השוואה: גבול
 * ההפעלה (EM-22) ו"מי מאוחר יותר" (§5.ה4) שניהם מחזירים false, וזה בדיוק
 * מה שהזריקה למעלה נועדה למנוע. האידיום זהה ל-`draft/merge.ts` ול-`query.ts`.
 */
function isRealDate(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

// ─────────────────────────────── המתאם ───────────────────────────────

/**
 * כשל בהנפקת הטוקן → הכרעה, באותה שפה של שאר הקריאה.
 *
 * **בלי התרגום הזה דווקא הכשל שדורש אדם היה יוצא בלי סיווג.** הטוקן מונפק
 * לפני כל בקשה, ו-`invalid_grant` (refresh token שנשלל) הוא התקלה היחידה
 * במסלול שאינה חולפת לעולם. כ-`Error` בלי `kind` היא נופלת אצל הצינור
 * למסלול "שגיאה לא מוכרת" — ניסיונות חוזרים שלעולם לא יצליחו, תיבה ששותקת
 * ימים, והג׳וב "רץ" (הנימוק המלא ב-`source.ts`).
 *
 * דחיית הבקשה עצמה (4xx שאינו פסק זמן או הגבלת קצב) היא `auth`. בלי תשובה
 * בכלל (רשת, פסק זמן), 408/429/5xx, וגם 200 עם גוף שאינו נקרא — כולם
 * חולפים: אותה בקשה בדיוק תצליח בסבב הבא.
 */
function tokenErrorKind(error: unknown): MailErrorKind {
  const status = error instanceof GoogleTokenError ? error.status : undefined;
  if (status === undefined) return "transient";
  if (status === 408 || status === 429 || status >= 500) return "transient";
  return status >= 400 ? "auth" : "transient";
}

/**
 * מקור קריאה מעל Gmail API.
 *
 * הטוקן מגיע מהמטמון המשותף (`google/gmail-token.ts`) ולא מאחד משלו: אותו
 * refresh token משמש גם לשליחה, ומטמון שני היה מכפיל את בקשות הטוקן ואת
 * מצבי הכשל.
 */
export function gmailSource(config: GoogleOAuthConfig, deps: GmailSourceDeps = {}): MailSource {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const getAccessToken = deps.getAccessToken ?? createAccessTokenProvider(config, deps.fetch ? { fetch: deps.fetch } : {});

  /**
   * הבקשה היחידה בקובץ — ולכן גם הסיווג היחיד של שגיאות.
   *
   * גוף התשובה נכנס להודעת השגיאה: הסיווג ל-`scope` מול `auth` נקרא ממנו,
   * ובלעדיו `Job.lastError` היה אומר "403" ותו לא — שתי תקלות שונות לגמרי
   * עם אותו נוסח.
   */
  async function gmailGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${GMAIL_USER_API}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    let token: string;
    try {
      token = await getAccessToken();
    } catch (error) {
      throw new MailSourceError(`אין access token לקריאה מ-Gmail (${path}): ${String(error)}`, tokenErrorKind(error), {
        cause: error,
        ...(error instanceof GoogleTokenError && error.status !== undefined ? { status: error.status } : {}),
      });
    }

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // נפילת רשת או פסק זמן: אין קוד, ולכן `classifyMailError` מחזיר
      // `transient`. הסיבה המקורית נשמרת ב-`cause` ליומן.
      throw new MailSourceError(`קריאה מ-Gmail נכשלה (${path}): ${String(error)}`, classifyMailError(null, ""), {
        cause: error,
      });
    }

    const body = await response.text();
    if (!response.ok) {
      throw new MailSourceError(
        `קריאה מ-Gmail נכשלה (${path}, ${response.status}): ${body.slice(0, 300)}`,
        classifyMailError(response.status, body),
        { status: response.status },
      );
    }

    try {
      return JSON.parse(body) as T;
    } catch (error) {
      // תשובת 200 שאינה JSON היא כמעט תמיד דף שגיאה של שרת ביניים, ולכן
      // חולפת — ולא באג אצלנו.
      throw new MailSourceError(`תשובת Gmail אינה JSON (${path}): ${body.slice(0, 200)}`, "transient", { cause: error });
    }
  }

  return {
    name: "gmail",

    async getProfile() {
      const profile = await gmailGet<{ emailAddress?: string }>("/profile");
      if (!profile.emailAddress) throw new MailSourceError("תשובת הפרופיל של Gmail חסרה emailAddress", "permanent");
      return { emailAddress: profile.emailAddress };
    },

    async listIds(query, opts) {
      const page = await gmailGet<GmailListResponse>("/messages", {
        q: query,
        maxResults: String(MAX_LIST_RESULTS),
        ...(opts?.pageToken ? { pageToken: opts.pageToken } : {}),
      });

      return {
        // שדה חסר הוא "אין הודעות", לא שגיאה: Gmail משמיט את `messages`
        // כשהשאילתה לא מצאה דבר, וזה המצב הרגיל ברוב הסבבים.
        ids: (page.messages ?? []).map((item) => item.id).filter(Boolean),
        ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
      };
    },

    async getMessage(id) {
      try {
        return toEnvelope(await gmailGet<GmailMessage>(`/messages/${encodeURIComponent(id)}`, { format: "full" }));
      } catch (error) {
        // ההודעה נמחקה מהתיבה בין הרשימה לקריאה — קורה, ואינו כשל: הצינור
        // רושם `GONE` וממשיך. כל סיווג אחר ממשיך למעלה כמות שהוא.
        if (error instanceof MailSourceError && error.kind === "not_found") return null;
        throw error;
      }
    },

    async getAttachment(messageId, attachmentId) {
      const part = await gmailGet<{ data?: string }>(
        `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      );
      // `data` ריק הוא קובץ באורך אפס, ולכן הבדיקה היא על היעדר השדה בלבד.
      if (part.data === undefined || part.data === null) {
        throw new MailSourceError(`תשובת Gmail על קובץ מצורף חסרה data (${messageId})`, "permanent");
      }
      return Buffer.from(part.data, "base64url");
    },
  };
}
