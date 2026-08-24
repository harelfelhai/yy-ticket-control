import { type Page, expect, test } from "@playwright/test";
import { addProfessional, loginAsManager, pick, searchBoard } from "./helpers";
import { shownText } from "./ticket-screen";

/**
 * החיפוש (מסך 9) — **בתוך הלוח, ולא במסך משלו.**
 *
 * מאז סבב הצפיפות אין `/search`: החיפוש הוא שדה ברצועת המסננים של הלוח,
 * והתוצאות מחליפות את שלוש הקבוצות ברשימה שטוחה. הסיבה מתועדת ב-
 * `board/page.tsx`: הקיבוץ עונה על "אצל מי הכדור", ובחיפוש השאלה היא
 * "איפה ראיתי את זה" — ופנייה סגורה שתואמת הייתה נוחתת בארכיון המקופל,
 * כלומר המשתמש מחפש, יש התאמה, והוא רואה מסך ריק.
 *
 * הבדיקה מתמקדת במה שהמנהל עושה בפועל: הוא זוכר מילה מתוך הפנייה, לא את
 * מספרה. לכן החיפוש חייב למצוא גם לפי מה שנכתב בשרשור ולא רק לפי התיאור.
 *
 * **מה שהיה כאן ואינו כאן.** בקובץ ישבה בדיקת מסנן התאריכים — הבדיקה
 * הראשונה אי-פעם על רצועת המסננים. פקדי התאריך ירדו יחד עם המסך הנפרד
 * (§3.6 מונה חמישה מסננים, ותאריכים מעולם לא היו בהם), אבל **הטענה**
 * שאותה בדיקה החזיקה — שהערך שנבחר בפקד מגיע לכתובת ומשם לשאילתה בשרת —
 * אינה תלויה בשדה מסוים, והיא חיה כעת ב-`board.spec.ts`
 * ("מסנן הבניין משמיט פניות שאינן שלו"). היא הועברה, לא נמחקה.
 */

/** יוצר פנייה משוגרת עם נמען חדש, ומחזיר את התיאור הייחודי שלה */
async function createSentTicket(page: Page, text: string, prefix: string): Promise<string> {
  const stamp = Date.now();
  const description = `${text} ${stamp}`;

  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await pick(page, "תחום", "חשמל");
  await page.getByLabel("תיאור").fill(description);
  await addProfessional(page, `${prefix} ${stamp}`, `05${prefix.length}-${String(stamp).slice(-7)}`);
  await page.getByRole("button", { name: "שלח לנמענים" }).click();
  await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible();

  return description;
}

test("חיפוש בלוח מוצא פנייה לפי התיאור ולפי מה שנכתב בשרשור", async ({ page }) => {
  await loginAsManager(page);
  const description = await createSentTicket(page, "רטיבות בממ״ד", "קבלן");
  const reply = `הצנרת מאחורי הקיר ${Date.now()}`;

  await page.getByLabel("תגובה").fill(reply);
  await page.getByRole("button", { name: "שלח", exact: true }).click();
  // ‏shownText: `getByText` היה נפתר על תיבת הכתיבה ולא ממתין לשרת.
  await expect(shownText(page, reply)).toBeVisible();

  // ── השדה יושב בלוח, ואין אליו יעד ניווט נפרד ──────────────────────
  await page.goto("/board");
  await expect(page.getByRole("searchbox", { name: "חיפוש" })).toBeVisible();
  // הטענה השלילית היא מה ששומר על האיחוד: חיפוש שיחזור להיות מסך משלו
  // יחזיר גם את הקבוצות שהתוצאות נועדו להחליף.
  await expect(page.getByRole("navigation").getByRole("link", { name: "חיפוש" })).toHaveCount(0);

  // בלי מונח הלוח הוא הלוח — שלוש קבוצות, לא רשימת תוצאות.
  await expect(page.getByRole("heading", { name: /^אצל הנמענים/ })).toBeVisible();

  // ── חיפוש לפי התיאור ──────────────────────────────────────────────
  await searchBoard(page, description);
  await expect(page.getByRole("link").filter({ hasText: description })).toBeVisible();
  // מונה התוצאות אינו קישוט: רשימה שטוחה בלי מספר אינה אומרת אם זו כל
  // התשובה או תחילתה.
  await expect(page.getByText(/\d+ תוצאות/)).toBeVisible();
  // והקיבוץ נעלם — התוצאות **מחליפות** את הלוח ולא נדחפות מעליו.
  await expect(page.getByRole("heading", { name: /^אצל הנמענים/ })).toHaveCount(0);

  // ── חיפוש לפי מה שנכתב בשרשור ─────────────────────────────────────
  await searchBoard(page, reply);
  await expect(page.getByRole("link").filter({ hasText: description })).toBeVisible();

  // ── מונח שאינו קיים ───────────────────────────────────────────────
  await searchBoard(page, `אלומיניום ${Date.now()}`);
  await expect(page.getByText("לא נמצאו פניות")).toBeVisible();
});

test("החיפוש נשמר בכתובת ושורד חזרה מפנייה", async ({ page }) => {
  // מנהל שמצא פנייה, נכנס אליה וחזר, חייב למצוא את התוצאות במקומן.
  await loginAsManager(page);
  const description = await createSentTicket(page, "דלת לא נסגרת", "נגר");

  await page.goto("/board");
  await searchBoard(page, description);

  const card = page.getByRole("link").filter({ hasText: description });
  await expect(card).toBeVisible();
  await expect(page).toHaveURL(/[?&]q=/);

  await card.click();
  await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("link").filter({ hasText: description })).toBeVisible();
  /*
   * והשדה עצמו מציג שוב את המונח. זו טענה נפרדת מהתוצאות: הסנכרון של
   * ‏`BoardSearch` לכתובת נעשה ברינדור בדיוק בשביל המסלול הזה — שדה ריק
   * מעל רשימה מסוננת קורא כאילו הרשימה היא הלוח המלא.
   */
  await expect(page.getByRole("searchbox", { name: "חיפוש" })).toHaveValue(description);
});

test("הכתובת /search הישנה מגיעה ללוח עם אותו מונח", async ({ page }) => {
  /*
   * ‏`/search` הפך לבדל הפניה ולא נמחק, כי הכתובת יצאה החוצה: קישורים
   * שנשלחו בוואטסאפ וסימניות של מנהלים. הבדיקה כאן שומרת על ההבטחה הזו —
   * ‏404 במקומה נקרא כשבירה ולא כמעבר.
   */
  await loginAsManager(page);
  const term = `מחט ${Date.now()}`;

  await page.goto(`/search?q=${encodeURIComponent(term)}`);
  await expect(page).toHaveURL(/\/board\?/);
  expect(new URL(page.url()).searchParams.get("q")).toBe(term);

  // וגם בלי מונח — הבדל מגיע ללוח נקי ולא ל-404.
  await page.goto("/search");
  await expect(page).toHaveURL(/\/board$/);
});
