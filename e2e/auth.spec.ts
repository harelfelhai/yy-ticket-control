import { expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";

/**
 * מסלול ההתחברות מקצה לקצה, במסלול האמיתי: טופס → Server Action → עוגייה
 * מוצפנת → מסך מוגן. הבדיקות האלה תופסות דברים שבדיקת יחידה לא יכולה,
 * כמו הגנת ה-proxy והחזרה ליעד המקורי אחרי התחברות.
 */

async function login(page: import("@playwright/test").Page, password = E2E_ADMIN.password) {
  await page.getByLabel("טלפון או מייל").fill(E2E_ADMIN.phone);
  await page.getByLabel("סיסמה").fill(password);
  await page.getByRole("button", { name: "כניסה" }).click();
}

test.describe("התחברות", () => {
  test("משתמש לא מחובר שמנסה להגיע ללוח מופנה להתחברות", async ({ page }) => {
    await page.goto("/board");
    await expect(page).toHaveURL(/\/login/);
  });

  test("פרטים נכונים מכניסים ללוח", async ({ page }) => {
    await page.goto("/login");
    await login(page);

    await expect(page).toHaveURL(/\/board$/);
    await expect(page.getByRole("banner")).toContainText(E2E_ADMIN.name);
  });

  test("פרטים שגויים מציגים שגיאה ואינם מכניסים", async ({ page }) => {
    await page.goto("/login");
    await login(page, "סיסמה שגויה");

    // מוגבל לטופס: כלי הפיתוח של Next מוסיפים role="alert" משלהם לעמוד.
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "פרטי ההתחברות אינם נכונים",
    );
    await expect(page).toHaveURL(/\/login/);
  });

  test("אחרי התחברות המשתמש חוזר למסך שאליו ניסה להגיע", async ({ page }) => {
    // תרחיש אמיתי: קישור שנשלח בוואטסאפ נפתח אחרי שהסשן פג.
    await page.goto("/board");
    await expect(page).toHaveURL(/next=%2Fboard/);

    await login(page);
    await expect(page).toHaveURL(/\/board$/);
  });

  test("יציאה מנתקת ומחזירה למסך ההתחברות", async ({ page }) => {
    await page.goto("/login");
    await login(page);
    await expect(page).toHaveURL(/\/board$/);

    await page.getByRole("button", { name: "יציאה" }).click();
    await expect(page).toHaveURL(/\/login/);

    // אימות אמיתי שהסשן נהרס, ולא רק שהדפדפן ניווט.
    await page.goto("/board");
    await expect(page).toHaveURL(/\/login/);
  });

  test("משתמש מחובר שמגיע למסך ההתחברות מועבר ללוח", async ({ page }) => {
    await page.goto("/login");
    await login(page);
    await expect(page).toHaveURL(/\/board$/);

    await page.goto("/login");
    await expect(page).toHaveURL(/\/board$/);
  });
});
