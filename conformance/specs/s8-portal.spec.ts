import { expect, test } from "@playwright/test";
import { CAST } from "../fixtures/cast";
import { loginAs } from "../fixtures/roles";
import { ASSIGNMENT_STATUS, PORTAL, TICKET_SCREEN } from "../fixtures/spec-text";
import {
  acceptDialogs,
  expectExpiredLink,
  createTicket,
  openPortalTicket,
  recipientRow,
  showLink,
  uniq,
  uniqPhone,
} from "../fixtures/world";

/**
 * מסך 8 — פורטל הנמען החיצוני.
 *
 * "הפורטל הוא מוצר נפרד, לא גרסה מצומצמת של האפליקציה הפנימית", וקהל היעד
 * "אינו טכנולוגי, נכנס ללא סיסמה וללא הדרכה". לכן כל דבר שאינו שתי פעולות
 * ותיבת תגובה הוא חריגה.
 */

test.describe("מסך 8 — פורטל הקבלן", () => {
  test("S8-04/S8-05/S8-06 — הקישור פותח לוח בקרה אישי, לא פנייה בודדת", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const contractor = uniq("קבלן-לוח");
    const firstDescription = uniq("תקלה-א");
    const secondDescription = uniq("תקלה-ב");

    await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain: "חשמל",
      description: firstDescription,
      newProfessional: { name: contractor, phone: uniqPhone() },
    });
    const link = await showLink(page, contractor);

    await createTicket(page, {
      building: "בניין א",
      apartment: "2",
      domain: "אינסטלציה",
      description: secondDescription,
      recipients: [contractor],
    });

    // הקישור מציג את **שתי** הפניות, ולא אחת מהן.
    await page.goto(link);
    await expect(page.getByRole("heading", { name: `שלום ${contractor}` })).toBeVisible();
    await expect(page.getByText(firstDescription)).toBeVisible();
    await expect(page.getByText(secondDescription)).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();

    // סגירת אחת מהן מעבירה אותה ללשונית הארכיון.
    await loginAs(page, "managerA");
    await page.goto("/board");
    await page.getByRole("link").filter({ hasText: firstDescription }).first().click();
    await page.getByRole("button", { name: TICKET_SCREEN.close }).click();
    await expect(page.getByRole("status")).toContainText(TICKET_SCREEN.closedNotice);

    await page.goto(link);
    await expect(page.getByText(secondDescription)).toBeVisible();
    const archive = page.locator("details");
    await expect(archive).toBeVisible();
    await archive.getByText(/ארכיון/).click();
    await expect(archive).toContainText("בניין א");
  });

  test("S8-07 — הנמען שנוסף רואה את השרשור המלא, כולל מה שקדם לצירופו", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const early = uniq("הערה שקדמה לצירוף");
    const first = uniq("קבלן-ראשון");
    const late = uniq("קבלן-מאוחר");
    const description = uniq("תקלה-היסטוריה");

    await createTicket(page, {
      building: "בניין ב",
      apartment: "1",
      domain: "חשמל",
      description,
      newProfessional: { name: first, phone: uniqPhone() },
    });

    await page.getByLabel("תגובה").fill(early);
    await page.getByRole("button", { name: TICKET_SCREEN.send, exact: true }).click();
    await expect(page.getByText(early)).toBeVisible();

    await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
    await page.getByLabel("שם").fill(late);
    await page.getByLabel("טלפון").fill(uniqPhone());
    await page.getByRole("button", { name: "שמור איש מקצוע" }).click();
    await expect(recipientRow(page, late)).toBeVisible();

    const link = await showLink(page, late);
    await openPortalTicket(page, link, description);
    await expect(page.getByText(early)).toBeVisible();
  });

  test("S8-08/S8-13 — 'סיימתי — טופל' מחזיר את הפנייה לאישור הפותח, בנוסח האפיון", async ({
    page,
  }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const contractor = uniq("קבלן-טופל");
    const description = uniq("תקלה-טופל");
    await createTicket(page, {
      building: "בניין א",
      apartment: "3",
      domain: "חשמל",
      description,
      newProfessional: { name: contractor, phone: uniqPhone() },
    });
    const link = await showLink(page, contractor);

    await openPortalTicket(page, link, description);
    await page.getByRole("button", { name: PORTAL.markDone }).click();
    await expect(page.getByRole("status")).toContainText(
      PORTAL.doneNotice(CAST.managerA.name),
    );
  });

  test("S8-09/S8-14 — 'יש לי שאלה' נשלחת לפותח, בנוסח האפיון", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const contractor = uniq("קבלן-שאלה");
    const description = uniq("תקלה-שאלה-פורטל");
    await createTicket(page, {
      building: "בניין ב",
      apartment: "2",
      domain: "חשמל",
      description,
      newProfessional: { name: contractor, phone: uniqPhone() },
    });
    const link = await showLink(page, contractor);

    await openPortalTicket(page, link, description);
    await page.getByLabel("תגובה").fill("צריך אישור לפני שאני מתחיל");
    await page.getByRole("button", { name: PORTAL.askQuestion }).click();
    await expect(page.getByRole("status")).toContainText(
      PORTAL.questionNotice(CAST.managerA.name),
    );

    await loginAs(page, "managerA");
    await page.goto("/board");
    await page.getByRole("link").filter({ hasText: description }).first().click();
    await expect(recipientRow(page, contractor)).toContainText(ASSIGNMENT_STATUS.question);
  });

  test("S8-15 — קישור שאינו קיים מציג את נוסח האפיון", async ({ page }) => {
    acceptDialogs(page);
    await page.goto("/p/lo-kayam-bichlal");
    await expectExpiredLink(page);
  });

  test("S8-01/S8-02 — הפורטל אינו האפליקציה הפנימית: אין ניווט, אין יציאה, אין חיפוש", async ({
    page,
  }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const contractor = uniq("קבלן-מוצר-נפרד");
    const description = uniq("תקלה-מוצר-נפרד");
    await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain: "חשמל",
      description,
      newProfessional: { name: contractor, phone: uniqPhone() },
    });
    const link = await showLink(page, contractor);

    await page.context().clearCookies();
    await page.goto(link);
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "יציאה" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "חיפוש" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "תגיות" })).toHaveCount(0);
  });
});
