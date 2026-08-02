import { defineConfig, devices } from "@playwright/test";

/**
 * הרצת QA מול הפרודקשן החי — **בלי `globalSetup`**, וזו הנקודה הקריטית.
 *
 * ‏`e2e/global-setup.ts` מרוקן כל טבלה בבסיס לפני הריצה. הפניית החבילה
 * הרגילה לכתובת הפרודקשן הייתה מוחקת את המערכת. הקובץ הזה קיים כדי
 * שהאפשרות הזו לא תהיה קיימת: אין כאן setup, ואין `webServer`.
 */
const BASE_URL = process.env.QA_BASE_URL ?? "https://web-production-6875c.up.railway.app";

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  expect: { timeout: 20_000 },

  use: {
    baseURL: BASE_URL,
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "mobile", use: { ...devices["Pixel 5"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
});
