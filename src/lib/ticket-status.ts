import type { AssignmentStatus } from "@/generated/prisma/enums";
import { he } from "./he";

/**
 * חישוב מצב הפנייה מתוך סטטוסי השיוכים.
 *
 * זהו הקובץ שקובע מה המשתמש רואה בלוח, ולכן הוא נשמר טהור לחלוטין: בלי
 * גישה ל-DB, בלי `Date.now()`, בלי תלות ב-React. כל קלט מגיע כפרמטר —
 * כולל "עכשיו" — כדי שכל שורה בטבלאות §3.5 ו-§5.ג באפיון תהיה ניתנת
 * לבדיקה ישירה, כולל מקרי הקצה.
 *
 * למה סטטוס נגזר ולא שדה שמור: פנייה משויכת לכמה נמענים, כל אחד עם סטטוס
 * משלו. שדה סטטוס על הפנייה היה נכנס לסתירה עם השיוכים ברגע שהראשון מסמן
 * "טופל", ומצב שמור-וסותר הוא בדיוק מה שמאבד אמון המשתמש.
 */

/** סטטוס הפנייה כפי שהוא מוצג — לעולם אינו נערך ידנית (אפיון §3.5) */
export type DerivedTicketStatus =
  | "CLOSED"
  | "DRAFT"
  | "AWAITING_OPENER_QUESTION"
  | "AWAITING_OPENER_APPROVAL"
  | "PARTIAL"
  | "VIEWED"
  | "NEW";

/** קבוצת הקיבוץ בלוח הראשי, לפי אצל מי הכדור (אפיון §4 מסך 1) */
export type BoardSection = "ACTION_REQUIRED" | "WITH_RECIPIENTS" | "ARCHIVE";

/** המידע המינימלי על שיוך שנדרש כדי לגזור מצב ולנסח סיבה */
export interface AssignmentView {
  status: AssignmentStatus;
  /** שם הנמען, לשימוש בטקסט הסיבה ("יוסי שאל שאלה") */
  recipientName: string;
}

/** המידע המינימלי על פנייה שנדרש כדי לגזור מצב */
export interface TicketView {
  isDraft: boolean;
  closedAt: Date | null;
  /** סומן על ידי הג'וב היומי כפנייה ללא תנועה */
  escalated: boolean;
  lastActivityAt: Date;
  /** שם המנהל שסימן "אני מטפל", אם יש */
  handlerName?: string | null;
  /**
   * ההודעה האחרונה בשרשור נכתבה בידי **נמען**, ואיש מהצוות לא הגיב אחריה.
   *
   * דגל סקציה ולא סטטוס, בדיוק כמו `escalated`. סטטוס הפנייה מתאר את
   * התקדמות השיוכים ("כמה סיימו"), בעוד ש"אצל מי הכדור" הוא בדיוק מה
   * ש-`BoardSection` אומר — ולכן הודעה שממתינה למענה מזיזה את הפנייה בלי
   * לשקר על מצב העבודה. השם הוא של הכותב, לשורת הסיבה.
   */
  awaitingReply?: { recipientName: string } | null;
}

/** ההודעה האחרונה בשרשור, בשדות שנדרשים כדי לדעת מי כתב אותה */
export interface LastMessageView {
  authorUserId: string | null;
  authorProfessionalId: string | null;
  authorName: string;
}

/**
 * ההודעה האחרונה כפי שהיא חוזרת מהשאילתה, בצורה שהגזירה מכירה.
 *
 * מקבל מערך ולא איבר, מפני ששלושת הקוראים שולפים `take: 1` — מערך ריק
 * או בן איבר אחד. כך אף קורא אינו כותב `messages[0]` בעצמו ומסתכן בשכחת
 * המקרה הריק.
 */
export function toLastMessageView(
  messages: readonly {
    authorUserId: string | null;
    authorProfessionalId: string | null;
    authorUser: { name: string } | null;
    authorProfessional: { name: string } | null;
  }[],
): LastMessageView | null {
  const last = messages[0];
  if (!last) return null;

  return {
    authorUserId: last.authorUserId,
    authorProfessionalId: last.authorProfessionalId,
    authorName: last.authorProfessional?.name ?? last.authorUser?.name ?? "",
  };
}

/**
 * האם הפנייה ממתינה למענה של הצוות.
 *
 * טהורה ומשותפת לשלושה קוראים (הלוח, מסך הפנייה, החיפוש), כדי שהכלל
 * "הכדור אצלנו" יהיה זהה בכל מקום. שלושה תנאים, וכל אחד מהם מוציא מצב
 * שנראה דומה אך אינו:
 *
 * 1. **יש הודעה אחרונה.** פנייה בלי שרשור אינה ממתינה לדבר.
 * 2. **יש לה כותב.** אירוע מערכת (`שויך לרונית`) אינו הודעה של אדם.
 * 3. **הכותב הוא נמען פעיל.** מנהל שכתב אחרון אינו ממתין לעצמו — וזה
 *    גם מה שמנקה את הדגל ברגע שמישהו מהצוות עונה, בלי שדה שמור ובלי
 *    פעולת "סימון כנקרא" שמישהו צריך לזכור לבצע.
 */
export function deriveAwaitingReply(
  lastMessage: LastMessageView | null,
  activeRecipientIds: readonly string[],
): { recipientName: string } | null {
  if (!lastMessage) return null;

  const authorId = lastMessage.authorProfessionalId ?? lastMessage.authorUserId;
  if (!authorId) return null;
  if (!activeRecipientIds.includes(authorId)) return null;

  return { recipientName: lastMessage.authorName };
}

/** מספר הימים ללא תנועה שאחריו פנייה פעילה מוסלמת (אפיון §5.ג) */
export const STALE_DAYS_THRESHOLD = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** שיוך שהוסר אינו נספר בשום חישוב — הנמען כבר לא בתמונה (אפיון §3.4) */
export function activeAssignments(assignments: readonly AssignmentView[]): AssignmentView[] {
  return assignments.filter((a) => a.status !== "REMOVED");
}

/**
 * הכלל הראשון שמתקיים הוא הקובע — סדר הבדיקות כאן הוא בדיוק סדר השורות
 * בטבלה §3.5 באפיון, ואסור לשנות אותו.
 */
export function deriveTicketStatus(
  ticket: TicketView,
  assignments: readonly AssignmentView[],
): DerivedTicketStatus {
  if (ticket.closedAt !== null) return "CLOSED";
  if (ticket.isDraft) return "DRAFT";

  const active = activeAssignments(assignments);

  // "שאלה" גובר על הכול למעט סגירה: נמען חסום עוצר עבודה בשטח.
  if (active.some((a) => a.status === "QUESTION")) return "AWAITING_OPENER_QUESTION";

  const done = active.filter((a) => a.status === "DONE").length;
  if (active.length > 0 && done === active.length) return "AWAITING_OPENER_APPROVAL";
  if (done > 0) return "PARTIAL";

  if (active.some((a) => a.status === "VIEWED")) return "VIEWED";

  // כולל את המקרה שאין שיוכים כלל, או שכולם הוסרו: הפנייה עדיין פעילה
  // וממתינה לשיוך — היא לא נעלמת ולא נסגרת מעצמה (אפיון §5.ב).
  return "NEW";
}

/**
 * הפנייה נכנסת ל"דורש ממך" כשהכדור אצל צוות החברה: טיוטה להשלמה, שאלה
 * שמחכה לתשובה, אישור סגירה, או הסלמה על היעדר תנועה.
 *
 * הפונקציה אינה תלויה בזהות הצופה, בכוונה: לפי §5.ז מנהל עבודה רואה ופועל
 * על **כל** הפניות באתר שלו ולא רק על שלו, ולכן "הכדור אצלנו" הוא מצב של
 * הפנייה ולא יחס בינה לבין משתמש מסוים.
 */
export function deriveBoardSection(
  status: DerivedTicketStatus,
  escalated: boolean,
  awaitingReply = false,
): BoardSection {
  if (status === "CLOSED") return "ARCHIVE";
  if (
    status === "DRAFT" ||
    status === "AWAITING_OPENER_QUESTION" ||
    status === "AWAITING_OPENER_APPROVAL"
  ) {
    return "ACTION_REQUIRED";
  }
  // הודעה מנמען שממתינה למענה היא הכדור אצלנו לכל דבר. בלי השורה הזו קבלן
  // היה כותב "צריך מפתח לחדר החשמל", והפנייה הייתה נשארת ב"אצל הנמענים" —
  // כלומר במקום שמנהל אינו סורק, כי לכאורה מישהו אחר מטפל בה.
  return escalated || awaitingReply ? "ACTION_REQUIRED" : "WITH_RECIPIENTS";
}

/** מספר ימים שלמים שחלפו מאז התנועה האחרונה */
export function daysWithoutActivity(ticket: TicketView, now: Date): number {
  return Math.floor((now.getTime() - ticket.lastActivityAt.getTime()) / MS_PER_DAY);
}

/** האם הפנייה חצתה את סף היעדר התנועה. פנייה סגורה לעולם אינה מוסלמת. */
export function isStale(ticket: TicketView, now: Date): boolean {
  if (ticket.closedAt !== null || ticket.isDraft) return false;
  return daysWithoutActivity(ticket, now) >= STALE_DAYS_THRESHOLD;
}

/**
 * שורת ההסבר על כרטיס הפנייה: למה היא נמצאת בקבוצה הזו.
 *
 * הסדר נגזר משאלה אחת — מה גרם לפנייה להיות במקום שבו היא נמצאת. הסלמה
 * נבדקת אחרי המצבים שממילא מכניסים ל"דורש ממך", כי רק כשהמצב עצמו לא
 * מסביר את המיקום, ההסלמה היא ההסבר. בלי הסדר הזה פנייה עם שאלה פתוחה
 * הייתה מציגה "ללא תנועה 9 ימים" במקום את השאלה שממתינה לתשובה.
 */
export function reasonText(
  ticket: TicketView,
  assignments: readonly AssignmentView[],
  now: Date,
): string {
  const status = deriveTicketStatus(ticket, assignments);
  const active = activeAssignments(assignments);

  if (status === "CLOSED") return he.reason.closed;
  if (status === "DRAFT") return he.reason.draft;

  if (status === "AWAITING_OPENER_QUESTION") {
    const askers = active.filter((a) => a.status === "QUESTION");
    const [first, ...rest] = askers;
    const name = first?.recipientName ?? "";
    return rest.length === 0
      ? he.reason.questionOne(name)
      : he.reason.questionMany(name, rest.length);
  }

  if (status === "AWAITING_OPENER_APPROVAL") return he.reason.allDone;

  /*
   * לפני ההסלמה, ובכוונה: הודעה טרייה מסבירה את מיקום הפנייה טוב יותר
   * מ"ללא תנועה 9 ימים" — ובפועל הודעה חדשה מאפסת את מד התנועה ממילא,
   * כך שהסדר הזה נכון גם כשהשתיים מתנגשות.
   */
  if (ticket.awaitingReply) return he.reason.messageFrom(ticket.awaitingReply.recipientName);

  if (ticket.escalated) return he.reason.stale(daysWithoutActivity(ticket, now));

  if (status === "PARTIAL") {
    const done = active.filter((a) => a.status === "DONE").length;
    return he.reason.partial(done, active.length);
  }

  if (ticket.handlerName) return he.reason.handler(ticket.handlerName);

  if (status === "VIEWED") return he.reason.viewedNoReply;

  return active.length === 0 ? he.reason.noRecipients : he.reason.awaitingFirstView;
}
