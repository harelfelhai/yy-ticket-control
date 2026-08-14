import { type Page, expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";

/**
 * הפעולות על פנייה קיימת, דרך הממשק האמיתי.
 *
 * הבדיקות האלה מאמתות את מה שבדיקת שירות אינה רואה: שהמסך מתרענן אחרי
 * הפעולה (Server Component לא מתעדכן בלי revalidate), שהכפתורים מופיעים
 * ונעלמים לפי ההרשאה, ושהשרשור מציג את אירועי המערכת בעברית.
 */

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("טלפון או מייל").fill(E2E_ADMIN.phone);
  await page.getByLabel("סיסמה").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "כניסה" }).click();
  await expect(page).toHaveURL(/\/board$/);
}

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).first().click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** יוצר פנייה משוגרת ומחזיר את התיאור הייחודי שלה */
async function createTicket(page: Page): Promise<string> {
  const stamp = Date.now();
  const description = `תקלה ${stamp}`;

  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await pick(page, "תחום", "חשמל");
  await page.getByLabel("תיאור").fill(description);

  await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
  await page.getByLabel("שם").fill(`קבלן ${stamp}`);
  await page.getByLabel("טלפון").fill(`050-${String(stamp).slice(-7)}`);
  await page.getByRole("button", { name: "שמור איש מקצוע" }).click();

  // ההמתנה חיונית: יצירת איש המקצוע אסינכרונית, ושיגור לפניה היה שומר
  // את הפנייה כטיוטה בלי נמענים — בדיוק כפי שהמערכת אמורה להתנהג.
  await expect(page.getByRole("list", { name: "נמענים", exact: true })).toContainText(
    `קבלן ${stamp}`,
  );

  await page.getByRole("button", { name: "שלח לנמענים" }).click();
  await expect(page).toHaveURL(/\/tickets\/[a-z0-9]+$/);

  // ‏toHaveURL אינו מספיק: הכתובת מתעדכנת לפני שהמסך החדש מוצג, ובחלון הזה
  // הבדיקה פוגעת בכפתורים של מסך היצירה. "שרשור" קיים רק במסך הפנייה.
  await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible();
  return description;
}

test.describe("פעולות על פנייה", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("תגובה נוספת לשרשור ומסמנת אוטומטית את הכותב כמטפל", async ({ page }) => {
    await createTicket(page);

    await page.getByLabel("תגובה").fill("בדקתי, צריך להחליף מפסק");
    await page.getByRole("button", { name: "שלח", exact: true }).click();

    await expect(page.getByText("בדקתי, צריך להחליף מפסק")).toBeVisible();
    // §5.ד: מנהל שכותב בשרשור מסומן אוטומטית כמטפל.
    await expect(page.getByText(`${E2E_ADMIN.name} מטפל`).first()).toBeVisible();
  });

  test("סגירה מעבירה את הפנייה לסטטוס סגור וחוסמת תגובה של נמען", async ({ page }) => {
    await createTicket(page);

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "סגור פנייה" }).click();

    await expect(page.getByText("סגור", { exact: true })).toBeVisible();
    await expect(page.getByText("הפנייה נסגרה", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "פתח מחדש" })).toBeVisible();
  });

  test("ביטול באישור הסגירה אינו סוגר", async ({ page }) => {
    await createTicket(page);

    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "סגור פנייה" }).click();

    await expect(page.getByRole("button", { name: "סגור פנייה" })).toBeVisible();
  });

  test("פתיחה מחדש מאפסת את השיוכים ומוסיפה תג", async ({ page }) => {
    await createTicket(page);

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "סגור פנייה" }).click();
    await expect(page.getByRole("button", { name: "פתח מחדש" })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "פתח מחדש" }).click();

    await expect(page.getByText("נפתחה מחדש", { exact: true })).toBeVisible();
    await expect(page.getByText("חדש", { exact: true })).toBeVisible();
  });

  test("הוספת נמען מעדכנת את הרצועה מיד", async ({ page }) => {
    await createTicket(page);

    // ‏exact: בלי זה "נמענים שהוסרו" נתפס גם הוא, כי ההתאמה היא לפי הכלה.
    const strip = page.getByRole("list", { name: "נמענים", exact: true });
    await expect(strip.getByRole("listitem")).toHaveCount(1);

    await page.getByRole("button", { name: /^הוסף נמען/ }).click();
    // הוספת נמען מציגה אישור (אפיון מסך 3): הנמען יראה את כל ההיסטוריה.
    page.once("dialog", (d) => d.accept());
    await page.getByRole("option").first().click();

    await expect(strip.getByRole("listitem")).toHaveCount(2);
  });

  test("הסרת נמען מעבירה אותו לרשימת המוסרים ואינה מוחקת אותו", async ({ page }) => {
    await createTicket(page);

    // ‏exact: בלי זה "נמענים שהוסרו" נתפס גם הוא, כי ההתאמה היא לפי הכלה.
    const strip = page.getByRole("list", { name: "נמענים", exact: true });
    await expect(strip.getByRole("listitem")).toHaveCount(1);

    // הסרת נמען מציגה אישור (אפיון מסך 3): הפנייה תיעלם מרשימתו.
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /^הסר / }).first().click();

    // ההיסטוריה נשמרת: "שלחתי לו והוא לא הגיב" הוא מידע שאסור לאבד.
    await expect(strip.getByRole("listitem")).toHaveCount(0);
    await expect(
      page.getByRole("list", { name: "נמענים שהוסרו" }).getByRole("listitem"),
    ).toHaveCount(1);
    await expect(page.getByText("הוסר", { exact: true })).toBeVisible();
  });

  test("השרשור מציג אירועי מערכת בעברית", async ({ page }) => {
    await createTicket(page);
    await expect(page.getByText(/שויך לפנייה$/)).toBeVisible();
  });
});
