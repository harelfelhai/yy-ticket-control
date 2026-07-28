import { type Page, expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";

/**
 * מחזור חיי הטיוטה מקצה לקצה (אפיון §2.5, מסך 7):
 *
 * שמירה כטיוטה → מסך הפנייה מציג באנר אדום ורק את השדות החסרים → הלוח
 * מצמיד את הטיוטה לראש "דורש ממך" ומסמן אותה באדום → השלמה ושיגור → מחיקה.
 *
 * זהו הפער המהותי שהביקורת מצאה: submitDraft היה קוד מת בלי מסלול ממשק.
 */

test.beforeEach(async ({ page }) => {
  // סביבת ה-E2E חולקת בסיס נתונים אחד, וטיוטות מקומיות (IndexedDB) עלולות
  // לשרוד בין בדיקות ולגרום לטופס היצירה לשחזר טיוטה זרה. addInitScript רץ
  // לפני קוד האפליקציה בכל ניווט, ולכן הניקוי קודם ל-loadDraft.
  await page.addInitScript(() => {
    try {
      indexedDB.deleteDatabase("yy-ticket-control");
    } catch {
      // דפדפן ללא IndexedDB — אין מה לנקות.
    }
  });
});

async function loginAsManager(page: Page) {
  await page.goto("/board");
  if (new URL(page.url()).pathname === "/login") {
    await page.getByLabel("טלפון או מייל").fill(E2E_ADMIN.phone);
    await page.getByLabel("סיסמה").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "כניסה" }).click();
  }
  await expect(page).toHaveURL(/\/board$/);
}

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).first().click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function addProfessional(page: Page, name: string, phone: string) {
  await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
  await page.getByLabel("שם").fill(name);
  await page.getByLabel("טלפון").fill(phone);
  await page.getByRole("button", { name: "שמור איש מקצוע" }).click();
  await expect(page.getByRole("list", { name: "נמענים", exact: true })).toContainText(name);
}

/** יוצר טיוטה עם בניין ודירה בלבד, ומחזיר את כתובת מסך הפנייה */
async function makeMinimalDraft(page: Page): Promise<string> {
  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await page.getByRole("button", { name: "שמור כטיוטה" }).click();
  await expect(page).toHaveURL(/\/tickets\/[a-z0-9]+$/);
  return new URL(page.url()).pathname;
}

test("שמירה כטיוטה: באנר אדום, בלי כפתור סגירה, ובלי עורך הנמענים הרגיל", async ({
  page,
}) => {
  await loginAsManager(page);
  await makeMinimalDraft(page);

  await expect(page.getByText("טיוטה — חסרים פרטים. לא נשלחה לאיש.")).toBeVisible();
  // טיוטה אינה נסגרת, ואינה מציגה את בורר הנמענים הרגיל של פנייה משוגרת.
  await expect(page.getByRole("button", { name: "סגור פנייה" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "שגר", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "מחק טיוטה" })).toBeVisible();

  // בלוח: הטיוטה ב"דורש ממך". first() כי הבסיס משותף לכל בדיקות ה-E2E,
  // וטיוטות מבדיקות אחרות עשויות להופיע גם הן באותה קבוצה.
  await page.goto("/board");
  const actionRequired = page.locator("section", { hasText: "דורש ממך" }).first();
  await expect(actionRequired.getByText("טיוטה — חסרים פרטים").first()).toBeVisible();
});

test("השלמת טיוטה ושיגורה: ממלאים את החסר, משגרים, והנמען מקבל אותה", async ({ page }) => {
  const stamp = Date.now();
  const electrician = `חשמלאי ${stamp}`;

  await loginAsManager(page);
  await makeMinimalDraft(page);

  // השדות החסרים בלבד מוצגים: תחום, תיאור ונמענים. בניין ודירה כבר קיימים.
  await pick(page, "תחום", "חשמל");
  await page.getByLabel("תיאור").fill(`אין חשמל בסלון ${stamp}`);
  await addProfessional(page, electrician, "0501234567");

  await page.getByRole("button", { name: "שגר", exact: true }).click();

  // אחרי השיגור: הבאנר נעלם, הנמען ברצועה עם "נשלח", ואירוע שיוך בשרשור.
  await expect(page.getByText("טיוטה — חסרים פרטים. לא נשלחה לאיש.")).toHaveCount(0);
  const recipients = page.getByRole("list", { name: "נמענים", exact: true });
  await expect(recipients).toContainText(electrician);
  await expect(recipients).toContainText("נשלח");
  await expect(page.getByText(`${electrician} שויך לפנייה`)).toBeVisible();
});

test("נמעני הטיוטה נשמרים: טיוטה עם נמען וחסרון תחום — הנמען שורד את השיגור", async ({
  page,
}) => {
  const stamp = Date.now();
  const plumber = `אינסטלטור ${stamp}`;

  await loginAsManager(page);
  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await page.getByLabel("תיאור").fill(`נזילה ${stamp}`);
  await addProfessional(page, plumber, "0527654321");
  // חסר רק תחום — נשמר כטיוטה עם הנמען שמור ב-draftRecipients.
  await page.getByRole("button", { name: "שמור כטיוטה" }).click();
  await expect(page).toHaveURL(/\/tickets\/[a-z0-9]+$/);

  // מסך ההשלמה אינו מציג בורר נמענים (הם אינם חסרים), רק את התחום החסר.
  await expect(page.getByRole("button", { name: "+ איש מקצוע חדש" })).toHaveCount(0);
  await pick(page, "תחום", "חשמל");
  await page.getByRole("button", { name: "שגר", exact: true }).click();

  // הנמען ששמור בטיוטה מופיע ברצועה אחרי השיגור — הוא לא אבד.
  const recipients = page.getByRole("list", { name: "נמענים", exact: true });
  await expect(recipients).toContainText(plumber);
});

test("מחיקת טיוטה מחזירה ללוח והטיוטה איננה", async ({ page }) => {
  await loginAsManager(page);
  const draftPath = await makeMinimalDraft(page);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "מחק טיוטה" }).click();

  await expect(page).toHaveURL(/\/board$/);
  // הפנייה שנמחקה אינה נגישה יותר.
  await page.goto(draftPath);
  await expect(page.getByText("טיוטה — חסרים פרטים")).toHaveCount(0);
});
