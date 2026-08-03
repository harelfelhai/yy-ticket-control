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

async function expectTouchTargets(page: Page, label: string) {
  const targets = page.locator("main button:visible, main a:visible");
  const count = await targets.count();
  const small: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const target = targets.nth(index);
    const box = await target.boundingBox();
    if (!box || box.height === 0) continue;
    // קישור בתוך משפט אינו אזור מגע עצמאי (`DESIGN.md § Touch`), ולכן
    // נמדדים רק אלמנטים שעומדים בפני עצמם.
    const inline = await target.evaluate((el) => getComputedStyle(el).display === "inline");
    if (inline) continue;
    if (box.height < MIN_TOUCH) {
      small.push(`${(await target.innerText()).slice(0, 30)} (${Math.round(box.height)}px)`);
    }
  }
  expect(small, `${label}: אזורי מגע קטנים מ-${MIN_TOUCH}px`).toEqual([]);
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

    await page.getByRole("button", { name: /^הוסף תגית/ }).first().click();
    const tagName = uniq("תגית-RTL");
    await page.getByRole("textbox", { name: /חיפוש/ }).fill(tagName);
    await page.getByRole("button", { name: /צור חדש/ }).click();
    await expect(page.getByText(tagName)).toBeVisible();

    await page.goto("/tags");
    await page.getByRole("link", { name: new RegExp(tagName) }).click();
    const tagPath = new URL(page.url()).pathname;

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
      [tagPath, "מסך 6 — צ׳אט תגית"],
      ["/admin", "מסך ניהול"],
      ["/admin/sites", "מסך 11 — אתרים"],
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

  test("S0-04 — מסך 404 בעברית ובכיווניות ימין-לשמאל", async ({ page }) => {
    /**
     * ‏§4 שורה 176 קובע "שפת הממשק: עברית, כיווניות מימין לשמאל" ללא חריג.
     * לפרויקט אין `not-found.tsx` ואין `error.tsx` בשום מקום, בעוד
     * ‏`notFound()` נקרא מ-`/tickets/[id]` ומ-`/tags/[id]` — ולכן משתמש
     * שמגיע לפנייה שאין לו גישה אליה מקבל את מסך ברירת המחדל של Next,
     * באנגלית ומשמאל לימין. מדווח ב-conformance-report.
     */
    test.fail();
    await loginAs(page, "managerA");
    await page.goto("/tickets/lokayamlokayam");
    await expect(page.locator("html")).toHaveAttribute("lang", "he");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });
});
