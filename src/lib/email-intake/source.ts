import type { MailEnvelope } from "./types";

/**
 * מקור הדואר הנכנס — הממשק שהצינור מכיר (אפיון §2.6, §5.ה3).
 *
 * **הממשק הוא ההגנה, לא המשמעת.** התיבה משותפת עם EasyInv, שרשימת העבודה
 * שלו היא "לא נקרא", וכל שינוי מצדנו — סימון כנקרא, העברה, מחיקה — היה
 * מעלים לו מסמך בלי שאיש יידע (EM-20, §5.ה3 כלל 3). לכן אין כאן פעולה
 * שמשנה: לא "סמן", לא "העבר", לא "מחק". מי שירצה להוסיף אחת יצטרך לשנות
 * את הטיפוס הזה, לא לשכוח כלל שכתוב בתיעוד. השכבה השנייה היא ההרשאה
 * (`gmail.readonly`), והשלישית היא סריקת המקור
 * (`tests/conformance/source/email-intake.test.ts`).
 *
 * הממשק גם אינו יודע Gmail: הוא מחזיר `MailEnvelope`, וערוץ נוסף בעתיד
 * (IMAP, תיבה שנייה) הוא מימוש נוסף ולא שינוי בצינור.
 */
export interface MailSource {
  /** שם המימוש, ליומן ולשגיאות ("gmail") */
  readonly name: string;
  /** כתובת התיבה שהטוקן פותח — נבדקת מול ההגדרה לפני שסבב נכנס לתיבה הלא נכונה */
  getProfile(): Promise<{ emailAddress: string }>;
  /** מזהי ההודעות לשאילתה אחת, עמוד אחד. המשך דרך `nextPageToken`. */
  listIds(query: string, opts?: { pageToken?: string }): Promise<{ ids: string[]; nextPageToken?: string }>;
  /** ההודעה כמעטפה, או `null` כשאיננה עוד בתיבה (הכרעה `GONE`) */
  getMessage(id: string): Promise<MailEnvelope | null>;
  /** הבתים של קובץ מצורף שלא הגיע בתוך ההודעה (`MailPart.sourceRef`) */
  getAttachment(messageId: string, attachmentId: string): Promise<Buffer>;
}

/**
 * סוג הכשל — **מה הצינור אמור לעשות**, לא מה קרה.
 *
 * ההפרדה הזו היא כל הערך של הסיווג: לצינור אין דרך אחרת לדעת אם לנסות שוב
 * או לעצור, וניחוש לכל אחד משני הכיוונים נכשל בשקט. `transient` שנקרא
 * `permanent` מפיל מייל אמיתי; `auth` שנקרא `transient` הופך רפרש-טוקן
 * שנשלל לניסיונות חוזרים שלעולם לא יצליחו — והתיבה שותקת ימים בלי שאיש
 * יידע, כי "הג׳וב רץ".
 *
 * - `transient` — לנסות שוב לנצח, עם השהיה גדלה (רשת, 429, 5xx).
 * - `auth` — הטוקן אינו תקף עוד. לעצור ברעש; דורש אדם.
 * - `scope` — הטוקן תקף אך אינו כולל `gmail.readonly`. גם הוא דורש אדם,
 *   והוא מופרד מ-`auth` כי התיקון אחר לגמרי: הנפקה מחדש עם היקף, לא
 *   התחברות מחדש.
 * - `not_found` — ההודעה או הקובץ אינם שם. לא כשל של הערוץ.
 * - `permanent` — בקשה שגויה או תשובה שאינה נקראת. באג אצלנו.
 */
export type MailErrorKind = "transient" | "auth" | "scope" | "not_found" | "permanent";

/** כשל בקריאה מהתיבה, עם ההכרעה מה לעשות בו (`kind`) */
export class MailSourceError extends Error {
  readonly kind: MailErrorKind;
  /** קוד ה-HTTP, כשהייתה תשובה. כשל רשת מגיע בלי קוד. */
  readonly status?: number;

  constructor(message: string, kind: MailErrorKind, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "MailSourceError";
    this.kind = kind;
    if (options.status !== undefined) this.status = options.status;
  }
}

/**
 * סימנים בגוף התשובה שאומרים "הבקשה נדחתה זמנית", ולא "אין לך הרשאה".
 *
 * **הם נבדקים לפני כל השאר, וזו הנקודה העדינה בפונקציה.** Google מחזירה
 * הגבלת קצב של Gmail כ-**403**, לא כ-429 — אותו קוד שבו היא מחזירה "אין
 * הרשאה". סיווג לפי הקוד בלבד היה הופך הגבלת קצב לעצירה ברעש שדורשת אדם,
 * בכל פעם שסבב פוגש תיבה עמוסה, והערוץ היה נעצר עד שמישהו יבחין.
 */
const TRANSIENT_HINT = /rateLimitExceeded|quotaExceeded|backendError|SERVICE_UNAVAILABLE|UNAVAILABLE/i;

/**
 * סימנים להיקף חסר. Google כותבת אותם בשתי צורות: הודעה באנגלית
 * ("Request had insufficient authentication scopes") ו-`reason` מובנה
 * (`ACCESS_TOKEN_SCOPE_INSUFFICIENT`, `insufficientPermissions`).
 */
const SCOPE_HINT = /insufficient|scope/i;

/**
 * מקוד ותשובה — להכרעה (`MailErrorKind`).
 *
 * `status === null` הוא כשל שלא הגיע לתשובה כלל: נפילת רשת, DNS, או פסק
 * זמן שלנו. כולם חולפים בהגדרה.
 *
 * 408 ו-429 הם פסק זמן והגבלת קצב מפורשים; 5xx הוא צד הספק. 404 מופרד כי
 * הוא התשובה התקינה על הודעה שנמחקה מהתיבה בין הרשימה לקריאה — מצב שקורה
 * ואינו תקלה. כל השאר (400, 422...) הוא בקשה שאנחנו בנינו לא נכון.
 */
export function classifyMailError(status: number | null | undefined, body: string): MailErrorKind {
  if (status === null || status === undefined) return "transient";
  if (status === 401 || status === 403) {
    if (TRANSIENT_HINT.test(body)) return "transient";
    return SCOPE_HINT.test(body) ? "scope" : "auth";
  }
  if (status === 404) return "not_found";
  if (status === 408 || status === 429 || status >= 500) return "transient";
  return "permanent";
}
