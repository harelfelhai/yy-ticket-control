import { type Page, expect, test } from "@playwright/test";
import {
  WA_DISPATCHED_ACK,
  WA_DISPATCHED_REPORT,
  WA_LATE_ACK,
  WA_REPORT,
  type WaDraftSeed,
  seedWhatsapp,
  seedWhatsappDraft,
} from "../../e2e/whatsapp-fixtures";
import { loginAs } from "../fixtures/roles";
import { CONFLICT_DIALOG, DRAFT_SCREEN, EMAIL_DRAFT_SCREEN, REASON_EXAMPLES, WHATSAPP_DRAFT_SCREEN } from "../fixtures/spec-text";
import { acceptDialogs, openDetails } from "../fixtures/world";

/**
 * אפיון 1.4 — מה שמשתמש רואה מטיוטה מוואטסאפ (W8): מסך 7 ושיחת הוואטסאפ, חלון 7א,
 * הלוח, חלון "פרטים" אחרי השיגור, והבאנר כשהחיבור נפל. **מול המחרוזות שהועתקו
 * מהאפיון** (`spec-text.ts`), לעולם לא מול `he.ts`. המצב נזרע כמו שהצינור משאיר
 * אותו — אותה זריעה של ה-E2E (`e2e/seed-whatsapp-draft.ts`).
 */

let seed: WaDraftSeed;

function reseed() {
  test.beforeAll(() => {
    seed = seedWhatsappDraft();
  });
}

async function hydrated(page: Page) {
  await expect(page.getByRole("button", { name: DRAFT_SCREEN.delete })).toBeEnabled();
}

test.describe("מסך 7 — טיוטה מוואטסאפ", () => {
  reseed();

  test.beforeEach(async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    await page.goto(`/tickets/${seed.draftId}`);
    await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible();
  });

  test("WA-S7-01 — שיחת הוואטסאפ בראש המסך, ומצב המסירה של הודעות המערכת", async ({ page }) => {
    const conversation = page.getByRole("region", { name: WHATSAPP_DRAFT_SCREEN.conversation });
    await expect(conversation).toBeVisible();
    await expect(conversation.getByText(WA_REPORT)).toBeVisible();
    await expect(conversation.getByText(WHATSAPP_DRAFT_SCREEN.delivery.read, { exact: true })).toBeVisible();
    await expect(conversation.getByText(WHATSAPP_DRAFT_SCREEN.delivery.failed, { exact: true })).toBeVisible();
    // ההתכתבות של המייל אינה כאן
    await expect(page.getByRole("region", { name: EMAIL_DRAFT_SCREEN.correspondence })).toHaveCount(0);
  });

  test("WA-M02 — תג 'מוואטסאפ' ליד מה שמולא מהשיחה", async ({ page }) => {
    await expect(
      page.locator('[data-field="DESCRIPTION"]').getByText(WHATSAPP_DRAFT_SCREEN.fromTag, { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('[data-field="BUILDING"]').getByText(WHATSAPP_DRAFT_SCREEN.fromTag, { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(EMAIL_DRAFT_SCREEN.fromEmailTag, { exact: true })).toHaveCount(0);
  });

  test("WA-S7-02 — נוסח הסתירה בשם הערוץ, ו'שגר' חסום", async ({ page }) => {
    await hydrated(page);
    await expect(page.getByText(WHATSAPP_DRAFT_SCREEN.conflictBanner(1))).toBeVisible();
    await expect(page.getByRole("button", { name: DRAFT_SCREEN.submit, exact: true })).toBeDisabled();
  });

  test("WA-S7A-01 — חלון הסתירות: הכותרת ועמודת המקור בשם הערוץ, בלי בחירה מראש", async ({ page }) => {
    await hydrated(page);
    await page.getByRole("button", { name: EMAIL_DRAFT_SCREEN.compare }).click();
    const dialog = page.getByRole("dialog", { name: WHATSAPP_DRAFT_SCREEN.conflictsTitle });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("radio", { name: `${WHATSAPP_DRAFT_SCREEN.sourceColumn}: בניין ב` })).toBeVisible();
    for (const radio of await dialog.getByRole("radio").all()) await expect(radio).not.toBeChecked();
    await expect(dialog.getByRole("button", { name: CONFLICT_DIALOG.apply })).toBeDisabled();
  });
});

test.describe("מסך 1 — טיוטה מוואטסאפ בלוח", () => {
  reseed();

  test("WA-S1-01 — התג 'מוואטסאפ' ושורת הסיבה בשם הערוץ", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/board");
    const card = page.getByRole("link").filter({ hasText: WA_REPORT.slice(0, 20) }).first();
    await expect(card).toBeVisible();
    await expect(card.getByText(`· ${WHATSAPP_DRAFT_SCREEN.fromTag}`, { exact: true })).toBeVisible();
    await expect(card).toContainText(REASON_EXAMPLES.waDraftConflicts(1));
  });
});

test.describe("מסך 2 — אחרי השיגור", () => {
  reseed();

  test("WA-S2-01 — 'שיחת הוואטסאפ' בחלון 'פרטים', ולא בשרשור — רק מה שקדם לשיגור", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    await page.goto(`/tickets/${seed.dispatchedId}`);
    await expect(page.getByRole("region", { name: "שרשור" }).getByText(WA_DISPATCHED_ACK)).toHaveCount(0);

    await openDetails(page);
    const conversation = page
      .getByRole("dialog", { name: "פרטים" })
      .getByRole("region", { name: WHATSAPP_DRAFT_SCREEN.conversation });
    await expect(conversation.getByText(WA_DISPATCHED_REPORT)).toBeVisible();
    await expect(conversation.getByText(WA_DISPATCHED_ACK)).toBeVisible();
    await expect(conversation.getByText(WA_LATE_ACK)).toHaveCount(0);
  });
});

test.describe("מסך 1 — כשהוואטסאפ התנתק", () => {
  test.afterAll(() => seedWhatsapp("clear"));

  test("WA-S1-02 — באנר למנהל המערכת בלבד, בנוסח האפיון, עם קישור לחיבור", async ({ page }) => {
    seedWhatsapp("error");
    await loginAs(page, "admin");
    await page.goto("/board");
    const banner = page.getByRole("status").filter({ hasText: WHATSAPP_DRAFT_SCREEN.disconnectedBanner });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("link", { name: WHATSAPP_DRAFT_SCREEN.connect })).toBeVisible();

    seedWhatsapp("connected");
    await page.goto("/board");
    await expect(page.getByText(WHATSAPP_DRAFT_SCREEN.disconnectedBanner)).toHaveCount(0);
  });

  test("WA-S1-02 — בעלים אינו רואה את הבאנר", async ({ page }) => {
    seedWhatsapp("error");
    await loginAs(page, "owner");
    await page.goto("/board");
    await expect(page.getByText(WHATSAPP_DRAFT_SCREEN.disconnectedBanner)).toHaveCount(0);
  });
});
