import { type Page, expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";
import { openFilters } from "./helpers";

/**
 * הלוח הראשי — המסך שמנהל העבודה פותח בבוקר.
 *
 * הבדיקות מתמקדות במה שהאפיון מדגיש: רשימה אחת עם כותרות קיבוץ ולא טאבים,
 * טקסט סיבה על כל כרטיס, ומצב סיור שמקבץ לפי דירה.
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

async function createTicket(page: Page, apartment: string): Promise<string> {
  const stamp = Date.now();
  const description = `תקלה ${stamp}`;

  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", apartment);
  await pick(page, "תחום", "חשמל");
  await page.getByLabel("תיאור").fill(description);
  await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
  await page.getByLabel("שם").fill(`קבלן ${stamp}`);
  await page.getByLabel("טלפון").fill(`050-${String(stamp).slice(-7)}`);
  await page.getByRole("button", { name: "שמור איש מקצוע" }).click();
  await expect(page.getByRole("list", { name: "נמענים", exact: true })).toContainText(
    `קבלן ${stamp}`,
  );
  await page.getByRole("button", { name: "שלח לנמענים" }).click();
  await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible();

  return description;
}

test.describe("הלוח הראשי", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("מציג את שלוש הקבוצות ככותרות ברשימה אחת, לא כטאבים", async ({ page }) => {
    await createTicket(page, "1");
    await page.goto("/board");

    await expect(page.getByRole("heading", { name: /^דורש ממך/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^אצל הנמענים/ })).toBeVisible();
    // אין tablist — זו הכרעה מפורשת באפיון.
    await expect(page.getByRole("tablist")).toHaveCount(0);
  });

  test("פנייה חדשה מופיעה תחת 'אצל הנמענים' עם טקסט סיבה", async ({ page }) => {
    const description = await createTicket(page, "1");
    await page.goto("/board");

    const card = page.getByRole("link").filter({ hasText: description });
    await expect(card).toBeVisible();
    // טקסט הסיבה הוא הלב של הכרטיס: בלעדיו פנייה קופצת בין קבוצות בלי הסבר.
    await expect(card).toContainText("נשלח, טרם נצפה");
  });

  test("לחיצה על כרטיס מובילה לפנייה", async ({ page }) => {
    const description = await createTicket(page, "1");
    await page.goto("/board");

    await page.getByRole("link").filter({ hasText: description }).click();
    await expect(page).toHaveURL(/\/tickets\/[a-z0-9]+$/);
  });

  test("סגירה מעבירה את הפנייה לארכיון המקופל", async ({ page }) => {
    const description = await createTicket(page, "1");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "סגור פנייה" }).click();
    await expect(page.getByRole("button", { name: "פתח מחדש" })).toBeVisible();

    await page.goto("/board");

    // הארכיון מקופל: הפנייה קיימת אך אינה גלויה עד לפתיחת המקטע.
    await expect(page.getByRole("link").filter({ hasText: description })).toBeHidden();
    await page.getByText(/^ארכיון/).click();
    await expect(page.getByRole("link").filter({ hasText: description })).toBeVisible();
  });

  test("מצב סיור מקבץ לפי בניין ודירה", async ({ page }) => {
    await createTicket(page, "1");
    await createTicket(page, "2");

    await page.goto("/board");
    await page.getByRole("checkbox", { name: "מצב סיור" }).check();

    await expect(page.getByRole("heading", { name: /בניין א · דירה 1/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /בניין א · דירה 2/ })).toBeVisible();
  });

  test("מצב הסינון נשמר בכתובת, כך שחזרה למסך משמרת אותו", async ({ page }) => {
    await page.goto("/board");
    await openFilters(page);
    await page.getByLabel("הפניתי").selectOption("opened");

    await expect(page).toHaveURL(/direction=opened/);

    // חזרה מהפנייה למסך אינה מאבדת את הסינון. הרצועה נפתחת מאליה, כי
    // הכתובת מסוננת — ולכן אין צורך לפתוח אותה שוב.
    await page.reload();
    await expect(page.getByLabel("הפניתי")).toHaveValue("opened");
  });

  test("בנייד הרצועה מקופלת, ובמסך רחב היא גלויה", async ({ page }, testInfo) => {
    await page.goto("/board");

    const toggle = page.getByRole("button", { name: /^מסננים/ });
    const filter = page.getByLabel("הפניתי");

    if (testInfo.project.name === "mobile") {
      // שישה בוררים גלויים תפסו כשליש מהמסך הראשון של הלוח.
      await expect(toggle).toBeVisible();
      await expect(filter).toBeHidden();
      await expect(page.getByRole("checkbox", { name: "מצב סיור" })).toBeVisible();
    } else {
      await expect(toggle).toBeHidden();
      await expect(filter).toBeVisible();
    }
  });

  test("כתובת מסוננת פותחת את הרצועה מאליה", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "הקיפול קיים רק מתחת ל-md");

    // בלי זה, לוח שהתרוקן בגלל מסנן שהגיע בקישור נקרא כאובדן נתונים.
    await page.goto("/board?direction=opened");

    await expect(page.getByLabel("הפניתי")).toBeVisible();
    await expect(page.getByRole("button", { name: /^מסננים/ })).toContainText("1");
  });

  test("כפתור פנייה חדשה מוביל למסך היצירה", async ({ page }) => {
    await page.goto("/board");
    await page.getByRole("link", { name: "+ פנייה חדשה" }).click();
    await expect(page).toHaveURL(/\/tickets\/new$/);
  });
});

/**
 * מתג התצוגה (הכרעת 0.3 §7 שורה 28).
 *
 * שתי טענות שקל לפספס: ששלוש כותרות הקיבוץ **נשארות** בטבלה — כלומר
 * שהשינוי הוא ברינדור השורה ולא במבנה המסך — ושהשורה נשארת **קישור**,
 * כי `role="row"` על `<Link>` היה דורס את תפקיד הקישור ושובר את שאר
 * בדיקות הלוח בלי שאיש ישים לב.
 */
test.describe("תצוגת טבלה", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await createTicket(page, "1");
  });

  test("המתג מחליף לטבלה, הכותרות נשארות, והשורה מובילה לפנייה", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "הטבלה היא דסקטופ בלבד");

    await page.goto("/board");
    await page.getByRole("button", { name: "טבלה" }).click();
    await expect(page).toHaveURL(/view=table/);

    // שלוש כותרות הקיבוץ נשארות — הטבלה אינה מחליפה את מבנה המסך.
    await expect(page.getByRole("heading", { name: /^דורש ממך/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^אצל הנמענים/ })).toBeVisible();

    // כותרות העמודות מוצגות. `.first()` בכוונה: לכל קבוצה שורת כותרות
    // משלה — הטבלה מקובצת, ואינה טבלה אחת עם כותרת אחת בראש המסך.
    await expect(page.getByText("מיקום", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("סיבה", { exact: true }).first()).toBeVisible();

    // השורה היא קישור אחד לפנייה — ולא תא בתוך טבלה.
    const row = page.getByRole("link").filter({ hasText: "בניין א · דירה 1" }).first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(/\/tickets\/c/);
  });

  test("אין תפקידי ARIA של טבלה — הסמנטיקה היא רשימת קישורים", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "הטבלה היא דסקטופ בלבד");

    await page.goto("/board?view=table");
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByRole("row")).toHaveCount(0);
  });

  test("המתג אינו מוצג בנייד, והלוח נשאר כרטיסים", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "הטענה היא על הנייד");

    await page.goto("/board");
    await openFilters(page);
    // ‏hidden ולא count(0): הכפתור קיים ב-DOM ומוסתר ב-`md:` — מה שנבדק
    // הוא שהמשתמש אינו יכול ללחוץ עליו ולא לראות שינוי.
    await expect(page.getByRole("button", { name: "טבלה" })).toBeHidden();
  });

  test("גם כשהכתובת מבקשת טבלה במפורש, בנייד מוצגים כרטיסים", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "הטענה היא על הנייד");

    /*
     * הסתרת המתג אינה מספיקה: הכתובת נגישה מקישור שנשמר ומחזרה בהיסטוריה.
     * סבב הצילום הראה שב-390px כותרות העמודות נדבקות זו לזו והתאים נחתכים
     * לאות אחת — וזה **אינו** נתפס באוכף הגלישה, כי הרשת מצטמצמת ואינה גולשת.
     */
    await page.goto("/board?view=table");
    // ‏`.first()`: הטבלה מרונדרת פעם לכל קבוצה, וכולן מוסתרות ב-`md:`.
    await expect(page.getByText("מיקום", { exact: true }).first()).toBeHidden();
    /*
     * ‏`getByRole` ולא `getByText`: הטבלה עדיין ב-DOM ומוסתרת ב-`display:none`,
     * ולכן `getByText` היה תופס את התא המוסתר שלה כראשון. אלמנט מוסתר אינו
     * בעץ הנגישות, ולכן חיפוש לפי תפקיד מוצא רק את הכרטיס שבאמת מוצג.
     */
    await expect(
      page.getByRole("link").filter({ hasText: "נשלח, טרם נצפה" }).first(),
    ).toBeVisible();
  });

  test("מיון לפי עמודה, ולחיצה שלישית מחזירה לסדר המערכת", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "הפקד קיים רק בטבלה, והיא דסקטופ בלבד");

    await page.goto("/board?view=table");

    // ‏`.first()`: לכל קבוצה שורת כותרות משלה — הטבלה מקובצת.
    const header = page.getByRole("link", { name: /^תחום/ }).first();

    await header.click();
    await expect(page).toHaveURL(/sort=domain&dir=asc/);

    await page.getByRole("link", { name: /^תחום/ }).first().click();
    await expect(page).toHaveURL(/sort=domain&dir=desc/);

    /*
     * הלחיצה השלישית היא כל העניין: בלעדיה המיון הוא דלת חד-כיוונית
     * שמבטלת את דירוג הדחיפות ואינה מציעה דרך חזרה (§7 שורה 30).
     */
    await page.getByRole("link", { name: /^תחום/ }).first().click();
    await expect(page).not.toHaveURL(/sort=/);
    // והתצוגה נשארת טבלה — המיון התאפס, לא המסך.
    await expect(page).toHaveURL(/view=table/);
  });

  test("המיון אינו מוחק את שאר מצב הלוח", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "הפקד קיים רק בטבלה");

    await page.goto("/board?view=table&direction=opened");
    await page.getByRole("link", { name: /^מיקום/ }).first().click();

    // מסנן שנמחק בלחיצה על כותרת נקרא כאובדן נתונים.
    await expect(page).toHaveURL(/direction=opened/);
    await expect(page).toHaveURL(/view=table/);
  });

  test("כתובת עם מיון לא מוכר נקראת כ'בלי מיון' ואינה מפילה את המסך", async ({ page }) => {
    await page.goto("/board?view=table&sort=צבע&dir=desc");
    await expect(page.getByRole("heading", { name: /^אצל הנמענים/ })).toBeVisible();
  });
});

