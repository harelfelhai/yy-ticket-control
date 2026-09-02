import { type Locator, type Page, expect } from "@playwright/test";
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
 * בוחר ערך ברצועת המסננים, וממתין עד שהוא באמת הגיע לכתובת.
 *
 * **הפונקציה הזו החליפה את `openFilters`.** הרצועה אינה מקופלת עוד — מאז
 * סבב הצפיפות היא שורה אחת גלויה בכל רוחב, ואין מתג "מסננים" לפתוח.
 *
 * אבל מה ש-`openFilters` נתן **בדרך אגב** נשאר נדרש: ההמתנה שלו
 * ל-`aria-expanded` שימשה בפועל כמחסום הידרציה. הפקדים מנווטים
 * ב-`onChange` → `router.replace`, ולכן `selectOption` לפני שה-hydration
 * חיברה את המטפלים **נבלע בשקט** — הערך משתנה בדפדפן, הכתובת אינה משתנה,
 * והבדיקה נכשלת על "לא סוננה". זה גם מה שהפך בעבר את בדיקת המסננים
 * ל-flaky בדסקטופ בלבד, שם לא היה מתג ולא הייתה המתנה.
 *
 * לכן הבחירה חוזרת על עצמה עד שהכתובת מכילה את הפרמטר. זו אותה תבנית
 * שהוכיחה את עצמה במסנן התאריכים שהיה, והיא ההמתנה **וגם** הפעולה: אין
 * דרך לוודא ש"הפקד מחובר" בלי לבדוק את התוצאה שהוא אמור לייצר.
 */
export async function applyFilter(
  page: Page,
  label: string,
  option: Parameters<Locator["selectOption"]>[0],
  param: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.getByLabel(label, { exact: true }).selectOption(option);
        return new URL(page.url()).search;
      },
      /*
       * **בלי `timeout` קבוע — הוא יורש מהקונפיג.**
       *
       * הערך שישב כאן היה `15_000`, זהה ל-`expect.timeout` של חבילת ה-E2E
       * — כלומר נכון שם וסמוי. משהעוזר הזה נקרא גם מחבילת ההתאמה, שבה
       * התקציב הוא 25 שניות **מנימוק כתוב** ("קימפול ראשון של Server
       * Action תחת העומס הזה חרג מ-15 שניות"), המספר הקבוע היה נותן דווקא
       * לצעד היחיד שהוא סבב שרת מלא את התקציב הצר ביותר בקובץ.
       *
       * מקור אמת אחד לתקציב, והוא בקונפיג.
       */
      { message: `המסנן ${label} לא הגיע לכתובת` },
    )
    .toContain(`${param}=`);
}

/**
 * מחפש בלוח, וחוזר על הפעולה עד שהמונח באמת הגיע לכתובת.
 *
 * זהו אותו מחסום הידרציה שמתועד ב-`applyFilter`, ובגרסה חריפה יותר: שדה
 * החיפוש יושב ב-`<form>` שהשיגור שלו נעצר ב-`preventDefault` של React.
 * לחיצה **לפני** שההידרציה חיברה את המטפל אינה נבלעת בשקט אלא מפעילה שיגור
 * נייטיב — ולשדה אין `name`, ולכן הדפדפן מנווט ל-`/board` **נקי**. זהו
 * הכשל המסוכן מבין השניים: המסך שמתקבל הוא הלוח המלא, וטענה על "הפנייה
 * מוצגת" מרוצה ממנו — ירוק שלא בדק דבר.
 *
 * ההשוואה היא ל-`searchParams.get("q")` ולא למחרוזת בכתובת: מונחי חיפוש
 * מכילים רווחים, `URLSearchParams` מקודד אותם כ-`+` ו-`encodeURIComponent`
 * כ-`%20`, ושתי הצורות תקינות. הערך המפוענח הוא מה שנבדק.
 */
export async function searchBoard(page: Page, term: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.getByRole("searchbox", { name: "חיפוש" }).fill(term);
        await page.getByRole("button", { name: "חפש" }).click();
        return new URL(page.url()).searchParams.get("q");
      },
      { timeout: 15_000, message: `מונח החיפוש "${term}" לא הגיע לכתובת` },
    )
    .toBe(term);
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

/**
 * תופס את `/api/wa/…` שלנו, בודק לאן הוא מפנה, ועוצר שם.
 *
 * **שני דברים שנלמדו בדרך הקשה:**
 *
 * 1. **אי אפשר ליירט את `wa.me` עצמו.** ‏Playwright אינו מיירט הפניות
 *    שהדפדפן עוקב אחריהן אוטומטית, והבקשה יצאה החוצה בכל מקרה. מה שכן
 *    ניתן ליירוט הוא הנתיב **שלנו** — וזה גם מה שנכון לבדוק: התפקיד שלנו
 *    מסתיים בכתובת שאליה הפנינו.
 * 2. **‏`wa.me` מפנה הלאה ל-`api.whatsapp.com`.** הכתובת הסופית של הלשונית
 *    לעולם אינה `wa.me`, והמתנה לה לא הייתה נגמרת לעולם.
 *
 * ‏`maxRedirects: 0` מריץ את הבקשה האמיתית מול השרת — כלומר התיעוד ב-DB
 * קורה בפועל — ועוצר על ה-302 במקום לעקוב אחריו.
 */
export function captureWhatsAppRedirects(page: Page): string[] {
  const targets: string[] = [];

  void page.context().route("**/api/wa/*", async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    targets.push(response.headers()["location"] ?? "");
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html><body>wa stub</body></html>",
    });
  });

  return targets;
}
