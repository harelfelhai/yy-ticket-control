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
  gmailUser: () => optional("GMAIL_USER"),
  gmailAppPassword: () => optional("GMAIL_APP_PASSWORD"),
  /**
   * כתובת השולח. אופציונלית — ברירת המחדל היא `GMAIL_USER` עצמו.
   *
   * ‏Gmail מתיר לשלוח רק מהחשבון המאומת (או מכתובת שהוגדרה בו כ-alias),
   * ולכן ערך אחר כאן אינו "עיצוב" אלא דרך להיכשל. היא נשארת נפרדת מפני
   * ששם תצוגה מותר — `"בקרת פניות Y&Y <...@gmail.com>"`.
   */
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

  /**
   * מפתח Gemini — **לתמלול העברית ולחילוץ הטקסט כאחד**.
   *
   * החליף ב-1.9.2026 את `OPENAI_API_KEY` ו-`ANTHROPIC_API_KEY`: שני
   * הספקים עשו שתי משימות שספק אחד עושה בנקודת קצה אחת, והפיצול קנה שני
   * חשבונות ושתי נקודות כשל בלי לקנות יכולת. ראה `ai/gemini.ts`.
   *
   * בלעדיו שני העיבודים מדולגים ואינם נכשלים.
   */
  geminiApiKey: () => optional("GEMINI_API_KEY"),

  /**
   * זוג המפתחות של "התחברות עם Google" (1.2).
   *
   * **כול-או-כלום כמו `r2()`, ומאותו נימוק:** מפתח אחד מתוך שניים אינו "כמעט
   * מוגדר" אלא כפתור שמפנה לגוגל וחוזר בשגיאה. `undefined` → הכפתור אינו
   * מוצג כלל, וההתחברות בטלפון/מייל ובסיסמה אינה נוגעת בזה.
   *
   * **‏`optional()` ולא `required()` גם בפרודקשן — בשונה מ-R2 וממייל.** שם
   * ההיעדר הוא כשל, כי בלי אחסון אין איפה לשמור קובץ ובלי SMTP אף אחד אינו
   * מקבל הודעה. כאן ההיעדר הוא **ויתור**: המערכת שלמה בלי המסלול הזה, שכן
   * הסיסמה המקומית ממשיכה לעבוד. מה שמונע "ויתור שהוא בעצם שכחה" אינו כשל
   * בעלייה אלא invariant ב-watchdog (`google-login-configured`), שמדווח
   * ל-Sentry בפרודקשן בלי לסכן את ה-healthcheck של הפריסה.
   */
  googleOauth: () => {
    const clientId = optional("GOOGLE_CLIENT_ID");
    const clientSecret = optional("GOOGLE_CLIENT_SECRET");

    if (!clientId || !clientSecret) return undefined;
    return { clientId, clientSecret };
  },

  /**
   * נתיב ל-pg_dump ול-pg_restore. בפרודקשן הם על ה-PATH (מותקנים בקונטיינר),
   * ולכן ברירת המחדל היא השם בלבד. מקומית, ב-Windows, embedded-postgres אינו
   * כולל אותם — מצביעים ל-scoop דרך .env (ראה .env.example).
   */
  pgDumpPath: () => optional("PG_DUMP_PATH") ?? "pg_dump",
  pgRestorePath: () => optional("PG_RESTORE_PATH") ?? "pg_restore",

  /**
   * ה-bucket השני ב-R2 כיעד לגיבוי הלילי — ה-fallback של Gate G6 (חשבון
   * Google One, בלי service account). אותם פרטי חיבור של R2, שם bucket אחר.
   * undefined → הגיבוי נכתב לתיקייה מקומית (פיתוח ובדיקות).
   */
  backupR2: () => {
    const accountId = optional("R2_ACCOUNT_ID");
    const accessKeyId = optional("R2_ACCESS_KEY_ID");
    const secretAccessKey = optional("R2_SECRET_ACCESS_KEY");
    const bucket = optional("R2_BACKUP_BUCKET");

    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return undefined;
    return { accountId, accessKeyId, secretAccessKey, bucket };
  },

  isProduction: () => process.env.NODE_ENV === "production",
};

/** מחרוזת ריקה נחשבת כלא-מוגדר: כך שורה ריקה ב-.env אינה מתחזה לערך */
function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}
