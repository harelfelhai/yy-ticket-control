import { expect, test } from "@playwright/test";
import { CAST, SITE_A, SITE_B } from "../fixtures/cast";
import { loginAs } from "../fixtures/roles";

/**
 * שער שלב 1 — הצוות קיים ומתחבר.
 *
 * הבדיקה הזו אינה מאמתת דרישה מהאפיון; היא מאמתת שהתשתית שעליה כל שאר
 * החבילה נשענת עובדת. בלעדיה, כשל בהרשאות היה נראה כמו פער באפיון בזמן
 * שהוא סתם משתמש שלא נוצר.
 */

test.describe("צוות ההתאמה", () => {
  for (const key of ["admin", "owner", "managerA", "managerA2", "managerB"] as const) {
    test(`${CAST[key].name} מתחבר ומגיע ללוח`, async ({ page }) => {
      await loginAs(page, key);
      await expect(page).toHaveURL(/\/board/);
      await expect(page.getByRole("banner")).toContainText(CAST[key].name);
    });
  }

  /**
   * **הטענה התהפכה עבור הבעלים, וזה תיקון ולא ויתור.**
   *
   * ‏§4 שורה 345 ("מסכים 11–15: מנהל מערכת ראשי בלבד") נשמר במלואו — הוא
   * חל על **תוכן** מסכי הניהול, וזה נבדק ב-A2-08. מה שהשתנה הוא מה שיושב
   * מאחורי הקישור: מאז סבב הצפיפות **סקירת האתרים (מסך 10) עברה לראש
   * `/admin`**, ולבעלים היא המסך היחיד שנבנה עבורו (§5.ז — "רואה את כל
   * האתרים"). קישור חסום היה מסתיר ממנו בדיוק אותו.
   *
   * מנהל העבודה נשאר בחוץ: אין לו תצוגה חוצת-אתרים כלל.
   */
  test("קישור הניהול מוצג למנהל המערכת ולבעלים, ולא למנהל עבודה (§4 שורה 345 + מסך 10)", async ({
    page,
  }) => {
    const navLink = () => page.getByRole("navigation").getByRole("link", { name: "ניהול" });

    await loginAs(page, "admin");
    await expect(navLink()).toBeVisible();

    await loginAs(page, "owner");
    await expect(navLink()).toBeVisible();

    await loginAs(page, "managerA");
    await expect(navLink()).toHaveCount(0);
  });

  test("שני האתרים קיימים והמנהלים משויכים נכון", async ({ page }) => {
    // מנהל עבודה משויך לאתר אחד: האתר מוצג כערך ולא כבורר — אין לו מה
    // לבחור — ואתר ב׳ אינו מופיע כלל.
    await loginAs(page, "managerA");
    await page.goto("/tickets/new");
    await expect(page.getByRole("button", { name: "שלח לנמענים" })).toBeEnabled();
    await expect(page.getByText(SITE_A, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^אתר/ })).toHaveCount(0);
    await expect(page.getByText(SITE_B, { exact: true })).toHaveCount(0);

    // אדמין פועל בכל האתרים, ולכן השדה פתוח ואינו נבחר מראש: **בחירה
    // מפורשת**, כי ברירת מחדל שרירותית הייתה משייכת פניות לאתר הלא נכון.
    await loginAs(page, "admin");
    await page.goto("/tickets/new");
    await expect(page.getByRole("button", { name: "שלח לנמענים" })).toBeEnabled();
    const openSite = page.getByRole("button", { name: /^אתר/ }).first();
    await expect(openSite).toBeEnabled();
    await openSite.click();
    await expect(page.getByRole("option", { name: SITE_A, exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: SITE_B, exact: true })).toBeVisible();
  });
});
