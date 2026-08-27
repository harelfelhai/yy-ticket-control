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
 * ניהול המערכת (מסכים 11–15): אתרים, משתמשים, אנשי מקצוע, תחומים.
 * שמור למנהל המערכת הראשי בלבד (אפיון §5.ז) — הקמת משתמשים, שינוי תפקידים
 * ואיחוד כפילויות הם פעולות שמשנות את מבנה המערכת עצמו.
 */
export function canManageAdmin(viewer: Viewer): boolean {
  return isUser(viewer) && viewer.role === "ADMIN";
}

/**
 * מי רשאי לראות את **סקירת האתרים** — התצוגה חוצת-האתרים שבראש מסך הניהול.
 *
 * הפרדיקט השני, ולא הרחבה של `canManageAdmin`: מאז שהסקירה עברה לתוך
 * `/admin`, "רשאי לראות" ו"רשאי לנהל" חדלו להיות אותה שאלה. הבעלים רואה
 * את כל האתרים ואינו מקים משתמשים; מנהל עבודה מקובע לאתר אחד ואין לו
 * תצוגה חוצת-אתרים כלל (אפיון §5.ז).
 *
 * הכלל נכתב בשלילה — "כל מי שאינו מנהל עבודה" — מפני שכך הוא נוסח באפיון,
 * וכך תפקיד פנימי חדש יקבל את הסקירה כברירת מחדל במקום להישכח מחוצה לה.
 * הוא היה קיים כשני תנאים משוכפלים inline (בסרגל הניווט ובמסך הסקירה)
 * לפני שקיבל בית.
 */
export function canViewOverview(viewer: Viewer): boolean {
  return isUser(viewer) && viewer.role !== "SITE_MANAGER";
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
 * עריכת שדות הפנייה עצמה (בניין, דירה, תחום, חדר, תיאור, שם דייר), וכן
 * השלמת טיוטה ושיגורה.
 *
 * מאציל ל-`canEditAssignments`: אותה קבוצה רשאית — מנהל מערכת, מנהל האתר,
 * או הפותח. §3.2 באפיון מסמן את שדות הפנייה כניתנים לעריכה, ומי שרשאי
 * לשייך נמענים הוא בדיוק מי שמנהל את הפנייה בפועל. שם נפרד, ולא שימוש
 * ישיר, כי זהו כלל אפיון עצמאי שעשוי להשתנות בלי לגעת בשיוך.
 */
export function canEditTicketFields(viewer: Viewer, ticket: TicketAccessView): boolean {
  return canEditAssignments(viewer, ticket);
}

/**
 * מחיקת טיוטה.
 *
 * שמורה לאותה קבוצה שמנהלת את הפנייה (מנהל מערכת, מנהל האתר, הפותח) —
 * וזאת בשונה ממחיקת פנייה אמיתית, ששמורה למנהל המערכת בלבד. ההבדל מכוון:
 * מסך 7 באפיון נותן "מחק טיוטה" למנהל העבודה, והכלל "פנייה אמיתית אינה
 * נמחקת לעולם" (§5.ז) חל על פנייה ש**שוגרה** — טיוטה מעולם לא נשלחה לאיש,
 * ולכן אין בה מה לאבד. הבדיקה על `isDraft` מונעת שימוש במסלול הזה לעקיפת
 * ההגבלה על מחיקת פנייה אמיתית.
 */
export function canDeleteDraft(
  viewer: Viewer,
  ticket: TicketAccessView & { isDraft: boolean },
): boolean {
  return ticket.isDraft && canEditTicketFields(viewer, ticket);
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
 *
 * משתמש פנימי רואה כל צ׳אט תגית — הצ׳אט הוא מרחב תיאום בין המשרד לקבלנים,
 * ואינו ממודר לפי אתר באפיון (בשונה מרשימת הפניות שבתגית, שכן ממודרת —
 * ראה `canViewTagTickets`). נמען חיצוני רואה רק תגית שנפתחה לו במפורש.
 */
export function canViewTagChat(viewer: Viewer, grantedProfessionalIds: readonly string[]): boolean {
  if (viewer.kind === "professional") return grantedProfessionalIds.includes(viewer.id);
  return true;
}

/** כתיבה בצ׳אט התגית זהה לצפייה בו: מי שרואה את הצ׳אט רשאי גם לכתוב בו */
export function canPostTagChat(
  viewer: Viewer,
  grantedProfessionalIds: readonly string[],
): boolean {
  return canViewTagChat(viewer, grantedProfessionalIds);
}

/**
 * רשימת הפניות שבתגית.
 * זו הנקודה הרגישה ביותר במודל ההרשאות: פתיחת תגית לנמען חושפת לו את הצ׳אט
 * **בלבד**. נמען לעולם אינו רואה פנייה שלא שויכה אליו — גם לא דרך התגית.
 *
 * מחזיר true לכל משתמש פנימי, אבל **אין די בכך**: מנהל עבודה רואה רק את
 * פניות האתר שלו, ולכן רשימת הפניות שבתגית מסוננת נוסף לכך דרך
 * `canViewTicket` על כל פנייה (ראה `getTagDetail`).
 */
export function canViewTagTickets(viewer: Viewer): boolean {
  return isUser(viewer);
}

/**
 * תיוג פנייה — הוספה והסרה של תגיות (אפיון §3.2 שדה 12: "הפותח או כל מנהל").
 *
 * מוגדר בנפרד אך מאציל ל-`canEditAssignments`: קבוצת המורשים זהה היום (מנהל
 * מערכת, מנהל האתר, או הפותח), ואצילה — ולא העתקת התנאים — שומרת מקור אמת
 * אחד. השם הנפרד קיים כי זהו כלל אפיון עצמאי, שעשוי להשתנות בלי לגעת בשיוך.
 */
export function canTagTicket(viewer: Viewer, ticket: TicketAccessView): boolean {
  return canEditAssignments(viewer, ticket);
}

/**
 * פתיחת תגית לקבלנים — הענקת גישה או ביטולה.
 *
 * זו פעולה תפעולית של תיאום, ולכן שמורה למנהל המערכת ולמנהל העבודה — ולא
 * לבעלים, שתפקידו צפייה ופתיחת פניות (אפיון §5.ז). קבוצת הליקויים והקבלנים
 * שמתאמים סביבה הם עניינו של מי שמנהל את העבודה בפועל.
 *
 * הערה: אינו ממודר לפי אתר. תגית עשויה לחצות אתרים, וצ׳אט התגית גלוי ממילא
 * לכל מנהל פנימי; פתיחתו לקבלן היא בחירה מפורשת של המנהל. בקנה המידה של
 * חברה אחת עם צוות קטן זו החלטה סבירה — אם יידרש מידור, זה המקום לשנותו.
 */
export function canManageTagAccess(viewer: Viewer): boolean {
  return isUser(viewer) && (viewer.role === "ADMIN" || viewer.role === "SITE_MANAGER");
}

/**
 * **חשיפת קישור הגישה של קבלן** — להבדיל מפתיחת תגית עבורו.
 *
 * שני הכללים נפרדו, וזה בדיוק העניין. `canManageTagAccess` שלמעלה אינו
 * ממודר לפי אתר, וזו החלטה סבירה **לגבי הצ׳אט**: הוא גלוי ממילא לכל מנהל
 * פנימי. אבל אותו פרדיקט שימש גם לחשיפת **קישור הקסם**, וזה דבר אחר לגמרי:
 * הטוקן שייך לאיש המקצוע ולא לתגית, אינו פג לעולם, ופותח את **כל** הפניות
 * שלו בכל האתרים.
 *
 * התוצאה הייתה עקיפה של מידור האתרים בשלוש לחיצות: מנהל עבודה של אתר א׳
 * בוחר מרשימת הקבלנים (שלא הייתה ממודרת) קבלן שעובד באתר ב׳, פותח לו תגית,
 * מבקש את הקישור — ומקבל גישת קריאה **וכתיבה** לכל פניות אתר ב׳ של אותו
 * קבלן, כולל היכולת לכתוב בשמו.
 *
 * הכלל כאן: **קישור נחשף רק למי שיש לו קשר עבודה ממשי עם הקבלן.** מנהל
 * מערכת רואה הכול ממילא; מנהל עבודה — רק לקבלן שכבר משויך לפנייה באתר שלו,
 * כלומר יחסי עבודה שהוא כבר מנהל בפועל וממילא רואה. בעלים אינו מתאם קבלנים
 * (ראה `canManageTagAccess`) ולכן אינו כלול.
 *
 * ‏`hasSiteWork` נמסר כפרמטר ואינו נשלף כאן: הפונקציות בקובץ הזה טהורות,
 * והשליפה נעשית ב-`getTagContractorLink`.
 *
 * **מה זה עדיין אינו פותר:** הטוקן נשאר גלובלי, ולכן קבלן שעובד גם באתר א׳
 * וגם באתר ב׳ עדיין חושף את אתר ב׳ למנהל של אתר א׳. הפתרון המלא הוא לקשור
 * את הטוקן להקשר שבשמו הונפק — שינוי מבני נפרד.
 */
export function canRevealPortalLink(viewer: Viewer, hasSiteWork: boolean): boolean {
  if (!isUser(viewer)) return false;
  if (viewer.role === "ADMIN") return true;
  return viewer.role === "SITE_MANAGER" && hasSiteWork;
}
