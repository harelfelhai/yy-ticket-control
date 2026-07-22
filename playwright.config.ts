import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

/**
 * בדיקות מקצה לקצה מול שרת Next אמיתי.
 *
 * שתי הכרעות:
 * - פורט 3101 ובסיס הבדיקות (ולא 3100 ובסיס הפיתוח), כדי שאפשר יהיה להריץ
 *   E2E בזמן ששרת הפיתוח פתוח, ובלי שהבדיקות יזהמו נתוני פיתוח.
 * - שני מכשירים: מובייל הוא מסלול השימוש העיקרי (מנהל עבודה בשטח), דסקטופ
 *   נדרש למסך ההזנה המרוכזת מבדק בית. באג שנוגע רק לאחד מהם קורה בפועל.
 */
const PORT = 3101;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // כל הבדיקות חולקות בסיס נתונים אחד
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",

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
    command: `npx next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      APP_BASE_URL: BASE_URL,
    },
  },
});
