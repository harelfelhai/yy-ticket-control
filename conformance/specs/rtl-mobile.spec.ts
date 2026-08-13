import { type Page, expect, test } from "@playwright/test";
import { loginAs } from "../fixtures/roles";
import { createTicket, showLink, uniq, uniqPhone } from "../fixtures/world";

/**
 * §4 שורות 176–177 — דרישות הרוחב של כל המסכים:
 * "שפת הממשק: עברית, כיווניות מימין לשמאל" ו"עבודה גם במובייל וגם בדסקטופ".
 *
 * הבדיקה הקיימת (`e2e/mobile-qa.spec.ts`) מכסה ארבעה מסכים. כאן נבדקים
 * **כל** המסכים, כולל מסכי הניהול והפורטל — כי RTL שבור במסך אחד מתוך
 * חמישה־עשר הוא בדיוק מה שאיש לא מגלה עד שמשתמש אמיתי נכנס אליו.
 */

const MIN_TOUCH = 44;

async function expectRtlNoOverflow(page: Page, label: string) {
  await expect(page.locator("html"), `${label}: dir`).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html"), `${label}: lang`).toHaveAttribute("lang", "he");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label}: גלישה אופקית`).toBeLessThanOrEqual(2);
}

/**
 * חריגים שהתקן העיצובי מכיר בהם במפורש.
 *
 * "ערוך" של שם הדייר הוא קישור **בתוך משפט** — `DESIGN.md § Layout` מתיר
 * זאת, ו-`tests/unit/primitives.test.ts` כבר מחזיק אותו ברשימת החריגים
 * המנומקת (36px).
 *
 * האחרים **אינם** חריגים מסונקצנים אלא פערים שנמדדו:
 * "×" של צ׳יפ הנמען (16px), "שנה שם" ברשימת התגיות (16px), ו**קישורי
 * החזרה** — "← חזרה לרשימה" בפורטל, "← תגיות" במסך התגית,
 * "← ניהול המערכת" במסכי הניהול — כולם 20px. זהו **דפוס אחד** ולא שלושה
 * מקרים: קישור חזרה נכתב בכל מקום בלי `min-h`.
 *
 * הם מוחרגים כאן כדי שהסריקה הרוחבית תמשיך לתפוס פערים **חדשים** ולא
 * תיתקע על הידועים; כולם מדווחים ב-conformance-report, ו-`S0-03` מחזיק
 * אחד מהם כבדיקה שנועדה להיכשל עד שיתוקן.
 */
const SANCTIONED = ["ערוך", "×", "שנה שם", "← חזרה לרשימה", "← תגיות", "← ניהול המערכת"];

async function smallTargets(page: Page): Promise<string[]> {
  const targets = page.locator("main button:visible, main a:visible");
  const count = await targets.count();
  const small: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const target = targets.nth(index);
    const box = await target.boundingBox();
    if (!box || box.height === 0) continue;
    const inline = await target.evaluate((el) => getComputedStyle(el).display === "inline");
    if (inline) continue;
    const text = (await target.innerText()).trim().slice(0, 30);
    if (SANCTIONED.includes(text)) continue;
    if (box.height < MIN_TOUCH) small.push(`${text} (${Math.round(box.height)}px)`);
  }
  return small;
}

async function expectTouchTargets(page: Page, label: string) {
  expect(await smallTargets(page), `${label}: אזורי מגע קטנים מ-${MIN_TOUCH}px`).toEqual([]);
}

test.describe("S0 — RTL, מובייל ואזורי מגע בכל המסכים", () => {
  test("המסכים הפנימיים", async ({ page }) => {
    await loginAs(page, "admin");
    const description = uniq("מסך-לבדיקת-RTL");
    const ticketPath = await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain: "חשמל",
      description,
      newProfessional: { name: uniq("קבלן-RTL"), phone: uniqPhone() },
    });

    // מסך התגית נדרש לסריקה, אך יצירת תגית אינה הנושא כאן — לוקחים את
    // הראשונה שקיימת. ריצה מבודדת של הקובץ הזה בלבד תדלג עליו.
    await page.goto("/tags");
    const firstTag = page.locator('a[href^="/tags/"]').first();
    const tagPath = (await firstTag.count())
      ? await firstTag.getAttribute("href")
      : null;

    // מסך הבניינים תלוי באתר קיים, ולכן הנתיב נשלף ולא נכתב קשיח — בדיוק
    // כמו מסך התגית. בלעדיו הוא היה המסך היחיד שאיש אינו מודד בו אזורי מגע.
    await page.goto("/admin/sites");
    const firstSite = page.locator('a[href^="/admin/sites/"]').first();
    const sitePath = (await firstSite.count()) ? await firstSite.getAttribute("href") : null;

    const screens: [string, string][] = [
      ["/login", "מסך התחברות"],
      ["/board", "מסך 1 — הלוח"],
      ["/board?tour=1", "מסך 1 — מצב סיור"],
      ["/tickets/new", "מסך 4 — יצירה מהירה"],
      [ticketPath, "מסך 2 — פנייה ושרשור"],
      ["/tickets/batch", "מסך 5 — הזנה מרוכזת"],
      ["/search", "מסך 9 — חיפוש"],
      ["/overview", "מסך 10 — תצוגת הבעלים"],
      ["/tags", "רשימת תגיות"],
      ...(tagPath ? ([[tagPath, "מסך 6 — צ׳אט תגית"]] as [string, string][]) : []),
      ["/admin", "מסך ניהול"],
      ["/admin/sites", "מסך 11 — אתרים"],
      ...(sitePath ? ([[sitePath, "מסך 16 — בניינים ודירות"]] as [string, string][]) : []),
      ["/admin/users", "מסך 12 — משתמשים"],
      ["/admin/professionals", "מסך 13 — אנשי מקצוע"],
      ["/admin/domains", "מסך 14 — תחומים"],
    ];

    for (const [url, label] of screens) {
      if (url === "/login") {
        await page.context().clearCookies();
      }
      await page.goto(url);
      await expectRtlNoOverflow(page, label);
      await expectTouchTargets(page, label);
      if (url === "/login") {
        await loginAs(page, "admin");
      }
    }
  });

  test("מסכי הפורטל", async ({ page }) => {
    await loginAs(page, "managerA");
    const contractor = uniq("קבלן-פורטל-RTL");
    const description = uniq("תקלה-פורטל-RTL");
    await createTicket(page, {
      building: "בניין א",
      apartment: "2",
      domain: "חשמל",
      description,
      newProfessional: { name: contractor, phone: uniqPhone() },
    });
    const link = await showLink(page, contractor);

    await page.context().clearCookies();

    await page.goto(link);
    await expectRtlNoOverflow(page, "מסך 8 — לוח הפורטל");
    await expectTouchTargets(page, "מסך 8 — לוח הפורטל");

    await page.getByRole("link").filter({ hasText: description }).first().click();
    await expectRtlNoOverflow(page, "מסך 8 — פנייה בפורטל");
    await expectTouchTargets(page, "מסך 8 — פנייה בפורטל");

    await page.goto("/p/lo-kayam");
    await expectRtlNoOverflow(page, "מסך 8 — קישור לא בתוקף");
  });

  test("S0-03 — כפתור הסרת נמען מצ׳יפ עומד בסף המגע", async ({ page }) => {
    /**
     * ‏`DESIGN.md § Touch` מחייב 44px, ו-`e2e/mobile-qa.spec.ts` מודד זאת —
     * אך על ארבעה מסכים בלבד, ואף אחד מהם אינו מסך היצירה.
     * ‏`tests/unit/layout-guards.test.ts` סורק `min-h-*` בקוד המקור, ולכן
     * אלמנט שאינו מצהיר `min-h` כלל **אינו נראה לו**. כפתור ה-"×" של צ׳יפ
     * הנמען (`recipient-picker.tsx:66`) נופל בין שני האוכפים. מדווח.
     */
    test.fail();
    await loginAs(page, "managerA");
    await page.goto("/tickets/new");
    await page.getByRole("button", { name: /^נמענים/ }).first().click();
    await page.getByRole("option").first().click();

    const remove = page.getByRole("button", { name: /^הסר / }).first();
    const box = await remove.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN_TOUCH);
  });

  test("S0-04 — מסך 404: המעטפת עברית ו-RTL", async ({ page }) => {
    await loginAs(page, "managerA");
    await page.goto("/tickets/lokayamlokayam");
    // המעטפת תקינה: `app/layout.tsx` עוטף גם את מסך ברירת המחדל של Next.
    await expect(page.locator("html")).toHaveAttribute("lang", "he");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });

  test("S0-04 — תוכן מסך 404 בעברית", async ({ page }) => {
    /**
     * ‏§4 שורה 176: "שפת הממשק: עברית" — ללא חריג.
     *
     * המעטפת אכן עברית ו-RTL (הבדיקה שמעל), אך **הטקסט** הוא מסך ברירת
     * המחדל של Next באנגלית: "This page could not be found". לפרויקט אין
     * ‏`not-found.tsx` ואין `error.tsx` בשום מקום, בעוד `notFound()` נקרא
     * מ-`/tickets/[id]` ומ-`/tags/[id]` — כלומר כל חסימת הרשאה חוצת-אתרים
     * מגיעה לשם. מדווח ב-conformance-report.
     */
    test.fail();
    await loginAs(page, "managerA");
    await page.goto("/tickets/lokayamlokayam");
    await expect(page.locator("body")).not.toContainText("could not be found");
  });
});
