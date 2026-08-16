import { expect, test } from "@playwright/test";
import { PROS } from "../fixtures/cast";
import { query } from "../fixtures/db";
import { loginAs } from "../fixtures/roles";
import {
  DRAFT_SCREEN,
  PORTAL,
  ROOMS_HE,
  RECIPIENTS_SCREEN,
  TICKET_STATUS,
  TICKET_SCREEN,
} from "../fixtures/spec-text";
import {
  expectExpiredLink,
  createTicket,
  openDetails,
  openPortalTicket,
  recipientRow,
  showLink,
  ticketIdFromPath,
  uniq,
  uniqPhone,
} from "../fixtures/world";

/**
 * האיסורים המפורשים של האפיון — כל מקום שבו כתוב "לעולם", "אך ורק",
 * "בלבד" או "אינו".
 *
 * בדיקה שלילית היא הסוג שקל ביותר לוותר עליו ושהכי כואב כשהיא חסרה: פיצ׳ר
 * שעובד נראה בעין, איסור שנפרץ אינו נראה עד שמישהו פורץ אותו.
 */

test.describe("PROH — הנמען אינו סוגר", () => {
  test("PROH-01/03/12 — אין בפורטל כפתור סגירה, ושתי פעולות בלבד", async ({ page }) => {
    await loginAs(page, "managerA");
    const contractor = uniq("קבלן-איסור");
    const description = uniq("תקלה לאיסור");
    await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain: "חשמל",
      description,
      newProfessional: { name: contractor, phone: uniqPhone() },
    });
    const link = await showLink(page, contractor);

    await openPortalTicket(page, link, description);

    await expect(page.getByRole("button", { name: PORTAL.markDone })).toBeVisible();
    // ‏"יש לי שאלה" הוסר ב-0.4 (§7 שורה 31). הטענה התהפכה: לא רק שהכפתור
    // אינו נדרש — קיומו מחדש יהיה נסיגה. שאלה נכתבת בתיבת התגובה.
    await expect(page.getByRole("button", { name: "יש לי שאלה" })).toHaveCount(0);
    // §4 מסך 8 שורה 323: "אין בפורטל כפתור סגירה. זה מכוון."
    await expect(page.getByRole("button", { name: TICKET_SCREEN.close })).toHaveCount(0);
    await expect(page.getByRole("button", { name: TICKET_SCREEN.reopen })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /סגור/ })).toHaveCount(0);

    // אין גם דרך לסמן "מי מטפל" או לערוך נמענים מהפורטל.
    await expect(page.getByRole("button", { name: TICKET_SCREEN.markHandler })).toHaveCount(0);
    await expect(page.getByRole("button", { name: TICKET_SCREEN.editRecipients })).toHaveCount(0);
  });

  test("PROH-10 — קבלן אינו מגיע לפנייה שלא שויכה אליו, גם עם טוקן תקף", async ({ page }) => {
    await loginAs(page, "managerA");

    const mine = uniq("קבלן-שלי");
    await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain: "חשמל",
      description: uniq("פנייה של הקבלן"),
      newProfessional: { name: mine, phone: uniqPhone() },
    });
    const link = await showLink(page, mine);

    // פנייה אחרת, שהקבלן הזה אינו משויך אליה כלל.
    const otherPath = await createTicket(page, {
      building: "בניין ב",
      apartment: "1",
      domain: "אינסטלציה",
      description: uniq("פנייה זרה"),
      recipients: [PROS.full.name],
    });
    const otherId = ticketIdFromPath(otherPath);

    await page.goto(`${link}/${otherId}`);
    await expectExpiredLink(page);
  });
});

test.describe("PROH — פנייה אינה נסגרת ואינה נמחקת מעצמה", () => {
  test("PROH-05/BR-09 — כשכל הנמענים סימנו טופל, הפנייה ממתינה לאישור ואינה נסגרת", async ({
    page,
  }) => {
    await loginAs(page, "managerA");
    const contractor = uniq("קבלן-סיים");
    const description = uniq("כולם סיימו");
    const path = await createTicket(page, {
      building: "בניין א",
      apartment: "2",
      domain: "חשמל",
      description,
      newProfessional: { name: contractor, phone: uniqPhone() },
    });
    const link = await showLink(page, contractor);

    await openPortalTicket(page, link, description);
    await page.getByRole("button", { name: PORTAL.markDone }).click();
    await expect(page.getByRole("status")).toBeVisible();

    await loginAs(page, "managerA");
    await page.goto(path);
    // §3.5 כלל 4 — "טופל — ממתין לאישור סופי", ובשום אופן לא "סגור".
    await expect(page.getByText(TICKET_STATUS.closed, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: TICKET_SCREEN.close })).toBeVisible();

    const rows = await query<{ closedAt: Date | null }>(
      `select "closedAt" from "Ticket" where id = $1`,
      [ticketIdFromPath(path)],
    );
    expect(rows[0]?.closedAt).toBeNull();
  });

  test("PROH-07/A1-10 — מנהל עבודה אינו מוחק פנייה ששוגרה", async ({ page }) => {
    await loginAs(page, "managerA");
    const path = await createTicket(page, {
      building: "בניין א",
      apartment: "3",
      domain: "חשמל",
      description: uniq("לא נמחקת"),
      recipients: [PROS.full.name],
    });

    await expect(page.getByRole("button", { name: /מחק/ })).toHaveCount(0);

    // גם לאדמין אין "מחק טיוטה" על פנייה ששוגרה — רק מחיקת כפילות.
    await loginAs(page, "admin");
    await page.goto(path);
    await expect(page.getByRole("button", { name: DRAFT_SCREEN.delete })).toHaveCount(0);
  });

  test("PROH-19 — טיוטה עם נמען אינה יוצרת שיוך ואינה נשלחת לאיש", async ({ page }) => {
    await loginAs(page, "managerA");
    const path = await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain: "חשמל",
      description: uniq("טיוטה עם נמען"),
      recipients: [PROS.full.name],
      saveAsDraft: true,
    });

    await expect(page.getByText(DRAFT_SCREEN.banner)).toBeVisible();

    const id = ticketIdFromPath(path);
    const assignments = await query<{ count: string }>(
      `select count(*)::text as count from "Assignment" where "ticketId" = $1`,
      [id],
    );
    expect(
      Number(assignments[0]?.count ?? -1),
      "לטיוטה אסור שיהיה שיוך — שיוך פירושו שמישהו קיבל אותה",
    ).toBe(0);
  });
});

test.describe("PROH — גבולות המודל", () => {
  test("PROH-16 — רשימת החדרים היא 11 הערכים הקבועים, בלי חצר או שטח חוץ", async ({
    page,
  }) => {
    await loginAs(page, "managerA");
    await page.goto("/tickets/new");
    await page.getByRole("button", { name: /^חדר/ }).first().click();

    const options = page.getByRole("option");
    await expect(options).toHaveCount(ROOMS_HE.length);
    for (const room of ROOMS_HE) {
      await expect(page.getByRole("option", { name: room, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("option", { name: /חצר/ })).toHaveCount(0);
  });

  test("PROH-20/BR-39 — נמען ללא טלפון וללא מייל נחסם", async ({ page }) => {
    await loginAs(page, "managerA");
    await page.goto("/tickets/new");
    const name = uniq("קבלן-בלי-פרטים");
    await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
    await page.getByLabel("שם").fill(name);
    await page.getByRole("button", { name: "שמור איש מקצוע" }).click();

    // ההתנהגות שהאפיון דורש: השיגור נחסם, ומוצגת סיבה.
    await expect(page.getByRole("alert").filter({ hasText: /לא ניתן לשגר/ })).toBeVisible();
    await expect(page.getByRole("list", { name: "נמענים", exact: true })).toHaveCount(0);
  });

  test("S3-08 — נוסח ההודעה על נמען בלי פרטי קשר, כלשונו באפיון", async ({ page }) => {
    /**
     * ‏§4 מסך 3 שורה 241 מחייב את המשפט: "חסר טלפון או מייל — בלעדיהם לא
     * ניתן לשלוח לו את הפנייה." הוא אינו קיים בקוד: `he.ts` מחזיק במקומו
     * ‏`directory.contactRequiredHint` ("צריך טלפון או מייל — בלעדיהם אי
     * אפשר לשלוח אליו את הפנייה") כרמז מקדים, ושגיאה אחרת בשיגור. הפער
     * מדווח ב-`conformance-report`; ‏`test.fail` יהפוך לאדום ברגע שיתוקן.
     */
    test.fail();
    await loginAs(page, "managerA");
    await page.goto("/tickets/new");
    await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
    await page.getByLabel("שם").fill(uniq("קבלן-נוסח"));
    await page.getByRole("button", { name: "שמור איש מקצוע" }).click();
    await expect(page.getByText(RECIPIENTS_SCREEN.missingContact)).toBeVisible();
  });

  test("PROH-22 — למדיה בשרשור אין פעולת מחיקה", async ({ page }) => {
    await loginAs(page, "managerA");
    const path = await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain: "חשמל",
      description: uniq("בלי מחיקת מדיה"),
      recipients: [PROS.full.name],
    });
    await page.goto(path);
    await expect(page.getByRole("button", { name: /מחק קובץ|הסר מהשרשור/ })).toHaveCount(0);
  });
});

test.describe("PROH — הפנייה חוזרת לפותח", () => {
  test("PROH-14 — סימון 'אני מטפל' אינו נועל את הפנייה בפני מנהל אחר", async ({ page }) => {
    await loginAs(page, "managerA");
    const path = await createTicket(page, {
      building: "בניין ב",
      apartment: "3",
      domain: "חשמל",
      description: uniq("בלי נעילה"),
      recipients: [PROS.full.name],
    });
    await page.getByRole("button", { name: TICKET_SCREEN.markHandler }).click();
    await openDetails(page);
    await expect(recipientRow(page, PROS.full.name)).toBeVisible();

    // מנהל אחר באותו אתר עדיין רשאי לפעול: להגיב, ולקחת את הסימון במפורש.
    await loginAs(page, "managerA2");
    await page.goto(path);
    // הפנייה אינה נעולה: המנהל השני קורא, מגיב, ועורך נמענים.
    await expect(page.getByLabel("תגובה")).toBeEditable();
    // כפתור השליחה מושבת כשאין מה לשלוח — מקלידים ואז בודקים.
    await page.getByLabel("תגובה").fill("גם אני יכול לפעול");
    await expect(page.getByRole("button", { name: TICKET_SCREEN.send, exact: true })).toBeEnabled();
    // עריכת הנמענים ירדה לפאנל "פרטים" ב-0.3 (אפיון מסך 2 אזור ב׳).
    await openDetails(page);
    await expect(page.getByRole("button", { name: "+ איש מקצוע חדש" })).toBeVisible();
  });
});
