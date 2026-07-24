import { type Locator, type Page, expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";

/**
 * QA רוחבי אוטומטי: כיווניות (RTL), היעדר גלישה אופקית, וגדלי מגע.
 *
 * מה שכאן **אינו** מחליף: בדיקה על מכשיר פיזי אמיתי (iPhone Safari, Android
 * Chrome) בתנאי שטח (שמש, כפפות). זו נשארת בדיקה ידנית שתלויה בפריסה. מה
 * שכן: הבדיקות רצות גם תחת מנוע WebKit (פרויקט safari-qa), הקירוב הקרוב
 * ביותר ל-iOS Safari, וכך תופסות פערי רינדור שדפדפן Chromium לבדו מפספס.
 *
 * גודל המגע: 44px הוא המינימום של Apple ושל WCAG 2.5.5 — היעד הקטן ביותר
 * שאפשר להקיש עליו באמינות עם אצבע, קל וחומר בכפפה או בשמש.
 */

const MIN_TOUCH_PX = 44;

/** גלישה אופקית: התוכן לא אמור לחרוג מרוחב המסך. סובלנות של 2px לעיגול תת-פיקסלי. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "יש גלישה אופקית מעבר לרוחב המסך").toBeLessThanOrEqual(2);
}

async function expectRtl(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
}

/** גובה יעד המגע — נמדד מתיבת התוחם בפועל, לא מ-CSS */
async function expectTouchTarget(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.height ?? 0, "יעד המגע קטן מהמינימום").toBeGreaterThanOrEqual(MIN_TOUCH_PX);
}

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/board");
  if (new URL(page.url()).pathname === "/login") {
    await page.getByLabel("טלפון או מייל").fill(E2E_ADMIN.phone);
    await page.getByLabel("סיסמה").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "כניסה" }).click();
  }
  await expect(page).toHaveURL(/\/board$/);
}

test("מסך ההתחברות: RTL, בלי גלישה, וגדלי מגע", async ({ page }) => {
  await page.goto("/login");

  await expectRtl(page);
  await expectNoHorizontalOverflow(page);

  // המסך העיקרי בשטח: השדות והכפתור חייבים להיות נוחים להקשה.
  await expectTouchTarget(page.getByLabel("טלפון או מייל"));
  await expectTouchTarget(page.getByLabel("סיסמה"));
  await expectTouchTarget(page.getByRole("button", { name: "כניסה" }));
});

test("הלוח: RTL ובלי גלישה אופקית", async ({ page }) => {
  await loginAsAdmin(page);
  await expectRtl(page);
  await expectNoHorizontalOverflow(page);
});

test("מסך יצירת פנייה: RTL ובלי גלישה אופקית", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/tickets/new");

  await expectRtl(page);
  await expectNoHorizontalOverflow(page);
});

test("פורטל הקבלן (קישור לא תקף): RTL ובלי גלישה", async ({ page }) => {
  // גם מסך השגיאה של הפורטל נצפה בשטח, ולכן נבדק.
  await page.goto("/p/lo-kayam");
  await expectRtl(page);
  await expectNoHorizontalOverflow(page);
});
