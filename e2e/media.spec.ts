import { type Page, expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";

/**
 * צירוף קבצים — מהבחירה ועד להצגה בשרשור, אצל שני הצדדים.
 *
 * זו הבדיקה שמאמתת את המסלול בשלושת השלבים (רישום → העלאה → אישור), כולל
 * מה שאף בדיקת אינטגרציה אינה יכולה לבדוק: שהבתים באמת עוברים ברשת, שהם
 * חוזרים דרך ה-route שבודק הרשאה, ושהתמונה נטענת בדפדפן בפועל.
 */

/**
 * ‏PNG אמיתי בגודל 1×1, מקודד base64.
 *
 * קובץ אמיתי ולא בתים אקראיים: הבדיקה מוודאת שהדפדפן **מצייר** את התמונה
 * (‏`naturalWidth > 0`), וזבל היה עובר את כל השרשרת ונכשל רק שם — או גרוע
 * מכך, עובר בשקט אילו הבדיקה הייתה מסתפקת בקיום התגית.
 */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function pngFile(name: string) {
  return { name, mimeType: "image/png", buffer: Buffer.from(PNG_BASE64, "base64") };
}

/**
 * שדה הקובץ מוסתר ומופעל מכפתור, ולכן אין לו שם נגיש לבחור לפיו.
 * הבחירה לפי `accept` מבדילה אותו משדה המצלמה שלצדו.
 */
function fileInput(page: Page) {
  return page.locator('input[type="file"][accept="image/*,application/pdf,video/*"]');
}

async function loginAsManager(page: Page) {
  await page.goto("/board");
  if (new URL(page.url()).pathname === "/login") {
    await page.getByLabel("טלפון או מייל").fill(E2E_ADMIN.phone);
    await page.getByLabel("סיסמה").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "כניסה" }).click();
  }
  await expect(page).toHaveURL(/\/board$/);
}

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).first().click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** פותח פנייה עם קבלן ומחזיר את התיאור ואת קישור הפורטל שלו */
async function openTicketWithContractor(page: Page, stamp: number) {
  const description = `סדק בקיר ${stamp}`;
  const contractor = `קבלן ${stamp}`;

  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await pick(page, "תחום", "חשמל");
  await page.getByLabel("תיאור").fill(description);
  await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
  await page.getByLabel("שם").fill(contractor);
  await page.getByLabel("טלפון").fill(`058-${String(stamp).slice(-7)}`);
  await page.getByRole("button", { name: "שמור איש מקצוע" }).click();
  await expect(page.getByRole("list", { name: "נמענים", exact: true })).toContainText(contractor);
  await page.getByRole("button", { name: "שלח לנמענים" }).click();
  await expect(page.getByRole("heading", { name: "שרשור" })).toBeVisible();

  await page
    .getByRole("list", { name: "נמענים", exact: true })
    .getByRole("listitem")
    .filter({ hasText: contractor })
    .getByRole("button", { name: `קישור גישה ${contractor}` })
    .click();
  await expect(page.getByText(`קישור עבור ${contractor}`)).toBeVisible();

  const link = (
    await page.getByRole("textbox", { name: "קישור גישה", exact: true }).inputValue()
  ).replace(/^https?:\/\/[^/]+/, "");

  return { description, contractor, link };
}

test("מנהל מצרף תמונה לתגובה, והקבלן רואה אותה בפורטל", async ({ page }) => {
  const stamp = Date.now();

  await loginAsManager(page);
  const { description, link } = await openTicketWithContractor(page, stamp);

  // ── המנהל מצרף תמונה ──────────────────────────────────────────────
  await fileInput(page).setInputFiles(pngFile("wall.png"));

  // ההעלאה מתחילה בבחירה ולא בשליחה: התצוגה המקדימה מופיעה כשהקובץ כבר
  // אצל השרת, וזה מה שמאפשר למנהל להמשיך להקליד בזמן שהבתים בדרך.
  const preview = page.getByRole("list", { name: "צרף קובץ" });
  await expect(preview.getByRole("img", { name: "תמונה מצורפת" })).toBeVisible();

  await page.getByLabel("תגובה").fill("ככה זה נראה");
  await page.getByRole("button", { name: "שלח", exact: true }).click();

  // ── התמונה בשרשור, ונטענת בפועל ───────────────────────────────────
  const thread = page.locator("section").filter({ hasText: "שרשור" });
  const image = thread.getByRole("img", { name: "wall.png" });
  await expect(image).toBeVisible();

  const src = await image.getAttribute("src");
  expect(src).toMatch(/^\/api\/media\//);
  // הדפדפן צייר אותה — כלומר הבתים באמת חזרו דרך ה-route שבודק הרשאה.
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBeGreaterThan(0);

  // ── אותה תמונה אצל הקבלן ──────────────────────────────────────────
  await page.goto(link);
  await page.getByRole("link").filter({ hasText: description }).click();

  const portalImage = page.getByRole("img", { name: "wall.png" });
  await expect(portalImage).toBeVisible();
  // הטוקן נוסף לכתובת: לפורטל אין עוגיית סשן.
  expect(await portalImage.getAttribute("src")).toContain("?t=");
  await expect
    .poll(() => portalImage.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBeGreaterThan(0);
});

test("מנהל מצלם לפני שהפנייה קיימת, והתמונה נכנסת איתה", async ({ page }) => {
  // המסלול העיקרי בשטח: עומדים מול הדירה, מצלמים, וממלאים אחר כך.
  const stamp = Date.now();
  const description = `אריח שבור ${stamp}`;

  await loginAsManager(page);
  await page.goto("/tickets/new");

  // הצילום קודם — לפני שנבחרו בניין, דירה ותחום.
  await fileInput(page).setInputFiles(pngFile("before.png"));
  await expect(
    page.getByRole("list", { name: "צרף קובץ" }).getByRole("img", { name: "תמונה מצורפת" }),
  ).toBeVisible();

  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await pick(page, "תחום", "חשמל");
  await page.getByLabel("תיאור").fill(description);
  await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
  await page.getByLabel("שם").fill(`רצף ${stamp}`);
  await page.getByLabel("טלפון").fill(`059-${String(stamp).slice(-7)}`);
  await page.getByRole("button", { name: "שמור איש מקצוע" }).click();
  await expect(page.getByRole("list", { name: "נמענים", exact: true })).toContainText(
    `רצף ${stamp}`,
  );

  await page.getByRole("button", { name: "שלח לנמענים" }).click();
  await expect(page.getByRole("heading", { name: "שרשור" })).toBeVisible();

  const image = page.getByRole("img", { name: "before.png" });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBeGreaterThan(0);
});

test("קבלן מגיב בתמונה בלי לכתוב מילה", async ({ page }) => {
  // התרחיש מהאפיון: הקבלן מצלם את מה שתיקן. תמונה בלי כיתוב היא הודעה
  // שלמה, ולעיתים המדויקת ביותר.
  const stamp = Date.now();

  await loginAsManager(page);
  const { description, link } = await openTicketWithContractor(page, stamp);

  await page.goto(link);
  await page.getByRole("link").filter({ hasText: description }).click();

  await fileInput(page).setInputFiles(pngFile("fixed.png"));
  await expect(
    page.getByRole("list", { name: "צרף קובץ" }).getByRole("img", { name: "תמונה מצורפת" }),
  ).toBeVisible();

  // שדה התגובה נשאר ריק בכוונה.
  await page.getByRole("button", { name: "שלח", exact: true }).click();
  await expect(page.getByRole("img", { name: "fixed.png" })).toBeVisible();

  // והמנהל רואה אותה בשרשור.
  await loginAsManager(page);
  await page.goto("/board");
  await page.getByRole("link").filter({ hasText: description }).click();
  await expect(page.getByRole("img", { name: "fixed.png" })).toBeVisible();
});

test("קובץ בגודל אמיתי עובר במלואו", async ({ page }) => {
  /**
   * כל שאר בדיקות המדיה מעלות קובץ של 70 בתים, וזה לא מייצג דבר: תמונה
   * מטלפון היא כמה מגה־בייטים. הסיכון האמיתי הוא מגבלת גודל גוף בקשה
   * בשרת או בשכבת האירוח — כשל שהיה מתגלה רק בפרודקשן, אצל מנהל שמנסה
   * להעלות צילום של דירה.
   *
   * ‏PDF ולא תמונה: המבנה הפנימי אינו נבדק בשרת, וכך אפשר לייצר קובץ
   * גדול באמת בלי לקודד תמונה של שלושה מגה־בייטים.
   */
  const stamp = Date.now();
  const megabytes = 3;
  const big = Buffer.alloc(megabytes * 1024 * 1024, 0x41);
  big.write("%PDF-1.4\n", 0);

  await loginAsManager(page);
  const { description } = await openTicketWithContractor(page, stamp);

  await fileInput(page).setInputFiles({
    name: "דוח בדק בית.pdf",
    mimeType: "application/pdf",
    buffer: big,
  });

  // אין תצוגה מקדימה ל-PDF, ולכן מחכים לשם הקובץ בצ'יפ.
  await expect(page.getByRole("list", { name: "צרף קובץ" })).toContainText("דוח בדק בית.pdf");
  // בשמות ההודעות ולא לפי role="alert": ב-Next במצב פיתוח קיים אזור
  // הכרזה נגיש עם אותו role, והוא היה מזוהה ככשל.
  await expect(page.getByText("ההעלאה נכשלה")).toHaveCount(0);
  await expect(page.getByText("הקובץ גדול מדי")).toHaveCount(0);

  await page.getByRole("button", { name: "שלח", exact: true }).click();

  const link = page.getByRole("link", { name: /דוח בדק בית\.pdf/ });
  await expect(link).toBeVisible();

  // ההורדה מחזירה את כל הבתים — לא קובץ קטוע.
  const href = (await link.getAttribute("href")) as string;
  const response = await page.request.get(href);
  expect(response.status()).toBe(200);
  expect((await response.body()).byteLength).toBe(big.byteLength);

  // והפנייה עצמה לא נפגעה בדרך.
  await expect(page.getByText(description)).toBeVisible();
});

test("קובץ של פנייה אחת אינו נגיש לקבלן של פנייה אחרת", async ({ page }) => {
  const stamp = Date.now();

  await loginAsManager(page);
  await openTicketWithContractor(page, stamp);
  await fileInput(page).setInputFiles(pngFile("secret.png"));
  await expect(
    page.getByRole("list", { name: "צרף קובץ" }).getByRole("img", { name: "תמונה מצורפת" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "שלח", exact: true }).click();

  const image = page.getByRole("img", { name: "secret.png" });
  await expect(image).toBeVisible();
  const mediaUrl = (await image.getAttribute("src")) as string;

  // קבלן של פנייה אחרת מקבל 404 — אותה תשובה כמו לקובץ שאינו קיים, כדי
  // שלא ניתן יהיה למפות אילו קבצים קיימים במערכת.
  const second = await openTicketWithContractor(page, stamp + 1);
  const token = second.link.replace("/p/", "");

  const response = await page.request.get(`${mediaUrl}?t=${token}`);
  expect(response.status()).toBe(404);
});
