import { expect, test } from "@playwright/test";

/**
 * בדיקת נקודת הבריאות מול שרת אמיתי — הרמה הנכונה ל-endpoint של HTTP.
 *
 * נבדק דרך request context (בלי דפדפן): זה בדיוק מה ש-Railway יריץ מול
 * `healthcheckPath`, ולכן בדיקה זו מקבעת את החוזה שהפלטפורמה מסתמכת עליו.
 * אין כאן אימות ואין DB — הנקודה אמורה לענות גם כשעוד אין סשן וגם אם ה-DB רועד.
 */
test("‏GET /api/health מחזיר 200 עם סטטוס ok", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});
