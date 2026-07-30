import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

/**
 * לכידה ויזואלית — צילום המסכים המרכזיים לבדיקת עיצוב.
 *
 * **קונפיג נפרד ולא פרויקט נוסף ב-`playwright.config.ts`.** הסיבה: חבילת
 * ה-E2E היא שער איכות שרץ ב-CI, והוספת פרויקט צילום אליה הייתה מאריכה כל
 * ריצה ומייצרת קבצים שאיש אינו בודק. כאן ההרצה יזומה בלבד (`npm run visual`).
 *
 * `globalSetup` ו-`webServer` מיובאים מאותה תשתית של ה-E2E ולא משוכפלים:
 * אותו בסיס בדיקות, אותו seed, אותם פרטי התחברות. מקור אמת אחד.
 *
 * הפלט ב-`.visual/` — ב-gitignore. אלה תצלומים לקריאה אנושית (או של סוכן),
 * לא snapshot-ים להשוואה אוטומטית; השוואה מול תקן היא שיפוט, לא diff של פיקסלים.
 */
const PORT = 3101;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./visual",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 120_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
  },

  projects: [
    {
      name: "mobile",
      // ‏390×844 ב-dsf 2 ולא ברירת המחדל של Pixel 5 (dsf 2.75): זהו מסלול
      // השימוש העיקרי, וקובץ קטן יותר נקרא מהר יותר בלי לאבד פרטי עיצוב.
      use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],

  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 300_000,
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
      APP_BASE_URL: BASE_URL,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "",
      NEXT_PUBLIC_SENTRY_DSN: "",
      MEDIA_STORAGE: "local",
    },
  },
});
