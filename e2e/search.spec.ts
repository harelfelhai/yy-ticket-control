import { type Page, expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";
import { openFilters } from "./helpers";
import { shownText } from "./ticket-screen";

/**
 * מסך החיפוש (מסך 9).
 *
 * הבדיקה מתמקדת במה שהמנהל עושה בפועל: הוא זוכר מילה מתוך הפנייה, לא את
 * מספרה. לכן החיפוש חייב למצוא גם לפי מה שנכתב בשרשור ולא רק לפי התיאור.
 */

async function login(page: Page) {
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

test("חיפוש מוצא פנייה לפי התיאור ולפי מה שנכתב בשרשור", async ({ page }) => {
  const stamp = Date.now();
  const description = `רטיבות בממ״ד ${stamp}`;
  const reply = `הצנרת מאחורי הקיר ${stamp}`;

  await login(page);

  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await pick(page, "תחום", "חשמל");
  await page.getByLabel("תיאור").fill(description);
  await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
  await page.getByLabel("שם").fill(`קבלן ${stamp}`);
  await page.getByLabel("טלפון").fill(`056-${String(stamp).slice(-7)}`);
  await page.getByRole("button", { name: "שמור איש מקצוע" }).click();
  await expect(page.getByRole("list", { name: "נמענים", exact: true })).toContainText(
    `קבלן ${stamp}`,
  );
  await page.getByRole("button", { name: "שלח לנמענים" }).click();
  await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible();

  await page.getByLabel("תגובה").fill(reply);
  await page.getByRole("button", { name: "שלח", exact: true }).click();
  // ‏shownText: `getByText` היה נפתר על תיבת הכתיבה ולא ממתין לשרת.
  await expect(shownText(page, reply)).toBeVisible();

  // ── הגעה למסך מהתפריט, לא מהכתובת ─────────────────────────────────
  await page.getByRole("link", { name: "חיפוש" }).click();
  await expect(page).toHaveURL(/\/search/);

  // בלי מונח ובלי מסננים אין מה להציג — רשימה של הכול היא הלוח.
  await expect(page.getByText("הקלד מה לחפש")).toBeVisible();

  // ── חיפוש לפי התיאור ──────────────────────────────────────────────
  await page.getByLabel("חיפוש", { exact: true }).fill(description);
  await page.getByRole("button", { name: "חפש" }).click();
  await expect(page.getByRole("link").filter({ hasText: description })).toBeVisible();

  // ── חיפוש לפי מה שנכתב בשרשור ─────────────────────────────────────
  await page.getByLabel("חיפוש", { exact: true }).fill(reply);
  await page.getByRole("button", { name: "חפש" }).click();
  await expect(page.getByRole("link").filter({ hasText: description })).toBeVisible();

  // ── מונח שאינו קיים ───────────────────────────────────────────────
  await page.getByLabel("חיפוש", { exact: true }).fill(`אלומיניום ${stamp}`);
  await page.getByRole("button", { name: "חפש" }).click();
  await expect(page.getByText("לא נמצאו פניות")).toBeVisible();
});

/**
 * מסנן התאריכים — **הבדיקה הראשונה אי-פעם על רצועת המסננים.**
 *
 * הרצועה נבנתה בפער 12 ומעולם לא נבדקה מקצה לקצה, וזו הסיבה שסבב הביקורת
 * הראשון מצא בה סטיות שאיש לא ראה. הבדיקה מכסה את מה ששום בדיקת יחידה אינה
 * יכולה: שהערך שנבחר בפקד הנייטיב באמת מגיע לכתובת, ומשם לשאילתה בשרת.
 */
test("מסנן התאריכים מסנן בפועל ונשמר בכתובת", async ({ page }) => {
  const stamp = Date.now();
  const description = `תריס תקוע ${stamp}`;

  await login(page);
  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await pick(page, "תחום", "חשמל");
  await page.getByLabel("תיאור").fill(description);
  await page.getByRole("button", { name: "שמור כטיוטה" }).click();
  await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible();

  await page.goto("/search");
  await openFilters(page);

  /**
   * המילוי חוזר על עצמו עד שהכתובת מתעדכנת, וזה אינו קישוט.
   *
   * פקדי הרצועה מנווטים ב-`onChange` → `router.replace`, ולכן מילוי **לפני**
   * ה-hydration נבלע בשקט — האירוע נורה כשאין לו עדיין מטפל. במובייל
   * `openFilters` ממתין ל-`aria-expanded` וזה משמש גם כהמתנה ל-hydration;
   * בדסקטופ אין מתג, הפונקציה חוזרת מיד, ואין שום מחסום. זה מה שהפך את
   * הבדיקה ל-flaky בדסקטופ בלבד.
   */
  async function filterByDate(label: string, value: string, param: string) {
    await expect
      .poll(
        async () => {
          await page.getByLabel(label).fill(value);
          return new URL(page.url()).search;
        },
        { timeout: 15_000 },
      )
      .toContain(`${param}=`);
  }

  // ── טווח שמכיל את היום: הפנייה שנוצרה עכשיו חייבת להימצא ──────────
  const today = new Date().toISOString().slice(0, 10);
  await filterByDate("מתאריך", today, "from");
  await expect(page.getByRole("link").filter({ hasText: description })).toBeVisible();

  // ── טווח שנגמר אתמול: אותה פנייה חייבת להיעלם ─────────────────────
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await filterByDate("עד תאריך", yesterday, "to");
  await expect(page.getByRole("link").filter({ hasText: description })).toHaveCount(0);
});

test("החיפוש נשמר בכתובת ושורד חזרה מפנייה", async ({ page }) => {
  // מנהל שמצא פנייה, נכנס אליה וחזר, חייב למצוא את התוצאות במקומן.
  const stamp = Date.now();
  const description = `דלת לא נסגרת ${stamp}`;

  await login(page);
  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await pick(page, "תחום", "חשמל");
  await page.getByLabel("תיאור").fill(description);
  await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
  await page.getByLabel("שם").fill(`נגר ${stamp}`);
  await page.getByLabel("טלפון").fill(`057-${String(stamp).slice(-7)}`);
  await page.getByRole("button", { name: "שמור איש מקצוע" }).click();
  await expect(page.getByRole("list", { name: "נמענים", exact: true })).toContainText(
    `נגר ${stamp}`,
  );
  await page.getByRole("button", { name: "שלח לנמענים" }).click();
  await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible();

  await page.goto("/search");
  await page.getByLabel("חיפוש", { exact: true }).fill(description);
  await page.getByRole("button", { name: "חפש" }).click();

  const card = page.getByRole("link").filter({ hasText: description });
  await expect(card).toBeVisible();
  await expect(page).toHaveURL(/[?&]q=/);

  await card.click();
  await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("link").filter({ hasText: description })).toBeVisible();
});
