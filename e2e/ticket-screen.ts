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
 * פותח את פאנל "פרטים", אם הוא סגור.
 *
 * **למה זה נדרש.** הדפדפן מסיר תוכן של `<details>` סגור מעץ הנגישות, ולכן
 * ‏`getByRole` תחתיו נפתר ל**אפס** אלמנטים: לא רק ש-`click` נכשל, גם
 * ‏`toHaveCount(0)` הופך ירוק-שקר.
 *
 * אידמפוטנטי בכוונה: בטיוטה הפאנל פתוח מהשרת, ולחיצה הייתה סוגרת אותו.
 */
export async function openDetails(page: Page): Promise<void> {
  const summary = page.locator("summary", { hasText: "פרטים" });
  const details = page.locator("details", { has: summary });
  await expect(details).toBeVisible();

  /*
   * ‏`toPass` ולא בדיקה חד-פעמית: `open` נגזר מ-`isDraft` **בשרת**, ולכן
   * שיגור טיוטה סוגר את הפאנל בזמן ה-re-render. בדיקה שרצה רגע לפני
   * הסגירה הייתה רואה אותו פתוח, חוזרת, ומשאירה אותו סגור בפועל.
   */
  await expect(async () => {
    const isOpen = () => details.evaluate((el) => (el as HTMLDetailsElement).open);
    if (!(await isOpen())) await summary.click();
    expect(await isOpen()).toBe(true);
  }).toPass({ timeout: 15_000 });
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
export async function showLink(page: Page, contractorName: string): Promise<string> {
  await openDetails(page);
  await recipientRow(page, contractorName)
    .getByRole("button", { name: `קישור גישה ${contractorName}` })
    .click();

  await expect(page.getByText(`קישור עבור ${contractorName}`)).toBeVisible({ timeout: 45_000 });
  const field = page.getByRole("textbox", { name: "קישור גישה", exact: true });
  return (await field.inputValue()).replace(/^https?:\/\/[^/]+/, "");
}
