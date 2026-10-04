import { type Page, expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";

/**
 * WA-S12-01 (אפיון מסך 12, §3.7 שדה 5): בכרטיס המשתמש מתג "רשאי לפתוח פניות
 * בוואטסאפ", דלוק כברירת מחדל, ליד מתג המייל — מקצה לקצה, כולל שמירה בשרת
 * ששורדת רענון.
 *
 * **הריצה מחזירה את המתג למצבו.** הבסיס משותף לשני המכשירים ולשאר החבילה,
 * ומתג שנשאר כבוי היה משנה את מצב מנהל ה-seed לכל spec שבא אחריו.
 */

const LABEL = "רשאי לפתוח פניות בוואטסאפ";

async function loginAsAdmin(page: Page) {
  await page.goto("/board");
  if (new URL(page.url()).pathname === "/login") {
    await page.getByLabel("טלפון או מייל").fill(E2E_ADMIN.phone);
    await page.getByLabel("סיסמה").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "כניסה" }).click();
  }
  await expect(page).toHaveURL(/\/board$/);
}

async function openAdminCard(page: Page) {
  await page.goto("/admin/users");
  await page.getByRole("button", { name: E2E_ADMIN.name, exact: true }).click();
  return page.getByRole("dialog");
}

test("WA-S12-01 — מתג הוואטסאפ דלוק כברירת מחדל, וכיבויו נשמר בשרת", async ({ page }) => {
  await loginAsAdmin(page);

  let dialog = await openAdminCard(page);
  const toggle = dialog.getByRole("checkbox", { name: LABEL });
  await expect(toggle).toBeChecked();
  // ליד מתג המייל, באותו גוש
  await expect(dialog.getByRole("checkbox", { name: "רשאי לפתוח פניות במייל" })).toBeVisible();

  // ── כיבוי ההרשאה שורד רענון ──────────────────────────────────────
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.reload();
  dialog = await openAdminCard(page);
  await expect(dialog.getByRole("checkbox", { name: LABEL })).not.toBeChecked();
  // המייל לא זז
  await expect(dialog.getByRole("checkbox", { name: "רשאי לפתוח פניות במייל" })).toBeChecked();

  // ── ניקוי: הדלקה מחדש ─────────────────────────────────────────────
  await dialog.getByRole("checkbox", { name: LABEL }).click();
  await expect(dialog.getByRole("checkbox", { name: LABEL })).toBeChecked();
  await page.reload();
  dialog = await openAdminCard(page);
  await expect(dialog.getByRole("checkbox", { name: LABEL })).toBeChecked();
});
