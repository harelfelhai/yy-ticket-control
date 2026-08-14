import { type Page, expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";

/**
 * "פנייה לא הולכת לאיבוד" — הכלל הקשיח באפיון §5.ב.
 *
 * זו הבדיקה היחידה בפרויקט שמנתקת את הרשת בפועל. אין דרך אחרת לאמת את
 * ההתנהגות הזו: היא כולה בנויה סביב מה שקורה כשהבקשה **לא מגיעה לשרת**,
 * ולכן שום בדיקת אינטגרציה לא נוגעת בה.
 *
 * התרחיש מהשטח: מנהל עומד בקומה תשע, מקליד, לוחץ "שלח" — ואין קליטה.
 */

async function login(page: Page) {
  await page.goto("/board");
  if (new URL(page.url()).pathname === "/login") {
    await page.getByLabel("טלפון או מייל").fill(E2E_ADMIN.phone);
    await page.getByLabel("סיסמה").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "כניסה" }).click();
  }
  await expect(page).toHaveURL(/\/board$/);
}

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).first().click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function fillTicket(page: Page, description: string, stamp: number) {
  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await pick(page, "תחום", "חשמל");
  await page.getByLabel("תיאור").fill(description);
  await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
  await page.getByLabel("שם").fill(`קבלן ${stamp}`);
  await page.getByLabel("טלפון").fill(`051-${String(stamp).slice(-7)}`);
  await page.getByRole("button", { name: "שמור איש מקצוע" }).click();
  await expect(page.getByRole("list", { name: "נמענים", exact: true })).toContainText(
    `קבלן ${stamp}`,
  );
}

test("שיגור בלי קליטה נשמר מקומית, ויוצא לבד כשהחיבור חוזר", async ({ page, context }) => {
  const stamp = Date.now();
  const description = `אין מים חמים ${stamp}`;

  await login(page);
  await fillTicket(page, description, stamp);

  // ── הקליטה נופלת בדיוק לפני השיגור ────────────────────────────────
  await context.setOffline(true);
  await page.getByRole("button", { name: "שלח לנמענים" }).click();

  // מה שהוקלד לא נעלם, והמסך אומר זאת במפורש. בלי הבאנר המנהל רואה מסך
  // שלא הגיב, מניח שהפנייה נשלחה או שנעלמה, ומקליד הכול שוב.
  await expect(page.getByText("נשמר מקומית — ממתין לחיבור")).toBeVisible();
  await expect(page).toHaveURL(/\/tickets\/new/);

  // ── הקליטה חוזרת: הפנייה יוצאת לבד ────────────────────────────────
  await context.setOffline(false);
  // אירוע `online` הוא מה שמפעיל את הניסיון החוזר בדפדפן אמיתי; ב-Playwright
  // שינוי המצב אינו תמיד משדר אותו, ולכן משדרים אותו במפורש.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(description)).toBeVisible();
});

test("מה שהוקלד שורד רענון של הדפדפן", async ({ page }) => {
  // הטלפון ננעל, האפליקציה נסגרה, המנהל חזר. אותו מצב בדיוק.
  const stamp = Date.now();
  const description = `דלת המחסן תקועה ${stamp}`;

  await login(page);
  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await page.getByLabel("תיאור").fill(description);

  // ההמתנה היא להשהיית השמירה (400ms) ועוד שוליים.
  await expect(page.getByLabel("תיאור")).toHaveValue(description);
  await page.waitForTimeout(1200);

  await page.reload();

  await expect(page.getByText("שוחזר מה שהקלדת קודם")).toBeVisible();
  await expect(page.getByLabel("תיאור")).toHaveValue(description);
  // גם הבחירות מהרשימות חזרו, לא רק הטקסט.
  await expect(page.getByRole("button", { name: /^בניין/ }).first()).toContainText("בניין א");
});

test("פנייה ששוגרה בהצלחה אינה חוזרת כטיוטה בפנייה הבאה", async ({ page }) => {
  // אחרת כל פנייה חדשה הייתה נפתחת מלאה בפרטים של הקודמת.
  const stamp = Date.now();

  await login(page);
  await fillTicket(page, `תקלה ראשונה ${stamp}`, stamp);
  await page.getByRole("button", { name: "שלח לנמענים" }).click();
  await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible();

  await page.goto("/tickets/new");
  await expect(page.getByText("שוחזר מה שהקלדת קודם")).toHaveCount(0);
  await expect(page.getByLabel("תיאור")).toHaveValue("");
});
