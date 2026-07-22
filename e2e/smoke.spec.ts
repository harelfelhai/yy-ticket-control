import { expect, test } from "@playwright/test";

/**
 * בדיקת עשן לצינור ה-E2E כולו: שרת Next עולה, מגיש עמוד, וההגדרות
 * שקובעות אם ממשק עברי ייראה נכון (כיוון וטיפוגרפיה) באמת מגיעות לדפדפן.
 */
test.describe("שלד המערכת", () => {
  test("שורש האתר מפנה למסך ההתחברות כשאין סשן", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("העמוד נטען עם כיוון ימין-לשמאל ושפה עברית", async ({ page }) => {
    await page.goto("/login");

    const html = page.locator("html");
    await expect(html).toHaveAttribute("dir", "rtl");
    await expect(html).toHaveAttribute("lang", "he");
  });

  test("מציג את שם המערכת ככותרת", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("בקרת פניות");
  });

  test("הטקסט מוצג בפונט העברי שנטען ולא בפונט ברירת מחדל", async ({ page }) => {
    await page.goto("/login");
    const fontFamily = await page
      .getByRole("heading", { level: 1 })
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(fontFamily).toContain("Heebo");
  });
});
