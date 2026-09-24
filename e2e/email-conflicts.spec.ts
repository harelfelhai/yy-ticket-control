import { type Page, expect, test } from "@playwright/test";
import { type EmailSeed, seedEmail } from "./email-fixtures";
import { loginAsManager } from "./helpers";

/**
 * מסך 7א — סתירות בין המייל למערכת (EM-S7A-01…06), בדסקטופ ובמובייל.
 *
 * הטיוטה הזרועה נושאת סתירה אחת: הבניין נערך במערכת ל"בניין א", והתשובה
 * במייל הציעה "בניין ב". הזריעה מאפסת את התרחיש לפני כל קובץ, ולכן פרויקט
 * הדסקטופ מקבל סתירה פתוחה גם אחרי שהמובייל הכריע אותה.
 */

let seed: EmailSeed;

test.beforeAll(() => {
  seed = seedEmail();
});

test.beforeEach(async ({ page }) => {
  await loginAsManager(page);
  await page.goto(`/tickets/${seed.draftId}`);
  await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible();
});

async function openConflicts(page: Page) {
  // הכפתור מושבת עד ה-hydration, ו-click ממתין שיהיה פעיל — לחיצה לפניו
  // הייתה נבלעת בשקט
  await page.getByRole("button", { name: "השווה ובחר" }).click();
  const dialog = page.getByRole("dialog", { name: "סתירות בין המייל למערכת" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("EM-S7A-02/03/04 — כותרת מהאפיון, בלי בחירה מראש, והאישור חסום עד שנבחר ערך", async ({
  page,
}, testInfo) => {
  const dialog = await openConflicts(page);

  const radios = dialog.getByRole("radio");
  await expect(radios).toHaveCount(2);
  for (const radio of await radios.all()) await expect(radio).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "החל את הבחירה" })).toBeDisabled();

  // המקור נכלל בשם הנגיש של כל אפשרות — בשני הרוחבים
  await expect(dialog.getByRole("radio", { name: "במערכת: בניין א" })).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "מהמייל: בניין ב" })).toBeVisible();

  if (testInfo.project.name === "desktop") {
    // טבלת השוואה: העמודות "במערכת" / "מהמייל", וכל השדות — גם שאינם בסתירה
    await expect(dialog.getByText("במערכת", { exact: true })).toBeVisible();
    await expect(dialog.getByText("מהמייל", { exact: true })).toBeVisible();
    await expect(dialog.getByText("תיאור", { exact: true })).toBeVisible();
    await expect(dialog.getByText("נמענים", { exact: true })).toBeVisible();
  } else {
    // בטלפון: גוש לכל שדה בסתירה בלבד; שדות שאינם בסתירה אינם מוצגים
    await expect(dialog.getByText("תיאור", { exact: true })).toBeHidden();
    await expect(dialog.getByText("נמענים", { exact: true })).toBeHidden();
    await expect(dialog.getByText("בניין", { exact: true })).toBeVisible();
  }
});

test("EM-S7A-05 — 'סגור' סוגר בלי שינוי והסתירה נשארת", async ({ page }) => {
  const dialog = await openConflicts(page);
  await dialog.getByRole("radio", { name: /בניין ב/ }).check();
  await dialog.getByRole("button", { name: "סגור", exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(
    page.getByText("יש סתירה בין המייל למערכת ב-1 שדה. לא ניתן לשגר עד שתוכרע."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "שגר", exact: true })).toBeDisabled();
});

test("EM-S7A-04/05 + EM-C09 — 'החל את הבחירה' בשלב אחד: הסתירה נסגרת, 'שגר' משתחרר, ובלי תג 'מהמייל'", async ({
  page,
}) => {
  const dialog = await openConflicts(page);
  await dialog.getByRole("radio", { name: /בניין ב/ }).check();
  const apply = dialog.getByRole("button", { name: "החל את הבחירה" });
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(dialog).toBeHidden();

  const building = page.locator('[data-field="BUILDING"]');
  // הסתירה נסגרה: ההודעה נעלמה, הסימון ירד, והשיגור אינו חסום עוד מסתירה
  await expect(page.getByText(/יש סתירה בין המייל למערכת/)).toHaveCount(0);
  await expect(building.getByText("בסתירה", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "שגר", exact: true })).toBeEnabled();
  // הערך שנבחר נכתב לטיוטה — בפקד הבניין, ובכותרת המסך
  await expect(building.getByRole("button", { name: /^בניין/ })).toContainText("בניין ב");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("בניין ב");
  // הכרעה נחשבת עריכה במערכת: הבניין אינו נושא "מהמייל"
  await expect(building.getByText("מהמייל", { exact: true })).toHaveCount(0);

  // ושורד רענון — זה מצב בשרת, לא בדפדפן
  await page.reload();
  await expect(page.locator('[data-field="BUILDING"]').getByRole("button", { name: /^בניין/ })).toContainText(
    "בניין ב",
  );
  await expect(page.getByRole("button", { name: "השווה ובחר" })).toHaveCount(0);
});
