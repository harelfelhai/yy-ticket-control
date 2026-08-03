import { expect, test } from "@playwright/test";
import { loginAs } from "../fixtures/roles";
import { DRAFT_SCREEN, TICKET_SCREEN } from "../fixtures/spec-text";
import {
  acceptDialogs,
  expectExpiredLink,
  activeTokenCount,
  createTicket,
  openPortalTicket,
  recipientRow,
  showLink,
  uniq,
  uniqPhone,
} from "../fixtures/world";

/**
 * הכרעות המימוש של גרסה 0.2 (§7 #15–18).
 *
 * ארבע הכרעות שהתקבלו **אחרי** שהמערכת נבנתה, ולכן הן המקום הסביר ביותר
 * שבו הקוד והמסמך נפרדו: מסמך שעודכן בדיעבד מתאר לעיתים את מה שהוחלט ולא
 * את מה שנכתב.
 */

test.describe("V02 — קישור הקבלן יציב, וההחלפה מפורשת", () => {
  test("V02-06/V02-13 — אותו קישור בשלוש הצגות; 'צור קישור חדש' הורג את הקודם", async ({
    page,
  }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const contractor = uniq("קבלן-קישור");
    const description = uniq("תקלה-קישור");
    await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain: "חשמל",
      description,
      newProfessional: { name: contractor, phone: uniqPhone() },
    });

    const first = await showLink(page, contractor);
    await page.reload();
    const second = await showLink(page, contractor);
    await page.reload();
    const third = await showLink(page, contractor);

    // "אותו קישור בכל שליחה, כך שהודעה ישנה בוואטסאפ ממשיכה לעבוד".
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(await activeTokenCount(contractor)).toBe(1);

    // הקישור הישן עובד לפני הסיבוב.
    await openPortalTicket(page, first, description);

    await loginAs(page, "managerA");
    await page.goto("/board");
    await page.getByRole("link").filter({ hasText: description }).first().click();
    await recipientRow(page, contractor)
      .getByRole("button", { name: "צור קישור חדש" })
      .click();

    const rotated = await page
      .getByRole("textbox", { name: "קישור גישה", exact: true })
      .inputValue();
    expect(rotated.replace(/^https?:\/\/[^/]+/, "")).not.toBe(first);
    expect(await activeTokenCount(contractor)).toBe(1);

    // "מנפיק טוקן חדש ומבטל את הישן" — הישן מפסיק לעבוד.
    await page.goto(first);
    await expectExpiredLink(page);
  });

  test("V02-10 — 'שלח בוואטסאפ' הוא קישור wa.me עם ההודעה מוכנה", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const contractor = uniq("קבלן-וואטסאפ");
    const description = uniq("תקלה-וואטסאפ");
    await createTicket(page, {
      building: "בניין א",
      apartment: "2",
      domain: "חשמל",
      description,
      newProfessional: { name: contractor, phone: uniqPhone() },
    });

    const link = recipientRow(page, contractor).getByRole("link", {
      name: TICKET_SCREEN.sendWhatsApp,
    });
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^https:\/\/wa\.me\/972\d+\?text=/);
    const text = decodeURIComponent(href?.split("?text=")[1] ?? "");
    expect(text).toContain(contractor);
    expect(text).toContain("בניין א");
    expect(text).toContain(description);
    expect(text).toContain("/p/");
  });

  test("V02-09 — 'שלח שוב במייל' זמין לנמען עם מייל ומעדכן את חיווי השליחה", async ({
    page,
  }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const contractor = uniq("קבלן-מייל");
    await createTicket(page, {
      building: "בניין א",
      apartment: "3",
      domain: "חשמל",
      description: uniq("תקלה-מייל"),
      newProfessional: {
        name: contractor,
        phone: uniqPhone(),
        email: `${uniq("mail")}@conformance.test`,
      },
    });

    const row = recipientRow(page, contractor);
    const resend = row.getByRole("button", { name: TICKET_SCREEN.resendEmail });
    await expect(resend).toBeVisible();
    await resend.click();
    await expect(page.getByRole("status")).toContainText(
      TICKET_SCREEN.linkResent(contractor),
    );
  });
});

test.describe("V02 — מחיקת טיוטה", () => {
  test("V02-21/V02-23 — מנהל עבודה מוחק טיוטה, ואינו מוחק פנייה ששוגרה", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");

    const draftText = uniq("טיוטה-למחיקה");
    await createTicket(page, { description: draftText, saveAsDraft: true });
    await expect(page.getByText(DRAFT_SCREEN.banner)).toBeVisible();

    await page.getByRole("button", { name: DRAFT_SCREEN.delete }).click();
    await expect(page).toHaveURL(/\/board/);
    await expect(page.getByText(draftText)).toHaveCount(0);

    // פנייה ששוגרה — אין למנהל העבודה שום פעולת מחיקה.
    await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain: "חשמל",
      description: uniq("שוגרה-לא-נמחקת"),
      newProfessional: { name: uniq("קבלן-שוגר"), phone: uniqPhone() },
    });
    await expect(page.getByRole("button", { name: DRAFT_SCREEN.delete })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "מחק פנייה" })).toHaveCount(0);
  });
});
