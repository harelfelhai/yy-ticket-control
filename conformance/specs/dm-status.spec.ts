import { expect, test } from "@playwright/test";
import { query } from "../fixtures/db";
import { loginAs } from "../fixtures/roles";
import {
  ASSIGNMENT_STATUS,
  BOARD,
  PORTAL,
  REASON_EXAMPLES,
  TICKET_SCREEN,
  TICKET_STATUS,
} from "../fixtures/spec-text";
import {
  acceptDialogs,
  ageTicket,
  boardArchive,
  boardCard,
  expandArchive,
  boardSection,
  createTicket,
  openPortalTicket,
  recipientRow,
  runJob,
  showLink,
  ticketIdFromPath,
  uniq,
  uniqPhone,
} from "../fixtures/world";

/**
 * §3.5 — שבעת כללי גזירת הסטטוס, כל אחד בתרחיש שמפעיל **אותו** ולא את
 * קודמיו, ודרך המסך ולא דרך הפונקציה.
 *
 * הסדר הוא הדרישה: "הכלל הראשון שמתקיים הוא הקובע". בדיקת יחידה על
 * `deriveTicketStatus` כבר קיימת; מה שהיא אינה יכולה להוכיח הוא שהמסך
 * באמת מציג את מה שהפונקציה חישבה, ושהתרחיש בעולם האמיתי מגיע למצב הזה.
 */

/** יוצר פנייה עם קבלן חדש ומחזיר את הנתיב, שם הקבלן, קישור הפורטל והתיאור */
async function ticketWithContractor(
  page: import("@playwright/test").Page,
  label: string,
  extra: { apartment?: string } = {},
) {
  const contractor = uniq(`קבלן-${label}`);
  const description = uniq(`תקלה-${label}`);
  const path = await createTicket(page, {
    building: "בניין א",
    apartment: extra.apartment ?? "1",
    domain: "חשמל",
    description,
    newProfessional: { name: contractor, phone: uniqPhone() },
  });
  const link = await showLink(page, contractor);
  return { path, contractor, link, description };
}

test.describe("§3.5 — גזירת סטטוס הפנייה", () => {
  test.beforeEach(async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
  });

  test("DM-D07 — אף נמען לא צפה ⇒ חדש", async ({ page }) => {
    acceptDialogs(page);
    const { path, contractor } = await ticketWithContractor(page, "חדש");
    await page.goto(path);
    await expect(page.getByText(TICKET_STATUS.fresh, { exact: true })).toBeVisible();
    await expect(recipientRow(page, contractor)).toContainText(ASSIGNMENT_STATUS.sent);
  });

  test("DM-D06/DM-S02 — נמען פתח ⇒ נצפה, והמנהל רואה מי צפה", async ({ page }) => {
    acceptDialogs(page);
    const { path, contractor, link, description } = await ticketWithContractor(page, "נצפה");

    await openPortalTicket(page, link, description);

    await loginAs(page, "managerA");
    await page.goto(path);
    await expect(recipientRow(page, contractor)).toContainText(ASSIGNMENT_STATUS.viewed);
  });

  test("DM-D05/DM-D10 — חלק סיימו ⇒ בטיפול חלקי, והסיבה היא '1 מתוך 2 סיימו'", async ({
    page,
  }) => {
    acceptDialogs(page);
    const first = uniq("קבלן-חלקי-א");
    const second = uniq("קבלן-חלקי-ב");
    const description = uniq("תקלה-חלקית");
    const path = await createTicket(page, {
      building: "בניין א",
      apartment: "2",
      domain: "חשמל",
      description,
      newProfessional: { name: first, phone: uniqPhone() },
    });

    // הנמען השני מתווסף אחרי היצירה — זהו מסלול המשנה WF-S02.
    await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
    await page.getByLabel("שם").fill(second);
    await page.getByLabel("טלפון").fill(uniqPhone());
    await page.getByRole("button", { name: "שמור איש מקצוע" }).click();
    await expect(recipientRow(page, second)).toBeVisible();

    const link = await showLink(page, first);
    await openPortalTicket(page, link, description);
    await page.getByRole("button", { name: PORTAL.markDone }).click();
    await expect(page.getByRole("status")).toBeVisible();

    await loginAs(page, "managerA");
    await page.goto(path);
    await expect(page.getByText(TICKET_STATUS.partial, { exact: true })).toBeVisible();

    await page.goto("/board");
    await expect(boardCard(page, description)).toContainText(REASON_EXAMPLES.partial(1, 2));
  });

  test("DM-D04 — כל הנמענים סיימו ⇒ ממתין לפותח (אישור), והפנייה ב'דורש ממך'", async ({
    page,
  }) => {
    acceptDialogs(page);
    const { path, link, description } = await ticketWithContractor(page, "אישור", {
      apartment: "3",
    });
    await openPortalTicket(page, link, description);
    await page.getByRole("button", { name: PORTAL.markDone }).click();
    await expect(page.getByRole("status")).toBeVisible();

    await loginAs(page, "managerA");
    await page.goto(path);
    await expect(page.getByText(TICKET_STATUS.awaitingApproval, { exact: true })).toBeVisible();

    await page.goto("/board");
    await expect(boardSection(page, BOARD.actionRequired)).toContainText(description);
  });

  test("DM-D03/DM-D08 — שאלה גוברת על טופל", async ({ page }) => {
    acceptDialogs(page);
    const asker = uniq("קבלן-שואל");
    const finisher = uniq("קבלן-מסיים");
    const description = uniq("תקלה-שאלה");
    const path = await createTicket(page, {
      building: "בניין ב",
      apartment: "1",
      domain: "חשמל",
      description,
      newProfessional: { name: finisher, phone: uniqPhone() },
    });

    await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
    await page.getByLabel("שם").fill(asker);
    await page.getByLabel("טלפון").fill(uniqPhone());
    await page.getByRole("button", { name: "שמור איש מקצוע" }).click();
    await expect(recipientRow(page, asker)).toBeVisible();

    const finisherLink = await showLink(page, finisher);
    const askerLink = await showLink(page, asker);

    await openPortalTicket(page, finisherLink, description);
    await page.getByRole("button", { name: PORTAL.markDone }).click();
    await expect(page.getByRole("status")).toBeVisible();

    await openPortalTicket(page, askerLink, description);
    await page.getByLabel("תגובה").fill("איפה שעון המים?");
    await page.getByRole("button", { name: PORTAL.askQuestion }).click();
    await expect(page.getByRole("status")).toBeVisible();

    await loginAs(page, "managerA");
    await page.goto(path);
    // אחד סיים ואחד שאל — "שאלה גובר על הכול (למעט סגירה)".
    await expect(page.getByText(TICKET_STATUS.awaitingQuestion, { exact: true })).toBeVisible();

    await page.goto("/board");
    await expect(boardCard(page, description)).toContainText(REASON_EXAMPLES.question(asker));
  });

  test("DM-D02 — חסרים שדות חובה ⇒ טיוטה", async ({ page }) => {
    acceptDialogs(page);
    const description = uniq("תקלה-טיוטה");
    await createTicket(page, { description, saveAsDraft: true });
    await expect(page.getByText(TICKET_STATUS.draft, { exact: true })).toBeVisible();
  });

  test("DM-D01/DM-D09 — סגירה ⇒ סגור; פתיחה מחדש מחזירה לכללים ומוסיפה תג", async ({
    page,
  }) => {
    acceptDialogs(page);
    const { path, contractor, description } = await ticketWithContractor(page, "סגירה");

    await page.getByRole("button", { name: TICKET_SCREEN.close }).click();
    await expect(page.getByRole("status")).toContainText(TICKET_SCREEN.closedNotice);
    await expect(page.getByText(TICKET_STATUS.closed, { exact: true })).toBeVisible();

    // הפנייה יורדת לארכיון המקופל ואינה נעלמת (PROH-06).
    await page.goto("/board");
    await expect(boardSection(page, BOARD.actionRequired)).not.toContainText(description);
    await expect(boardSection(page, BOARD.withRecipients)).not.toContainText(description);
    await expandArchive(page);
    await expect(boardArchive(page)).toContainText(description);
    await page.goto(path);

    await page.getByRole("button", { name: TICKET_SCREEN.reopen }).click();
    await expect(page.getByRole("status")).toContainText(TICKET_SCREEN.reopenedNotice);
    // "'נפתח מחדש' אינו סטטוס נפרד" — הסטטוס חוזר לכללים, והתג נוסף.
    await expect(page.getByText(TICKET_STATUS.fresh, { exact: true })).toBeVisible();
    await expect(recipientRow(page, contractor)).toContainText(ASSIGNMENT_STATUS.sent);

    await page.goto("/board");
    await expect(boardCard(page, description)).toContainText(TICKET_STATUS.reopenedBadge);
  });

  test("DM-D11 — כל השיוכים הוסרו: מצב שהאפיון לא הגדיר (GAP-05)", async ({ page }) => {
    acceptDialogs(page);
    const { path, contractor } = await ticketWithContractor(page, "הוסרו");

    await recipientRow(page, contractor)
      .getByRole("button", { name: /^הסר/ })
      .click();
    await expect(page.getByText("נמענים שהוסרו")).toBeVisible();

    // האפיון אינו קובע מה הסטטוס כאן. הבדיקה מתעדת את ההתנהגות בפועל
    // ואינה קובעת שהיא שגויה — הפער הוא באפיון, ומדווח ככזה.
    const id = ticketIdFromPath(path);
    const rows = await query<{ count: string }>(
      `select count(*)::text as count from "Assignment"
        where "ticketId" = $1 and status <> 'REMOVED'`,
      [id],
    );
    expect(Number(rows[0]?.count ?? -1)).toBe(0);
    await page.goto(path);
    await expect(page.getByText(TICKET_STATUS.fresh, { exact: true })).toBeVisible();
  });
});

test.describe("§5.ג — הסלמה על היעדר תנועה", () => {
  test("BR-10/BR-16 — פנייה בת 9 ימים מוסלמת, עוברת ל'דורש ממך' ומציגה את מספר הימים", async ({
    page,
  }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const { path, description } = await ticketWithContractor(page, "הסלמה", { apartment: "2" });
    const id = ticketIdFromPath(path);

    await ageTicket(id, 9);
    const output = runJob("escalate");
    expect(output).toContain("escalated=");

    await page.goto("/board");
    await expect(boardCard(page, description)).toContainText(REASON_EXAMPLES.stale(9));
    await expect(boardSection(page, BOARD.actionRequired)).toContainText(description);
  });

  test("BR-14 — פנייה סגורה אינה מוסלמת", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const { path } = await ticketWithContractor(page, "סגורה-ישנה", { apartment: "3" });
    const id = ticketIdFromPath(path);

    await page.getByRole("button", { name: TICKET_SCREEN.close }).click();
    await expect(page.getByRole("status")).toContainText(TICKET_SCREEN.closedNotice);

    await ageTicket(id, 30);
    runJob("escalate");

    const rows = await query<{ escalated: boolean }>(
      `select escalated from "Ticket" where id = $1`,
      [id],
    );
    expect(rows[0]?.escalated).toBe(false);
  });
});
