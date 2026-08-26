import { expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";

/**
 * מסלול ההתחברות מקצה לקצה, במסלול האמיתי: טופס → Server Action → עוגייה
 * מוצפנת → מסך מוגן. הבדיקות האלה תופסות דברים שבדיקת יחידה לא יכולה,
 * כמו הגנת ה-proxy והחזרה ליעד המקורי אחרי התחברות.
 */

async function login(page: import("@playwright/test").Page, password = E2E_ADMIN.password) {
  await page.getByLabel("טלפון או מייל").fill(E2E_ADMIN.phone);
  await page.getByLabel("סיסמה").fill(password);
  await page.getByRole("button", { name: "כניסה" }).click();
}

test.describe("התחברות", () => {
  test("משתמש לא מחובר שמנסה להגיע ללוח מופנה להתחברות", async ({ page }) => {
    await page.goto("/board");
    await expect(page).toHaveURL(/\/login/);
  });

  test("פרטים נכונים מכניסים ללוח", async ({ page }) => {
    await page.goto("/login");
    await login(page);

    await expect(page).toHaveURL(/\/board$/);
    await expect(page.getByRole("banner")).toContainText(E2E_ADMIN.name);
  });

  test("פרטים שגויים מציגים שגיאה ואינם מכניסים", async ({ page }) => {
    await page.goto("/login");
    await login(page, "סיסמה שגויה");

    // מוגבל לטופס: כלי הפיתוח של Next מוסיפים role="alert" משלהם לעמוד.
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "פרטי ההתחברות אינם נכונים",
    );
    await expect(page).toHaveURL(/\/login/);
  });

  test("אחרי התחברות המשתמש חוזר למסך שאליו ניסה להגיע", async ({ page }) => {
    // תרחיש אמיתי: קישור שנשלח בוואטסאפ נפתח אחרי שהסשן פג.
    await page.goto("/board");
    await expect(page).toHaveURL(/next=%2Fboard/);

    await login(page);
    await expect(page).toHaveURL(/\/board$/);
  });

  test("יציאה מנתקת ומחזירה למסך ההתחברות", async ({ page }) => {
    await page.goto("/login");
    await login(page);
    await expect(page).toHaveURL(/\/board$/);

    await page.getByRole("button", { name: "יציאה" }).click();
    await expect(page).toHaveURL(/\/login/);

    // אימות אמיתי שהסשן נהרס, ולא רק שהדפדפן ניווט.
    await page.goto("/board");
    await expect(page).toHaveURL(/\/login/);
  });

  test("משתמש מחובר שמגיע למסך ההתחברות מועבר ללוח", async ({ page }) => {
    await page.goto("/login");
    await login(page);
    await expect(page).toHaveURL(/\/board$/);

    await page.goto("/login");
    await expect(page).toHaveURL(/\/board$/);
  });
});

/**
 * השבתת עובד — הפעולה השגרתית ביותר במסך הניהול — במסלול המלא ובשני
 * דפדפנים: מנהל שמשבית, ועובד שכבר מחובר.
 *
 * הבדיקה קיימת בגלל תקלה אמיתית: `requireUser` מחק את הסשן בתוך רינדור,
 * ‏Next אוסר כתיבת עוגייה בשלב הזה, והחריגה החליפה את ההפניה למסך ההתחברות
 * ב-500. העובד המושבת לא "הוצא החוצה" — **המערכת כולה נפלה עבורו**, בכל מסך.
 *
 * ולכן נבדק כאן קוד התשובה ולא רק הכתובת: הפניה למסך ההתחברות ו-500 נראים
 * דומה בצילום מסך, והבדיקה חייבת להבחין ביניהם.
 */
test("עובד שהושבת מוחזר למסך ההתחברות, ואינו מקבל שגיאת שרת", async ({ page, browser }) => {
  const stamp = Date.now();
  const employeeName = `עובד להשבתה ${stamp}`;
  const employeePhone = `054${String(stamp).slice(-7)}`;
  const employeePassword = "sod-chazak-456";

  // ── המנהל מקים את העובד ────────────────────────────────────────────
  await page.goto("/board");
  if (new URL(page.url()).pathname === "/login") await login(page);
  await expect(page).toHaveURL(/\/board$/);

  // ‏0.7: ההקמה נפתחת מכפתור שצמוד לכותרת, והשדות בדיאלוג.
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "הוסף משתמש חדש" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("שם", { exact: true }).fill(employeeName);
  await form.getByLabel("טלפון").fill(employeePhone);
  await form.getByLabel("אתר").selectOption({ label: "אתר לדוגמה" });
  await form.getByLabel("סיסמה ראשונית").fill(employeePassword);
  await form.getByRole("button", { name: "הוסף משתמש", exact: true }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole("button", { name: employeeName, exact: true })).toBeVisible();

  // ── העובד מתחבר בדפדפן נפרד ומגיע ללוח ─────────────────────────────
  const employeeContext = await browser.newContext();
  const employeePage = await employeeContext.newPage();
  try {
    await employeePage.goto("/login");
    await employeePage.getByLabel("טלפון או מייל").fill(employeePhone);
    await employeePage.getByLabel("סיסמה").fill(employeePassword);
    await employeePage.getByRole("button", { name: "כניסה" }).click();
    await expect(employeePage).toHaveURL(/\/board$/);

    // ── המנהל משבית אותו בזמן שהוא מחובר ─────────────────────────────
    //
    // ‏0.7: ההשבתה ירדה מהשורה לדיאלוג הפרטים שנפתח בלחיצה על הכרטיס.
    await page.getByRole("button", { name: employeeName, exact: true }).click();
    const details = page.getByRole("dialog");
    await details.getByRole("button", { name: "השבת" }).click();
    await expect(details.getByRole("button", { name: "הפעל" })).toBeVisible();
    await details.getByRole("button", { name: "סגור", exact: true }).click();

    // ── ומכאן: הפניה למסך ההתחברות, לא 500 ───────────────────────────
    const response = await employeePage.goto("/board");
    expect(response?.status()).toBe(200);
    await expect(employeePage).toHaveURL(/\/login/);

    // הסשן באמת מת, ולא רק ניווט אחד נחסם.
    const tagsResponse = await employeePage.goto("/tags");
    expect(tagsResponse?.status()).toBe(200);
    await expect(employeePage).toHaveURL(/\/login/);
  } finally {
    await employeeContext.close();
  }
});
