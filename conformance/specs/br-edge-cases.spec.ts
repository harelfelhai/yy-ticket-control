import { type Page, expect, test } from "@playwright/test";
import { query } from "../fixtures/db";
import { loginAs } from "../fixtures/roles";
import { EDGE_CASES, PORTAL, TICKET_SCREEN } from "../fixtures/spec-text";
import {
  acceptDialogs,
  TICKET_URL,
  createTicket,
  openPortalTicket,
  openDetails,
  recipientRow,
  showLink,
  shownText,
  ticketIdFromPath,
  uniq,
  uniqPhone,
} from "../fixtures/world";

/**
 * §5.ו — שמונת מקרי הקצה, כלשונם.
 *
 * זהו הסעיף שנוטים לדלג עליו: כל שורה בו מתארת מצב שמתרחש רק כשמשהו אחר
 * השתבש, ולכן אף אחד לא נתקל בו בשימוש רגיל — ואיש לא יגלה שהוא שבור.
 */

/** ‏WebM אודיו מינימלי — מספיק כדי שהשרת יסווג את הקובץ כאודיו */
const WEBM_BASE64 =
  "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAAHTEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHGTbuMU6uEElTDZ1OsggEXTbuMU6uEHFO7a1OsggG97AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function fileInput(page: Page) {
  return page.locator('input[type="file"][accept="image/*,application/pdf,video/*"]');
}

test.describe("§5.ו — מקרי הקצה", () => {
  test("BR-32 — נמען מגיב על פנייה שנסגרה: התגובה נחסמת עם הנוסח מהאפיון", async ({
    page,
  }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const contractor = uniq("קבלן-נסגרה");
    const description = uniq("תקלה-נסגרה");
    const path = await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain: "חשמל",
      description,
      newProfessional: { name: contractor, phone: uniqPhone() },
    });
    const link = await showLink(page, contractor);

    await page.getByRole("button", { name: TICKET_SCREEN.close }).click();
    await expect(page.getByRole("status")).toContainText(TICKET_SCREEN.closedNotice);

    await openPortalTicket(page, link, description, ticketIdFromPath(path));
    await expect(page.getByText(EDGE_CASES.closedTicketBlocked)).toBeVisible();
    await expect(page.getByRole("button", { name: PORTAL.markDone })).toHaveCount(0);
  });

  test("BR-33 — נמען שהוסר: הפנייה אינה ברשימתו ואין לו הרשאת כתיבה", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const stay = uniq("קבלן-נשאר");
    const removed = uniq("קבלן-מוסר");
    const description = uniq("תקלה-הסרה");
    await createTicket(page, {
      building: "בניין א",
      apartment: "2",
      domain: "חשמל",
      description,
      newProfessional: { name: removed, phone: uniqPhone() },
    });

    // נמען שני, כדי שהטוקן של הראשון לא יבוטל בהסרה האחרונה — כך נבדק
    // המצב שהאפיון מתאר: קישור **תקף** שהפנייה נעלמה ממנו.
    // בורר הנמענים יושב בדיאלוג "פרטים" מ-0.4, ולכן פותחים לפני ההוספה.
    await openDetails(page);
    await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
    await page.getByLabel("שם").fill(stay);
    await page.getByLabel("טלפון").fill(uniqPhone());
    await page.getByRole("button", { name: "שמור איש מקצוע" }).click();
    await expect(recipientRow(page, stay)).toBeVisible();

    const link = await showLink(page, removed);
    await openPortalTicket(page, link, description);

    await loginAs(page, "managerA");
    await page.goto("/board");
    await page.getByRole("link").filter({ hasText: description }).first().click();
    // הנמענים ירדו לפאנל "פרטים" ב-0.3 (אפיון מסך 2 אזור ב׳).
    await openDetails(page);
    await recipientRow(page, removed)
      .getByRole("button", { name: /^הסר/ })
      .click();
    await expect(page.getByRole("list", { name: "נמענים שהוסרו" })).toBeVisible();

    // אותו קישור — הפנייה כבר אינה ברשימה.
    await page.goto(link);
    await expect(page.getByText(description)).toHaveCount(0);
  });

  test("BR-34 — שני מנהלים במקביל: שניהם רשאים, והשרשור מציג את שתי הפעולות לפי סדר", async ({
    page,
    browser,
  }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const description = uniq("תקלה-מקבילה");
    const path = await createTicket(page, {
      building: "בניין ב",
      apartment: "1",
      domain: "חשמל",
      description,
      newProfessional: { name: uniq("קבלן-מקביל"), phone: uniqPhone() },
    });

    // הקשר דפדפן שני = מנהל שני שיושב במקביל. `baseURL` נלקח מהקונפיג דרך
    // `test.info()`, כי הקשר חדש אינו יורש אותו מהפיקסטורה.
    const second = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const secondPage = await second.newPage();
    await loginAs(secondPage, "managerA2");

    await page.goto(path);
    await secondPage.goto(path);

    const firstText = uniq("הערה-ראשונה");
    const secondText = uniq("הערה-שנייה");

    await page.getByLabel("תגובה").fill(firstText);
    await secondPage.getByLabel("תגובה").fill(secondText);

    /*
     * ‏`shownText` ולא `getByText`, וזו אינה החמרה סגנונית: הטענה
     * הקודמת נפתרה על תיבת הכתיבה שזה עתה מולאה, כלומר עברה מיד ולא
     * המתינה לשרת. הרעננון שאחריה יצא לדרך לפני שההודעה השנייה נכתבה —
     * ‏47ms הפרש שנמדדו — והשרשור שהתקבל היה נכון לזמנו. ראה `world.ts`.
     */
    await page.getByRole("button", { name: TICKET_SCREEN.send, exact: true }).click();
    await expect(shownText(page, firstText)).toBeVisible();
    await secondPage.getByRole("button", { name: TICKET_SCREEN.send, exact: true }).click();
    await expect(shownText(secondPage, secondText)).toBeVisible();

    // "שניהם רשאים. השרשור מציג את שתי הפעולות לפי סדר."
    await page.reload();
    await expect(shownText(page, firstText)).toBeVisible();
    await expect(shownText(page, secondText)).toBeVisible();

    const order = await query<{ text: string }>(
      `select text from "Message" where "ticketId" = $1 and text is not null order by "createdAt" asc`,
      [ticketIdFromPath(path)],
    );
    const texts = order.map((r) => r.text);
    expect(texts.indexOf(firstText)).toBeLessThan(texts.indexOf(secondText));

    await second.close();
  });

  test("BR-35 — התמלול נכשל: המדיה נשמרת ומוצגת, והשדה מסומן 'התמלול נכשל'", async ({
    page,
  }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const description = uniq("תקלה-תמלול");
    const path = await createTicket(page, {
      building: "בניין ב",
      apartment: "2",
      domain: "חשמל",
      description,
      newProfessional: { name: uniq("קבלן-תמלול"), phone: uniqPhone() },
    });

    await fileInput(page).setInputFiles({
      name: "recording.webm",
      mimeType: "audio/webm",
      buffer: Buffer.from(WEBM_BASE64, "base64"),
    });
    await expect(page.getByText("מעלה…")).toHaveCount(0);
    await page.getByLabel("תגובה").fill("הקלטה מהשטח");
    await page.getByRole("button", { name: TICKET_SCREEN.send, exact: true }).click();
    await expect(page.getByText("הקלטה מהשטח")).toBeVisible();

    /*
     * **קודם ממתינים שעיבוד ה-AI יסתיים, ורק אז כופים כשל.**
     *
     * בלי מפתח OpenAI הג׳וב מסמן `SKIPPED` ולא `FAILED`, ולכן המצב נקבע
     * ישירות — זו הבאת מצב, לא עקיפה של פעולה נבדקת. אבל העובד רץ ברקע:
     * במכונה עמוסה ה-tick שלו מתאחר, הג׳וב נוחת **אחרי** ה-UPDATE וכותב
     * ‏`SKIPPED` מעליו (`jobs/handlers/ai.ts` — `markSkipped`). אז התצוגה
     * צודקת כשאינה אומרת דבר, והבדיקה נכשלת על המוצר הנכון.
     *
     * ההמתנה היא על **מצב סופי של השורה** ולא על הג׳וב: יש שני מנועים
     * שעשויים לעבד אותה — העובד שבתוך השרת ו-`runJob("drain")` — והמתנה
     * לאחד מהם בלבד הייתה משאירה את המרוץ עם השני.
     */
    const mediaSettled = async () => {
      const rows = await query<{ aiStatus: string }>(
        `select m."aiStatus" from "MediaFile" m
           join "Message" msg on msg.id = m."messageId"
          where msg."ticketId" = $1`,
        [ticketIdFromPath(path)],
      );
      return rows.length > 0 && rows.every((r) => r.aiStatus !== "PENDING" && r.aiStatus !== "PROCESSING");
    };
    await expect.poll(mediaSettled, { timeout: 30_000 }).toBe(true);

    await query(
      `update "MediaFile" set "aiStatus" = 'FAILED', transcription = null
        where id in (
          select m.id from "MediaFile" m
          join "Message" msg on msg.id = m."messageId"
          where msg."ticketId" = $1
        )`,
      [ticketIdFromPath(path)],
    );

    await page.reload();
    await expect(page.locator("audio")).toBeVisible();
    await expect(page.getByText(EDGE_CASES.transcriptionFailed)).toBeVisible();
  });

  test("BR-36 — שיגור בלי קליטה נשמר מקומית ואינו הולך לאיבוד", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    await page.goto("/tickets/new");
    const description = uniq("תקלה-בלי-קליטה");
    await page.getByLabel("תיאור").fill(description);

    await page.context().setOffline(true);
    await page.getByRole("button", { name: "שמור כטיוטה" }).click();
    await expect(page.getByText(/נשמר מקומית/)).toBeVisible();
    await expect(page).toHaveURL(/\/tickets\/new/);

    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page).toHaveURL(TICKET_URL, { timeout: 30_000 });
    await expect(shownText(page, description)).toBeVisible();
  });
});
