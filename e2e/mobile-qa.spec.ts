import { type Locator, type Page, expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";
import { pick } from "./helpers";

/**
 * QA רוחבי אוטומטי: כיווניות (RTL), היעדר גלישה אופקית, וגדלי מגע.
 *
 * מה שכאן **אינו** מחליף: בדיקה על מכשיר פיזי אמיתי (iPhone Safari, Android
 * Chrome) בתנאי שטח (שמש, כפפות). זו נשארת בדיקה ידנית שתלויה בפריסה. מה
 * שכן: הבדיקות רצות גם תחת מנוע WebKit (פרויקט safari-qa), הקירוב הקרוב
 * ביותר ל-iOS Safari, וכך תופסות פערי רינדור שדפדפן Chromium לבדו מפספס.
 *
 * גודל המגע: 44px הוא המינימום של Apple ושל WCAG 2.5.5 — היעד הקטן ביותר
 * שאפשר להקיש עליו באמינות עם אצבע, קל וחומר בכפפה או בשמש.
 */

/**
 * **רצפה אחת לשלושת הפרויקטים — 28px.**
 *
 * הקובץ רץ על `mobile` (Pixel 5), `safari-qa` (iPhone 13) ו-`desktop`,
 * ועד 0.7 שאל כל אחד מהם בשאילתת מדיה אם הוא מכשיר מגע: כן → 44px,
 * לא → 28px. הרצפה המותנית בוטלה בהכרעת בעל המוצר, וכל שלושת הפרויקטים
 * מודדים עכשיו מול אותו מספר.
 *
 * ‏**השם `MIN_POINTER_FINE_PX` נשמר בכוונה** — `layout-guards.test.ts`
 * מאתר אותו לפי השם וגוזר את ערכו מ-`compact` שב-`button.tsx`, כך
 * ששינוי גובה בפרימיטיב אינו יכול להשאיר את חבילות המדידה מאחור.
 */
const MIN_POINTER_FINE_PX = 28;

/** גלישה אופקית: התוכן לא אמור לחרוג מרוחב המסך. סובלנות של 2px לעיגול תת-פיקסלי. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "יש גלישה אופקית מעבר לרוחב המסך").toBeLessThanOrEqual(2);
}

async function expectRtl(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
}

/** גובה יעד הלחיצה — נמדד מתיבת התוחם בפועל, לא מ-CSS */
async function expectTouchTarget(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const floor = MIN_POINTER_FINE_PX;
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.height ?? 0, `יעד הלחיצה קטן מ-${floor}px`).toBeGreaterThanOrEqual(floor);
}

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/board");
  if (new URL(page.url()).pathname === "/login") {
    await page.getByLabel("טלפון או מייל").fill(E2E_ADMIN.phone);
    await page.getByLabel("סיסמה").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "כניסה" }).click();
  }
  await expect(page).toHaveURL(/\/board$/);
}

test("מסך ההתחברות: RTL, בלי גלישה, וגדלי מגע", async ({ page }) => {
  await page.goto("/login");

  await expectRtl(page);
  await expectNoHorizontalOverflow(page);

  // המסך העיקרי בשטח: השדות והכפתור חייבים להיות נוחים להקשה.
  await expectTouchTarget(page.getByLabel("טלפון או מייל"));
  await expectTouchTarget(page.getByLabel("סיסמה"));
  await expectTouchTarget(page.getByRole("button", { name: "כניסה" }));
});

test("הלוח: RTL ובלי גלישה אופקית", async ({ page }) => {
  await loginAsAdmin(page);
  await expectRtl(page);
  await expectNoHorizontalOverflow(page);
});

/**
 * **‏`<textarea>` מעולם לא נמדד באף חבילה, וזה איך תיבת הכתיבה ירדה מתחת
 * לרצפת המגע בלי שאיש ידע.**
 *
 * ‏`rtl-mobile.spec.ts` סורק `main button, main a` — כלומר כפתורים
 * וקישורים בלבד. תיבת הכתיבה בקומפוזר יושבת מחוץ לסריקה הזו, גובהה נכתב
 * מ-`scrollHeight` ולא ממחלקה, ורצפת ה-`min-h` שעליה לא נגעה כלל. היא
 * ישבה על ‏≈43.6px במגע — מתחת ל-44 — וכל 941 בדיקות היחידה היו ירוקות.
 *
 * ‏0.6 הפך את הגובה הזה לכלל (§ שורת ההקלטה: התיבה והכפתורים באותו גובה);
 * הבדיקה הזו הופכת אותו למדוד.
 */
test("תיבת הכתיבה בשרשור עומדת ברצפת המגע", async ({ page }) => {
  await loginAsAdmin(page);

  /*
   * **הפנייה נוצרת כאן ואינה נבחרת מהלוח.**
   *
   * הניסוח הראשון לחץ על הקישור הראשון בלוח והמתין ל-`region` של השרשור.
   * הוא נכשל בשלושת המכשירים, ומסיבה שכדאי לזכור: הסקציה **קיימת ואינה
   * גלויה** — פנייה בלי תיאור ובלי הודעות מרנדרת `<ul>` ריק, כלומר אלמנט
   * בגובה אפס. Playwright קורא לזה `hidden`, וההודעה ("resolved to
   * `<section>` … unexpected value hidden") אינה מרמזת שהבעיה היא בתוכן.
   *
   * זהו הדפוס שכל שאר החבילה משתמשת בו ממילא: יוצרים פנייה עם תיאור —
   * שהוא **ההודעה הראשונה בשרשור** — ולכן יש מה לראות.
   */
  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await page.getByLabel("תיאור").fill(`רצפת מגע ${Date.now()}`);
  await page.getByRole("button", { name: "שמור כטיוטה" }).click();

  // ההמתנה היא על התיבה עצמה ולא על אזור עוטף: היא מה שנמדד, והיא גם
  // מה שמעיד שהמסך נטען.
  await expect(page.getByLabel("תגובה")).toBeVisible({ timeout: 30_000 });
  await expectTouchTarget(page.getByLabel("תגובה"));

  /*
   * **התיבה והכפתורים חולקים תחתית, ולא רק גובה.**
   *
   * זה נמצא בעין ולא באוכף, וזו הנקודה: שלושת האלמנטים היו בגובה **זהה
   * לחלוטין** (44.0px), ולכן כל טענה על `height` עברה בירוק — אבל תחתית
   * התיבה ישבה ב-357 מול 364 של הכפתורים. הסיבה: `<textarea>` הוא
   * `inline-block` עם `vertical-align: baseline`, והדפדפן משאיר מתחתיו
   * מרווח קו-בסיס.
   *
   * ‏7px זה מה שהעין קולטת כ"לא באותו גובה", ואף בדיקה במערכת לא הסתכלה
   * על `y`. מכאן והלאה — כן.
   */
  const bottoms = await Promise.all(
    [
      page.getByLabel("תגובה"),
      page.getByRole("button", { name: "צירוף", exact: true }),
      page.getByRole("button", { name: "הקלט" }),
    ].map(async (loc) => {
      const box = await loc.boundingBox();
      return Math.round((box?.y ?? 0) + (box?.height ?? 0));
    }),
  );

  expect(
    new Set(bottoms).size,
    `שורת ההקלטה אינה מיושרת לתחתית — תיבה/צירוף/הקלט: ${bottoms.join(" · ")}`,
  ).toBe(1);
});

test("מסך יצירת פנייה: RTL ובלי גלישה אופקית", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/tickets/new");

  await expectRtl(page);
  await expectNoHorizontalOverflow(page);
});

test("פורטל הקבלן (קישור לא תקף): RTL ובלי גלישה", async ({ page }) => {
  // גם מסך השגיאה של הפורטל נצפה בשטח, ולכן נבדק.
  await page.goto("/p/lo-kayam");
  await expectRtl(page);
  await expectNoHorizontalOverflow(page);
});
