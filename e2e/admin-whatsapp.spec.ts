import { type Page, expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";
import { WA_OWNER, seedWhatsapp } from "./whatsapp-fixtures";

/**
 * WA-S12-01 (אפיון מסך 12, §3.7 שדה 5): בכרטיס המשתמש מתג "רשאי לפתוח פניות
 * בוואטסאפ", דלוק כברירת מחדל, ליד מתג המייל — מקצה לקצה, כולל שמירה בשרת
 * ששורדת רענון.
 *
 * **הריצה מחזירה את המתג למצבו.** הבסיס משותף לשני המכשירים ולשאר החבילה,
 * ומתג שנשאר כבוי היה משנה את מצב מנהל ה-seed לכל spec שבא אחריו.
 *
 * בהמשך הקובץ: מסך 17 — חיבור המספר העסקי (W5).
 */

const LABEL = "רשאי לפתוח פניות בוואטסאפ";

async function loginAsAdmin(page: Page) {
  await page.goto("/board");
  if (new URL(page.url()).pathname === "/login") {
    await page.getByLabel("טלפון או מייל").fill(E2E_ADMIN.phone);
    await page.getByLabel("סיסמה").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "כניסה" }).click();
  }
  await expect(page).toHaveURL(/\/board$/);
}

async function openAdminCard(page: Page) {
  await page.goto("/admin/users");
  await page.getByRole("button", { name: E2E_ADMIN.name, exact: true }).click();
  return page.getByRole("dialog");
}

test("WA-S12-01 — מתג הוואטסאפ דלוק כברירת מחדל, וכיבויו נשמר בשרת", async ({ page }) => {
  await loginAsAdmin(page);

  let dialog = await openAdminCard(page);
  const toggle = dialog.getByRole("checkbox", { name: LABEL });
  await expect(toggle).toBeChecked();
  // ליד מתג המייל, באותו גוש
  await expect(dialog.getByRole("checkbox", { name: "רשאי לפתוח פניות במייל" })).toBeVisible();

  // ── כיבוי ההרשאה שורד רענון ──────────────────────────────────────
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.reload();
  dialog = await openAdminCard(page);
  await expect(dialog.getByRole("checkbox", { name: LABEL })).not.toBeChecked();
  // המייל לא זז
  await expect(dialog.getByRole("checkbox", { name: "רשאי לפתוח פניות במייל" })).toBeChecked();

  // ── ניקוי: הדלקה מחדש ─────────────────────────────────────────────
  await dialog.getByRole("checkbox", { name: LABEL }).click();
  await expect(dialog.getByRole("checkbox", { name: LABEL })).toBeChecked();
  await page.reload();
  dialog = await openAdminCard(page);
  await expect(dialog.getByRole("checkbox", { name: LABEL })).toBeChecked();
});

// ─────────────────────────────── מסך 17 — חיבור וואטסאפ ───────────────────────────────

/**
 * מסך 17 (אפיון 1.4, W5) מקצה לקצה — **בלי Meta**: `server-env.ts` מאפס את
 * `WHATSAPP_*`, ולכן אין "חבר מספר" והתבניות "לא זמינות". המצבים נזרעים בבסיס
 * (`seed-whatsapp.ts`), והזרימה מול Meta נבדקת ב-`tests/integration/wa-number.test.ts`.
 * הנוסחים כלשונם מהאפיון, מסך 17.
 */
test.describe("מסך 17 — חיבור וואטסאפ", () => {
  const CONFIRM = "הודעות למספר הזה לא ייקלטו עוד במערכת, וגם לא בדיעבד. לנתק?";

  test.afterAll(() => seedWhatsapp("clear"));

  test("WA-S17-01 — מצב החיבור, השולחים שלא זוהו, הודעת הבדיקה, והתקלה במילים", async ({ page }) => {
    seedWhatsapp("connected");
    await loginAsAdmin(page);

    // הכרטיס ברכזת הניהול הוא טעינת מסמך מלאה — ה-CSP של המסך שונה
    await page.goto("/admin");
    await page.getByRole("link", { name: "חיבור וואטסאפ" }).click();
    await expect(page).toHaveURL(/\/admin\/whatsapp$/);
    await expect(page.getByRole("heading", { level: 1, name: "חיבור וואטסאפ" })).toBeVisible();

    await expect(page.getByText("+972 50-000-0077")).toBeVisible();
    await expect(page.getByText("מחובר", { exact: true })).toBeVisible();
    await expect(page.getByText("Y&Y אחזקה")).toBeVisible();
    // שתיים ב-30 הימים האחרונים; הישנה מ-40 יום אינה נספרת (WA-21)
    await expect(page.locator("p", { hasText: 'הודעות עם "תקלה" משולח שלא זוהה, ב-30 הימים האחרונים' })).toContainText("2");
    await expect(page.getByText("נמסרה", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "שלח הודעת בדיקה" })).toBeVisible();
    // אין Meta ב-E2E — שורה שמסבירה, לא מסך שנפל
    await expect(page.getByText("לא ניתן לטעון את התבניות מ-Meta כרגע.")).toBeVisible();

    seedWhatsapp("error");
    await page.reload();
    await expect(page.getByText("תקלה", { exact: true })).toBeVisible();
    await expect(
      page.getByText("החיבור לטלפון העסקי נותק (האפליקציה בטלפון לא נפתחה כ-14 יום) — יש לחבר מחדש."),
    ).toBeVisible();
    // הודעת בדיקה ותבניות — רק למספר מחובר
    await expect(page.getByRole("button", { name: "שלח הודעת בדיקה" })).toHaveCount(0);
  });

  test("WA-S17-03 — נתק: האישור בנוסח האפיון; ביטול אינו משנה דבר", async ({ page }) => {
    seedWhatsapp("connected");
    await loginAsAdmin(page);
    await page.goto("/admin/whatsapp");

    const prompts: string[] = [];
    page.once("dialog", (dialog) => {
      prompts.push(dialog.message());
      void dialog.dismiss();
    });
    await page.getByRole("button", { name: "נתק" }).click();
    await expect.poll(() => prompts).toEqual([CONFIRM]);
    await expect(page.getByText("מחובר", { exact: true })).toBeVisible();

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "נתק" }).click();
    await expect(page.getByText("מנותק", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "נתק" })).toHaveCount(0);
    // מנותק, ובלי תצורה של Meta — אין כפתור חיבור, ונאמר למה
    await expect(page.getByText("החיבור לוואטסאפ עוד לא הוגדר בשרת. יש לפנות למפתח המערכת.")).toBeVisible();
  });

  test("WA-S1-02 — באנר בראש הלוח: למנהל המערכת, רק כשהחיבור נפל, והקישור טוען את מסך 17", async ({
    page,
    browser,
  }) => {
    const BANNER = "הוואטסאפ אינו מחובר — הודעות לא נקלטות.";
    seedWhatsapp("error");
    await loginAsAdmin(page);
    await page.goto("/board");
    const banner = page.getByRole("status").filter({ hasText: BANNER });
    await expect(banner).toBeVisible();
    const link = banner.getByRole("link", { name: "לחיבור" });
    await expect(link).toHaveAttribute("href", "/admin/whatsapp");
    // טעינת מסמך מלאה: ה-CSP של מסך 17 — היחיד שמתיר את ה-SDK — חל עליו
    const [response] = await Promise.all([page.waitForResponse(/\/admin\/whatsapp$/), link.click()]);
    expect(response.headers()["content-security-policy"]).toContain("https://connect.facebook.net");
    await expect(page.getByText("תקלה", { exact: true })).toBeVisible();

    // בעלים — אין באנר, גם כשהחיבור נפל
    const context = await browser.newContext();
    const owner = await context.newPage();
    await owner.goto("/login");
    await owner.getByLabel("טלפון או מייל").fill(WA_OWNER.phone);
    await owner.getByLabel("סיסמה").fill(WA_OWNER.password);
    await owner.getByRole("button", { name: "כניסה" }).click();
    await expect(owner).toHaveURL(/\/board$/);
    await expect(owner.getByText(BANNER)).toHaveCount(0);
    await context.close();

    // חיבור תקין — אין באנר: חיווי קבוע מלמד להפסיק לקרוא אותו
    seedWhatsapp("connected");
    await page.goto("/board");
    // הלוח מרונדר בשרת: אחרי goto התוכן כבר שם, והיעדר הבאנר הוא תשובה ולא מרוץ
    await expect(page.getByText(BANNER)).toHaveCount(0);
  });

  test("ה-CSP מתיר את ה-SDK של Meta במסך 17 בלבד", async ({ page }) => {
    await loginAsAdmin(page);
    const screen = await page.goto("/admin/whatsapp");
    expect(screen?.headers()["content-security-policy"]).toContain("https://connect.facebook.net");
    const hub = await page.goto("/admin");
    expect(hub?.headers()["content-security-policy"]).not.toContain("facebook");
  });

  test("WA-S17-01 — מנהל מערכת בלבד: בעלים מוחזר ללוח, ואין לו כרטיס ברכזת", async ({ browser }) => {
    seedWhatsapp("connected");
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("טלפון או מייל").fill(WA_OWNER.phone);
    await page.getByLabel("סיסמה").fill(WA_OWNER.password);
    await page.getByRole("button", { name: "כניסה" }).click();
    await expect(page).toHaveURL(/\/board$/);

    await page.goto("/admin/whatsapp");
    await expect(page).toHaveURL(/\/board$/);
    await page.goto("/admin");
    await expect(page.getByRole("link", { name: "חיבור וואטסאפ" })).toHaveCount(0);
    await context.close();
  });
});
