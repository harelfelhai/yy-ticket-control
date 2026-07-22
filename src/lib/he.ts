import type { AssignmentStatus, Channel, Role, Room } from "@/generated/prisma/enums";
import type { BoardSection, DerivedTicketStatus } from "./ticket-status";

/**
 * מקור האמת היחיד לכל מחרוזת המוצגת למשתמש.
 *
 * כלל: אין מחרוזת עברית מפוזרת בתוך קומפוננטה או route handler — הכול עובר מכאן.
 * הנוסחים נלקחים מהאפיון הפונקציונלי (docs/specs/ticket-control-pre-plan.md);
 * שינוי נוסח מתבצע כאן בלבד, ומתגלגל לכל המסכים.
 *
 * ‏Record<Enum, string> ולא אובייקט חופשי: כך הוספת ערך לספירה ב-Prisma
 * מפילה את הקומפילציה עד שנכתב לו נוסח, במקום להציג למשתמש מזהה באנגלית.
 */
export const he = {
  app: {
    /** שם המוצר כפי שהמשתמשים מכירים אותו */
    name: "בקרת פניות",
    /** שם החברה המפעילה — מופיע בהודעות יוצאות */
    company: "Y&Y",
    title: "בקרת פניות — Y&Y",
    description: "מערכת לניהול פניות תיקונים באתרי בנייה",
  },

  common: {
    loading: "טוען…",
    save: "שמור",
    cancel: "ביטול",
    close: "סגור",
    back: "חזרה",
    search: "חיפוש",
    choose: "בחר",
    noResults: "אין תוצאות",
    notAllowed: "אין לך הרשאה לפעולה הזו",
    optional: "לא חובה",
    genericError: "משהו השתבש. נסה שוב.",
  },

  role: {
    ADMIN: "מנהל מערכת",
    OWNER: "בעלים",
    SITE_MANAGER: "מנהל עבודה",
  } satisfies Record<Role, string>,

  /** תג ערוץ המקור על כרטיס הפנייה (אפיון §4 מסך 1) */
  channel: {
    SELF: "אני",
    MANAGEMENT: "מההנהלה",
    WHATSAPP: "מוואטסאפ",
  } satisfies Record<Channel, string>,

  /** רשימה קבועה, אינה נלמדת (אפיון §3.3) */
  room: {
    SALON: "סלון",
    KITCHEN: "מטבח",
    BEDROOM: "חדר שינה",
    BATHROOM: "חדר רחצה",
    WC: "שירותים",
    BALCONY: "מרפסת",
    MAMAD: "ממ״ד",
    STAIRWELL: "חדר מדרגות",
    PARKING: "חניה",
    LOBBY: "לובי",
    COMMON: "שטח משותף",
  } satisfies Record<Room, string>,

  /** סטטוס של נמען יחיד בפנייה (אפיון §3.4) */
  assignmentStatus: {
    SENT: "נשלח",
    VIEWED: "נצפה",
    DONE: "טופל",
    QUESTION: "שאלה",
    REMOVED: "הוסר",
  } satisfies Record<AssignmentStatus, string>,

  /** סטטוס הפנייה, מחושב מהשיוכים (אפיון §3.5) */
  ticketStatus: {
    CLOSED: "סגור",
    DRAFT: "טיוטה",
    AWAITING_OPENER_QUESTION: "ממתין לפותח (שאלה)",
    AWAITING_OPENER_APPROVAL: "ממתין לפותח (אישור)",
    PARTIAL: "בטיפול חלקי",
    VIEWED: "נצפה",
    NEW: "חדש",
  } satisfies Record<DerivedTicketStatus, string>,

  /** כותרות הקיבוץ בלוח הראשי (אפיון §4 מסך 1) */
  boardSection: {
    ACTION_REQUIRED: "דורש ממך",
    WITH_RECIPIENTS: "אצל הנמענים",
    ARCHIVE: "ארכיון",
  } satisfies Record<BoardSection, string>,

  /**
   * טקסט הסיבה על כרטיס הפנייה — למה הפנייה נמצאת בקבוצה שבה היא נמצאת.
   * האפיון מדגיש שבלי הטקסט הזה פנייה קופצת בין קבוצות בלי שהמשתמש עשה
   * דבר, וזה שוחק אמון. הנוסחים "יוסי שאל שאלה" / "2 מתוך 3 סיימו" /
   * "ללא תנועה 9 ימים" / "דוד מטפל" לקוחים מהאפיון כלשונם.
   */
  reason: {
    draft: "טיוטה — חסרים פרטים",
    questionOne: (name: string) => `${name} שאל שאלה`,
    questionMany: (name: string, others: number) => `${name} ועוד ${others} שאלו שאלה`,
    allDone: "כולם סיימו — ממתין לאישור",
    partial: (done: number, total: number) => `${done} מתוך ${total} סיימו`,
    stale: (days: number) => `ללא תנועה ${days} ימים`,
    handler: (name: string) => `${name} מטפל`,
    viewedNoReply: "נצפה, אין תגובה עדיין",
    awaitingFirstView: "נשלח, טרם נצפה",
    noRecipients: "אין נמענים משויכים",
    closed: "הפנייה נסגרה",
  },

  ticket: {
    description: "תיאור",
    recipients: "נמענים",
    addRecipient: "הוסף נמען",
    removeRecipient: "הסר",
    room: "חדר",
    site: "אתר",
    chooseBuildingFirst: "בחר בניין תחילה",
    noSite: "לא משויך אתר. פנה למנהל המערכת.",
    chooseSite: "באיזה אתר נפתחת הפנייה?",
    noLocation: "ללא בניין ודירה",
    noDomain: "ללא תחום",
    openedBy: "נפתחה על ידי",
    thread: "שרשור",
    threadEmpty: "אין עדיין הודעות",
    newTicket: "+ פנייה חדשה",
    createTitle: "פנייה חדשה",
    submit: "שלח לנמענים",
    saveDraft: "שמור כטיוטה",
    sentTo: (names: string[]) => `הפנייה נשלחה ל${names.join(", ")}.`,
    savedAsDraft: "נשמר כטיוטה. לא נשלח לאיש.",
    cannotSubmitMissing: (missing: string[]) => `לא ניתן לשגר — חסר: ${missing.join(", ")}`,
    notFound: "הפנייה לא נמצאה",
  },

  /** אירועי מערכת בשרשור — מה קרה לפנייה, להבדיל ממה שמישהו כתב */
  event: {
    assigned: (name: string) => `${name} שויך לפנייה`,
    removed: (name: string) => `${name} הוסר מהפנייה`,
    viewed: (name: string) => `${name} צפה בפנייה`,
    done: (name: string) => `${name} סימן: טופל`,
    question: (name: string) => `${name} שאל שאלה`,
    closed: (name: string) => `${name} סגר את הפנייה`,
    reopened: (name: string) => `${name} פתח את הפנייה מחדש`,
    handlerSet: (name: string) => `${name} מטפל בפנייה`,
  },

  /** הרשימות הנלמדות: בניין, דירה, תחום, איש מקצוע */
  directory: {
    building: "בניין",
    apartment: "דירה",
    domain: "תחום",
    professional: "איש מקצוע",
    professionalName: "שם",
    phone: "טלפון",
    email: "מייל",
    newProfessional: "+ איש מקצוע חדש",
    // נוסח מלא ולא "שמור": במסך היצירה יש גם "שמור כטיוטה", ושני כפתורים
    // שנקראים דומה הם טעות לחיצה שמאבדת את מה שהוקלד.
    saveProfessional: "שמור איש מקצוע",
    contactRequiredHint: "צריך טלפון או מייל — בלעדיהם אי אפשר לשלוח אליו את הפנייה",
    createNew: (value: string) => `צור חדש: "${value}"`,
    buildingNameRequired: "יש להזין שם בניין",
    apartmentNumberRequired: "יש להזין מספר דירה",
    domainNameRequired: "יש להזין תחום",
    professionalNameRequired: "יש להזין שם איש מקצוע",
    invalidEmail: "כתובת המייל אינה תקינה",
  },

  login: {
    title: "כניסה למערכת",
    identifierLabel: "טלפון או מייל",
    passwordLabel: "סיסמה",
    submit: "כניסה",
    submitting: "מתחבר…",
    logout: "יציאה",
    missingFields: "יש למלא טלפון או מייל, וסיסמה",
    // הודעה אחת לכל סוגי הכישלון — משתמש לא קיים, מושבת, או סיסמה שגויה.
    // הפרדה ביניהן הייתה מאפשרת למפות מי רשום במערכת.
    invalidCredentials: "פרטי ההתחברות אינם נכונים",
  },

  /** נוסחים שמופיעים באפיון כלשונם ואסור לשנותם בלי החלטה מפורשת */
  notices: {
    closedTicketBlocked: "הפנייה נסגרה. פנה למנהל העבודה.",
    transcriptionFailed: "התמלול נכשל",
    savedLocally: "נשמר מקומית — ממתין לחיבור",
    linkExpired: "הקישור אינו בתוקף",
    cannotSendNoContact: "לא ניתן לשגר: לנמען אין טלפון ואין מייל",
  },
} as const;
