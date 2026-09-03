import { type Page, expect, test } from "@playwright/test";
import { addProfessional, captureWhatsAppRedirects, loginAsManager, pick } from "./helpers";

/**
 * קבלן עם טלפון ובלי מייל — הפער התפעולי החד ביותר שהיה במערכת.
 *
 * המערכת שולחת מייל אוטומטית. קבלן שאין לו מייל **לא קיבל דבר**, והפנייה
 * שלו נראתה בלוח בדיוק כמו פנייה ששוגרה בהצלחה. ההגנה היחידה הייתה שמנהל
 * העבודה יזכור ללחוץ על כפתור הוואטסאפ, ואם שכח — איש לא ידע שהוא שכח.
 *
 * שתי הבדיקות כאן מכסות את שני חצאי הפתרון:
 * 1. **הלשונית נפתחת מעצמה** בשיגור, לנמען הראשון שאין לו מייל.
 * 2. **מי שנשאר מופיע ברשימה** שאינה נעלמת עד שנלחצה — כי חוסם החלונות
 *    הקופצים מתיר לשונית אחת למחווה, ובלי הרשימה השני היה נעלם בשקט.
 */

/** ממלא את השדות המשותפים לשתי הבדיקות */
async function fillTicket(page: Page, description: string): Promise<void> {
  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await pick(page, "תחום", "חשמל");
  await page.getByLabel("תיאור").fill(description);
}

let waRedirects: string[];

test.beforeEach(async ({ page }) => {
  waRedirects = captureWhatsAppRedirects(page);
  await loginAsManager(page);
});

test("נמען יחיד בלי מייל — הוואטסאפ נפתח מעצמו, והשורה מדווחת 'נפתח'", async ({ page }) => {
  const stamp = Date.now();
  await fillTicket(page, `אין חשמל בסלון ${stamp}`);

  const name = `חשמלאי ${stamp}`;
  await addProfessional(page, name, `050-${String(stamp).slice(-7)}`);

  /*
   * ‏`Promise.all` ולא `click()` ואז המתנה: הלשונית נפתחת **בתוך** הלחיצה
   * (זו כל הנקודה — `window.open` מותר רק בזמן טיפול באירוע משתמש), ולכן
   * המאזין חייב להיות מותקן לפניה.
   */
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "שלח לנמענים" }).click(),
  ]);

  // הלשונית נפתחה ריקה בלחיצה וקיבלה יעד כשהתשובה חזרה — היא עוברת דרך
  // ‏`/api/wa/…`, שמתעד את הפתיחה ומפנה ל-`wa.me` עם ההודעה מוכנה.
  await popup.waitForURL(/\/api\/wa\//);
  await expect.poll(() => waRedirects).toHaveLength(1);
  expect(waRedirects[0]).toContain("wa.me/972");
  // ההודעה נושאת את קישור הקסם — זה כל מה שהקבלן צריך כדי להיכנס.
  expect(decodeURIComponent(waRedirects[0] ?? "")).toContain("/p/");

  await expect(page).toHaveURL(/\/tickets\/[a-z0-9]+$/);
  await page.getByRole("button", { name: "פרטים" }).click();

  /*
   * **"נפתח" ולא "נשלח".** ‏`wa.me` פותח שיחה עם הטקסט מוכן; השליחה היא
   * לחיצה נוספת באפליקציה שאין לנו גישה אליה. הטענה השלילית כאן היא
   * העיקר — נוסח שמצהיר על מסירה שלא הוכחה הוא בדיוק מה שמנהל בשטח סומך
   * עליו ואז לא מרים טלפון.
   */
  const recipients = page.getByRole("list", { name: "נמענים" });
  await expect(recipients).toContainText("נפתח בוואטסאפ");
  await expect(recipients).not.toContainText("אין מייל — שלח בוואטסאפ");

  // הנמען טופל, ולכן אין משימה פתוחה.
  await expect(page.getByRole("group", { name: "נותר לשלוח בוואטסאפ" })).toHaveCount(0);
});

test("שני נמענים בלי מייל — השני נשאר ברשימה עד שנשלח אליו", async ({ page }) => {
  const stamp = Date.now();
  await fillTicket(page, `נזילה בשני מקומות ${stamp}`);

  const first = `שרברב ${stamp}`;
  const second = `אינסטלטור ${stamp}`;
  await addProfessional(page, first, `052-${String(stamp).slice(-7)}`);
  await addProfessional(page, second, `053-${String(stamp).slice(-7)}`);

  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "שלח לנמענים" }).click(),
  ]);
  await popup.waitForURL(/\/api\/wa\//);

  await expect(page).toHaveURL(/\/tickets\/[a-z0-9]+$/);

  /*
   * **הפאנל על המסך עצמו, בלי לפתוח "פרטים".** משימה שדורשת פתיחת דיאלוג
   * כדי לגלות שהיא קיימת אינה שונה בהרבה מהמצב שלפני התיקון.
   *
   * **וזו הטענה המרכזית של הפיצ׳ר.** חוסם החלונות הקופצים מתיר לשונית אחת
   * למחווה, ולכן השני לא נפתח — ואם לא הייתה רשימה, הוא היה נעלם בשקט
   * בדיוק כמו לפני התיקון, אלא שהפעם המנהל היה **בטוח** שהמערכת טיפלה.
   */
  const pending = page.getByRole("group", { name: "נותר לשלוח בוואטסאפ" });
  await expect(pending).toBeVisible();
  await expect(pending).toContainText(second);
  await expect(pending).not.toContainText(first);

  const [secondPopup] = await Promise.all([
    page.waitForEvent("popup"),
    pending.getByRole("link", { name: new RegExp(`שלח בוואטסאפ ${second}`) }).click(),
  ]);
  await secondPopup.waitForURL(/\/api\/wa\//);
  // שתי פתיחות בסך הכול: אחת אוטומטית לראשון, ואחת ידנית לשני.
  await expect.poll(() => waRedirects).toHaveLength(2);

  // הרשימה מתרוקנת — הרענון הוא מה שמונע שליחה כפולה לאותו קבלן.
  await expect(pending).toHaveCount(0);
});
