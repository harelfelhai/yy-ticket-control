import type { MailDirection, MailOutcome, MailState } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { type Viewer, type AssignmentAccessView, type TicketAccessView, canViewTicket } from "@/lib/permissions";
import { SKIPPED_AFTER_CLOSE } from "./email-reply";

/**
 * התכתבות המייל של פנייה — קריאה בלבד (EM-M01, §3.1, §3.2 שדה 20).
 *
 * **"אותן שורות עצמן".** ההערה שמעל `MailboxMessage` בסכימה קובעת זאת
 * במפורש: היומן שמבטיח "אותו מייל נבדק פעמיים — נקלט פעם אחת", וההתכתבות
 * שמוצגת למשתמש (מסך 7, וחלון "פרטים" אחרי השיגור — מסך 2), הן **אותה
 * טבלה**. אין כאן פרויקציה נפרדת ואין העתקה: כל שורת `MailboxMessage`
 * ששייכת ל-`MailThread` של הפנייה **היא** ההתכתבות, מוצג ישירות ממה
 * שהוכרע.
 *
 * **מה נכלל, ולמה.** §3.1 מגדיר: "המייל המקורי, התשובות שנקלטו והמיילים
 * שהמערכת שלחה, לפי הסדר". בפועל, השורות שמגיעות ל-`MailThread` כלל אינן
 * כוללות מייל שהמערכת התעלמה ממנו **לפני** זיהוי השרשרת (שלבים 3–6
 * בסולם של `email-intake.ts`: לפני הפעלה, מהתיבה עצמה, תשובה אוטומטית,
 * שולח לא מורשה) — שורות כאלה אינן מקבלות `threadId` כלל, ולכן שאילתה
 * ששייכת ל-thread כבר מוציאה אותן מאליה. מה שכן עשוי להגיע לכאן הוא תשובה
 * **בתוך** שרשרת מוכרת שהוכרעה כ"לא נקלטת" (למשל IGNORED_UNAUTHORIZED
 * על תשובה מקבלן שהיה בהעתק, או REPLY_NOT_PERMITTED) — אלה נכללים
 * במכוון: "התשובה שלו קרתה" הוא עובדה על ההתכתבות גם כשהתוכן שלה לא זז
 * לטיוטה, בדיוק כמו ש-EM-A08 (§7 #77) דורש להציג גם דילוג מפורש על מייל
 * חוזר ("הטיוטה שוגרה/נמחקה בין קליטה לשליחה") — אירוע בלי תוכן, אבל
 * חלק מהתיעוד של מה שקרה.
 *
 * **מה כן מסונן: `state === "PENDING"` בלבד.** זה המצב היחיד שאינו מתאר
 * שום דבר שקרה בפועל — הוא "עדיין לא": בכיוון נכנס, ההודעה עדיין
 * בעיבוד/בהמתנה לניסיון הבא ואין לה עדיין לא הכרעה ולא תוכן; בכיוון יוצא,
 * `scheduleReply` יוצר את השורה **בלי** נושא או גוף (הם מורכבים רק בזמן
 * השליחה עצמה, ב-`email-reply.ts`) — שורה `PENDING` יוצאת היא תור-לשליחה
 * ריק תוכן, לא מייל. כל מצב אחר — `DONE`, `SENT`, `SIMULATED`, `SKIPPED`,
 * `FAILED` — מתאר משהו שכבר קרה (הוכרע / נשלח / נכתב ללוג בלבד / דולג
 * במפורש / מיצה ניסיונות), ולכן מוצג.
 *
 * **הסדר** הוא `createdAt` עולה. זהו השדה היחיד שמובטח קיים על **כל**
 * שורה (ברירת מחדל של הסכימה) ומשקף את סדר האירועים בפועל: הודעה נכנסת
 * נוצרת כשהיא נקראת מהתיבה, ותשובה יוצאת נוצרת מיד אחרי ההכרעה על
 * ההודעה שהיא עונה עליה (`scheduleReply`, **באותה טרנזאקציה**) — לפני
 * שהיא נשלחת בפועל. `receivedAt`/`sentAt` אינם מתאימים לסדר גלובלי: הם
 * חסרים בדיוק בשורות שהניקוד תלוי בהן (שורה שהתעלמו ממנה בלי מעטפה, שורה
 * יוצאת שעוד לא נשלחה).
 *
 * **אין כאן כתיבה.** מסך 7 (S8) יציג את מה שהפונקציה הזו מחזירה; עריכה
 * ומחיקה של טיוטה עוברות דרך `draft-fields.ts` בלבד — ראה EM-M01: "אינה
 * ניתנת לעריכה".
 */

/** קובץ מצורף בהתכתבות — לתצוגה ולבניית קישור הורדה עתידי (מודול X) */
export interface CorrespondenceAttachment {
  /** מזהה `MailboxAttachment` — המפתח לקישור ההורדה שמודול X יבנה */
  id: string;
  filename: string | null;
  mimeType: string;
  sizeBytes: number;
  /** האם הקובץ נכנס כמדיה לטיוטה (תמונה/וידאו/אודיו/PDF) */
  isMedia: boolean;
  /** רשומת המדיה שנוצרה ממנו, אם קיימת עדיין (יכולה להיות הוסרה — מסך 7) */
  mediaFileId: string | null;
  /** למה הקובץ לא נשמר או לא נכנס לטיוטה — גדול מדי, זהה לקיים, הוסר... */
  skippedReason: string | null;
  /**
   * האם יש לקובץ בתים שמורים (`storageKey`). רק קובץ כזה מקבל קישור: הצינור
   * שומר בתים של מדיה שנכנסה לטיוטה בלבד, ו-`api/email-attachments/[id]`
   * מחזיר 404 לכל השאר — קישור אליהם היה קישור מת.
   */
  downloadable: boolean;
}

/** הודעת מייל אחת בהתכתבות — נכנסת או יוצאת, לפי הסדר */
export interface CorrespondenceMessage {
  id: string;
  direction: MailDirection;
  state: MailState;
  outcome: MailOutcome | null;
  fromAddress: string | null;
  fromName: string | null;
  toAddress: string | null;
  subject: string | null;
  /** `bodyText` בלבד — לא `fullText`, שכולל ציטוט ומיועד לאבחון (הערת הסכימה) */
  bodyText: string | null;
  receivedAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  /**
   * מייל יוצא שדולג כי הטיוטה שוגרה או נמחקה לפני השליחה (§7 שורה 77) — ולא
   * מסיבה אחרת. רק במקרה הזה ההתכתבות אומרת "שוגרה או נמחקה"; דילוג מסיבה
   * אחרת על טיוטה שעדיין פתוחה היה מקבל סיבה שגויה.
   */
  skippedAfterClose: boolean;
  attachments: CorrespondenceAttachment[];
}

/** שדות הפנייה הדרושים לבדיקת ההרשאה (`canViewTicket`) ותו לא */
const TICKET_ACCESS_SELECT = {
  siteId: true,
  createdById: true,
  closedAt: true,
  assignments: true,
} as const;

/**
 * טוען פנייה לבדיקת הרשאה בלבד — לא את ההתכתבות עצמה.
 *
 * שאילתה נפרדת ורזה, כדי ששני הקוראים (`getTicketCorrespondence` כאן,
 * ומודול X בהמשך — קובץ מצורף בודד) לא ייגררו כל פעם לטעינת שרשור שלם רק
 * כדי לענות "מותר?".
 */
async function loadTicketAccess(
  ticketId: string,
): Promise<(TicketAccessView & { assignments: AssignmentAccessView[] }) | null> {
  return db.ticket.findUnique({ where: { id: ticketId }, select: TICKET_ACCESS_SELECT });
}

/**
 * האם הצופה רשאי לראות את התכתבות המייל של הפנייה.
 *
 * זהה להרשאת צפייה בפנייה עצמה (`canViewTicket`) — ההתכתבות מוצמדת לפנייה
 * ואינה ישות נפרדת עם הרשאות משלה (EM-M01). מיוצא בנפרד כדי שמודול X
 * (הגשת קובץ מצורף בודד, במתכונת `getViewableMedia`/`api/media/[id]`)
 * ישתמש באותה בדיקה בדיוק בלי לשכפל את שאילתת הטעינה וההיגיון.
 */
export async function canViewCorrespondence(viewer: Viewer, ticketId: string): Promise<boolean> {
  if (!mayViewAnyCorrespondence(viewer)) return false;
  const ticket = await loadTicketAccess(ticketId);
  if (!ticket) return false;
  return canViewTicket(viewer, ticket, ticket.assignments);
}

/**
 * **נמען חיצוני אינו רואה התכתבות לעולם**, גם כשהוא משויך לפנייה.
 *
 * ההתכתבות הייתה עם השולח ולא עם הנמענים (מסך 2: "אינה נכנסת לשרשור"),
 * והפורטל (מסך 8) מציג את השרשור בלבד. היא גם כוללת את מה שמנהל הסיר
 * בכוונה מהטיוטה לפני השיגור — לוגו, תמונה שלא נועדה לקבלן (EM-S7-05) —
 * ולכן קבלן משויך שמחזיק מזהה של קובץ מצורף אינו רשאי להוריד אותו.
 */
function mayViewAnyCorrespondence(viewer: Viewer): boolean {
  return viewer.kind !== "professional";
}

/**
 * מרכיב את התכתבות המייל של פנייה, לפי הסדר.
 *
 * שלוש תוצאות אפשריות, ומכוון שהן שונות זו מזו:
 * - `null` — הפנייה אינה קיימת, **או** שהצופה אינו רשאי לראות אותה. שתי
 *   הסיבות מוחזרות באותה צורה בכוונה (כמו `getViewableMedia`): אין סיבה
 *   לחשוף לצופה שאינו מורשה האם פנייה כזו בכלל קיימת.
 * - `[]` — הפנייה קיימת והצופה רשאי, אבל אין לה שרשרת מייל כלל (פנייה
 *   שלא נפתחה במייל, או טיוטת מייל שעוד לא נוצרה לה `MailThread`).
 * - מערך לא ריק — ההתכתבות בפועל, לפי הסדר.
 */
export async function getTicketCorrespondence(
  viewer: Viewer,
  ticketId: string,
  /**
   * רק מה שנוצר עד הרגע הזה. חלון "פרטים" של פנייה משוגרת מציג "כל
   * ההתכתבות שקדמה לשיגור" (מסך 2, EM-S2-01): המייל החוזר שיוצא על תשובה
   * שהגיעה אחרי השיגור ("הפנייה כבר נשלחה") אינו חלק ממנה.
   */
  options: { before?: Date } = {},
): Promise<CorrespondenceMessage[] | null> {
  if (!mayViewAnyCorrespondence(viewer)) return null;
  const ticket = await loadTicketAccess(ticketId);
  if (!ticket) return null;
  if (!canViewTicket(viewer, ticket, ticket.assignments)) return null;

  const thread = await db.mailThread.findUnique({
    where: { ticketId },
    include: {
      messages: {
        // "עדיין לא" אינו התכתבות — ראה ההערה בראש הקובץ.
        where: {
          state: { not: "PENDING" },
          ...(options.before ? { createdAt: { lte: options.before } } : {}),
        },
        orderBy: { createdAt: "asc" },
        include: { attachments: { orderBy: { partIndex: "asc" } } },
      },
    },
  });
  if (!thread) return [];

  return thread.messages.map(toCorrespondenceMessage);
}

function toCorrespondenceMessage(message: {
  id: string;
  direction: MailDirection;
  state: MailState;
  outcome: MailOutcome | null;
  fromAddress: string | null;
  fromName: string | null;
  toAddress: string | null;
  subject: string | null;
  bodyText: string | null;
  receivedAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  detail: string | null;
  attachments: {
    id: string;
    filename: string | null;
    mimeType: string;
    sizeBytes: number;
    isMedia: boolean;
    mediaFileId: string | null;
    skippedReason: string | null;
    storageKey: string | null;
  }[];
}): CorrespondenceMessage {
  return {
    id: message.id,
    direction: message.direction,
    state: message.state,
    outcome: message.outcome,
    fromAddress: message.fromAddress,
    fromName: message.fromName,
    toAddress: message.toAddress,
    subject: message.subject,
    bodyText: message.bodyText,
    receivedAt: message.receivedAt,
    sentAt: message.sentAt,
    createdAt: message.createdAt,
    skippedAfterClose: message.state === "SKIPPED" && (message.detail ?? "").includes(SKIPPED_AFTER_CLOSE),
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      isMedia: attachment.isMedia,
      mediaFileId: attachment.mediaFileId,
      skippedReason: attachment.skippedReason,
      downloadable: attachment.storageKey !== null,
    })),
  };
}
