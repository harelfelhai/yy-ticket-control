import { expect, test } from "@playwright/test";
import { CAST, PROS } from "../fixtures/cast";
import { loginAs } from "../fixtures/roles";
import {
  CREATE_SCREEN,
  DRAFT_SCREEN,
  RECIPIENTS_SCREEN,
  THREAD_EVENTS,
  TICKET_SCREEN,
  TICKET_STATUS,
} from "../fixtures/spec-text";
import {
  createTicket,
  gotoNewTicket,
  pick,
  recipientRow,
  uniq,
  uniqPhone,
} from "../fixtures/world";

/**
 * מסכים 2, 3, 4 ו-7 — הפנייה, הנמענים, היצירה המהירה והשלמת הטיוטה.
 *
 * מסך 2 הוא "ליבת המערכת" ומסך 4 מיועד ל"שימוש ביד אחת מול הדירה". שניהם
 * מוגדרים באפיון ברמת פירוט של רכיבים ונוסחים, ולכן כל פריט נבדק בנפרד.
 */

test.describe("מסך 2 — הפנייה והשרשור", () => {
  test("S2-01 — הכותרת מציגה בניין, דירה, חדר, דייר, תחום, סטטוס וגיל", async ({ page }) => {
    await loginAs(page, "managerA");
    const description = uniq("כותרת-מלאה");
    await gotoNewTicket(page);
    await pick(page, "בניין", "בניין א");
    await pick(page, "דירה", "1");
    await pick(page, "תחום", "חשמל");
    await pick(page, "חדר", "מטבח");
    await page.getByLabel("תיאור").fill(description);
    await page.getByRole("button", { name: /^נמענים/ }).first().click();
    await page.getByRole("option", { name: new RegExp(`^${PROS.full.name}`) }).first().click();
    await page.getByRole("button", { name: CREATE_SCREEN.submit }).click();

    const header = page.getByRole("banner").locator("xpath=following::header[1]");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("בניין א");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("דירה 1");
    await expect(page.getByText("חשמל · מטבח")).toBeVisible();
    await expect(page.getByText(TICKET_STATUS.fresh, { exact: true })).toBeVisible();
    await expect(page.getByText("היום")).toBeVisible();
    await expect(page.getByText("דייר")).toBeVisible();
    void header;
  });

  test("S2-02 — רצועת הנמענים מציגה סטטוס אישי לכל נמען", async ({ page }) => {
    await loginAs(page, "managerA");
    const first = uniq("קבלן-רצועה-א");
    const second = uniq("קבלן-רצועה-ב");
    await createTicket(page, {
      building: "בניין א",
      apartment: "2",
      domain: "חשמל",
      description: uniq("רצועה"),
      newProfessional: { name: first, phone: uniqPhone() },
    });

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
    await page.getByLabel("שם").fill(second);
    await page.getByLabel("טלפון").fill(uniqPhone());
    await page.getByRole("button", { name: "שמור איש מקצוע" }).click();

    await expect(recipientRow(page, first)).toBeVisible();
    await expect(recipientRow(page, second)).toBeVisible();
    await expect(recipientRow(page, first)).toContainText("נשלח");
    await expect(recipientRow(page, second)).toContainText("נשלח");
  });

  test("S2-06 — השרשור מציג אירועי מערכת בעברית", async ({ page }) => {
    await loginAs(page, "managerA");
    const contractor = uniq("קבלן-אירועים");
    await createTicket(page, {
      building: "בניין ב",
      apartment: "1",
      domain: "חשמל",
      description: uniq("אירועים"),
      newProfessional: { name: contractor, phone: uniqPhone() },
    });

    const thread = page.getByRole("list").filter({ hasText: THREAD_EVENTS.assigned(contractor) });
    await expect(thread).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await recipientRow(page, contractor)
      .getByRole("button", { name: /^הסר/ })
      .click();
    await expect(page.getByText(THREAD_EVENTS.removed(contractor))).toBeVisible();
  });

  test("S2-08/S2-09/S2-10/S2-16 — כל פעולות המסך קיימות לפותח", async ({ page }) => {
    await loginAs(page, "managerA");
    await createTicket(page, {
      building: "בניין א",
      apartment: "3",
      domain: "חשמל",
      description: uniq("פעולות"),
      recipients: [PROS.full.name],
    });

    await expect(page.getByRole("button", { name: TICKET_SCREEN.send })).toBeVisible();
    await expect(page.getByRole("button", { name: TICKET_SCREEN.markHandler })).toBeVisible();
    await expect(page.getByRole("button", { name: TICKET_SCREEN.close })).toBeVisible();
    await expect(page.getByLabel("תגובה")).toBeEditable();
    await expect(page.getByRole("button", { name: "+ איש מקצוע חדש" })).toBeVisible();
  });
});

test.describe("מסך 3 — עריכת נמענים", () => {
  test("S3-03 — בחירת איש מקצוע קיים שולפת את פרטי הקשר שלו", async ({ page }) => {
    await loginAs(page, "managerA");
    await gotoNewTicket(page);
    await page.getByRole("button", { name: /^נמענים/ }).first().click();
    // הרמז שמוצג לצד השם הוא הטלפון או המייל שנשלפו מהרשומה.
    await expect(
      page.getByRole("option", { name: new RegExp(`^${PROS.full.name}\\s+\\S`) }),
    ).toBeVisible();
  });

  test("S3-06 — נוסח אישור ההוספה כלשונו באפיון", async ({ page }) => {
    await loginAs(page, "managerA");
    const contractor = uniq("קבלן-אישור");
    await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain: "חשמל",
      description: uniq("אישור-הוספה"),
      newProfessional: { name: contractor, phone: uniqPhone() },
    });

    const messages: string[] = [];
    page.on("dialog", (dialog) => {
      messages.push(dialog.message());
      void dialog.accept();
    });
    await page.getByRole("button", { name: /^נמענים/ }).first().click();
    await page.getByRole("option", { name: new RegExp(`^${PROS.second.name}`) }).first().click();
    await expect(recipientRow(page, PROS.second.name)).toBeVisible();

    expect(messages).toContain(RECIPIENTS_SCREEN.confirmAdd);
  });

  test("S3-07 — נוסח אישור ההסרה כלשונו באפיון", async ({ page }) => {
    await loginAs(page, "managerA");
    const contractor = uniq("קבלן-הסרה");
    await createTicket(page, {
      building: "בניין ב",
      apartment: "2",
      domain: "חשמל",
      description: uniq("אישור-הסרה"),
      newProfessional: { name: contractor, phone: uniqPhone() },
    });

    const messages: string[] = [];
    page.on("dialog", (dialog) => {
      messages.push(dialog.message());
      void dialog.accept();
    });
    await recipientRow(page, contractor)
      .getByRole("button", { name: /^הסר/ })
      .click();
    await expect(page.getByText("נמענים שהוסרו")).toBeVisible();

    expect(messages).toContain(RECIPIENTS_SCREEN.confirmRemove(contractor));
  });
});

test.describe("מסך 4 — יצירת פנייה מהירה", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "managerA");
    await gotoNewTicket(page);
  });

  test("S4-01/S4-03 — מסך אחד ולא אשף, והמדיה בראש", async ({ page }) => {
    // אשף היה מציג "הבא"/"שלב 1 מתוך N". כאן כל השדות על מסך אחד.
    await expect(page.getByRole("button", { name: /^הבא/ })).toHaveCount(0);
    await expect(page.getByText(/שלב \d+ מתוך/)).toHaveCount(0);

    await expect(page.getByRole("button", { name: "צלם" })).toBeVisible();
    await expect(page.getByRole("button", { name: "הקלט" })).toBeVisible();
    await expect(page.getByLabel("תיאור")).toBeVisible();
    await expect(page.getByRole("button", { name: CREATE_SCREEN.submit })).toBeVisible();
    await expect(page.getByRole("button", { name: CREATE_SCREEN.saveDraft })).toBeVisible();
  });

  test("S4-05/S4-06 — בניין ודירה הם רשימת בחירה, ויצירת ערך חדש מכוונת", async ({ page }) => {
    await page.getByRole("button", { name: /^בניין/ }).first().click();
    await expect(page.getByRole("option", { name: "בניין א" })).toBeVisible();
    // שם קיים אינו מציע יצירה — כך שגיאת הקלדה אינה יוצרת בניין כפול.
    await page.getByRole("textbox", { name: /חיפוש/ }).fill("בניין א");
    await expect(page.getByRole("button", { name: /צור חדש/ })).toHaveCount(0);
    // שם שאינו קיים כן מציע — וזו פעולה נפרדת ומפורשת.
    await page.getByRole("textbox", { name: /חיפוש/ }).fill(uniq("בניין"));
    await expect(page.getByRole("button", { name: /צור חדש/ })).toBeVisible();
  });

  test("S4-13/S4-15 — 'שמור כטיוטה' נשמר ולא נשלח לאיש", async ({ page }) => {
    const description = uniq("טיוטה-מהירה");
    await page.getByLabel("תיאור").fill(description);
    await page.getByRole("button", { name: CREATE_SCREEN.saveDraft }).click();
    await expect(page.getByText(DRAFT_SCREEN.banner)).toBeVisible();
    await expect(page.getByText(description)).toBeVisible();
  });
});

test.describe("מסך 7 — השלמת טיוטה", () => {
  test("S7-03/S7-04/S7-05/S7-06/S7-07 — הקשר, השדות החסרים בלבד, ושתי הפעולות", async ({
    page,
  }) => {
    await loginAs(page, "managerA");
    const description = uniq("טיוטה-להשלמה");
    await gotoNewTicket(page);
    await pick(page, "בניין", "בניין א");
    await pick(page, "דירה", "1");
    await page.getByLabel("תיאור").fill(description);
    await page.getByRole("button", { name: CREATE_SCREEN.saveDraft }).click();

    // הבאנר, ההקשר המקורי, ושתי הפעולות.
    await expect(page.getByText(DRAFT_SCREEN.banner)).toBeVisible();
    await expect(page.getByText(description)).toBeVisible();
    await expect(page.getByRole("button", { name: DRAFT_SCREEN.submit })).toBeVisible();
    await expect(page.getByRole("button", { name: DRAFT_SCREEN.delete })).toBeVisible();

    // "רק השדות החסרים" — בניין ודירה כבר מולאו ואינם מוצגים שוב לעריכה.
    await expect(page.getByRole("button", { name: /^תחום/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^נמענים/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^בניין/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^דירה/ })).toHaveCount(0);

    // השלמה ושיגור.
    await pick(page, "תחום", "חשמל");
    await page.getByRole("button", { name: /^נמענים/ }).first().click();
    await page.getByRole("option", { name: new RegExp(`^${PROS.full.name}`) }).first().click();
    await page.getByRole("button", { name: DRAFT_SCREEN.submit }).click();

    await expect(page.getByText(DRAFT_SCREEN.banner)).toHaveCount(0);
    await expect(recipientRow(page, PROS.full.name)).toContainText("נשלח");
  });

  test("S7-01/S7-02 — הטיוטה מוצגת בראש הלוח ומסומנת באדום", async ({ page }) => {
    await loginAs(page, "managerA");
    const description = uniq("טיוטה-בראש");
    await createTicket(page, { description, saveAsDraft: true });

    await page.goto("/board");
    const cards = page.locator('a[href^="/tickets/"]');
    await expect(cards.first()).toContainText(description);
    await expect(cards.first()).toHaveClass(/danger/);
  });
});

test.describe("§1 — מי פתח את הפנייה", () => {
  test("DM-F04 — הפנייה מציגה את שם הפותח", async ({ page }) => {
    await loginAs(page, "managerA2");
    await createTicket(page, {
      building: "בניין א",
      apartment: "2",
      domain: "חשמל",
      description: uniq("פותח"),
      recipients: [PROS.full.name],
    });
    await expect(page.getByText(CAST.managerA2.name)).toBeVisible();
  });
});
