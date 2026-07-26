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
/**
 * שם המוצר ושם החברה כקבועים ברמת המודול, ולא רק בתוך `he`.
 *
 * מחרוזת בתוך האובייקט אינה יכולה להתייחס לשדה אחר שלו: בזמן בניית האובייקט
 * `he` עדיין לא הוגדר, וכל שימוש בו מחוץ לגוף של פונקציה מפיל את הטעינה.
 */
const APP_NAME = "בקרת פניות";
const COMPANY = "Y&Y";

export const he = {
  app: {
    /** שם המוצר כפי שהמשתמשים מכירים אותו */
    name: APP_NAME,
    /** שם החברה המפעילה — מופיע בהודעות יוצאות */
    company: COMPANY,
    title: `${APP_NAME} — ${COMPANY}`,
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
    edit: "ערוך",
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

  board: {
    title: "הלוח",
    empty: "אין פניות להצגה",
    emptySection: "אין כאן כלום",
    tourMode: "מצב סיור",
    tourDrafts: "טיוטות להשלמה",
    filters: "מסננים",
    clearFilters: "נקה מסננים",
    allDirections: "הכול",
    opened: "הפניתי",
    received: "קיבלתי",
    allSites: "כל האתרים",
    allBuildings: "כל הבניינים",
    allDomains: "כל התחומים",
    allRecipients: "כל הנמענים",
    allTags: "כל התגיות",
    batchEntry: "הזנה מרוכזת",
    ageDays: (days: number) => (days === 0 ? "היום" : days === 1 ? "אתמול" : `לפני ${days} ימים`),
    count: (n: number) => `${n}`,
  },

  /** תצוגת הבעלים (מסך 10) — סיכום חוצה-אתרים */
  overview: {
    navLink: "סקירה",
    title: "סקירת אתרים",
    subtitle: "תמונת מצב לכל אתר. לחיצה על מספר פותחת את הרשימה.",
    empty: "אין עדיין אתרים",
    open: "פתוחות",
    awaitingManager: "ממתינות למנהל",
    stale: "ללא תנועה 7+ ימים",
    /** למי שאינו בעלים או מנהל מערכת — אין לו תצוגה חוצת-אתרים */
    forbidden: "התצוגה הזו זמינה לבעלים ולמנהל המערכת בלבד",
  },

  /** מסכי הניהול (11–15 באפיון) — למנהל המערכת הראשי בלבד */
  admin: {
    navLink: "ניהול",
    title: "ניהול המערכת",
    forbidden: "אזור הניהול זמין למנהל המערכת בלבד",

    // רכזת הניהול
    sites: "אתרים",
    users: "משתמשים",
    professionals: "אנשי מקצוע",
    domains: "תחומים",
    tags: "תגיות",
    manageTags: "ניהול תגיות ונראות",

    // אתרים
    newSite: "אתר חדש",
    siteName: "שם האתר",
    addSite: "הוסף אתר",
    siteManagers: "מנהלי עבודה",
    noManagers: "אין מנהל משויך",
    siteExists: "כבר קיים אתר בשם הזה",
    siteNameRequired: "יש להזין שם אתר",

    // משתמשים
    newUser: "משתמש חדש",
    userName: "שם",
    userPhone: "טלפון",
    userEmail: "מייל",
    userRole: "תפקיד",
    userSite: "אתר",
    userPassword: "סיסמה ראשונית",
    addUser: "הוסף משתמש",
    activate: "הפעל",
    deactivate: "השבת",
    inactiveBadge: "מושבת",
    noSite: "ללא אתר",
    userNameRequired: "יש להזין שם משתמש",
    passwordTooShort: (min: number) => `הסיסמה חייבת להיות באורך ${min} תווים לפחות`,
    siteManagerNeedsSite: "מנהל עבודה חייב להיות משויך לאתר",
    ownerAdminNoSite: "בעלים ומנהל מערכת אינם משויכים לאתר",
    phoneTaken: "הטלפון כבר רשום למשתמש אחר",
    emailTaken: "המייל כבר רשום למשתמש אחר",
    cannotDeactivateSelf: "אי אפשר להשבית את המשתמש שאיתו אתה מחובר",

    // אנשי מקצוע
    editProfessional: "ערוך",
    saveProfessional: "שמור",
    mergeHeading: "איחוד כפילויות",
    mergeHint: "בוחרים את איש המקצוע שיישאר. כל הפניות, הגישות וההיסטוריה של השני עוברות אליו, והוא נמחק.",
    mergeKeep: "להשאיר",
    mergeDrop: "לאחד ולמחוק",
    mergeButton: "אחד",
    mergeSame: "אי אפשר לאחד איש מקצוע עם עצמו",
    mergeConfirm: (drop: string, keep: string) =>
      `לאחד את "${drop}" לתוך "${keep}"? "${drop}" יימחק, וכל מה ששייך לו יעבור. הפעולה אינה הפיכה.`,
    merged: (keep: string) => `הכפילות אוחדה. הכול הועבר ל"${keep}".`,
    professionalNotFound: "איש המקצוע לא נמצא",
    activeTickets: (n: number) => (n === 1 ? "פנייה פעילה אחת" : `${n} פניות פעילות`),

    // תחומים
    newDomain: "תחום חדש",
    addDomain: "הוסף תחום",
    renameDomain: "שנה שם",
    domainExists: "כבר קיים תחום בשם הזה",
  },

  /** מסך החיפוש (מסך 9 באפיון) */
  search: {
    title: "חיפוש",
    placeholder: "חפש בתיאור, בשרשור, בתמלול ובטקסט שזוהה",
    submit: "חפש",
    allStatuses: "כל הסטטוסים",
    from: "מתאריך",
    to: "עד תאריך",
    /** מה שנכנס לחיפוש — נאמר במפורש כדי שהמשתמש ידע שההקלטות בפנים */
    scopeHint: "החיפוש כולל גם תמלול הקלטות וטקסט שזוהה בתמונות ובמסמכים",
    empty: "לא נמצאו פניות",
    startTyping: "הקלד מה לחפש, או סנן לפי בניין, תחום ותאריך",
    results: (n: number) => `${n} תוצאות`,
    /** חיתוך תוצאות נאמר במפורש — רשימה חתוכה שנראית מלאה היא הטעיה */
    truncated: "מוצגות התוצאות הראשונות. צמצם את החיפוש כדי לראות את השאר.",
  },

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
    removedRecipients: "נמענים שהוסרו",

    // ── שליחה לנמען ──────────────────────────────────────────────────
    /** פותח וואטסאפ בטלפון של המנהל עם ההודעה מוכנה */
    sendWhatsApp: "שלח בוואטסאפ",
    /** מציג את הקישור **הקיים** — אינו מבטל את מה שכבר אצל הקבלן */
    showLink: "קישור גישה",
    // "צור חדש" ולא "רענן": הפעולה מנתקת את הקבלן עד שיקבל את הקישור
    // החדש, והניסוח חייב להבהיר את זה לפני הלחיצה ולא אחריה.
    rotateLink: "צור קישור חדש",
    confirmRotateLink: "הקישור הנוכחי יפסיק לעבוד מיד. להנפיק חדש?",
    // שם הנמען מוצג מעל הקישור: בפנייה עם כמה קבלנים, קישור בלי שם הוא
    // הזמנה לשלוח לאחד את הקישור האישי של האחר.
    linkFor: (name: string) => `קישור עבור ${name}`,
    linkStable: "אותו קישור בכל שליחה. אפשר לשלוח אותו שוב בבטחה.",
    linkRotated: "הקישור הקודם בוטל. שלח לנמען את החדש.",
    // "שלח שוב במייל" — שולח באמת מייל חוזר, בשונה מהצגת הקישור להעתקה.
    resendEmail: "שלח שוב במייל",
    linkResent: (name: string) => `הקישור נשלח שוב ל${name}.`,

    // חיווי השליחה. "נשלח" בסטטוס פירושו ששייכנו אותו — לא שהוא יודע.
    notifiedAt: (time: string) => `נשלח מייל ${time}`,
    notifyQueued: "ההודעה בתור לשליחה",
    notifyNoEmail: "אין מייל — שלח בוואטסאפ",
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
    /** שחזור טופס שנשמר בדפדפן — ראה src/lib/offline-draft.ts */
    draftRestored: "שוחזר מה שהקלדת קודם",
    pendingRetry: "מנסה לשלוח שוב…",
    notFound: "הפנייה לא נמצאה",
    assignmentNotFound: "השיוך לא נמצא",
    emptyMessage: "אין מה לשלוח",

    // פעולות במסך הפנייה
    // שם הדייר בכותרת הפנייה (אפיון §3.2 שדה 11). מקושר לדירה, לא לפנייה.
    residentLabel: "דייר",
    // הודעות אחרי סגירה/פתיחה-מחדש (אפיון מסך 2), כלשונן
    closedNotice: "הפנייה נסגרה.",
    reopenedNotice: "הפנייה נפתחה מחדש. הנמענים קיבלו התראה.",
    // דיאלוגי האישור של עריכת הנמענים (אפיון מסך 3), כלשונם
    confirmAddRecipient:
      "לנמען שנוסף תיחשף כל היסטוריית השיחה בפנייה, כולל תמונות והקלטות. להוסיף?",
    confirmRemoveRecipient: (name: string) =>
      `הפנייה תיעלם מהרשימה של ${name} והוא לא יוכל להגיב יותר. התגובות שכתב יישארו. להסיר?`,

    reply: "תגובה",
    send: "שלח",
    close: "סגור פנייה",
    reopen: "פתח מחדש",
    setHandler: "סמן: אני מטפל",
    editRecipients: "ערוך נמענים",
    addRecipients: "הוסף",
    confirmClose: "לסגור את הפנייה?",
    confirmReopen: "לפתוח את הפנייה מחדש?",
    reopenedBadge: "נפתחה מחדש",
    handledBy: (name: string) => `${name} מטפל`,

    // ── השלמת טיוטה ומחיקתה (אפיון מסך 7) ────────────────────────────
    submitDraftButton: "שגר",
    deleteDraft: "מחק טיוטה",
    confirmDeleteDraft: "למחוק את הטיוטה? היא לא נשלחה לאיש ולא תישמר.",
    // עריכת נמענים בטיוטה נעשית דרך מסך ההשלמה, לא דרך העורך הרגיל — כי
    // שיוך פירושו שיגור, וטיוטה במפורש לא נשלחה לאיש.
    draftNoRecipientEdit: "בטיוטה עורכים נמענים דרך השלמת הטיוטה — היא לא נשלחה לאיש.",
    cannotCloseDraft: "טיוטה לא נסגרת — משגרים אותה או מוחקים אותה.",

    // מחיקה — מנהל מערכת בלבד, לכפילות ולרשומה שגויה (אפיון §5.ז)
    delete: "מחק פנייה",
    // האזהרה מדגישה שזה לא המסלול לסגירת פנייה שטופלה — זו מחיקת כפילות.
    deleteWarning: "מחיקה היא לכפילות או רשומה שגויה בלבד. פנייה שטופלה — סגור, אל תמחק.",
    confirmDelete: "הפנייה וכל השרשור שלה יימחקו לצמיתות. הפעולה אינה הפיכה.",
    confirmDeleteButton: "כן, מחק לצמיתות",
  },

  /**
   * תגיות: קיבוץ פניות + צ׳אט קבוצתי (אפיון §3.1, מסך 6).
   *
   * כלל הזהב של התגית: פתיחתה לקבלן חושפת את **הצ׳אט בלבד**, לעולם לא את
   * הפניות. הנוסח `openedNotice` לקוח מהאפיון מסך 6 כלשונו.
   */
  tag: {
    navLink: "תגיות",
    listTitle: "תגיות",
    listEmpty: "אין עדיין תגיות. תגית נוצרת בעת תיוג פנייה או בהזנה מרוכזת.",
    /** מונה פתוחות מול סגורות — גלוי למנהלים בלבד (אפיון מסך 6) */
    ticketCount: (open: number, closed: number) => `${open} פתוחות · ${closed} סגורות`,
    grantedCount: (n: number) => (n === 0 ? "סגורה" : `פתוחה ל-${n}`),

    // ── תיוג פנייה במסך הפנייה ────────────────────────────────────────
    label: "תגיות",
    add: "הוסף תגית",
    none: "ללא תגיות",
    remove: "הסר תגית",
    nameRequired: "יש להזין שם תגית",

    // ── מסך התגית (מסך 6) ─────────────────────────────────────────────
    ticketsHeading: "פניות בתגית",
    ticketsManagersOnly: "רשימה זו גלויה למנהלים בלבד",
    ticketsEmpty: "אין פניות בתגית",
    chatHeading: "צ׳אט קבוצתי",
    chatEmpty: "אין עדיין הודעות",
    chatHint: "דיון על קבוצת הליקויים כולה, נפרד משרשור כל פנייה",

    // ── פתיחה לקבלנים ─────────────────────────────────────────────────
    accessHeading: "מי רואה את הצ׳אט",
    accessNobody: "התגית סגורה. אף קבלן אינו רואה את הצ׳אט.",
    openToContractors: "פתח לקבלנים",
    // האזהרה מוצגת לפני הבחירה, לא אחריה: פתיחת צ׳אט לקבלן היא פעולה
    // שקשה לבטל אחרי שההודעות כבר נקראו.
    openHint: "הקבלנים שתבחר יראו את הצ׳אט הקבוצתי בלבד — לא את הפניות.",
    grant: "פתח",
    revoke: "בטל גישה",
    /** תווית הקישור שהמנהל שולח לקבלן שנפתחה לו התגית */
    chatLinkFor: (name: string) => `קישור עבור ${name}`,
    /** הנוסח מהאפיון מסך 6, כלשונו */
    openedNotice: (names: string[]) =>
      `התגית נפתחה ל${names.join(", ")}. הם יראו את הצ׳אט הקבוצתי בלבד, לא את הפניות.`,

    /** אירועי מערכת בצ׳אט התגית — מי נפתח ומתי */
    eventGranted: (names: string) => `${names} — נפתחה הגישה לצ׳אט`,
    eventRevoked: (name: string) => `הגישה של ${name} לצ׳אט בוטלה`,
  },

  /**
   * הזנה מרוכזת מדוח בדק בית (מסך 5).
   *
   * זהו המסך שעונה על התרחיש המתפרץ: דוח דירה עם עשרות ליקויים שיש להפיץ
   * לבעלי מקצוע שונים. בניין, דירה ותגית נקבעים פעם אחת; כל שורה היא פנייה.
   */
  batch: {
    navLink: "הזנה מרוכזת",
    title: "הזנה מרוכזת מדוח בדק בית",
    // המסך מיועד לדסקטופ (אפיון מסך 5): טור הזנה רחב לצד הדוח כהקשר קבוע.
    desktopHint: "מסך זה מיועד לעבודה בדסקטופ",

    // אזור א׳ — המקור
    sourceHeading: "המקור",
    sourceHint: "העלה את דוח הבדק או צילומי מסך. הטקסט שבו ייסרק ויהיה זמין לחיפוש.",

    // אזור ב׳ + ג׳ — הקשר משותף לכל השורות
    contextHeading: "משותף לכל השורות",
    sharedTag: "תגית משותפת",
    sharedTagPlaceholder: "בדק בית — דירה 12",

    // טור ההזנה
    rowsHeading: "ליקויים",
    addRow: "הוסף שורה",
    removeRow: "הסר שורה",
    rowDescription: "תיאור הליקוי",
    rowDomain: "תחום",
    rowRoom: "חדר",
    rowRecipient: "נמען",
    rowNumber: (n: number) => `שורה ${n}`,

    dispatch: "שגר הכל",
    saveDraft: "שמור הכל כטיוטה",

    // סיכומים — הנוסחים מהאפיון מסך 5
    created: (tickets: number, professionals: number) =>
      `נוצרו ${tickets} פניות ושויכו ל-${professionals} אנשי מקצוע.`,
    draftsMissingRecipient: (rows: number) =>
      rows === 1
        ? "שורה אחת חסרה נמען. היא נשמרה כטיוטה."
        : `${rows} שורות חסרות נמען. הן נשמרו כטיוטה.`,
    allDraft: (rows: number) =>
      rows === 1
        ? "פנייה אחת נשמרה כטיוטה. לא נשלחה לאיש."
        : `${rows} פניות נשמרו כטיוטה. לא נשלחו לאיש.`,

    // אימות לפני שיגור
    needLocation: "בחר בניין ודירה",
    needTag: "הזן תגית משותפת",
    needRows: "הוסף לפחות שורה אחת עם תיאור ותחום",
    goToTag: "פתח את התגית",
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
    fieldsEdited: (name: string) => `${name} עדכן את פרטי הפנייה`,
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
    // נזרק כשמנסים לשייך לפנייה בניין או דירה שאינם שייכים לאתר שלה —
    // מנהל אתר שהשיג מזהה של אתר אחר לא יכול לזהם דרכו את הרשומות.
    locationMismatch: "הבניין או הדירה אינם שייכים לאתר של הפנייה",
  },

  /** מדיה: תמונות, PDF, וידאו והקלטות קוליות */
  media: {
    attach: "צרף קובץ",
    camera: "צלם",
    record: "הקלט",
    recording: "מקליט…",
    stopRecording: "עצור",
    uploading: "מעלה…",
    remove: "הסר קובץ",
    /** נוסח כללי בכוונה: המשתמש אינו צריך לדעת אילו סוגים מותרים, הוא צריך לדעת שזה לא יעבוד */
    unsupportedType: "סוג הקובץ אינו נתמך. אפשר תמונה, PDF, וידאו או הקלטה.",
    tooLarge: "הקובץ גדול מדי. המגבלה היא 50 מגה־בייט.",
    notFound: "הקובץ לא נמצא",
    uploadFailed: "ההעלאה נכשלה. נסה שוב.",
    micDenied: "אין גישה למיקרופון. אשר אותה בהגדרות הדפדפן.",
    micUnavailable: "הקלטה אינה נתמכת בדפדפן הזה",
    /** תיאור נגיש לקובץ בשרשור */
    fileLabel: (name: string) => `קובץ מצורף: ${name}`,
    imageAlt: "תמונה מצורפת",
    audioLabel: "הקלטה קולית",
    download: "פתח",
  },

  /** תוצרי ה-AI: תמלול אודיו וחילוץ טקסט מתמונה */
  ai: {
    transcriptionPending: "מתמלל…",
    transcriptionFailed: "התמלול נכשל",
    transcriptionLabel: "תמלול",
    extractionPending: "קורא את הטקסט…",
    extractionFailed: "לא הצלחנו לקרוא את הטקסט",
    extractionLabel: "טקסט שזוהה",
  },

  /** פורטל הנמען החיצוני (מסך 8 באפיון) */
  portal: {
    greeting: (name: string) => `שלום ${name}`,
    activeTitle: "הפניות שלך",
    archiveTitle: "ארכיון",
    empty: "אין כרגע פניות פתוחות אצלך",
    emptyArchive: "אין פניות סגורות",
    markDone: "סיימתי — טופל",
    askQuestion: "יש לי שאלה",
    /** מקטע הצ׳אטים הקבוצתיים בלוח הקבלן — תגיות שנפתחו לו במפורש */
    groupChatsTitle: "צ׳אטים קבוצתיים",
    groupChatsEmpty: "אין צ׳אטים קבוצתיים פתוחים אליך",
    doneNotice: "סימנת שטופל. מנהל העבודה יאשר ויסגור.",
    questionNotice: "השאלה נשלחה למנהל העבודה.",
    back: "חזרה לרשימה",
    // הנוסח מהאפיון §7 — מוצג כשהקישור בוטל או שאינו קיים
    expired: "הקישור אינו בתוקף",
    expiredHelp: "פנה למנהל העבודה לקבלת קישור חדש.",
    tooManyActions: "יותר מדי פעולות ברצף. המתן רגע ונסה שוב.",
  },

  /**
   * הודעות יוצאות — מייל ווואטסאפ.
   *
   * **אותו נוסח בשני הערוצים בכוונה.** קבלן אחד מקבל מייל ואחר מקבל וואטסאפ,
   * ושניהם עשויים לדבר ביניהם או להעביר הודעה הלאה; נוסח שונה לכל ערוץ היה
   * מייצר שתי גרסאות למה שנשלח, וזה בדיוק מה שהמערכת נועדה למנוע.
   *
   * הגוף מנוסח כטקסט פשוט ולא כ-HTML: וואטסאפ אינו יודע HTML, והמייל עוטף
   * את אותו טקסט. גם כאן — מקור אמת אחד.
   */
  notify: {
    /** שורת המיקום החוזרת בכל ההודעות: "בניין א דירה 3, חשמל" */
    location: (building: string | null, apartment: string | null, domain: string | null) => {
      const place =
        building && apartment ? `${building} דירה ${apartment}` : "ללא בניין ודירה";
      return `${place}, ${domain ?? "ללא תחום"}`;
    },
    /** מספר הפנייה הקריא — מה שאומרים בטלפון: "תראה את פנייה 47" */
    ref: (seq: number) => `פנייה #${seq}`,

    assignedSubject: (location: string) => `פנייה חדשה — ${location}`,
    // הנוסח מהתוכנית כלשונו. התיאור מצורף מתחתיו כי קבלן שקורא בוואטסאפ
    // צריך לדעת אם לקחת סולם לפני שהוא פותח קישור.
    assigned: (name: string, location: string) =>
      `שלום ${name}, נשלחה אליך פנייה חדשה מחברת ${he.app.company} — ${location}.`,

    reopenedSubject: (location: string) => `פנייה נפתחה מחדש — ${location}`,
    reopened: (name: string, location: string) =>
      `שלום ${name}, פנייה שסומנה כטופלה נפתחה מחדש — ${location}. העבודה לא הושלמה.`,

    questionSubject: (actor: string, location: string) => `${actor} שאל שאלה — ${location}`,
    question: (actor: string, ref: string, location: string) =>
      `${actor} שאל שאלה ב${ref} — ${location}.`,

    doneSubject: (actor: string, location: string) => `${actor} סימן שטופל — ${location}`,
    done: (actor: string, ref: string, location: string) =>
      `${actor} סימן שטופל ב${ref} — ${location}. הפנייה ממתינה לאישור שלך ולסגירה.`,

    /** שורת הסיום עם הקישור. נפרדת כדי שתמיד תופיע אחרונה ובאותו נוסח. */
    linkLine: (link: string) => `לצפייה וטיפול: ${link}`,
    /** חתימת המייל — לא מופיעה בוואטסאפ, שם השולח ידוע ממילא */
    emailFooter: `הודעה אוטומטית ממערכת ${APP_NAME} של ${COMPANY}.`,
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
    tooManyAttempts: (minutes: number) =>
      `יותר מדי ניסיונות התחברות. נסה שוב בעוד ${minutes} דקות.`,
  },

  /** נוסחים שמופיעים באפיון כלשונם ואסור לשנותם בלי החלטה מפורשת */
  notices: {
    closedTicketBlocked: "הפנייה נסגרה. פנה למנהל העבודה.",
    transcriptionFailed: "התמלול נכשל",
    savedLocally: "נשמר מקומית — ממתין לחיבור",
    linkExpired: "הקישור אינו בתוקף",
    cannotSendNoContact: "לא ניתן לשגר: לנמען אין טלפון ואין מייל",
    // באנר הטיוטה במסך הפנייה (אפיון מסך 7) — הנוסח כלשונו
    draftBanner: "טיוטה — חסרים פרטים. לא נשלחה לאיש.",
  },
} as const;
