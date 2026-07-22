import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

/**
 * בדיקות מקצה לקצה מול שרת Next אמיתי.
 *
 * שתי הכרעות:
 * - פורט 3101 ובסיס נתונים ייעודי ל-E2E (`yy_e2e`), ולא 3100 ובסיס הפיתוח.
 *   כך אפשר להריץ E2E בזמן ששרת הפיתוח פתוח, בלי לזהם נתוני פיתוח, ובלי
 *   להתנגש בבדיקות האינטגרציה — שמרוקנות את הבסיס שלהן בין בדיקות ולכן
 *   היו משאירות כאן ישויות זרות.
 * - שני מכשירים: מובייל הוא מסלול השימוש העיקרי (מנהל עבודה בשטח), דסקטופ
 *   נדרש למסך ההזנה המרוכזת מבדק בית. באג שנוגע רק לאחד מהם קורה בפועל.
 */
const PORT = 3101;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * ‏E2E_PRODUCTION=1 מריץ מול בנייה של פרודקשן במקום מול שרת הפיתוח.
 *
 * זה לא ניואנס: ‏Next מצנזר הודעות שגיאה של Server Actions בפרודקשן
 * ומחליף אותן בטקסט גנרי. שגיאה שנזרקת במקום להיות מוחזרת כערך נראית
 * תקינה לחלוטין בפיתוח, ומגיעה למשתמש כ"משהו השתבש" בפרודקשן.
 */
const PRODUCTION = process.env.E2E_PRODUCTION === "1";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false, // כל הבדיקות חולקות בסיס נתונים אחד
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",

  /**
   * ‏60 שניות ולא 30.
   *
   * בדיקה כאן מריצה מסלול מלא מול שרת אמיתי, ובמצב פיתוח Turbopack מקמפל
   * כל route בפעם הראשונה שמבקשים אותו. הקימפול הראשון של מסך הפורטל, על
   * שרת קר ותחת עומס, חרג מ-30 שניות — וזה נראה ככשל של המערכת במקום
   * כהמתנה לכלי הבנייה.
   */
  timeout: 60_000,

  use: {
    baseURL: BASE_URL,
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "mobile", use: { ...devices["Pixel 5"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],

  webServer: {
    command: PRODUCTION
      ? `npx next build && npx next start -p ${PORT}`
      : `npx next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI && !PRODUCTION,
    timeout: 300_000,
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
      APP_BASE_URL: BASE_URL,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "",
      NODE_ENV: PRODUCTION ? "production" : "development",
    },
  },
});
