import { expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";
import { openDetails } from "./ticket-screen";

/**
 * התזכורן — פנייה שהמנהל משייך לעצמו (תוכנית M1.7).
 *
 * זהו המקרה שבו הפותח והנמען הם אותו אדם, וכל בדיקת "מי מול מי" במערכת
 * נפגשת בו: הרשאות, סינון הלוח, ורצועת הנמענים. הוא נבדק ברמת האינטגרציה,
 * אבל דווקא כאן חשוב לעבור במסלול הממשק — כי הפער שהאפיון מזהיר ממנו
 * ("פנייה מתפספסת") נוצר בדיוק כשמנהל רושם לעצמו משהו ואיש לא מקבל אותו.
 *
 * הבדיקה מאמתת גם את ההיפוך: לנמען פנימי **אין** כפתור קישור גישה. הוא
 * נכנס עם סיסמה; קישור קסם למשתמש רשום הוא סוד מיותר שאפשר לדלוף.
 */

test("מנהל פותח פנייה ומשייך את עצמו — הפנייה מגיעה אליו כנמען", async ({ page }) => {
  const stamp = Date.now();
  const description = `לבדוק את הדוד בגג ${stamp}`;

  await page.goto("/login");
  await page.getByLabel("טלפון או מייל").fill(E2E_ADMIN.phone);
  await page.getByLabel("סיסמה").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "כניסה" }).click();
  await expect(page).toHaveURL(/\/board$/);

  await page.goto("/tickets/new");
  for (const [label, option] of [
    ["בניין", "בניין א"],
    ["דירה", "1"],
    ["תחום", "חשמל"],
  ]) {
    await page.getByRole("button", { name: new RegExp(`^${label}`) }).first().click();
    await page.getByRole("option", { name: option, exact: true }).click();
  }
  await page.getByLabel("תיאור").fill(description);

  // הנמען נבחר מהרשימה הרגילה ולא דרך "איש מקצוע חדש": משתמש פנימי כבר
  // קיים במערכת, וזו בדיוק הנקודה — אותו בורר משרת את שני סוגי הנמענים.
  await page.getByRole("button", { name: /^נמענים/ }).first().click();
  // בלי exact: שורת האפשרות נושאת גם את הרמז ("מנהל מערכת") מתחת לשם.
  await page.getByRole("option", { name: E2E_ADMIN.name }).click();
  await expect(page.getByRole("list", { name: "נמענים", exact: true })).toContainText(
    E2E_ADMIN.name,
  );

  await page.getByRole("button", { name: "שלח לנמענים" }).click();
  await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible();

  // רצועת הנמענים מציגה אותו כנמען לכל דבר, עם סטטוס אישי משלו.
  await openDetails(page);
  const strip = page.getByRole("list", { name: "נמענים", exact: true });
  await expect(strip).toContainText(E2E_ADMIN.name);
  await expect(strip.getByText("נשלח", { exact: true })).toHaveCount(1);

  // ואין לו קישור גישה — הוא נכנס עם סיסמה.
  //
  // המחרוזת כאן הייתה "צור קישור גישה", שאינה קיימת בשום מקום במוצר
  // (`he.ticket.showLink` הוא "קישור גישה"), ולכן הטענה הזו מעולם לא בדקה
  // דבר. שתי הטענות שמעליה הן הבקרה החיובית: הן מוכיחות שהרצועה נפתרה,
  // ולכן היעדר הכפתור כאן הוא היעדר אמיתי.
  await expect(strip.getByRole("button", { name: /^קישור גישה/ })).toHaveCount(0);

  // הפנייה נמצאת גם תחת "הפניתי" וגם תחת "קיבלתי" — שני הצדדים הם הוא.
  const card = page.getByRole("link").filter({ hasText: description });

  await page.goto("/board?direction=opened");
  await expect(card).toBeVisible();

  await page.goto("/board?direction=received");
  await expect(card).toBeVisible();
});
