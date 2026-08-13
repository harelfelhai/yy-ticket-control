import { expect, test } from "@playwright/test";
import { SITE_A } from "../fixtures/cast";
import { loginAs } from "../fixtures/roles";
import { acceptDialogs, createTicket, uniq, uniqPhone } from "../fixtures/world";

/**
 * מסכים 11–16 — ניהול הרשומות (הכרעות 0.3, §7 שורות 23–25).
 *
 * האפיון קובע: "בכל אחת מהרשימות אפשר לערוך ולמחוק", עם שני כללים חוצים —
 * **המחיקה נחסמת כשקיימות הפניות וההודעה אומרת מה חוסם ובכמה**, ו**משתמש
 * אינו נמחק לעולם**. שלושת אלה נבדקים כאן מקצה לקצה.
 *
 * **כל בדיקת מחיקה יוצרת את הרשומה שלה ומוחקת אותה.** מחיקה שנוגעת בנתוני
 * ה-cast הייתה מרעילה את ההרצה הבאה — `provision-cast` עושה upsert לפי שם,
 * ושאר הבדיקות מניחות שהאתרים, הבניינים והקבלנים קיימים.
 */

test.describe("מסך 16 — בניינים ודירות", () => {
  test("S16-01 — האתר מוביל למסך הבניינים, ואפשר להגדיר בניין ודירה מראש", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    await page.goto("/admin/sites");

    // ההגעה היא מהאתר ולא מתפריט שטוח: הייחודיות של שם בניין היא (אתר, שם).
    await page
      .getByRole("listitem")
      .filter({ hasText: SITE_A })
      .getByRole("link", { name: /בניינים ודירות/ })
      .click();
    await expect(page.getByRole("heading", { name: SITE_A })).toBeVisible();

    const building = uniq("בניין-ניהולי");
    await page.getByLabel("שם הבניין").fill(building);
    await page.getByRole("button", { name: "הוסף בניין", exact: true }).click();

    const row = page.getByRole("listitem").filter({ hasText: building });
    await expect(row).toBeVisible();
    await expect(row.getByText("אין פניות")).toBeVisible();

    // דירה נוספת לבניין שנוצר, מתוך אותה שורה.
    await row.getByLabel("מספר דירה").fill("12");
    await row.getByRole("button", { name: "הוסף דירה", exact: true }).click();
    await expect(row.getByText("דירה 12")).toBeVisible();

    // ניקוי אחרי עצמנו — הבדיקה אינה משאירה שאריות לריצה הבאה.
    await row.getByRole("button", { name: "מחק דירה 12" }).click();
    await expect(row.getByText("דירה 12")).toHaveCount(0);
    await row.getByRole("button", { name: `מחק ${building}` }).click();
    await expect(page.getByRole("listitem").filter({ hasText: building })).toHaveCount(0);
  });

  test("S16-02 — שינוי שם בניין נשמר, ושם תפוס נדחה עם הסבר", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    const first = uniq("בניין-א-זמני");
    const second = uniq("בניין-ב-זמני");

    await page.goto("/admin/sites");
    await page
      .getByRole("listitem")
      .filter({ hasText: SITE_A })
      .getByRole("link", { name: /בניינים ודירות/ })
      .click();

    for (const name of [first, second]) {
      await page.getByLabel("שם הבניין").fill(name);
      await page.getByRole("button", { name: "הוסף בניין", exact: true }).click();
      await expect(page.getByRole("listitem").filter({ hasText: name })).toBeVisible();
    }

    // שם תפוס באותו אתר — נדחה, וההודעה אומרת למה.
    const secondRow = page.getByRole("listitem").filter({ hasText: second });
    await secondRow.getByRole("button", { name: `שנה שם ${second}` }).click();
    await secondRow.getByRole("textbox", { name: second }).fill(first);
    await secondRow.getByRole("button", { name: "שמור", exact: true }).click();
    await expect(secondRow.getByRole("alert")).toContainText("כבר קיים בניין בשם הזה");

    // שם פנוי — נשמר.
    const renamed = uniq("בניין-אחרי-שינוי");
    await secondRow.getByRole("textbox", { name: second }).fill(renamed);
    await secondRow.getByRole("button", { name: "שמור", exact: true }).click();
    await expect(page.getByRole("listitem").filter({ hasText: renamed })).toBeVisible();

    for (const name of [first, renamed]) {
      const row = page.getByRole("listitem").filter({ hasText: name });
      await row.getByRole("button", { name: `מחק ${name}` }).click();
      await expect(page.getByRole("listitem").filter({ hasText: name })).toHaveCount(0);
    }
  });
});

test.describe("מסכים 11–16 — מחיקה חסומה ומוסברת", () => {
  test("S16-03 — תחום בשימוש אינו נמחק, וההודעה נוקבת בכמה פניות חוסמות", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");

    // תחום חדש שנכנס לפנייה אחת — ומרגע זה הוא היסטוריה ולא טעות הקלדה.
    const domain = uniq("תחום-בשימוש");
    await page.goto("/admin/domains");
    await page.getByLabel("תחום חדש").fill(domain);
    await page.getByRole("button", { name: "הוסף תחום", exact: true }).click();
    await expect(page.getByRole("button", { name: `שנה שם ${domain}` })).toBeVisible();

    await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain,
      description: uniq("פנייה-שחוסמת-תחום"),
      newProfessional: { name: uniq("קבלן-חוסם"), phone: uniqPhone() },
    });

    await page.goto("/admin/domains");
    const row = page.getByRole("listitem").filter({ hasText: domain });
    const remove = row.getByRole("button", { name: `מחק ${domain}` });

    // הכפתור לחיץ: החסימה היא מידע שאפשר לפעול לפיו, לא מצב שמסתירים.
    await expect(remove).toBeEnabled();
    await remove.click();
    await expect(row.getByRole("alert")).toContainText("לא ניתן למחוק");
    await expect(row.getByRole("alert")).toContainText("פנייה אחת משויכת");
    await expect(page.getByRole("listitem").filter({ hasText: domain })).toBeVisible();
  });

  test("S16-02b — תחום שלא נעשה בו שימוש נמחק", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    const domain = uniq("תחום-לניקוי");

    await page.goto("/admin/domains");
    await page.getByLabel("תחום חדש").fill(domain);
    await page.getByRole("button", { name: "הוסף תחום", exact: true }).click();

    const row = page.getByRole("listitem").filter({ hasText: domain });
    await row.getByRole("button", { name: `מחק ${domain}` }).click();
    await expect(page.getByRole("listitem").filter({ hasText: domain })).toHaveCount(0);
  });

  test("S16-04 — משתמש נערך ומושבת, ואין לו מחיקה בשום מקום במסך", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    await page.goto("/admin/users");

    const name = uniq("משתמש-לעריכה");
    await expect(page.getByRole("button", { name: "הוסף משתמש" })).toBeEnabled();
    await page.getByLabel("שם", { exact: true }).fill(name);
    await page.getByLabel("טלפון", { exact: true }).fill(uniqPhone());
    await page.getByLabel("תפקיד").selectOption({ label: "בעלים" });
    await page.getByLabel("סיסמה ראשונית").fill("conformance-1234");
    await page.getByRole("button", { name: "הוסף משתמש" }).click();

    const row = page.getByRole("listitem").filter({ hasText: name });
    await expect(row).toBeVisible();

    // עריכת פרטי קשר — קיימת.
    const renamed = `${name} עודכן`;
    await row.getByRole("button", { name: "ערוך פרטים" }).click();

    // השורה בעריכה אינה מכילה עוד את השם כטקסט אלא כערך של שדה, ולכן
    // ‏`filter({hasText})` מפסיק להתאים לה. מאתרים אותה לפי מה שיש בה.
    const editing = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: "שמור", exact: true }) });
    await editing.getByLabel("שם", { exact: true }).fill(renamed);
    await editing.getByRole("button", { name: "שמור", exact: true }).click();
    await expect(page.getByRole("listitem").filter({ hasText: renamed })).toBeVisible();

    // מחיקה — אינה קיימת, וזו ההכרעה: `SetNull` היה מוחק "מי מטפל"/"מי סגר".
    // מסלול ההוצאה הוא ההשבתה.
    const updated = page.getByRole("listitem").filter({ hasText: renamed });
    await expect(updated.getByRole("button", { name: /^מחק/ })).toHaveCount(0);
    await updated.getByRole("button", { name: "השבת" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: renamed })).toContainText("מושבת");
  });

  test("S16-05 — אתר עם בניינים ומשתמשים אינו נמחק, וההודעה מונה את שניהם", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    await page.goto("/admin/sites");

    const row = page.getByRole("listitem").filter({ hasText: SITE_A });
    await row.getByRole("button", { name: `מחק ${SITE_A}` }).click();

    const alert = row.getByRole("alert");
    await expect(alert).toContainText("לא ניתן למחוק");
    await expect(alert).toContainText("בניינים באתר");
    // האתר עצמו נשאר — הכשל אינו הרסני ואינו חלקי.
    await expect(page.getByRole("listitem").filter({ hasText: SITE_A })).toBeVisible();
  });
});
