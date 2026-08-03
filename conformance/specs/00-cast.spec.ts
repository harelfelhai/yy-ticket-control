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

  test("קישור הניהול מוצג למנהל המערכת בלבד (§4 שורה 345)", async ({ page }) => {
    await loginAs(page, "admin");
    await expect(page.getByRole("navigation").getByRole("link", { name: "ניהול" })).toBeVisible();

    await loginAs(page, "owner");
    await expect(page.getByRole("navigation").getByRole("link", { name: "ניהול" })).toHaveCount(0);

    await loginAs(page, "managerA");
    await expect(page.getByRole("navigation").getByRole("link", { name: "ניהול" })).toHaveCount(0);
  });

  test("שני האתרים קיימים והמנהלים משויכים נכון", async ({ page }) => {
    // מנהל עבודה משויך לאתר אחד ולכן מגיע ישירות לטופס, בלי בורר אתר.
    await loginAs(page, "managerA");
    await page.goto("/tickets/new");
    await expect(page.getByRole("button", { name: /^בניין/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: SITE_B, exact: true })).toHaveCount(0);

    // אדמין פועל בכל האתרים ולכן **בוחר במפורש** (`tickets/new/page.tsx:39`).
    await loginAs(page, "admin");
    await page.goto("/tickets/new");
    await expect(page.getByRole("link", { name: SITE_A, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: SITE_B, exact: true })).toBeVisible();
  });
});
