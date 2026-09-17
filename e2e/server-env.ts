/**
 * משתני ערוץ המייל — **מאופסים בכל שרת שבדיקות מרימות.**
 *
 * שרת הבדיקות הוא `next dev`/`next start` רגיל, ו-Next טוען בעצמו את
 * `.env.local` של המכונה. בלי האיפוס, מכונה שהוגדר בה חשבון Gmail הייתה
 * מריצה את חבילת הבדיקות **מול התיבה האמיתית**: התראות לקבלני דמה היו
 * יוצאות כמיילים אמיתיים, ומ-1.3 עובד הקליטה שבתוך השרת היה קורא את התיבה
 * המשותפת ופותח טיוטות בבסיס הבדיקות — כלומר גם עונה לשולחים אמיתיים.
 *
 * ‏מחרוזת ריקה ולא השמטה: Next אינו דורס משתנה שכבר קיים ב-`process.env`,
 * ו-`env.ts` מתייחס לריק כלא-מוגדר. זו אותה טכניקה של `GEMINI_API_KEY`
 * ו-`NEXT_PUBLIC_SENTRY_DSN` בקונפיגים.
 *
 * בדיקה שצריכה ערוץ מייל מקבלת אותו כפיל מוזרק, לא דרך הסביבה.
 * ‏`tests/conformance/source/email-intake.test.ts` מוודא שכל קונפיג של
 * Playwright פורש את האובייקט הזה.
 */
export const MAIL_ISOLATION_ENV = {
  GMAIL_USER: "",
  GMAIL_APP_PASSWORD: "",
  GMAIL_REFRESH_TOKEN: "",
  NOTIFY_FROM_EMAIL: "",
  EMAIL_INTAKE_ENABLED: "",
  EMAIL_INTAKE_NONPROD: "",
  EMAIL_INTAKE_PILOT_ADDRESSES: "",
} as const;
