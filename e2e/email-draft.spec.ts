import { type Page, expect, test } from "@playwright/test";
import {
  DISPATCHED_BODY,
  DISPATCHED_REPLY,
  type EmailSeed,
  FIRST_BODY,
  LATE_REPLY,
  MEDIA_NAME,
  NON_MEDIA_NAME,
  REPLY_ACK_BODY,
  REPLY_BODY,
  THREAD_FILE_NAME,
  seedEmail,
} from "./email-fixtures";
import { loginAsManager } from "./helpers";
import { openDetails } from "./ticket-screen";

/**
 * מסך 7 של טיוטה ממייל, מקצה לקצה (אפיון 1.3: EM-S7-02…06, EM-M03, EM-S2-01,
 * EM-S1-01).
 *
 * הטיוטה נזרעת ישירות בבסיס — לא דרך התיבה: הצינור עצמו (S6–S7) נבדק
 * במקומו, וכאן נבדק מה שהמסך עושה עם מה שהצינור השאיר. ההתחברות היא
 * כמנהל המערכת של ה-seed, שרשאי לערוך כל טיוטה ולבחור לה אתר.
 */

let seed: EmailSeed;

test.beforeAll(() => {
  seed = seedEmail();
});

test.beforeEach(async ({ page }) => {
  await loginAsManager(page);
  await page.goto(`/tickets/${seed.draftId}`);
  await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible();
});

/** עוטף השדה בטופס — כדי שבדיקת תג תדע ליד איזה שדה הוא יושב */
function field(page: Page, name: string) {
  return page.locator(`[data-field="${name}"]`);
}

/**
 * הטופס עבר hydration. "מחק טיוטה" מושבת עד אז בלבד (ולא בגלל סתירה), ולכן
 * הוא האות — בלעדיו "שגר מושבת" היה עובר גם על ה-HTML שהשרת מרנדר.
 */
async function hydrated(page: Page) {
  await expect(page.getByRole("button", { name: "מחק טיוטה" })).toBeEnabled();
}

test("EM-S7-02 — ההתכתבות בראש המסך: האחרון פתוח, הקודמים מקופלים, קובץ בלי בתים אינו קישור", async ({
  page,
}) => {
  const correspondence = page.getByRole("region", { name: "התכתבות המייל" });
  await expect(correspondence).toBeVisible();
  await expect(correspondence.locator("details")).toHaveCount(4);
  await expect(correspondence.locator("details[open]")).toHaveCount(1);

  // האחרון — המייל החוזר על התשובה — פתוח; השאר מקופלים
  await expect(correspondence.getByText(REPLY_ACK_BODY)).toBeVisible();
  await expect(correspondence.getByText(REPLY_BODY)).toBeHidden();
  await expect(correspondence.getByText(FIRST_BODY)).toBeHidden();

  // המייל היוצא מזוהה במילים
  await expect(correspondence.getByText("המערכת", { exact: true }).first()).toBeVisible();

  // פתיחת הראשון: קובץ המדיה הוא קישור בתוך המערכת; קובץ שאינו מדיה, בלי
  // בתים שמורים, מוצג בשמו ועם הסיבה — לא כקישור מת
  await correspondence.locator("details").first().locator("summary").click();
  await expect(correspondence.getByText(FIRST_BODY)).toBeVisible();
  await expect(correspondence.getByRole("link", { name: MEDIA_NAME })).toHaveAttribute(
    "href",
    /\/api\/email-attachments\/[a-z0-9]+$/,
  );
  await expect(correspondence.getByRole("link", { name: NON_MEDIA_NAME })).toHaveCount(0);
  await expect(correspondence.getByText(NON_MEDIA_NAME)).toBeVisible();
  await expect(correspondence.getByText("לא נכנס לטיוטה: אינו תמונה, וידאו, אודיו או PDF")).toBeVisible();
});

test("EM-S7-03 / EM-M03 — כל השדות מוצגים, והתגים יושבים ליד השדה שהם מתארים", async ({ page }) => {
  for (const name of ["SITE", "BUILDING", "APARTMENT", "ROOM", "DOMAIN", "DESCRIPTION", "RECIPIENTS"]) {
    await expect(field(page, name)).toBeVisible();
  }
  await expect(page.getByLabel("תיאור")).toHaveValue(FIRST_BODY);
  // תיאור ותחום הגיעו מהמייל; הבניין נערך במערכת ולכן אינו נושא תג
  await expect(field(page, "DESCRIPTION").getByText("מהמייל", { exact: true })).toBeVisible();
  await expect(field(page, "DOMAIN").getByText("מהמייל", { exact: true })).toBeVisible();
  await expect(field(page, "BUILDING").getByText("מהמייל", { exact: true })).toHaveCount(0);
  // שדות חובה ריקים מסומנים "חסר"; חדר אינו חובה
  await expect(field(page, "APARTMENT").getByText("חסר", { exact: true })).toBeVisible();
  await expect(field(page, "RECIPIENTS").getByText("חסר", { exact: true })).toBeVisible();
  await expect(field(page, "ROOM").getByText("חסר", { exact: true })).toHaveCount(0);
});

test("EM-S7-04 — סתירה: הודעה עם 'השווה ובחר', השדה מסומן בטופס, ו'שגר' חסום", async ({ page }) => {
  await hydrated(page);
  await expect(
    page.getByText("יש סתירה בין המייל למערכת ב-1 שדה. לא ניתן לשגר עד שתוכרע."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "השווה ובחר" })).toBeEnabled();
  await expect(field(page, "BUILDING").getByText("בסתירה", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "שגר", exact: true })).toBeDisabled();
});

test("EM-S7-06 — טיוטה שחסרים בה פרטים: 'טיוטה — חסרים פרטים. לא נשלחה לאיש.'", async ({ page }) => {
  await expect(page.getByText("טיוטה — חסרים פרטים. לא נשלחה לאיש.")).toBeVisible();
  await expect(page.getByRole("button", { name: "מחק טיוטה" })).toBeVisible();
});

test("שמירה מיידית — חדר נשמר ביציאה מהפקד, בלי 'שמור', ושורד רענון", async ({ page }) => {
  await hydrated(page);
  const room = page.getByLabel("חדר (לא חובה)");
  // משתמש מגיע לבורר לפני שהוא בוחר, ו-`selectOption` לבדו אינו ממקד: בלי
  // המיקוד `blur()` אינו מפעיל דבר, והשמירה לא הייתה יוצאת כלל
  await room.focus();
  await room.selectOption("KITCHEN");
  // ממתינים לתשובת ה-Server Action עצמה. "הפקד מושבת ואז פעיל" היה מפספס
  // שמירה מהירה מהבדיקה הראשונה של Playwright, ורענון לפני שהשמירה חזרה
  // היה קוטע אותה
  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.request().headers()["next-action"] !== undefined,
  );
  await room.blur();
  await saved;
  await page.reload();
  await expect(page.getByLabel("חדר (לא חובה)")).toHaveValue("KITCHEN");
});

test("בטיוטה ממייל התיאור אינו מופיע פעמיים — אין בועת פתיחה בשרשור", async ({ page }) => {
  await expect(page.getByLabel("תיאור")).toHaveValue(FIRST_BODY);
  await expect(page.getByRole("region", { name: "שרשור" }).getByText(FIRST_BODY)).toHaveCount(0);
});

test("EM-S7-05 — 'הסר קובץ' מוריד את הקובץ מהטיוטה ומשאיר אותו בהתכתבות", async ({ page }) => {
  await hydrated(page);
  const files = page.getByRole("region", { name: "קבצים בטיוטה" });
  await expect(files).toBeVisible();
  // קובץ שצורף בשרשור אינו מהמייל: אינו ברשימה ואין לו "הסר קובץ" (§7 שורה 87)
  await expect(files.getByText(THREAD_FILE_NAME)).toHaveCount(0);
  await files.getByRole("button", { name: `הסר קובץ: ${MEDIA_NAME}` }).click();
  // הקובץ היחיד מהמייל הוסר — הרשימה כולה נעלמת, והקובץ מהשרשור נשאר בשרשור
  await expect(files).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "שרשור" }).getByRole("link", { name: `קובץ מצורף: ${THREAD_FILE_NAME}` }),
  ).toBeVisible();

  // ונשאר בהתכתבות: הקישור עדיין שם (המייל הראשון מקופל — פותחים אותו)
  const correspondence = page.getByRole("region", { name: "התכתבות המייל" });
  await correspondence.locator("details").first().locator("summary").click();
  await expect(correspondence.getByRole("link", { name: MEDIA_NAME })).toBeVisible();
});

test("טיוטה בלי אתר — בוחרים אתר, ואז רשימת הבניינים של האתר זמינה", async ({ page }) => {
  await page.goto(`/tickets/${seed.noSiteId}`);
  await hydrated(page);
  const building = field(page, "BUILDING").getByRole("button", { name: /^בניין/ });
  await expect(building).toBeDisabled();

  await field(page, "SITE").getByRole("button", { name: /^אתר/ }).click();
  await page.getByRole("option").first().click();

  // אחרי שהאתר נשמר, הרשימה שייכת לאתר החדש ולא לרשימה הריקה שהייתה
  await expect(building).toBeEnabled();
  await building.click();
  await expect(page.getByRole("option", { name: "בניין א" })).toBeVisible();
});

test("EM-S2-01 — אחרי השיגור ההתכתבות בחלון 'פרטים', ולא בשרשור — ורק מה שקדם לשיגור", async ({
  page,
}) => {
  await page.goto(`/tickets/${seed.dispatchedId}`);
  // ההתכתבות אינה בשרשור: השרשור הוא השיחה עם הנמענים, וההתכתבות הייתה עם
  // השולח. התיאור (ההודעה הפותחת) כן שם; המיילים עצמם — לא.
  const thread = page.getByRole("region", { name: "שרשור" });
  await expect(thread).toBeVisible();
  await expect(thread.getByText(DISPATCHED_BODY)).toHaveCount(0);
  await expect(thread.getByText(DISPATCHED_REPLY)).toHaveCount(0);

  await openDetails(page);
  const dialog = page.getByRole("dialog", { name: "פרטים" });
  const correspondence = dialog.getByRole("region", { name: "התכתבות המייל" });
  await expect(correspondence).toBeVisible();
  await expect(correspondence.locator("details")).toHaveCount(2);
  // האחרון — המייל החוזר — פתוח
  await expect(correspondence.getByText(DISPATCHED_REPLY)).toBeVisible();
  // המייל החוזר על תשובה שהגיעה אחרי השיגור אינו חלק ממה שקדם לו
  await expect(correspondence.getByText(LATE_REPLY)).toHaveCount(0);
});

test("EM-S1-01 — בלוח, כרטיס הטיוטה נושא את תג הערוץ 'ממייל'", async ({ page }) => {
  await page.goto("/board");
  // הכרטיס מאותר לפי התיאור הייחודי של הזריעה: הבסיס משותף לכל הבדיקות
  const card = page.getByRole("link").filter({ hasText: FIRST_BODY.slice(0, 20) }).first();
  await expect(card).toBeVisible();
  // התג עצמו, בהתאמה מדויקת: שורת הסיבה ("טיוטה ממייל · …") מכילה גם היא
  // את המילה, ולכן בדיקת "מכיל" הייתה עוברת גם בלי התג
  await expect(card.getByText("· ממייל", { exact: true })).toBeVisible();
  await expect(card).toContainText("טיוטה ממייל · סתירה ב-1 שדה");
});
