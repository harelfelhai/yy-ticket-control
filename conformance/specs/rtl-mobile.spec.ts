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

/**
 * **רצפת גובה אחת לכל המכשירים — 28px.**
 *
 * עד 0.7 היו כאן שתיים: 44px במגע ו-28px בעכבר, נבחרות בשאילתת מדיה
 * (`TOUCH_QUERY`) שהייתה עותק מדויק של `@custom-variant touch` שב-CSS.
 * הרצפה המותנית **בוטלה בהכרעת בעל המוצר** — הכפתורים בטלפון נקראו לו
 * גדולים מדי ביחס לדסקטופ — ואיתה ירדו גם השאילתה וגם `MIN_TOUCH`.
 *
 * הנימוק של רצפת ה-44 לא הופרך: ‏WCAG 2.5.5 מדבר על יעד **מגע**, והמחיר
 * מוצהר ב-`docs/DESIGN.md` § אזורי מגע. מה שהשתנה הוא ההכרעה, לא הידע.
 *
 * ‏**`MIN_POINTER_FINE` שומר על שמו בכוונה:** ‏`layout-guards.test.ts`
 * גוזר את הערך מ-`compact` שב-`button.tsx` ומאתר אותו **לפי השם הזה**.
 * שינוי גובה בפרימיטיב מחייב את שתי חבילות המדידה באותה נשימה, וזה
 * המנגנון שמכריח זאת.
 */
const MIN_POINTER_FINE = 28;

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
 * "×" של צ׳יפ הנמען (16px), ו**קישורי החזרה** — "← חזרה לרשימה" בפורטל,
 * "← תגיות" במסך התגית, "← ניהול המערכת" במסכי הניהול — כולם 20px. זהו
 * **דפוס אחד** ולא שלושה מקרים: קישור חזרה נכתב בכל מקום בלי `min-h`.
 *
 * הם מוחרגים כאן כדי שהסריקה הרוחבית תמשיך לתפוס פערים **חדשים** ולא
 * תיתקע על הידועים; כולם מדווחים ב-conformance-report, ו-`S0-03` מחזיק
 * אחד מהם כבדיקה שנועדה להיכשל עד שיתוקן.
 *
 * **‏"שנה שם" הוסר מהרשימה ב-0.7, וזו הסרה של חריג שנסגר ולא ויתור עליו.**
 * הכפתור עבר לאייקון עיפרון בתוך `Button size="compact"` — כלומר אין לו
 * עוד טקסט גלוי להתאים לו, **וגם** הגובה שלו הוא 28px, שהוא בדיוק הרצפה.
 * חריג שאיש אינו סופר אינו חריג אלא פרצה (§ RTL), ולכן ערך מת יורד מכאן
 * ואינו נשאר "ליתר ביטחון".
 */
const SANCTIONED = ["ערוך", "×", "← חזרה לרשימה", "← תגיות", "← ניהול המערכת"];

async function smallTargets(page: Page): Promise<string[]> {
  const floor = MIN_POINTER_FINE;
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
    if (box.height < floor) small.push(`${text} (${Math.round(box.height)}px)`);
  }
  return small;
}

async function expectTouchTargets(page: Page, label: string) {
  const floor = MIN_POINTER_FINE;
  expect(await smallTargets(page), `${label}: אזורי לחיצה קטנים מ-${floor}px`).toEqual([]);
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
    // ‏0.7: הקישור לבניינים ודירות ירד מכרטיס האתר אל דיאלוג הפרטים,
    // ולכן הנתיב נשלף מתוכו. בלי זה `sitePath` היה `null` בשקט, ומסך 16
    // היה נושר מהסריקה — שוב.
    await page.goto("/admin/sites");
    const firstCard = page.getByRole("listitem").first().getByRole("button");
    let sitePath: string | null = null;
    if (await firstCard.count()) {
      await firstCard.click();
      const details = page.getByRole("dialog");
      sitePath = await details.getByRole("link", { name: /בניינים ודירות/ }).getAttribute("href");
      await details.getByRole("button", { name: "סגור", exact: true }).click();
    }

    const screens: [string, string][] = [
      ["/login", "מסך התחברות"],
      ["/board", "מסך 1 — הלוח"],
      // תצוגת הטבלה נמדדת גם בנייד, אף שהמתג אליה מוסתר שם: הכתובת עדיין
      // ניתנת להגעה (קישור שנשמר, חזרה בהיסטוריה), ורשת עמודות היא בדיוק
      // המקום שבו גלישה אופקית מופיעה.
      ["/board?view=table", "מסך 1 — תצוגת טבלה"],
      ["/tickets/new", "מסך 4 — יצירה מהירה"],
      [ticketPath, "מסך 2 — פנייה ושרשור"],
      ["/tickets/batch", "מסך 5 — הזנה מרוכזת"],
      /*
       * ‏`/search` ו-`/overview` ירדו מהרשימה — לא כוויתור על כיסוי אלא
       * מפני שאין שם מסך למדוד: שניהם בדלי הפניה (`redirect`), וסריקה
       * שלהם הייתה מודדת פעמיים את היעד ומדווחת עליו בשם הלא נכון.
       *
       * שני המסכים עצמם נשארים ברשימה במקומם החדש: החיפוש הוא **מצב** של
       * הלוח ולכן הוא נסרק עם מונח פעיל (הרשימה השטוחה היא פריסה אחרת
       * לגמרי מהלוח המקובץ, ובלי השורה הזו איש אינו מודד אותה), וסקירת
       * האתרים יושבת בראש `/admin`.
       */
      [`/board?q=${encodeURIComponent(description)}`, "מסך 9 — חיפוש בלוח"],
      ["/tags", "רשימת תגיות"],
      ...(tagPath ? ([[tagPath, "מסך 6 — צ׳אט תגית"]] as [string, string][]) : []),
      ["/admin", "מסך 10 + ניהול — סקירת אתרים ורכזת הניהול"],
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
    // ‏16px נופל מתחת לשתי הרצפות, ולכן הטענה נשארת נכונה בשני הפרויקטים
    // גם אחרי שהרצפה הפכה תלוית-מצביע.
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN_POINTER_FINE);
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
