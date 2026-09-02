import { type Page, expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";
import { openDetails, shownText} from "./ticket-screen";

/**
 * המסלול המרכזי של M1: מנהל פותח פנייה מהשטח ומשייך אותה לקבלן.
 *
 * הבדיקה עוברת דרך הממשק האמיתי ולא דרך שכבת השירות, ולכן היא מאמתת גם
 * את מה שבדיקת אינטגרציה לא רואה: שהרשימות הנלמדות באמת נטענות למסך,
 * שיצירת ערך חדש מתעדכנת בבורר בלי רענון, ושהפנייה שנוצרה מוצגת.
 */

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("טלפון או מייל").fill(E2E_ADMIN.phone);
  await page.getByLabel("סיסמה").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "כניסה" }).click();
  await expect(page).toHaveURL(/\/board$/);
}

/** בוחר ערך קיים מתוך בורר רשימה נלמדת */
async function pick(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).first().click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test.describe("יצירת פנייה", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/tickets/new");
  });

  test("טוען את הרשימות הנלמדות של האתר", async ({ page }) => {
    await page.getByRole("button", { name: /^בניין/ }).first().click();
    await expect(page.getByRole("option", { name: "בניין א" })).toBeVisible();
    await expect(page.getByRole("option", { name: "בניין ב" })).toBeVisible();
  });

  test("בחירת בניין פותחת את הדירות שלו בלבד", async ({ page }) => {
    // דירה 7 בבניין א׳ אינה דירה 7 בבניין ב׳ — הרשימה חייבת להיות תלוית בניין.
    await expect(page.getByRole("button", { name: /בחר בניין תחילה/ })).toBeVisible();

    await pick(page, "בניין", "בניין א");
    await page.getByRole("button", { name: /^דירה/ }).first().click();
    await expect(page.getByRole("option")).toHaveCount(3);
  });

  test("אינו מציע ליצור בניין שכבר קיים", async ({ page }) => {
    await page.getByRole("button", { name: /^בניין/ }).first().click();
    await page.getByRole("textbox", { name: "חיפוש בניין" }).fill("בניין א");
    await expect(page.getByRole("button", { name: /צור חדש/ })).toHaveCount(0);
  });

  test("מסלול מלא: פנייה נוצרת, משויכת, ומוצגת עם הסטטוס הנכון", async ({ page }) => {
    const stamp = Date.now();
    const description = `אין חשמל בסלון ${stamp}`;
    const contractorName = `חשמלאי ${stamp}`;
    // טלפון ייחודי לכל ריצה: זיהוי הכפילות בשרת הוא לפי טלפון, ולכן מספר
    // קבוע היה מחזיר בריצה השנייה את הקבלן מהריצה הראשונה — עם השם הישן.
    const contractorPhone = `050-${String(stamp).slice(-7)}`;

    await pick(page, "בניין", "בניין א");
    await pick(page, "דירה", "1");
    await pick(page, "תחום", "חשמל");
    await page.getByLabel("תיאור").fill(description);

    // איש מקצוע חדש נוצר תוך כדי — זו הדרך שבה הרשימה נלמדת בפועל.
    await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
    await page.getByLabel("שם").fill(contractorName);
    await page.getByLabel("טלפון").fill(contractorPhone);
    await page.getByRole("button", { name: "שמור איש מקצוע" }).click();

    await expect(page.getByRole("list", { name: "נמענים" })).toContainText(contractorName);

    await page.getByRole("button", { name: "שלח לנמענים" }).click();

    await expect(page).toHaveURL(/\/tickets\/[a-z0-9]+$/);
    // ‏"שרשור" קיים רק במסך הפנייה — ההמתנה מוודאת שהמסך החדש כבר מוצג,
    // כי הכתובת מתעדכנת לפניו.
    await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("בניין א");
    await expect(shownText(page, description)).toBeVisible();
    // רצועת הנמענים ולא כל העמוד: השם מופיע גם באירוע "שויך לפנייה" בשרשור.
    // הרצועה ירדה לפאנל "פרטים" ב-0.3 (אפיון מסך 2 אזור ב׳).
    await openDetails(page);
    await expect(page.getByRole("list", { name: "נמענים" })).toContainText(contractorName);
    // אף אחד לא צפה עדיין — הסטטוס הנגזר חייב להיות "חדש", והשיוך "נשלח".
    await expect(page.getByText("חדש", { exact: true })).toBeVisible();
    await expect(page.getByText("נשלח", { exact: true })).toBeVisible();
  });

  test("פנייה חסרת שדות נשמרת כטיוטה ולא הולכת לאיבוד", async ({ page }) => {
    const description = `משהו לא עובד ${Date.now()}`;
    await page.getByLabel("תיאור").fill(description);
    await page.getByRole("button", { name: "שלח לנמענים" }).click();

    await expect(page).toHaveURL(/\/tickets\/[a-z0-9]+$/);
    await expect(page.getByText("טיוטה", { exact: true })).toBeVisible();
    await expect(shownText(page, description)).toBeVisible();
  });

  test("איש מקצוע ללא טלפון וללא מייל נדחה עם הסבר", async ({ page }) => {
    await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
    await page.getByLabel("שם").fill("קבלן בלי פרטים");
    await page.getByRole("button", { name: "שמור איש מקצוע" }).click();

    /*
     * מוגבל לפאנל היצירה: כלי הפיתוח של Next מוסיפים role="alert" משלהם.
     *
     * הנוסח היה "לא ניתן לשגר" עד GAP-A5, שהחליף אותו במשפט שבאפיון —
     * "חסר טלפון או מייל — בלעדיהם לא ניתן לשלוח לו את הפנייה." הבדיקה
     * הזו היא היחידה שהחזיקה את הנוסח הישן, והיא נכשלה **רק ב-CI**:
     * ‏`verify` אינו מריץ e2e, וההתאמה בודקת את המחרוזת מ-`spec-text.ts`
     * ולא את זו שהוחלפה.
     *
     * מחצית המשפט ולא כולו: הנוסח המלא נאכף בחבילת ההתאמה מול האפיון
     * (‏`PROH-20`), וכפילות שלו כאן הייתה מייצרת מקום שני לתחזק.
     */
    await expect(
      page.getByRole("alert").filter({ hasText: "חסר טלפון או מייל" }),
    ).toBeVisible();
  });
});
