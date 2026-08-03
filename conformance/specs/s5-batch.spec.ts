import { type Locator, expect, test } from "@playwright/test";
import { loginAs } from "../fixtures/roles";
import { BATCH_SCREEN } from "../fixtures/spec-text";
import { pick, uniq, uniqPhone } from "../fixtures/world";

/**
 * מסך 5 — הזנה מרוכזת מדוח בדק בית.
 *
 * "מיועד לדסקטופ" הוא דרישה ולא העדפה (§4 שורה 269), ולכן הבדיקה רצה
 * בפרויקט הדסקטופ בלבד. זהו גם המסך שעונה על **התרחיש המתפרץ** — עשרות
 * ליקויים בדירה אחת.
 */

/** בורר רשימה נלמדת בתוך שורה: תחום או נמען */
async function pickInRow(row: Locator, label: string, option: string) {
  await row.getByRole("button", { name: new RegExp(`^${label}`) }).first().click();
  await row
    .page()
    .getByRole("option", { name: new RegExp(`^${option}`) })
    .first()
    .click();
}

test.describe("מסך 5 — הזנה מרוכזת", () => {
  test.skip(() => test.info().project.name !== "desktop", "מסך דסקטופ (§4 שורה 269)");

  test.beforeEach(async ({ page }) => {
    await loginAs(page, "managerA");
    await page.goto("/tickets/batch");
  });

  test("S5-02/S5-05/S5-07 — הקשר משותף: מקור, בניין ודירה קבועים, ותגית אחת", async ({
    page,
  }) => {
    const aside = page.getByRole("complementary");
    await expect(aside).toBeVisible();
    await expect(aside).toContainText("המקור");
    await expect(aside).toContainText("משותף לכל השורות");
    await expect(aside.getByLabel("תגית משותפת")).toBeVisible();
    // בניין ודירה נבחרים פעם אחת — בהקשר המשותף ולא בכל שורה.
    await expect(aside.getByRole("button", { name: /^בניין/ })).toBeVisible();
    await expect(aside.getByRole("button", { name: /^דירה/ })).toBeVisible();
  });

  test("S5-06/S5-08 — כל שורה היא פנייה: תיאור · חדר · תחום · נמען", async ({ page }) => {
    const row = page.getByRole("group", { name: "שורה 1", exact: true });
    await expect(row).toBeVisible();
    await expect(row.getByLabel("תיאור הליקוי")).toBeVisible();
    await expect(row.getByRole("button", { name: /^תחום/ })).toBeVisible();
    await expect(row.getByLabel(/^חדר/)).toBeVisible();
    await expect(row.getByRole("button", { name: /^נמענים/ })).toBeVisible();

    const before = await page.getByRole("group", { name: /^שורה \d+$/ }).count();
    await page.getByRole("button", { name: BATCH_SCREEN.addRow }).click();
    await expect(page.getByRole("group", { name: /^שורה \d+$/ })).toHaveCount(before + 1);
  });

  test("S5-09/S5-11/S5-13/S5-14/V02-17 — שיגור: הסיכום בנוסח האפיון ושורה בלי נמען נשמרת כטיוטה", async ({
    page,
  }) => {
    const tagName = uniq("בדק בית — דירה");
    const proA = uniq("קבלן-בדק-א");
    const proB = uniq("קבלן-בדק-ב");

    await pick(page, "בניין", "בניין א");
    await pick(page, "דירה", "1");
    await page.getByLabel("תגית משותפת").fill(tagName);

    const rows = [
      { description: uniq("סדק בקיר"), domain: "טיח וצבע", recipient: proA, create: true },
      { description: uniq("נזילה בכיור"), domain: "אינסטלציה", recipient: proB, create: true },
      { description: uniq("שקע שרוף"), domain: "חשמל", recipient: proA, create: false },
      { description: uniq("בלי נמען"), domain: "נגרות", recipient: null, create: false },
    ];

    while ((await page.getByRole("group", { name: /^שורה \d+$/ }).count()) < rows.length) {
      await page.getByRole("button", { name: BATCH_SCREEN.addRow }).click();
    }

    for (const [index, spec] of rows.entries()) {
      const row = page.getByRole("group", { name: `שורה ${index + 1}`, exact: true });
      await row.getByLabel("תיאור הליקוי").fill(spec.description);
      await pickInRow(row, "תחום", spec.domain);

      if (spec.recipient && spec.create) {
        await row.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
        await row.getByLabel("שם").fill(spec.recipient);
        await row.getByLabel("טלפון").fill(uniqPhone());
        await row.getByRole("button", { name: "שמור איש מקצוע" }).click();
        await expect(row.getByRole("list", { name: "נמענים" })).toContainText(spec.recipient);
      } else if (spec.recipient) {
        await pickInRow(row, "נמענים", spec.recipient);
      }
    }

    await page.getByRole("button", { name: BATCH_SCREEN.dispatchAll }).click();

    // "נוצרו 3 פניות ושויכו ל-2 אנשי מקצוע." — הנוסח מהאפיון.
    await expect(page.getByText(BATCH_SCREEN.created(3, 2))).toBeVisible();
    // "שורה שחסר בה נמען נשמרת כטיוטה" (הכרעת 0.2)
    await expect(page.getByText(/חסרה נמען|חסרות נמען/)).toBeVisible();
    await expect(page.getByRole("link", { name: /פתח את התגית/ })).toBeVisible();
  });

  test("S5-12 — 'שמור הכל כטיוטה' אינו משגר לאיש", async ({ page }) => {
    const tagName = uniq("טיוטה-מרוכזת");
    await pick(page, "בניין", "בניין ב");
    await pick(page, "דירה", "2");
    await page.getByLabel("תגית משותפת").fill(tagName);

    const row = page.getByRole("group", { name: "שורה 1", exact: true });
    await row.getByLabel("תיאור הליקוי").fill(uniq("ליקוי לטיוטה"));
    await pickInRow(row, "תחום", "חשמל");

    await page.getByRole("button", { name: BATCH_SCREEN.saveAllAsDraft }).click();
    await expect(page.getByText(/נשמרה כטיוטה|נשמרו כטיוטה/)).toBeVisible();
    await expect(page.getByText(/לא נשלחה לאיש|לא נשלחו לאיש/)).toBeVisible();
  });
});
