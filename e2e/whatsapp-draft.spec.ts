import { type Page, expect, test } from "@playwright/test";
import { loginAsManager } from "./helpers";
import { openDetails } from "./ticket-screen";
import {
  WA_ACK,
  WA_DISPATCHED_ACK,
  WA_DISPATCHED_REPORT,
  WA_LATE_ACK,
  WA_REPLY,
  WA_REPLY_ACK,
  WA_REPORT,
  WA_TRANSCRIPT,
  type WaDraftSeed,
  seedWhatsappDraft,
} from "./whatsapp-fixtures";

/**
 * מסך 7 של טיוטה מוואטסאפ, הלוח וחלון "פרטים" (W8) — מול שרת אמיתי ומסד שנזרע
 * כמו שהצינור משאיר אותו (`seed-whatsapp-draft.ts`). הנוסחים כאן הם של האפיון; הם
 * חוזרים בחבילת ההתאמה מול המחרוזות שהועתקו ממנו.
 */

let seed: WaDraftSeed;

test.beforeAll(() => {
  seed = seedWhatsappDraft();
});

test.beforeEach(async ({ page }) => {
  await loginAsManager(page);
});

async function openDraft(page: Page) {
  await page.goto(`/tickets/${seed.draftId}`);
  await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible();
}

function field(page: Page, name: string) {
  return page.locator(`[data-field="${name}"]`);
}

/** הבועה בשיחה — לפי טקסט שבה */
function bubble(page: Page, text: string) {
  return page.getByRole("region", { name: "שיחת הוואטסאפ" }).locator("ol > li").filter({ hasText: text });
}

test("WA-S7-01 — שיחת הוואטסאפ בראש המסך: הדיווח, ההקלטה עם התמלול, האישורים ומצב המסירה", async ({ page }) => {
  await openDraft(page);
  const conversation = page.getByRole("region", { name: "שיחת הוואטסאפ" });
  await expect(conversation).toBeVisible();
  // ארבע הודעות שנקלטו ושני אישורים — ובלי ההתכתבות של המייל
  await expect(conversation.locator("ol > li")).toHaveCount(5);
  await expect(page.getByRole("region", { name: "התכתבות המייל" })).toHaveCount(0);

  await expect(bubble(page, WA_REPORT).getByRole("img")).toBeVisible();
  await expect(conversation.getByText(WA_TRANSCRIPT)).toBeVisible();
  // האישור שנקרא — מילה שקטה; האישור שלא הגיע — "לא נשלחה"
  await expect(bubble(page, WA_ACK).getByText("נקראה", { exact: true })).toBeVisible();
  await expect(bubble(page, WA_ACK).getByText("המערכת", { exact: true })).toBeVisible();
  await expect(bubble(page, WA_REPLY_ACK).getByText("לא נשלחה", { exact: true })).toBeVisible();
  await expect(bubble(page, WA_REPLY)).toBeVisible();

  // השיחה אינה השרשור: התיאור הוא שדה בטופס, ולא בועה נוספת
  await expect(page.getByRole("region", { name: "שרשור" }).getByText(WA_REPORT)).toHaveCount(0);
});

test("WA-M02 — 'מוואטסאפ' ליד השדות שמולאו מהשיחה, ולא 'מהמייל'", async ({ page }) => {
  await openDraft(page);
  await expect(field(page, "DESCRIPTION").getByText("מוואטסאפ", { exact: true })).toBeVisible();
  await expect(field(page, "DOMAIN").getByText("מוואטסאפ", { exact: true })).toBeVisible();
  await expect(field(page, "BUILDING").getByText("מוואטסאפ", { exact: true })).toHaveCount(0);
  await expect(page.getByText("מהמייל", { exact: true })).toHaveCount(0);
});

test("WA-S7-02 — סתירה: הודעה בשם הערוץ, השדה מסומן, ו'שגר' חסום", async ({ page }) => {
  await openDraft(page);
  await expect(page.getByRole("button", { name: "מחק טיוטה" })).toBeEnabled();
  await expect(page.getByText("יש סתירה בין הוואטסאפ למערכת ב-1 שדה. לא ניתן לשגר עד שתוכרע.")).toBeVisible();
  await expect(field(page, "BUILDING").getByText("בסתירה", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "שגר", exact: true })).toBeDisabled();
});

test("WA-S7A-01 — חלון הסתירות: הכותרת ועמודת המקור בשם הערוץ", async ({ page }) => {
  await openDraft(page);
  await page.getByRole("button", { name: "השווה ובחר" }).click();
  const dialog = page.getByRole("dialog", { name: "סתירות בין הוואטסאפ למערכת" });
  await expect(dialog).toBeVisible();
  const building = dialog.getByRole("group", { name: "בניין" });
  await expect(building.getByRole("radio", { name: "מוואטסאפ: בניין ב" })).toBeVisible();
  await expect(building.getByRole("radio", { name: "במערכת: בניין א" })).toBeVisible();
  // אין בחירה מראש
  await expect(dialog.getByRole("button", { name: "החל את הבחירה" })).toBeDisabled();
});

test("WA-S7-03 — 'הסר קובץ' מוריד את התמונה מהטיוטה, והיא נשארת בשיחה", async ({ page }) => {
  await openDraft(page);
  await expect(page.getByRole("button", { name: "מחק טיוטה" })).toBeEnabled();
  const files = page.getByRole("region", { name: "קבצים בטיוטה" });
  await expect(files.getByRole("button", { name: /^הסר קובץ: / })).toHaveCount(2);
  await expect(files.getByText("קובץ שהגיע בוואטסאפ נשאר בשיחה גם אחרי שהוסר מהטיוטה, ואינו נשלח לנמענים.")).toBeVisible();

  // התמונה היא הקובץ הראשון (אין לה שם — שם חלופי ממוספר)
  await files.getByRole("button", { name: "הסר קובץ: קובץ ללא שם 1" }).click();
  await expect(files.getByRole("button", { name: /^הסר קובץ: / })).toHaveCount(1);

  // והיא עדיין בשיחה, ונטענת ממנה
  const image = bubble(page, WA_REPORT).getByRole("img");
  await expect(image).toBeVisible();
  const src = await image.getAttribute("src");
  expect(src).toMatch(/^\/api\/wa-media\//);
  const response = await page.request.get(src!);
  expect(response.status()).toBe(200);
});

test("WA-S2-01 — אחרי השיגור השיחה בחלון 'פרטים', ולא בשרשור — ורק מה שקדם לשיגור", async ({ page }) => {
  await page.goto(`/tickets/${seed.dispatchedId}`);
  const thread = page.getByRole("region", { name: "שרשור" });
  await expect(thread).toBeVisible();
  await expect(thread.getByText(WA_DISPATCHED_ACK)).toHaveCount(0);

  await openDetails(page);
  const conversation = page.getByRole("dialog", { name: "פרטים" }).getByRole("region", { name: "שיחת הוואטסאפ" });
  await expect(conversation).toBeVisible();
  await expect(conversation.getByText(WA_DISPATCHED_REPORT)).toBeVisible();
  await expect(conversation.getByText(WA_DISPATCHED_ACK)).toBeVisible();
  // התגובה המאוחרת ו"כבר נשלחה" עליה — אחרי השיגור, ולכן לא כאן
  await expect(conversation.getByText(WA_LATE_ACK)).toHaveCount(0);
  await expect(conversation.locator("ol > li")).toHaveCount(2);
});

test("WA-S1-01 — בלוח, כרטיס הטיוטה נושא את התג 'מוואטסאפ' ואת שורת הסיבה בשם הערוץ", async ({ page }) => {
  await page.goto("/board");
  const card = page.getByRole("link").filter({ hasText: WA_REPORT.slice(0, 20) }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText("· מוואטסאפ", { exact: true })).toBeVisible();
  await expect(card).toContainText("טיוטה מוואטסאפ · סתירה ב-1 שדה");
});
