import { type Page, expect } from "@playwright/test";
import { CAST, type CastKey } from "./cast";

/**
 * התחברות בתפקיד. הבדיקות בחבילה הזו מחליפות תפקיד תדיר — זהו כל הרעיון —
 * ולכן ההתחברות היא פעולה ראשית ולא הכנה חד-פעמית.
 *
 * ‏`logout` מפורש ולא רק `goto("/login")`: משתמש מחובר שמגיע למסך ההתחברות
 * מועבר ללוח (auth.spec.ts בודקת בדיוק את זה), ולכן בלי ניתוק המעבר בין
 * תפקידים היה נכשל בשקט ומריץ את הבדיקה בתפקיד הקודם — הכשל המסוכן ביותר
 * האפשרי בחבילת הרשאות.
 */
export async function logout(page: Page): Promise<void> {
  await page.goto("/board");
  const button = page.getByRole("button", { name: "יציאה" });
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    await expect(page).toHaveURL(/\/login/);
  } else {
    await page.context().clearCookies();
  }
}

export async function loginAs(page: Page, key: CastKey): Promise<void> {
  const member = CAST[key];
  await logout(page);
  await page.goto("/login");
  await page.getByLabel("טלפון או מייל").fill(member.phone);
  await page.getByLabel("סיסמה").fill(member.password);
  await page.getByRole("button", { name: "כניסה" }).click();
  // אין `toHaveURL(/board$/)` כאן: OWNER ו-SITE_MANAGER מגיעים ליעדים שונים,
  // וההפניה עצמה היא דרישה נבדקת (S10-01). מספיק לוודא שיצאנו מ-/login.
  await expect(page).not.toHaveURL(/\/login/);
}

/** התחברות שמצפה לנחיתה על הלוח — המסלול של רוב התפקידים */
export async function loginAsAndLandOnBoard(page: Page, key: CastKey): Promise<void> {
  await loginAs(page, key);
  await expect(page).toHaveURL(/\/board/);
}
