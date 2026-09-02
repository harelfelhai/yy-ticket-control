import { expect, test } from "@playwright/test";
import { loginAs } from "../fixtures/roles";
import { CAST, SITE_A, SITE_B } from "../fixtures/cast";
import { CREATE_SCREEN } from "../fixtures/spec-text";
import { acceptDialogs, pick } from "../fixtures/world";

/**
 * הכרעות המימוש של גרסה 0.3 (§7 #19–22).
 *
 * ארבע הכרעות שהתקבלו אחרי סבב שימוש של המשתמש במערכת החיה, כלומר אחרי
 * שהמסכים כבר נבנו — ולכן, בדיוק כמו הכרעות 0.2, זה המקום הסביר ביותר
 * שבו המסמך והקוד עלולים להיפרד.
 *
 * ‏#20 (ביטול הקלטה) ו-#21 (מצלמה בדסקטופ) אינם נבדקים כאן: שניהם דורשים
 * מיקרופון ומצלמה אמיתיים, ובדיקתם היא ב-jsdom עם התקנים מדומים
 * (`tests/unit/audio-recorder.test.tsx`, `tests/unit/camera-capture.test.tsx`).
 * מה שכן נבדק כאן הוא מה שנראה בדפדפן בלי חומרה: ש"צלם" ו"צרף קובץ"
 * נשארו **שתי פעולות נפרדות**.
 */

test.describe("V03 — האתר הוא שדה בטופס (§7 #19)", () => {
  test("V03-01 — החלפת אתר מאפסת בניין ודירה", async ({ page }) => {
    acceptDialogs(page);
    // אדמין הוא היחיד שיש לו יותר מאתר אחד, ולכן היחיד שיכול להחליף.
    await loginAs(page, "admin");
    await page.goto("/tickets/new");
    await expect(page.getByRole("button", { name: CREATE_SCREEN.submit })).toBeEnabled();

    await pick(page, "אתר", SITE_A);
    await pick(page, "בניין", "בניין א");
    await pick(page, "דירה", "1");
    await expect(page.getByRole("button", { name: /^בניין/ }).first()).toContainText("בניין א");

    await pick(page, "אתר", SITE_B);

    // דירה 1 בבניין א׳ אינה דירה 1 בבניין ג׳. השארת הבחירה הייתה משייכת
    // את הפנייה למקום הלא נכון בשקט — ולכן היא מתאפסת.
    await expect(page.getByRole("button", { name: /^בניין/ }).first()).not.toContainText(
      "בניין א",
    );
    await expect(page.getByRole("button", { name: /^דירה/ }).first()).not.toContainText("1");

    // ובניין ג׳, ששייך לאתר ב׳, הוא מה שמוצע עכשיו — ואתר א׳ נעלם.
    await page.getByRole("button", { name: /^בניין/ }).first().click();
    await expect(page.getByRole("option", { name: "בניין ג", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "בניין א", exact: true })).toHaveCount(0);
  });

  test("V03-02 — החלפת אתר משאירה נמען פנימי מאתר אחר", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    await page.goto("/tickets/new");
    await expect(page.getByRole("button", { name: CREATE_SCREEN.submit })).toBeEnabled();

    await pick(page, "אתר", SITE_A);

    // מנהל עבודה של אתר א׳ הוא נמען חוקי כאן.
    await page.getByRole("button", { name: /^נמענים/ }).first().click();
    await page
      .getByRole("option", { name: new RegExp(`^${CAST.managerA.name}`) })
      .first()
      .click();
    const recipients = page.getByRole("list", { name: "נמענים", exact: true });
    await expect(recipients).toContainText(CAST.managerA.name);

    await pick(page, "אתר", SITE_B);

    /*
     * **הבדיקה הפכה כיוון ב-1.9.2026 (GAP-A2).** קודם היא דרשה שהנמען
     * **יוסר**, מפני שמנהל של אתר א׳ לא היה יכול לראות פנייה של אתר ב׳
     * (`canViewTicket` השווה `siteId` בלבד) — השארתו הייתה משגרת אליו
     * פנייה שתיעלם לו מהלוח.
     *
     * ‏§5.ז קובע שנמען רואה פניות ששויכו אליו **מכל האתרים**, ומשתוקן
     * `canViewTicket` הנימוק להסרה נעלם. מה שנשאר הוא הכלל הכללי יותר:
     * **בחירה מפורשת של המשתמש אינה נמחקת בשקט מתחת לידיו.** בניין ודירה
     * כן מתאפסים (הבדיקה שמעל) מפני שהם שייכים לאתר; נמען אינו.
     */
    await expect(recipients).toContainText(CAST.managerA.name);
  });
});

test.describe("V03 — צילום וצירוף קובץ הן שתי פעולות (§7 #21)", () => {
  test("V03-03 — שני כפתורים נפרדים במסך היצירה", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    await page.goto("/tickets/new");

    // "צלם" מפעיל מצלמה; "צרף קובץ" פותח את הגלריה. משתמש שלוחץ "צלם"
    // ומקבל בורר קבצים מסיק שהמערכת שבורה — וזה מה שדווח מהשטח.
    await expect(page.getByRole("button", { name: "צלם" })).toBeVisible();
    await expect(page.getByRole("button", { name: "צרף קובץ" })).toBeVisible();
  });
});

/**
 * ‏V03-04 הוסר ב-0.4.
 *
 * הוא אימת את הכרעת 0.3 — ש"יש לי שאלה" נשאר לחיץ ומסביר מה חסר במקום
 * להיות מושבת. ב-0.4 הכפתור עצמו ירד (§7 שורה 31), ולכן אין מה לאמת:
 * בדיקה על התנהגות של רכיב שאינו קיים היא בדיקה שתמיד תיכשל, או גרוע
 * מכך — שתשוכתב כדי לעבור. **האיסור** שהחליף אותה נבדק ב-PROH-01/03/12
 * (`prohibitions.spec.ts`): הכפתור חייב להיעדר מהפורטל.
 */
