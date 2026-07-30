import { type Page, expect } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";

/**
 * עוזרי E2E משותפים — מקור אמת אחד לפעולות שחוזרות על פני קובצי בדיקה
 * (התחברות, בחירה מ-LearnedSelect, יצירת איש מקצוע). שכפולם בכל spec היה
 * מפזר את הידע על מבנה ה-DOM בכמה מקומות, כך שלשינוי בבורר יידרש עדכון בכל
 * אחד מהם בנפרד.
 */

/** מתחבר כמנהל הראשי ומוודא שהגיע ללוח */
export async function loginAsManager(page: Page): Promise<void> {
  await page.goto("/board");
  if (new URL(page.url()).pathname === "/login") {
    await page.getByLabel("טלפון או מייל").fill(E2E_ADMIN.phone);
    await page.getByLabel("סיסמה").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "כניסה" }).click();
  }
  await expect(page).toHaveURL(/\/board$/);
}

/**
 * פותח את רצועת המסננים אם היא מקופלת.
 *
 * מתחת ל-`md` הרצועה מוסתרת מאחורי מתג, ומעליו היא גלויה ואין מתג. התנאי
 * כאן הוא **נראות המתג** ולא שם הפרויקט — כך הבדיקה מתארת את ההתנהגות
 * האמיתית של המסך, ולא את הגדרות ההרצה.
 *
 * ‏`/^מסננים/` ולא `"מסננים"`: התאמת מחרוזת ב-Playwright היא הכלה, ולכן
 * "נקה מסננים" נתפס גם הוא — והלוקטור מפר את מצב ה-strict.
 */
export async function openFilters(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: /^מסננים/ });

  /**
   * ההמתנה כאן אינה קוסמטית, ושתי דרכים מתבקשות אליה שגויות.
   *
   * רצועת המסננים יושבת בתוך גבול `Suspense`, ולכן היא מגיעה בזרימה שנייה
   * אחרי אירוע ה-load שעליו `goto` ממתין. ל-`isVisible` אין המתנה מובנית,
   * ולכן לבדו הוא החזיר "לא נראה" על אלמנט שטרם הגיע — הפונקציה חזרה בלי
   * לפתוח, והבדיקה נכשלה על בורר מוסתר.
   *
   * ‏`waitFor` על המתג לבדו שגוי בכיוון ההפוך: במסך רחב הוא `display:none`
   * ולכן **אינו בעץ הנגישות כלל**, ו-`getByRole` לא ימצא אותו לעולם —
   * ההמתנה נתקעת עד ל-timeout במקום לדלג.
   *
   * לכן ההמתנה היא ל**רצועה**, דרך שני הביטויים שלה: המתג בנייד, או מסנן
   * הכיוון במסך רחב. `or` נפתר ברגע שאחד מהם נראה, ונכשל בקול אם אף אחד
   * מהם לא הגיע — בניגוד ל-timeout שנבלע.
   */
  const directionFilter = page.getByLabel("הפניתי");
  await toggle.or(directionFilter).first().waitFor();
  if (!(await toggle.isVisible())) return;

  // ‏toHaveAttribute חוזר על עצמו עד שהוא מצליח, ולכן הוא גם ההמתנה
  // להידרציה — לחיצה לפניה לא הייתה מפעילה כלום.
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

/** בוחר אפשרות קיימת מתוך LearnedSelect לפי תווית השדה ושם האפשרות */
export async function pick(page: Page, label: string, option: string): Promise<void> {
  await page
    .getByRole("button", { name: new RegExp(`^${label}`) })
    .first()
    .click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** יוצר איש מקצוע חדש דרך הבורר ומוודא שנוסף לרשימת הנמענים */
export async function addProfessional(page: Page, name: string, phone: string): Promise<void> {
  await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
  await page.getByLabel("שם").fill(name);
  await page.getByLabel("טלפון").fill(phone);
  await page.getByRole("button", { name: "שמור איש מקצוע" }).click();
  await expect(page.getByRole("list", { name: "נמענים", exact: true })).toContainText(name);
}

/**
 * יוצר טיוטה עם בניין ודירה בלבד (חסרים תחום, תיאור ונמענים), ומחזיר את
 * כתובת מסך הפנייה. זהו המצב שמסך ההשלמה נועד לו.
 *
 * ההמתנה ל-`toBeEnabled` אינה קוסמטית: כפתורי המסך מושבתים עד ש-React מחובר
 * (`useHydrated`), ובדיב הקומפילציה הראשונה של הראוט איטית. בלי ההמתנה,
 * ‏Playwright מתקתק על השדות לפני שהמטפלים חוברו — האירועים נבלעים בשקט
 * וההקלדה אובדת. זהו בדיוק החלון שהמשתמש האמיתי (איטי יותר) אינו נתקל בו.
 */
export async function makeMinimalDraft(page: Page): Promise<string> {
  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await page.getByRole("button", { name: "שמור כטיוטה" }).click();
  await expect(page).toHaveURL(/\/tickets\/[a-z0-9]+$/);
  await expect(page.getByRole("button", { name: "שגר", exact: true })).toBeEnabled();
  return new URL(page.url()).pathname;
}
