/**
 * קריאת משתני סביבה במקום אחד, עם כשל מוקדם וברור.
 *
 * הכלל: משתנה חסר מפיל את השרת בעלייה עם הודעה שאומרת מה חסר, ולא מייצר
 * התנהגות שקטה ושגויה בזמן ריצה. משתנה שנקרא ישירות מ-`process.env` בתוך
 * לוגיקה עסקית הוא באג שמתגלה רק בפרודקשן, כשמישהו כבר סומך על המערכת.
 *
 * הפונקציות עצלות (ולא קבועים ברמת המודול) כדי שקובץ בדיקה שאינו נוגע
 * ב-R2 או ב-AI לא ייכשל רק משום שהמפתחות האלה לא מוגדרים אצלו.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`משתנה הסביבה ${name} אינו מוגדר. ראה .env.example`);
  }
  return value;
}

/** אורך מינימלי למפתח הצפנת העוגייה. iron-session דורש 32 תווים לפחות. */
const SESSION_SECRET_MIN_LENGTH = 32;

export const env = {
  databaseUrl: () => required("DATABASE_URL"),

  sessionSecret: () => {
    const secret = required("SESSION_SECRET");
    if (secret.length < SESSION_SECRET_MIN_LENGTH) {
      throw new Error(
        `SESSION_SECRET חייב להיות באורך ${SESSION_SECRET_MIN_LENGTH} תווים לפחות`,
      );
    }
    return secret;
  },

  /** הבסיס לקישורי הקסם שנשלחים לקבלנים — חייב להיות כתובת שהם יכולים לפתוח */
  appBaseUrl: () => required("APP_BASE_URL"),

  /**
   * מפתח Resend וכתובת השולח.
   *
   * אופציונליים בכוונה: בלעדיהם המערכת כותבת את המייל ללוג במקום לשלוח,
   * וכל צינור השליחה נשאר ניתן להרצה בפיתוח ובבדיקות בלי חשבון חיצוני
   * ובלי לשלוח דואר לאיש. בפרודקשן ההיעדר שלהם הוא כשל — ראה
   * `selectEmailTransport`.
   */
  resendApiKey: () => optional("RESEND_API_KEY"),
  notifyFromEmail: () => optional("NOTIFY_FROM_EMAIL"),

  /**
   * הגדרות Cloudflare R2, או undefined אם אינן מלאות.
   *
   * הכול-או-כלום מכוון: שלושה מפתחות מתוך ארבעה אינם "כמעט מוגדר" אלא
   * תקלה שתתגלה רק בהעלאה הראשונה, אצל מנהל שעומד בשטח עם תמונה ביד.
   */
  r2: () => {
    const accountId = optional("R2_ACCOUNT_ID");
    const accessKeyId = optional("R2_ACCESS_KEY_ID");
    const secretAccessKey = optional("R2_SECRET_ACCESS_KEY");
    const bucket = optional("R2_BUCKET");

    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return undefined;
    return { accountId, accessKeyId, secretAccessKey, bucket };
  },

  /**
   * ויתור מפורש על אחסון בענן גם בבנייה של פרודקשן.
   *
   * קיים כדי להבדיל בין "שכחתי להגדיר R2" לבין "החלטתי שהקבצים על הדיסק".
   * ההבדל הזה חייב להיאמר בסביבה ולא להיות מנוחש — ראה `selectStorage`.
   */
  forceLocalStorage: () => optional("MEDIA_STORAGE") === "local",

  /** מפתח OpenAI לתמלול עברית. בלעדיו התמלול מדולג ואינו נכשל. */
  openaiApiKey: () => optional("OPENAI_API_KEY"),
  /** מפתח Anthropic לחילוץ טקסט מתמונות ומ-PDF */
  anthropicApiKey: () => optional("ANTHROPIC_API_KEY"),

  isProduction: () => process.env.NODE_ENV === "production",
};

/** מחרוזת ריקה נחשבת כלא-מוגדר: כך שורה ריקה ב-.env אינה מתחזה לערך */
function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}
