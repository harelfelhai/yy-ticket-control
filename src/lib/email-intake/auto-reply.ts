import { normalizeHebrew } from "./subject";
import type { MailAddress } from "./types";

/**
 * זיהוי תשובה אוטומטית: "מחוץ למשרד", החזרת דואר, מייל שנוצר בידי מערכת
 * (EM-23, אפיון §5.ה3 כלל 7).
 *
 * **למה זה קריטי ולא קוסמטי:** המערכת עונה על כל מייל שהיא קולטת. בלי הזיהוי,
 * משיב אוטומטי שעונה למייל החוזר שלנו היה מקבל ממנו מייל חוזר, עונה עליו
 * שוב — לולאה שאין לה סוף, שבה כל סיבוב גם מעדכן טיוטה.
 *
 * **הכיוון בספק:** זיהוי שגוי כאוטומטי מפיל פנייה אמיתית בשקט, ולכן כל סימן
 * כאן הוא סימן מפורש שמערכות מציבות בכוונה (כותרות תקניות, כתובת ריקה
 * להחזרה, שולח של שרת דואר). קידומות בכותרת הן רשת ביטחון, ונבדקות רק
 * בתחילת הכותרת — אדם שכותב "Out of Office" באמצע משפט אינו מסווג.
 *
 * **`X-Auto-Response-Suppress` אינו סימן, בכוונה.** Outlook ו-Exchange מציבים
 * אותו גם במייל שאדם כתב, כבקשה למשיבים אוטומטיים *לא לענות* עליו. הוא מתאר
 * מה השולח מבקש, לא מי כתב.
 */

export interface AutoReplyInput {
  /** כותרות ההודעה בשמות באותיות קטנות (`headerMap`) */
  headers: Record<string, string>;
  subject: string;
  from: MailAddress | null;
  contentType: string;
}

/**
 * איזה סימן זיהה את ההודעה כאוטומטית. נשמר ביומן ההודעה, כדי שכשמישהו
 * שואל "למה המייל שלי לא נקלט" התשובה תהיה בנתונים ולא בניחוש.
 */
export type AutoReplySignal =
  | "auto-submitted"
  | "x-autoreply"
  | "precedence"
  | "return-path"
  | "content-type"
  | "from"
  | "subject";

/**
 * `Precedence` אינו תקני, אבל נפוץ: `bulk`/`list` מסמנים דיוור ורשימות
 * תפוצה, `junk` מסמן דואר שנוצר אוטומטית, ו-`auto_reply` מוצב בידי חלק
 * מהמשיבים האוטומטיים.
 */
const AUTO_PRECEDENCE = new Set(["bulk", "junk", "list", "auto_reply"]);

/** כותרות לא תקניות שמשיבים אוטומטיים ותיקים מציבים במקום `Auto-Submitted` */
const X_AUTOREPLY_HEADERS = ["x-autoreply", "x-autorespond", "x-autoresponse"];

/**
 * שולחים שהם שרת הדואר עצמו: החזרות (bounce) והודעות מסירה.
 * `postmaster` הוא כתובת חובה בכל דומיין (RFC 5321), ו-`mailer-daemon` הוא
 * השם שכמעט כל שרת דואר חותם בו על החזרה.
 */
const DAEMON_LOCAL_PARTS = new Set(["mailer-daemon", "postmaster"]);

/**
 * קידומות כותרת של תשובות אוטומטיות, באותיות קטנות.
 *
 * הרשימה כוללת את מה ש-Outlook (עברית ואנגלית), Gmail, Exchange, Postfix ו-Exim
 * מציבים. היא רשת ביטחון בלבד: כמעט כל אחד מהם מציב גם כותרת מפורשת. אדם
 * שמשיב לתשובה אוטומטית כותב "RE: Automatic reply", ולכן הבדיקה היא על
 * תחילת הכותרת בלבד — הקידומת `RE:` מוציאה אותו מהכלל.
 */
const AUTO_SUBJECT_PREFIXES = [
  "automatic reply:",
  "auto:",
  "autoreply",
  "auto-reply",
  "out of office",
  "undeliverable:",
  "delivery status notification",
  "mail delivery failure",
  "undelivered mail returned to sender",
  "mail delivery failed",
  "תשובה אוטומטית",
  "מחוץ למשרד",
  "לא ניתן היה למסור",
];

/**
 * האסימון הראשון של ערך כותרת: בלי הערות בסוגריים ובלי פרמטרים אחרי `;`.
 * `Auto-Submitted: auto-replied; owner-email="x"` ו-`no (comment)` הם צורות
 * חוקיות, והשוואה ישירה של הערך הייתה מפספסת אותן.
 */
function headerToken(value: string | undefined): string {
  if (value === undefined) return "";
  return value
    .replace(/\([^)]*\)/g, " ")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

/**
 * החלק המקומי של השולח. כשהכתובת לא פוענחה (`from` הוא null), נקרא מהכותרת
 * הגולמית: החזרות נשלחות לעיתים מ-"MAILER-DAEMON" בלי דומיין, שאינה כתובת
 * חוקית ולכן אינה מגיעה כ-`MailAddress` — ובדיוק אותן אסור לפספס.
 */
function senderLocalPart(input: AutoReplyInput): string | null {
  const raw = input.from?.address ?? rawFromAddress(input.headers.from);
  if (!raw) return null;
  const at = raw.lastIndexOf("@");
  return (at === -1 ? raw : raw.slice(0, at)).trim().toLowerCase();
}

function rawFromAddress(value: string | undefined): string | null {
  if (!value) return null;
  // הערה בסוגריים היא תחביר חוקי לשם השולח ("MAILER-DAEMON (Mail Delivery System)"),
  // ובלי הסרתה היא נקראת כחלק מהכתובת
  const bracketed = /<([^<>]*)>/.exec(value);
  const address = (bracketed ? bracketed[1] : value).replace(/\([^)]*\)/g, " ").trim();
  return address || null;
}

function subjectStartsWithAutoPrefix(subject: string): boolean {
  const normalized = normalizeHebrew(subject).trim().replace(/\s+/g, " ").toLowerCase();
  return AUTO_SUBJECT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * הסימן הראשון שמזהה את ההודעה כאוטומטית, או null להודעה של אדם.
 *
 * הסדר הוא מהסימן המפורש ביותר לחלש ביותר, כך שהסימן שנרשם ביומן הוא
 * המשכנע מביניהם.
 */
export function autoReplySignal(input: AutoReplyInput): AutoReplySignal | null {
  const { headers } = input;

  // RFC 3834: כל ערך שאינו `no` פירושו "נוצר בידי מכונה". ערך ריק אינו
  // אומר דבר ואינו נחשב — כותרת פגומה אינה סיבה להפיל פנייה של אדם.
  const autoSubmitted = headerToken(headers["auto-submitted"]);
  if (autoSubmitted && autoSubmitted !== "no") return "auto-submitted";

  for (const name of X_AUTOREPLY_HEADERS) {
    const token = headerToken(headers[name]);
    if (token && token !== "no" && token !== "false") return "x-autoreply";
  }

  if (AUTO_PRECEDENCE.has(headerToken(headers.precedence))) return "precedence";

  // Return-Path ריק הוא הסימן התקני להודעה שאסור לענות עליה (RFC 5321 §4.5.5):
  // כך נשלחות החזרות, כדי ששגיאה על החזרה לא תייצר החזרה נוספת.
  if (headers["return-path"] !== undefined && headers["return-path"].replace(/\s+/g, "") === "<>") {
    return "return-path";
  }

  // multipart/report הוא המבנה של הודעת מסירה (DSN) ושל אישור קריאה (MDN)
  if (headerToken(input.contentType) === "multipart/report") return "content-type";

  const localPart = senderLocalPart(input);
  if (localPart && DAEMON_LOCAL_PARTS.has(localPart)) return "from";

  if (subjectStartsWithAutoPrefix(input.subject)) return "subject";

  return null;
}

/** האם ההודעה היא תשובה אוטומטית שאין לקלוט ואין לענות עליה (EM-23) */
export function isAutoReply(input: AutoReplyInput): boolean {
  return autoReplySignal(input) !== null;
}
