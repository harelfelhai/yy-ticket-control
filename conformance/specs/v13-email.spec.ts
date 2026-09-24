import { type Page, expect, test } from "@playwright/test";
import {
  DISPATCHED_REPLY,
  type EmailSeed,
  LATE_REPLY,
  MEDIA_NAME,
  REPLY_ACK_BODY,
  seedEmail,
} from "../../e2e/email-fixtures";
import { SITE_A } from "../fixtures/cast";
import { loginAs } from "../fixtures/roles";
import { CONFLICT_DIALOG, DRAFT_SCREEN, EMAIL_DRAFT_SCREEN } from "../fixtures/spec-text";
import { acceptDialogs, openDetails } from "../fixtures/world";

/**
 * עדכון 1.3 — פתיחת פנייה במייל: מסך 7 במצב מייל, מסך 7א, ההתכתבות בחלון
 * "פרטים" (EM-S7-*, EM-S7A-*, EM-S2-01, EM-M03).
 *
 * הנוסחים מגיעים מ-`spec-text.ts` — מה שהאפיון כותב, לא מה ש-`he.ts` מגדיר.
 * הטיוטה נזרעת ישירות בבסיס (אותו סקריפט של ה-E2E): מה שנבדק כאן הוא
 * המסך, לא הצינור.
 *
 * **כל `describe` זורע לעצמו.** הבדיקות רצות לפי הסדר ב-worker אחד, ובלי
 * ניסיונות חוזרים (`retries: 0`): בדיקה שמכריעה את הסתירה או מסירה קובץ
 * הייתה משנה את המצב לבדיקה שאחריה, והזריעה מאפסת אותו.
 */

let seed: EmailSeed;

function reseed() {
  test.beforeAll(() => {
    seed = seedEmail();
  });
}

/** הטופס עבר hydration — "מחק טיוטה" מושבת עד אז בלבד, ולא בגלל סתירה */
async function hydrated(page: Page) {
  await expect(page.getByRole("button", { name: DRAFT_SCREEN.delete })).toBeEnabled();
}

test.describe("מסך 7 — טיוטה ממייל", () => {
  reseed();

  test.beforeEach(async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    await page.goto(`/tickets/${seed.draftId}`);
    await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible();
  });

  test("EM-S7-02 — ההתכתבות בראש המסך, האחרון פתוח והקודמים מקופלים", async ({ page }) => {
    const correspondence = page.getByRole("region", { name: EMAIL_DRAFT_SCREEN.correspondence });
    await expect(correspondence).toBeVisible();
    await expect(correspondence.locator("details")).toHaveCount(4);
    await expect(correspondence.locator("details[open]")).toHaveCount(1);
    await expect(correspondence.getByText(REPLY_ACK_BODY)).toBeVisible();
  });

  test("EM-S7-03 / EM-M03 — כל השדות מוצגים, ותג 'מהמייל' ליד מה שמולא מהמייל", async ({ page }) => {
    await expect(page.getByLabel("תיאור")).toBeVisible();
    await expect(page.locator('[data-field="ROOM"]')).toBeVisible();
    await expect(
      page.locator('[data-field="DESCRIPTION"]').getByText(EMAIL_DRAFT_SCREEN.fromEmailTag, { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('[data-field="BUILDING"]').getByText(EMAIL_DRAFT_SCREEN.fromEmailTag, { exact: true }),
    ).toHaveCount(0);
  });

  test("EM-S7-04 — נוסח הסתירה, 'השווה ובחר', ו'שגר' חסום", async ({ page }) => {
    await hydrated(page);
    await expect(page.getByText(DRAFT_SCREEN.conflictBanner(1))).toBeVisible();
    await expect(page.getByRole("button", { name: EMAIL_DRAFT_SCREEN.compare })).toBeEnabled();
    await expect(page.getByRole("button", { name: DRAFT_SCREEN.submit, exact: true })).toBeDisabled();
  });

  test("EM-S7-06 — טיוטה חסרה: הנוסח המלא מהאפיון", async ({ page }) => {
    await expect(page.getByText(DRAFT_SCREEN.banner)).toBeVisible();
  });

  test("EM-S7-05 — 'הסר קובץ' בנוסח הקיים, והקובץ נשאר בהתכתבות", async ({ page }) => {
    await hydrated(page);
    await page
      .getByRole("button", { name: `${EMAIL_DRAFT_SCREEN.removeFile}: ${MEDIA_NAME}` })
      .click();
    await expect(page.getByRole("region", { name: "קבצים בטיוטה" })).toHaveCount(0);
    const correspondence = page.getByRole("region", { name: EMAIL_DRAFT_SCREEN.correspondence });
    await correspondence.locator("details").first().locator("summary").click();
    await expect(correspondence.getByRole("link", { name: MEDIA_NAME })).toBeVisible();
  });
});

test.describe("קהל היעד — EM-S7-01, EM-S7A-01", () => {
  reseed();

  test("בעלים שאינו השולח רואה את הטיוטה אך אינו משלים אותה", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "owner");
    await page.goto(`/tickets/${seed.draftId}`);
    await expect(page.getByText(DRAFT_SCREEN.banner)).toBeVisible();
    await expect(page.getByRole("button", { name: DRAFT_SCREEN.submit, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: EMAIL_DRAFT_SCREEN.compare })).toHaveCount(0);
  });

  test("מנהל העבודה של האתר משלים את הטיוטה, והאתר מוצג לו כטקסט ולא כבורר", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    await page.goto(`/tickets/${seed.draftId}`);
    await expect(page.getByRole("button", { name: DRAFT_SCREEN.submit, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: EMAIL_DRAFT_SCREEN.compare })).toBeVisible();
    const site = page.locator('[data-field="SITE"]');
    await expect(site.getByRole("button")).toHaveCount(0);
    await expect(site).toContainText(SITE_A);
  });
});

test.describe("מסך 7א — סתירות בין המייל למערכת", () => {
  reseed();

  test.beforeEach(async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    await page.goto(`/tickets/${seed.draftId}`);
    await page.getByRole("button", { name: EMAIL_DRAFT_SCREEN.compare }).click();
    await expect(page.getByRole("dialog", { name: CONFLICT_DIALOG.title })).toBeVisible();
  });

  test("EM-S7A-02/03/04 — כותרת, עמודות, בלי בחירה מראש, אישור חסום", async ({ page }, testInfo) => {
    const dialog = page.getByRole("dialog", { name: CONFLICT_DIALOG.title });
    const radios = dialog.getByRole("radio");
    await expect(radios).toHaveCount(2);
    for (const radio of await radios.all()) await expect(radio).not.toBeChecked();
    await expect(dialog.getByRole("button", { name: CONFLICT_DIALOG.apply })).toBeDisabled();
    if (testInfo.project.name === "desktop") {
      await expect(dialog.getByText(CONFLICT_DIALOG.columnSystem, { exact: true })).toBeVisible();
      await expect(dialog.getByText(CONFLICT_DIALOG.columnEmail, { exact: true })).toBeVisible();
      // כל השדות — גם שאינם בסתירה — מוצגים לקריאה
      await expect(dialog.getByText("תיאור", { exact: true })).toBeVisible();
    } else {
      // בטלפון רק השדות שבסתירה
      await expect(dialog.getByText("תיאור", { exact: true })).toBeHidden();
    }
  });

  test("EM-S7A-05 — 'סגור' סוגר בלי שינוי", async ({ page }) => {
    const dialog = page.getByRole("dialog", { name: CONFLICT_DIALOG.title });
    await dialog.getByRole("radio", { name: /בניין ב/ }).check();
    await dialog.getByRole("button", { name: CONFLICT_DIALOG.close, exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(DRAFT_SCREEN.conflictBanner(1))).toBeVisible();
  });

  test("EM-S7A-04/05 — 'החל את הבחירה' בשלב אחד; הסתירה נסגרת ו'שגר' משתחרר", async ({ page }) => {
    const dialog = page.getByRole("dialog", { name: CONFLICT_DIALOG.title });
    await dialog.getByRole("radio", { name: /בניין ב/ }).check();
    await dialog.getByRole("button", { name: CONFLICT_DIALOG.apply }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(DRAFT_SCREEN.conflictBanner(1))).toHaveCount(0);
    await expect(page.getByRole("button", { name: DRAFT_SCREEN.submit, exact: true })).toBeEnabled();
  });
});

test.describe("מסך 2 — אחרי השיגור", () => {
  reseed();

  test("EM-S2-01 — 'התכתבות המייל' בחלון 'פרטים', ולא בשרשור — רק מה שקדם לשיגור", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    await page.goto(`/tickets/${seed.dispatchedId}`);
    const thread = page.getByRole("region", { name: "שרשור" });
    await expect(thread).toBeVisible();
    await expect(thread.getByText(DISPATCHED_REPLY)).toHaveCount(0);

    await openDetails(page);
    const dialog = page.getByRole("dialog", { name: "פרטים" });
    const correspondence = dialog.getByRole("region", { name: EMAIL_DRAFT_SCREEN.correspondence });
    await expect(correspondence).toBeVisible();
    await expect(correspondence.getByText(DISPATCHED_REPLY)).toBeVisible();
    await expect(correspondence.getByText(LATE_REPLY)).toHaveCount(0);
  });
});
