import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

/**
 * שורש הפרויקט. נדרש במפורש כי `webServer.cwd` מוגדר כברירת מחדל לתיקיית
 * **הקונפיג**, ולכן `next dev` היה מחפש את `next.config.ts` בתוך
 * `conformance/` ונופל על `Cannot find module './src/lib/security-headers'`.
 *
 * ‏`process.cwd()` ולא `import.meta.url`: Playwright טוען את הקונפיג כ-CJS
 * (אותה מגבלה שמתועדת ב-`e2e/global-setup.ts`), ושם `import.meta` הוא שגיאת
 * תחביר. הפקודות ב-package.json רצות משורש הפרויקט.
 */
const ROOT = process.cwd();

/**
 * חבילת אימות ההתאמה — בדיקה של המערכת מול **טקסט האפיון**, לא מול הקוד.
 *
 * קונפיג נפרד מ-`playwright.config.ts` ולא פרויקט רביעי בתוכו, משתי סיבות:
 * 1. ה-globalSetup שונה — הוא מוסיף את צוות ההתאמה (OWNER, שני מנהלי עבודה,
 *    אתר שני). הרצה של חבילת ה-E2E הרגילה עם הצוות הזה הייתה משנה את מה
 *    שהיא בודקת (למשל, שני אתרים משנים את מסך יצירת הפנייה לאדמין).
 * 2. חבילת ה-E2E היא שער איכות שרץ תדיר; חבילת ההתאמה היא ביקורת תקופתית
 *    ארוכה. עירוב שלהן היה מאריך כל ריצה של השער.
 *
 * פורט 3102 (E2E על 3101, פיתוח על 3100) — שלושה פורטים נפרדים, כדי ששרת
 * אחד לא יתפוס את כתובתו של אחר. הבסיס משותף ל-E2E (`yy_e2e`) ושתי החבילות
 * מרוקנות בעלייה, ולכן הרצה סדרתית בטוחה והרצה מקבילה אינה.
 *
 * **תוקן ב-0.8: הפורטים אינם מאפשרים לשלושת השרתים לחיות במקביל.** כך נכתב
 * כאן, וזה חדל להיות נכון — `Next 16` חוסם `next dev` שני **באותה תיקייה**
 * ולא באותו פורט, ולכן הרצת החבילה דורשת לעצור את שרת הפיתוח תחילה. הנימוק
 * ב-`playwright.config.ts` מפורט יותר; כאן ממילא ההרצה סדרתית מסיבה שנייה
 * ובלתי תלויה — בסיס נתונים משותף שמרוקן בעלייה.
 */
const PORT = 3102;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * ‏CONFORMANCE_PRODUCTION=1 מריץ מול בניית פרודקשן.
 *
 * זהו אותו שיקול שמתועד ב-`src/lib/action-result.ts`: Next מצנזר הודעות
 * שגיאה של Server Actions בפרודקשן. כל נוסחי ההודעות שהאפיון מחייב עוברים
 * דרך המסלול הזה, ולכן בדיקת נוסח שעברה בפיתוח אינה מוכיחה דבר על מה
 * שהמשתמש יראה בפועל.
 */
const PRODUCTION = process.env.CONFORMANCE_PRODUCTION === "1";

export default defineConfig({
  testDir: "./specs",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "../test-results/conformance-results.json" }]],
  outputDir: "../test-results/conformance",
  /**
   * ‏120 שניות ו-25 שניות ל-`expect`, גבוה מחבילת ה-E2E (60/15).
   *
   * החבילה הזו מריצה מאות בדיקות ברצף על אותו שרת, ומחליפה תפקיד תדיר —
   * כל החלפה היא גיבוב argon2 מלא. בהרצה מול שרת פיתוח, קימפול ראשון של
   * ‏Server Action תחת העומס הזה חרג מ-15 שניות והפיל בדיקות שאין להן שום
   * קשר לזמן. הסף הגבוה סופג את זה בלי להסתיר כשל אמיתי — כשל אמיתי אינו
   * נעשה תקין אחרי עוד עשר שניות.
   */
  timeout: 120_000,
  expect: { timeout: 25_000 },

  use: {
    baseURL: BASE_URL,
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "mobile", use: { ...devices["Pixel 5"] } },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      // מסך ההזנה המרוכזת (מסך 5) מיועד לדסקטופ במפורש (§4 שורה 269), ורצועת
      // המסננים גלויה שם בלי מתג — שני הבדלים אמיתיים ולא קוסמטיים.
    },
  ],

  webServer: {
    command: PRODUCTION
      ? `npx next build && npx next start -p ${PORT}`
      : `npx next dev -p ${PORT}`,
    url: BASE_URL,
    cwd: ROOT,
    reuseExistingServer: !process.env.CI && !PRODUCTION,
    timeout: 300_000,
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
      APP_BASE_URL: BASE_URL,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "",
      NODE_ENV: PRODUCTION ? "production" : "development",
      NEXT_PUBLIC_SENTRY_DSN: "",
      /**
       * ריק במפורש — ולא "ממילא אין".
       *
       * החבילה מאמתת את המסלול **חסר-המנוע** (`media.spec.ts`: "שירות
       * הקריאה אינו מוגדר"), ועד 1.9.2026 היא נשענה על כך שלמכונה אין
       * מפתח. ברגע שהוגדר `GEMINI_API_KEY` ב-`.env` הבדיקה נכשלה — לא
       * מפני שהקוד השתנה, אלא מפני שהיא לא שלטה בסביבה שהיא בודקת.
       *
       * שני רווחים נוספים: ריצת בדיקות אינה שורפת מכסה אמיתית, ואינה
       * שולחת תמונות בדיקה לשרת חיצוני.
       */
      GEMINI_API_KEY: "",
      MEDIA_STORAGE: "local",
    },
  },
});
