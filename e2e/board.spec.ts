import { type Page, expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";

/**
 * הלוח הראשי — המסך שמנהל העבודה פותח בבוקר.
 *
 * הבדיקות מתמקדות במה שהאפיון מדגיש: רשימה אחת עם כותרות קיבוץ ולא טאבים,
 * טקסט סיבה על כל כרטיס, ומצב סיור שמקבץ לפי דירה.
 */

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("טלפון או מייל").fill(E2E_ADMIN.phone);
  await page.getByLabel("סיסמה").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "כניסה" }).click();
  await expect(page).toHaveURL(/\/board$/);
}

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).first().click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function createTicket(page: Page, apartment: string): Promise<string> {
  const stamp = Date.now();
  const description = `תקלה ${stamp}`;

  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", apartment);
  await pick(page, "תחום", "חשמל");
  await page.getByLabel("תיאור").fill(description);
  await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
  await page.getByLabel("שם").fill(`קבלן ${stamp}`);
  await page.getByLabel("טלפון").fill(`050-${String(stamp).slice(-7)}`);
  await page.getByRole("button", { name: "שמור איש מקצוע" }).click();
  await expect(page.getByRole("list", { name: "נמענים", exact: true })).toContainText(
    `קבלן ${stamp}`,
  );
  await page.getByRole("button", { name: "שלח לנמענים" }).click();
  await expect(page.getByRole("heading", { name: "שרשור" })).toBeVisible();

  return description;
}

test.describe("הלוח הראשי", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("מציג את שלוש הקבוצות ככותרות ברשימה אחת, לא כטאבים", async ({ page }) => {
    await createTicket(page, "1");
    await page.goto("/board");

    await expect(page.getByRole("heading", { name: /^דורש ממך/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^אצל הנמענים/ })).toBeVisible();
    // אין tablist — זו הכרעה מפורשת באפיון.
    await expect(page.getByRole("tablist")).toHaveCount(0);
  });

  test("פנייה חדשה מופיעה תחת 'אצל הנמענים' עם טקסט סיבה", async ({ page }) => {
    const description = await createTicket(page, "1");
    await page.goto("/board");

    const card = page.getByRole("link").filter({ hasText: description });
    await expect(card).toBeVisible();
    // טקסט הסיבה הוא הלב של הכרטיס: בלעדיו פנייה קופצת בין קבוצות בלי הסבר.
    await expect(card).toContainText("נשלח, טרם נצפה");
  });

  test("לחיצה על כרטיס מובילה לפנייה", async ({ page }) => {
    const description = await createTicket(page, "1");
    await page.goto("/board");

    await page.getByRole("link").filter({ hasText: description }).click();
    await expect(page).toHaveURL(/\/tickets\/[a-z0-9]+$/);
  });

  test("סגירה מעבירה את הפנייה לארכיון המקופל", async ({ page }) => {
    const description = await createTicket(page, "1");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "סגור פנייה" }).click();
    await expect(page.getByRole("button", { name: "פתח מחדש" })).toBeVisible();

    await page.goto("/board");

    // הארכיון מקופל: הפנייה קיימת אך אינה גלויה עד לפתיחת המקטע.
    await expect(page.getByRole("link").filter({ hasText: description })).toBeHidden();
    await page.getByText(/^ארכיון/).click();
    await expect(page.getByRole("link").filter({ hasText: description })).toBeVisible();
  });

  test("מצב סיור מקבץ לפי בניין ודירה", async ({ page }) => {
    await createTicket(page, "1");
    await createTicket(page, "2");

    await page.goto("/board");
    await page.getByRole("checkbox", { name: "מצב סיור" }).check();

    await expect(page.getByRole("heading", { name: /בניין א · דירה 1/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /בניין א · דירה 2/ })).toBeVisible();
  });

  test("מצב הסינון נשמר בכתובת, כך שחזרה למסך משמרת אותו", async ({ page }) => {
    await page.goto("/board");
    await page.getByLabel("הפניתי").selectOption("opened");

    await expect(page).toHaveURL(/direction=opened/);

    // חזרה מהפנייה למסך אינה מאבדת את הסינון.
    await page.reload();
    await expect(page.getByLabel("הפניתי")).toHaveValue("opened");
  });

  test("כפתור פנייה חדשה מוביל למסך היצירה", async ({ page }) => {
    await page.goto("/board");
    await page.getByRole("link", { name: "+ פנייה חדשה" }).click();
    await expect(page).toHaveURL(/\/tickets\/new$/);
  });
});
