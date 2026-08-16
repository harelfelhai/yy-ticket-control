import { type Page, expect } from "@playwright/test";

/**
 * עוזרי מסך הפנייה, משותפים לחבילת ה-E2E.
 *
 * הקובץ נוצר בגרסה 0.3, כשהמטא-דאטה של הפנייה — הנמענים, התגיות, שם הדייר
 * והמחיקה — ירדה לפאנל `<details>` מקופל. עד אז כל spec החזיק עותק משלו של
 * ‏`recipientRow`, וזה עבד כל עוד לא היה מה לתאם ביניהם.
 */

/**
 * טקסט כפי שהוא **מוצג על המסך** — ולא כפי שהוא יושב בתוך פקד קלט.
 *
 * ‏`getByText(x)` מתאים גם `<textarea>` שערכו `x`, ולכן טענה כזו אחרי
 * ‏`fill(x)` נפתרת מיד עם ההקלדה ואינה ממתינה לשרת; הצעד הבא מתחרה אז
 * בכתיבה שטרם נחתה.
 *
 * הנימוק המלא והמדידה שהוכיחה אותו — `conformance/fixtures/world.ts`.
 */
export function shownText(page: Page, text: string) {
  return page.getByText(text).and(page.locator(":not(textarea):not(input)"));
}

/**
 * פותח את דיאלוג "פרטים", אם אינו כבר פתוח.
 *
 * **זו נקודת החנק היחידה.** 26 אתרי קריאה בשתי חבילות הבדיקה מגיעים
 * לנמענים ולתגיות דרך הפונקציה הזו, וזו הסיבה שהמעבר מ-`<details>`
 * לדיאלוג ב-0.4 נגע בהגדרה אחת ולא בעשרים ושישה קבצים.
 *
 * **מה השתנה, וזו דווקא הקלה.** קודם היה כאן `<details>`, שהדפדפן מסיר את
 * תוכנו הסגור מעץ הנגישות — כלומר `getByRole` תחתיו נפתר לאפס אלמנטים,
 * ו-`toHaveCount(0)` הפך ירוק-שקר. דיאלוג סגור פשוט **אינו מרונדר**, ולכן
 * ההבחנה בין "לא קיים" ל"קיים ומוסתר" חוזרת להיות אמיתית.
 *
 * **בטיוטה אין דיאלוג ואין כפתור** — מסך ההשלמה פרוש על המסך, וכל מה
 * שהבדיקה מחפשת כבר גלוי. לכן הפונקציה יוצאת בשקט במקום להיכשל.
 *
 * אידמפוטנטית: קריאה שנייה כשהדיאלוג כבר פתוח אינה סוגרת אותו.
 */
export async function openDetails(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "פרטים" });
  if (await dialog.isVisible()) return;

  /*
   * **קודם ממתינים שמסך הפנייה ירונדר, ורק אז שואלים אם יש כפתור.**
   *
   * ‏`count() === 0` אחרי ניווט פירושו לרוב "העמוד עוד לא כאן", ולא "אין
   * כפתור". בלי ההמתנה הזו הפונקציה יצאה בשקט, הבדיקה המשיכה למסך סגור,
   * ונפלה 60 שניות מאוחר יותר על כפתור שנמצא בתוך הפאנל. זו בדיוק המחלה
   * ש-`harness-guards` נכתב בגללה: תנאי מגודר שמדלג בלי לומר.
   *
   * ‏`region "שרשור"` הוא העוגן: הוא קיים בכל מסך פנייה, גם בטיוטה.
   */
  await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible({ timeout: 30_000 });

  const trigger = page.getByRole("button", { name: "פרטים", exact: true });
  // רק עכשיו ההיעדר משמעותי: בטיוטה אין כפתור, והתוכן פרוש על המסך.
  if ((await trigger.count()) === 0) return;

  /*
   * ‏`toPass` ולא לחיצה אחת, וזה **הבדל אמיתי מ-`<details>`**.
   *
   * הפאנל הקודם היה HTML נייטיב: הוא נפתח גם לפני שה-JavaScript נטען.
   * הדיאלוג הוא רכיב לקוח, ולחיצה שמגיעה לפני ה-hydration פוגעת בכפתור
   * שעדיין אין לו מאזין — כלומר "נלחצת" ולא קורה דבר. הבדיקה נפלה בדיוק
   * כך אחרי ניווט, והצילום הראה את המסך עם הכפתור ובלי הדיאלוג.
   */
  await expect(async () => {
    if (!(await dialog.isVisible())) await trigger.click();
    await expect(dialog).toBeVisible({ timeout: 2_000 });

    /*
     * **ונשאר פתוח.** הפתיחה לבדה אינה מספיקה: מצב הדיאלוג חי ברכיב
     * לקוח, ותגובת RSC שנוחתת אחרי הניווט מרכיבה אותו מחדש ומאפסת אותו —
     * כלומר הפאנל נסגר מעצמו רגע אחרי שנפתח. ההמתנה הקצרה נותנת לעמוד
     * להתייצב, והטענה השנייה מחזירה את הלולאה לפתיחה נוספת אם נסגר.
     */
    await page.waitForTimeout(300);
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

/** סוגר את דיאלוג "פרטים", כדי לגשת למה שמאחוריו (הכיסוי לוכד את המשתמש). */
export async function closeDetails(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "פרטים" });
  if (!(await dialog.isVisible())) return;

  await dialog.getByRole("button", { name: "סגור", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

/** שורת נמען ברצועת הנמענים. דורש פאנל פתוח — ראו `openDetails`. */
export function recipientRow(page: Page, name: string) {
  return page
    .getByRole("list", { name: "נמענים", exact: true })
    .getByRole("listitem")
    .filter({ hasText: name });
}

/**
 * מציג את קישור הפורטל של קבלן מתוך מסך הפנייה ומחזיר אותו כנתיב יחסי.
 *
 * ההמתנה היא לכותרת שנושאת את שם הנמען, ולא רק לתיבה: בפנייה עם כמה
 * קבלנים התיבה כבר גלויה עם הקישור הקודם, וקריאה מוקדמת הייתה מחזירה
 * את הקישור של הקבלן הקודם.
 */
export async function showLink(
  page: Page,
  contractorName: string,
  /**
   * להשאיר את הדיאלוג פתוח.
   *
   * נדרש למי שממשיך **בתוך** הפאנל — "צור קישור חדש" ו"שלח שוב במייל"
   * יושבים בתוך תיבת הקישור שנחשפה כאן. סגירה ופתיחה מחדש היו מאפסות את
   * החשיפה, והכפתור לא היה נמצא. ברירת המחדל היא סגירה, כי היא הבטוחה:
   * כיסוי שנשאר פרוש חוסם את שאר המסך.
   */
  options: { keepOpen?: boolean } = {},
): Promise<string> {
  await openDetails(page);
  await recipientRow(page, contractorName)
    .getByRole("button", { name: `קישור גישה ${contractorName}` })
    .click();

  await expect(page.getByText(`קישור עבור ${contractorName}`)).toBeVisible({ timeout: 45_000 });
  const field = page.getByRole("textbox", { name: "קישור גישה", exact: true });
  const link = (await field.inputValue()).replace(/^https?:\/\/[^/]+/, "");

  /*
   * **הדיאלוג נסגר לפני החזרה, וזה אינו ניקיון בעלמא.**
   *
   * עד 0.4 ישב כאן `<details>` פתוח, שאינו חוסם דבר. דיאלוג לוכד את
   * המשתמש בכוונה — הכיסוי מכסה את המסך — ולכן כל קורא שהמשיך לקומפוזר
   * או ל"סגור פנייה" אחרי `showLink` נתקע על
   * `overlay intercepts pointer events`. הסגירה מרוכזת כאן מאותה סיבה
   * שהפתיחה מרוכזת: כלל שצריך לזכור בעשרים מקומות יישכח באחד מהם.
   */
  if (!options.keepOpen) await closeDetails(page);
  return link;
}
