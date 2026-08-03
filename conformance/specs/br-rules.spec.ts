import { expect, test } from "@playwright/test";
import { CAST, PROS } from "../fixtures/cast";
import { loginAs } from "../fixtures/roles";
import { BOARD, REASON_EXAMPLES, TICKET_SCREEN, TICKET_STATUS } from "../fixtures/spec-text";
import { acceptDialogs, boardArchive, boardCard, createTicket, expandArchive, uniq } from "../fixtures/world";

/**
 * §5.א–ד — החוקים העסקיים שאינם הרשאה ואינם מקרה קצה.
 *
 * §5.ד עודכן בגרסה 0.2 בסייג אחד ("רק אם עדיין אין מטפל"), והוא הדלתא
 * הקשה ביותר לראות בעין: שתי המערכות — הישנה והחדשה — נראות זהות עד
 * שמנהל שני מגיב.
 */

test.describe("§5.ד — מי מטפל", () => {
  test("BR-20/BR-21/V02-05 — מנהל שני שמגיב אינו גונב את הסימון", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const description = uniq("מי-מטפל");
    const path = await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain: "חשמל",
      description,
      recipients: [PROS.full.name],
    });

    // מנהל א׳ מגיב ראשון — ואין עדיין מטפל, ולכן הוא נקבע.
    await page.getByLabel("תגובה").fill("בדקתי בשטח");
    await page.getByRole("button", { name: TICKET_SCREEN.send, exact: true }).click();
    // תיבת הכתיבה מתרוקנת רק אחרי שההודעה נשמרה — זו ההמתנה האמיתית.
    // ‏`getByText` לבדו היה נתפס גם על הטקסט שבתוך ה-textarea.
    await expect(page.getByLabel("תגובה")).toHaveValue("");
    await expect(page.getByText(/מטפל בפנייה/)).toBeVisible();

    await page.goto("/board");
    await expect(boardCard(page, description)).toContainText(
      REASON_EXAMPLES.handler(CAST.managerA.name),
    );

    // מנהל ב׳ מגיב — ולפי הכרעת 0.2 הסימון **אינו** עובר אליו.
    await loginAs(page, "managerA2");
    await page.goto(path);
    await page.getByLabel("תגובה").fill("גם אני הסתכלתי");
    await page.getByRole("button", { name: TICKET_SCREEN.send, exact: true }).click();
    await expect(page.getByLabel("תגובה")).toHaveValue("");

    await page.goto("/board");
    await expect(boardCard(page, description)).toContainText(
      REASON_EXAMPLES.handler(CAST.managerA.name),
    );
  });

  test("BR-22/BR-23 — החלפת מטפל נעשית מפורשות דרך הכפתור", async ({ page }) => {
    acceptDialogs(page);
    /**
     * ‏§5.ד (הכרעת 0.2): "החלפת מטפל נעשית **מפורשות דרך הכפתור**".
     *
     * במימוש הכפתור "סמן: אני מטפל" מוצג רק כש**אין** מטפל
     * (`ticket-actions.tsx:101` — `canSetHandler && !hasHandler`), ולכן ברגע
     * שנקבע מטפל ראשון אין שום דרך להחליף אותו — לא בכפתור ולא בכלל.
     * זהו הפער שהסייג של 0.2 נכתב בדיוק כדי למנוע. מדווח ב-conformance-report.
     */
    test.fail();
    await loginAs(page, "managerA");
    const description = uniq("החלפת-מטפל");
    const path = await createTicket(page, {
      building: "בניין א",
      apartment: "2",
      domain: "חשמל",
      description,
      recipients: [PROS.full.name],
    });
    await page.getByRole("button", { name: TICKET_SCREEN.markHandler }).click();
    // הכפתור נעלם ברגע שנקבע מטפל — זו ההמתנה לסיום ה-Server Action, וגם
    // ההוכחה להיעדר מנגנון ההחלפה.
    await expect(page.getByRole("button", { name: TICKET_SCREEN.markHandler })).toHaveCount(0);

    await page.goto("/board");
    await expect(boardCard(page, description)).toContainText(
      REASON_EXAMPLES.handler(CAST.managerA.name),
    );

    await loginAs(page, "managerA2");
    await page.goto(path);
    // כאן אמור להיות הכפתור שהאפיון מחייב. הוא אינו קיים.
    await expect(page.getByRole("button", { name: TICKET_SCREEN.markHandler })).toBeVisible();
  });
});

test.describe("§5.א–ב — הסגירה היא שיקול דעת אנושי", () => {
  test("PROH-04 — סגירה אינה מותנית בצירוף תיעוד", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const description = uniq("סגירה-בלי-תיעוד");
    await createTicket(page, {
      building: "בניין ב",
      apartment: "1",
      domain: "חשמל",
      description,
      recipients: [PROS.full.name],
    });

    // אין מדיה, אין תגובה, אין "טופל" — ובכל זאת אפשר לסגור.
    await page.getByRole("button", { name: TICKET_SCREEN.close }).click();
    await expect(page.getByRole("status")).toContainText(TICKET_SCREEN.closedNotice);
    await expect(page.getByText(TICKET_STATUS.closed, { exact: true })).toBeVisible();
  });

  test("BR-08/PROH-06 — פנייה סגורה יורדת לארכיון ואינה נעלמת", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const description = uniq("לארכיון");
    await createTicket(page, {
      building: "בניין ב",
      apartment: "2",
      domain: "חשמל",
      description,
      recipients: [PROS.full.name],
    });
    await page.getByRole("button", { name: TICKET_SCREEN.close }).click();
    await expect(page.getByRole("status")).toContainText(TICKET_SCREEN.closedNotice);

    await page.goto("/board");
    await expandArchive(page);
    await expect(boardArchive(page)).toContainText(description);
  });
});

test.describe("§4 מסך 1 — הלוח מסביר את עצמו", () => {
  test("S1-01/S1-02 — רשימה אחת עם כותרות קיבוץ, לא טאבים", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    await page.goto("/board");

    await expect(
      page.getByRole("heading", { name: new RegExp(`^${BOARD.actionRequired}`) }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: new RegExp(`^${BOARD.withRecipients}`) }),
    ).toBeVisible();
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(0);
  });

  test("S1-03/S1-05 — לכל קבוצה מונה", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    await page.goto("/board");
    await expect(
      page.getByRole("heading", { name: new RegExp(`^${BOARD.actionRequired} · \\d+`) }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: new RegExp(`^${BOARD.withRecipients} · \\d+`) }),
    ).toBeVisible();
  });

  test("S1-13/S1-14 — הכרטיס מציג מיקום, תחום, תיאור, נמען, גיל וסיבה", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const description = uniq("כרטיס-מלא");
    await createTicket(page, {
      building: "בניין א",
      apartment: "3",
      domain: "אינסטלציה",
      description,
      recipients: [PROS.full.name],
    });

    await page.goto("/board");
    const card = boardCard(page, description);
    await expect(card).toContainText("בניין א");
    await expect(card).toContainText("3");
    await expect(card).toContainText("אינסטלציה");
    await expect(card).toContainText(description);
    await expect(card).toContainText(PROS.full.name);
    // גיל הפנייה — "היום" לפנייה שנוצרה עכשיו.
    await expect(card).toContainText("היום");
    // טקסט הסיבה — הפנייה נשלחה ואיש לא צפה.
    await expect(card).toContainText("נשלח, טרם נצפה");
  });

  test("S1-18/S1-19 — כפתור פנייה חדשה וחיפוש זמינים מהלוח", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    await page.goto("/board");
    await expect(page.getByRole("link", { name: BOARD.newTicket })).toBeVisible();
    await expect(page.getByRole("navigation").getByRole("link", { name: "חיפוש" })).toBeVisible();
  });

  test("S1-10/S1-12 — מצב סיור מקבץ לפי בניין ודירה, והטיוטות נשארות בראש", async ({
    page,
  }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const draftText = uniq("טיוטה-בסיור");
    await createTicket(page, { description: draftText, saveAsDraft: true });

    const ticketText = uniq("פנייה-בסיור");
    await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain: "חשמל",
      description: ticketText,
      recipients: [PROS.full.name],
    });

    await page.goto("/board?tour=1");
    await expect(page.getByRole("heading", { name: /^בניין א · דירה 1/ })).toBeVisible();
    // הטיוטה אינה נכנסת לקיבוץ — אין לה בניין ודירה.
    await expect(page.getByRole("heading", { name: /^טיוטות להשלמה/ })).toBeVisible();
    await expect(boardCard(page, draftText)).toBeVisible();
    await expect(boardCard(page, ticketText)).toBeVisible();
  });
});
