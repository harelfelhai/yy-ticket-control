import { type Locator, type Page, expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";

/**
 * הזנה מרוכזת מדוח בדק בית (מסך 5), מקצה לקצה.
 *
 * זהו התרחיש המתפרץ שהמערכת נבנתה בשבילו: דירה אחת, כמה ליקויים, בעלי
 * מקצוע שונים — שיגור אחד. הבדיקה מאמתת גם את הכלל "פנייה לא הולכת
 * לאיבוד": שורה בלי נמען נשמרת כטיוטה במקום להיכשל, והסיכום אומר זאת.
 */

async function loginAsManager(page: Page) {
  await page.goto("/board");
  if (new URL(page.url()).pathname === "/login") {
    await page.getByLabel("טלפון או מייל").fill(E2E_ADMIN.phone);
    await page.getByLabel("סיסמה").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "כניסה" }).click();
  }
  await expect(page).toHaveURL(/\/board$/);
}

/** בוחר ערך מ-LearnedSelect בתוך אזור נתון (aside או שורה) */
async function pickIn(scope: Locator, label: string, option: string) {
  await scope.getByRole("button", { name: new RegExp(`^${label}`) }).first().click();
  await scope.page().getByRole("option", { name: option, exact: true }).click();
}

/** יוצר איש מקצוע חדש מתוך בורר הנמענים של שורה */
async function addProfessionalIn(row: Locator, name: string, phone: string) {
  await row.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
  await row.getByLabel("שם", { exact: true }).fill(name);
  await row.getByLabel("טלפון").fill(phone);
  await row.getByRole("button", { name: "שמור איש מקצוע" }).click();
  await expect(row.getByRole("list", { name: "נמענים", exact: true })).toContainText(name);
}

test("הזנה מרוכזת: כמה שורות, שיגור אחד, ושורה חסרת נמען נשמרת כטיוטה", async ({ page }) => {
  const stamp = Date.now();
  const tagName = `בדק בית דירה 1 ${stamp}`;
  const electrician = `חשמלאי ${stamp}`;
  const plumber = `אינסטלטור ${stamp}`;
  const digits = String(stamp).slice(-7);

  await loginAsManager(page);
  await page.goto("/tickets/batch");

  // ── הקשר משותף: בניין, דירה, תגית ─────────────────────────────────
  const aside = page.getByRole("complementary");
  await pickIn(aside, "בניין", "בניין א");
  await pickIn(aside, "דירה", "1");
  await aside.getByLabel("תגית משותפת").fill(tagName);

  const row = (n: number) => page.getByRole("group", { name: `שורה ${n}`, exact: true });

  // ── שורה 1: ליקוי חשמל, קבלן חדש ──────────────────────────────────
  await row(1).getByLabel("תיאור הליקוי").fill("אין חשמל בסלון");
  await pickIn(row(1), "תחום", "חשמל");
  await addProfessionalIn(row(1), electrician, `050-${digits}`);

  // ── שורה 2: ליקוי חשמל נוסף, אותו קבלן (בחירה מהקיים) ─────────────
  await row(2).getByLabel("תיאור הליקוי").fill("שקע שרוף במטבח");
  await pickIn(row(2), "תחום", "חשמל");
  await row(2).getByRole("button", { name: /^נמענים/ }).first().click();
  await page.getByRole("option", { name: electrician }).click();

  // ── שורה 3: אינסטלציה, קבלן חדש ──────────────────────────────────
  await row(3).getByLabel("תיאור הליקוי").fill("נזילה מתחת לכיור");
  await pickIn(row(3), "תחום", "חשמל");
  await addProfessionalIn(row(3), plumber, `052-${digits}`);

  // ── שורה 4: בלי נמען — תיהפך לטיוטה ───────────────────────────────
  await page.getByRole("button", { name: "הוסף שורה" }).click();
  await row(4).getByLabel("תיאור הליקוי").fill("דלת מרפסת לא נסגרת");
  await pickIn(row(4), "תחום", "חשמל");

  // ── שיגור: שלוש שוגרו לשני קבלנים, אחת נשמרה כטיוטה ───────────────
  await page.getByRole("button", { name: "שגר הכל" }).click();
  await expect(page.getByText("נוצרו 3 פניות ושויכו ל-2 אנשי מקצוע.")).toBeVisible();
  await expect(page.getByText("שורה אחת חסרה נמען. היא נשמרה כטיוטה.")).toBeVisible();

  // ── מסך התגית: כל ארבע הפניות מקובצות תחתיה ───────────────────────
  // (מסנן התגית בלוח מאומת בנפרד ב-tags.spec; כאן די בכך שהקיבוץ נכון.)
  await page.getByRole("link", { name: "פתח את התגית" }).click();
  await expect(page.getByRole("heading", { name: tagName })).toBeVisible();
  await expect(page.getByText("4 פתוחות · 0 סגורות")).toBeVisible();
  // ארבע הפניות — שלוש ששוגרו והטיוטה — כולן מקובצות תחת התגית.
  // (מחריגים את קישור ה-nav ל-/tickets/batch, שגם הוא תחת /tickets/.)
  await expect(
    page.locator('a[href^="/tickets/"]:not([href="/tickets/batch"])'),
  ).toHaveCount(4);
});
