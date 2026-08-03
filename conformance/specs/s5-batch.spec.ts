import { expect, test } from "@playwright/test";
import { loginAs } from "../fixtures/roles";
import { BATCH_SCREEN } from "../fixtures/spec-text";
import { pick, uniq, uniqPhone } from "../fixtures/world";

/**
 * מסך 5 — הזנה מרוכזת מדוח בדק בית.
 *
 * "מיועד לדסקטופ" הוא דרישה ולא העדפה (§4 שורה 269), ולכן הבדיקה רצה
 * בפרויקט הדסקטופ בלבד. זהו גם המסך שעונה על **התרחיש המתפרץ** — עשרות
 * ליקויים בדירה אחת — ולכן הכשל שהכי חשוב לתפוס בו הוא כשל חלקי.
 */
test.describe("מסך 5 — הזנה מרוכזת", () => {
  test.skip(
    () => test.info().project.name !== "desktop",
    "מסך דסקטופ (§4 שורה 269)",
  );

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
  });

  test("S5-06/S5-08 — כל שורה היא פנייה: תיאור · חדר · תחום · נמען", async ({ page }) => {
    const row = page.getByRole("group", { name: "שורה 1", exact: true });
    await expect(row).toBeVisible();
    await expect(row.getByLabel("תיאור הליקוי")).toBeVisible();
    await expect(row.getByLabel("תחום")).toBeVisible();
    await expect(row.getByLabel("חדר")).toBeVisible();
    await expect(row.getByLabel("נמען")).toBeVisible();

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

    // שני אנשי מקצוע חדשים, שנוצרים מתוך המסך.
    for (const name of [proA, proB]) {
      await page.getByRole("button", { name: "+ איש מקצוע חדש" }).first().click();
      await page.getByLabel("שם").fill(name);
      await page.getByLabel("טלפון").fill(uniqPhone());
      await page.getByRole("button", { name: "שמור איש מקצוע" }).click();
    }

    const rows = [
      { description: uniq("סדק בקיר"), domain: "טיח וצבע", recipient: proA },
      { description: uniq("נזילה בכיור"), domain: "אינסטלציה", recipient: proB },
      { description: uniq("שקע שרוף"), domain: "חשמל", recipient: proA },
      { description: uniq("בלי נמען"), domain: "נגרות", recipient: null },
    ];

    while ((await page.getByRole("group", { name: /^שורה \d+$/ }).count()) < rows.length) {
      await page.getByRole("button", { name: BATCH_SCREEN.addRow }).click();
    }

    for (const [index, row] of rows.entries()) {
      const group = page.getByRole("group", { name: `שורה ${index + 1}`, exact: true });
      await group.getByLabel("תיאור הליקוי").fill(row.description);
      await group.getByLabel("תחום").selectOption({ label: row.domain });
      if (row.recipient) {
        await group.getByLabel("נמען").selectOption({ label: row.recipient });
      }
    }

    await page.getByRole("button", { name: BATCH_SCREEN.dispatchAll }).click();

    // "נוצרו 3 פניות ושויכו ל-2 אנשי מקצוע." — הנוסח המדויק מהאפיון.
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

    const group = page.getByRole("group", { name: "שורה 1", exact: true });
    await group.getByLabel("תיאור הליקוי").fill(uniq("ליקוי לטיוטה"));
    await group.getByLabel("תחום").selectOption({ label: "חשמל" });

    await page.getByRole("button", { name: BATCH_SCREEN.saveAllAsDraft }).click();
    await expect(page.getByText(/נשמרה כטיוטה|נשמרו כטיוטה/)).toBeVisible();
    await expect(page.getByText("לא נשלחה לאיש|לא נשלחו לאיש")).toHaveCount(0);
  });
});
