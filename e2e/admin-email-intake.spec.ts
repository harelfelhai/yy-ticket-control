import { type Page, expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";

/**
 * EM-S12-01 (אפיון מסך 12, §3.7): בכרטיס המשתמש מתג "רשאי לפתוח פניות
 * במייל" ושדה "כתובות נוספות לפתיחת פניות במייל", מקצה לקצה — כולל שמירה
 * בשרת ששורדת רענון, ודחיית כתובת תפוסה עם שם המחזיק.
 *
 * **כל ריצה מנקה אחריה.** הבסיס משותף לשני המכשירים ולשאר החבילה: כתובת
 * שנשארת הייתה מפילה את הריצה של המכשיר השני ב"הכתובת כבר משויכת", ומתג
 * שנשאר כבוי היה משנה את מצב מנהל ה-seed לכל spec שבא אחריו.
 */

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

test("EM-S12-01 — מתג ההרשאה וכתובות נוספות נשמרים בשרת, וכתובת תפוסה נדחית בשם", async ({
  page,
}, testInfo) => {
  // הכתובת ייחודית לכל מכשיר ולכל ריצה — ראו ההערה בראש הקובץ. ארוכה
  // בכוונה: `<fieldset>` נמתח כברירת מחדל לרוחב התוכן שלו, וכתובת ארוכה
  // גלשה מהדיאלוג בטלפון (נתפס בצילום; ראו `email-intake-fields.tsx`).
  const address = `e2e-${testInfo.project.name}-${Date.now()}-a-rather-long-private-address@example-company-domain.co.il`;
  await loginAsAdmin(page);

  let dialog = await openAdminCard(page);
  const toggle = dialog.getByRole("checkbox", { name: "רשאי לפתוח פניות במייל" });
  await expect(toggle).toBeChecked();

  // ── הוספת כתובת ──────────────────────────────────────────────────
  const field = dialog.getByLabel("כתובת נוספת");
  await field.fill(address.toUpperCase());
  await dialog.getByRole("button", { name: "הוסף", exact: true }).click();
  // נשמרת מנורמלת, והשדה מתרוקן רק אחרי שהשרת קיבל.
  await expect(dialog.getByText(address, { exact: true })).toBeVisible();
  await expect(field).toHaveValue("");

  // הכתובת הארוכה מקוצצת ואינה מותחת את הדיאלוג: כפתור ההוספה כולו בתוכו.
  const dialogBox = await dialog.boundingBox();
  const addBox = await dialog.getByRole("button", { name: "הוסף", exact: true }).boundingBox();
  expect(addBox!.x).toBeGreaterThanOrEqual(dialogBox!.x);
  expect(addBox!.x + addBox!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width);

  // ── אותה כתובת שוב: נדחית, נוקבת בשם, והשדה אינו מתרוקן ────────────
  await field.fill(address);
  await dialog.getByRole("button", { name: "הוסף", exact: true }).click();
  await expect(dialog.getByText(`הכתובת כבר משויכת ל${E2E_ADMIN.name}.`)).toBeVisible();
  await expect(field).toHaveValue(address);

  // ── כיבוי ההרשאה שורד רענון ──────────────────────────────────────
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.reload();
  dialog = await openAdminCard(page);
  await expect(dialog.getByRole("checkbox", { name: "רשאי לפתוח פניות במייל" })).not.toBeChecked();
  await expect(dialog.getByText(address, { exact: true })).toBeVisible();

  // ── ניקוי: הדלקה מחדש והסרת הכתובת ────────────────────────────────
  await dialog.getByRole("checkbox", { name: "רשאי לפתוח פניות במייל" }).click();
  await expect(dialog.getByRole("checkbox", { name: "רשאי לפתוח פניות במייל" })).toBeChecked();
  await dialog.getByRole("button", { name: `הסר ${address}` }).click();
  await expect(dialog.getByText(address, { exact: true })).toHaveCount(0);
});
