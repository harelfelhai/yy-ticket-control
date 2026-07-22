import type { AssignmentStatus, Role } from "@/generated/prisma/enums";

/**
 * מקור האמת היחיד לשאלה "מי רשאי לעשות מה" (אפיון §5.ז).
 *
 * הפונקציות כאן טהורות ומקבלות את כל ההקשר כפרמטרים, כדי שכל route handler
 * ישאל את אותה שאלה ויקבל את אותה תשובה. הרשאה שנבדקת בשני מקומות בשתי
 * דרכים היא הרשאה שבסוף תיפרץ באחד מהם.
 *
 * שים לב שהפונקציות אינן קובעות מה **נראה** ברשימות — סינון רשימה נעשה
 * בשאילתה עצמה, כדי לא לשלוף מה-DB מה שממילא ייזרק.
 */

/** מי מבצע את הפעולה: משתמש פנימי מחובר, או נמען חיצוני שנכנס בקישור */
export type Viewer =
  | { kind: "user"; id: string; role: Role; siteId: string | null }
  | { kind: "professional"; id: string };

export interface TicketAccessView {
  siteId: string;
  createdById: string;
  closedAt: Date | null;
}

/** שיוך כפי שנדרש לבדיקת גישה של נמען חיצוני */
export interface AssignmentAccessView {
  professionalId: string | null;
  userId: string | null;
  status: AssignmentStatus;
}

export function isUser(viewer: Viewer): viewer is Extract<Viewer, { kind: "user" }> {
  return viewer.kind === "user";
}

/**
 * האם לנמען יש שיוך פעיל לפנייה.
 * הבדיקה דינמית ומתבצעת בכל בקשה — זו הסיבה שקישור הקסם יכול להיות ללא
 * תפוגה: ברגע שמנהל מסיר נמען, הקישור שבידיו מפסיק לפתוח את הפנייה.
 */
export function hasActiveAssignment(
  viewer: Viewer,
  assignments: readonly AssignmentAccessView[],
): boolean {
  return assignments.some(
    (a) =>
      a.status !== "REMOVED" &&
      (viewer.kind === "professional" ? a.professionalId === viewer.id : a.userId === viewer.id),
  );
}

export function canViewTicket(
  viewer: Viewer,
  ticket: TicketAccessView,
  assignments: readonly AssignmentAccessView[] = [],
): boolean {
  if (viewer.kind === "professional") return hasActiveAssignment(viewer, assignments);

  switch (viewer.role) {
    case "ADMIN":
    case "OWNER":
      return true;
    // מנהל עבודה רואה את **כל** הפניות באתר שלו, לא רק את שלו — אבל רק בו.
    case "SITE_MANAGER":
      return viewer.siteId !== null && viewer.siteId === ticket.siteId;
  }
}

/**
 * פתיחת פנייה חדשה באתר נתון.
 * בעלים פותח פניות בכל אתר (אפיון §5.ז), מנהל עבודה רק בשלו, ונמען כלל לא —
 * הוא מקבל פניות ואינו יוצר אותן.
 */
export function canCreateTicketInSite(viewer: Viewer, siteId: string): boolean {
  if (!isUser(viewer)) return false;
  if (viewer.role === "SITE_MANAGER") return viewer.siteId === siteId;
  return true;
}

/**
 * סגירה היא שיקול דעת אנושי, ולכן שמורה לפותח או למנהל המערכת (אפיון §5.א).
 * ‏"טופל" מנמען הוא דיווח, לא אימות — ולכן נמען לעולם אינו סוגר.
 * גם בעלים אינו סוגר פנייה שלא פתח.
 */
export function canCloseTicket(viewer: Viewer, ticket: TicketAccessView): boolean {
  if (!isUser(viewer)) return false;
  return viewer.role === "ADMIN" || ticket.createdById === viewer.id;
}

/** פתיחה מחדש היא היפוך של הסגירה, ולכן נשמרת לאותם אנשים */
export function canReopenTicket(viewer: Viewer, ticket: TicketAccessView): boolean {
  return canCloseTicket(viewer, ticket);
}

/**
 * מחיקה שמורה למנהל המערכת ולכפילויות ולרשומות שגויות בלבד.
 * פנייה אמיתית אינה נמחקת לעולם — זו החלטה מפורשת של המשתמש, ולכן אין כאן
 * שום מסלול נוסף.
 */
export function canDeleteTicket(viewer: Viewer): boolean {
  return isUser(viewer) && viewer.role === "ADMIN";
}

/**
 * הוספה והסרה של נמענים.
 * בעלים נכלל רק עבור פניות שהוא עצמו פתח: §5.ז מתיר לו "לפתוח פניות בכל
 * אתר", ופתיחה בלי יכולת לשייך נמען אינה שלמה.
 */
export function canEditAssignments(viewer: Viewer, ticket: TicketAccessView): boolean {
  if (!isUser(viewer)) return false;
  if (viewer.role === "ADMIN") return true;
  if (viewer.role === "SITE_MANAGER") return viewer.siteId === ticket.siteId;
  return ticket.createdById === viewer.id;
}

/**
 * כתיבה בשרשור.
 * לנמען הכתיבה נחסמת בפנייה סגורה (אפיון §5.ו): "הפנייה נסגרה. פנה למנהל
 * העבודה." משתמש פנימי כן רשאי לכתוב בפנייה סגורה — הוא זה שיכול לפתוח
 * אותה מחדש, ותיעוד של החלטה אחרי סגירה הוא מידע לגיטימי.
 */
export function canCommentOnTicket(
  viewer: Viewer,
  ticket: TicketAccessView,
  assignments: readonly AssignmentAccessView[] = [],
): boolean {
  if (viewer.kind === "professional") {
    if (ticket.closedAt !== null) return false;
    return hasActiveAssignment(viewer, assignments);
  }
  return canViewTicket(viewer, ticket, assignments);
}

/** סימון "אני מטפל" הוא סימון פנימי בין מנהלים; לנמען אין בו תפקיד */
export function canSetHandler(
  viewer: Viewer,
  ticket: TicketAccessView,
  assignments: readonly AssignmentAccessView[] = [],
): boolean {
  return isUser(viewer) && canViewTicket(viewer, ticket, assignments);
}

/**
 * צ׳אט התגית. תגית סגורה כברירת מחדל, ופתיחתה היא פעולה מפורשת (אפיון §5.ה).
 */
export function canViewTagChat(viewer: Viewer, grantedProfessionalIds: readonly string[]): boolean {
  if (viewer.kind === "professional") return grantedProfessionalIds.includes(viewer.id);
  return true;
}

/**
 * רשימת הפניות שבתגית.
 * זו הנקודה הרגישה ביותר במודל ההרשאות: פתיחת תגית לנמען חושפת לו את הצ׳אט
 * **בלבד**. נמען לעולם אינו רואה פנייה שלא שויכה אליו — גם לא דרך התגית.
 */
export function canViewTagTickets(viewer: Viewer): boolean {
  return isUser(viewer);
}
