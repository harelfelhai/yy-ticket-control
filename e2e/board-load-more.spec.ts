import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { applyFilter, loginAsManager } from "./helpers";

/**
 * תקרת ה-20 עם "טען עוד" (ספק #38, הכרעת 0.9) וחיווי העדכון בסינון (ספק #39).
 *
 * הנתונים: 25 פניות סגורות תחת **בניין ייעודי באתר הקיים**, נזרעות פעם אחת
 * לריצה דרך `seed-archive.ts` (ראו שם למה סקריפט נפרד, ולמה בניין ולא אתר —
 * אתר שני משבית את בורר הבניין בכל החבילה). הסינון לבניין הזה נותן ארכיון
 * שגודלו ידוע — 25 — בלי תלות במה שבדיקות אחרות סגרו.
 */

const ARCHIVE_BUILDING = "בניין עומס";

test.beforeAll(() => {
  // אותה תבנית הרצה כמו ב-global-setup: הסקריפט מקבל את בסיס ה-E2E במפורש,
  // כי ייבוא `db` בתוך ה-spec היה נקשר לבסיס הפיתוח של הסביבה.
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const result = spawnSync(
    process.execPath,
    [require.resolve("tsx/cli"), path.join("e2e", "seed-archive.ts")],
    {
      env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL ?? "" },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(`זריעת הארכיון נכשלה:\n${result.stdout}\n${result.stderr}`);
  }
});

test.describe("תקרת 20 בקבוצה עם טען עוד", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsManager(page);
    await applyFilter(page, "בניין", { label: ARCHIVE_BUILDING }, "building");
  });

  test("הקבוצה מציגה 20, המונה נשאר מלא, וטען עוד משלים", async ({ page }) => {
    // המונה בכותרת הוא המספר המלא — הקטיעה היא ברינדור בלבד (S1-30).
    const summary = page.getByText("ארכיון · 25");
    await expect(summary).toBeVisible();
    await summary.click();

    // ‏20 כרטיסים בדיוק — הקישור "טען עוד" אינו נתפס בתבנית "פנייה ארכיונית".
    const archive = page.locator("details");
    await expect(archive.getByRole("link", { name: /פנייה ארכיונית/ })).toHaveCount(20);

    const loadMore = page.getByRole("link", { name: "טען עוד · 5" });
    await expect(loadMore).toBeVisible();
    await loadMore.click();

    // ההרחבה חיה בכתובת — כמו מסנן או מיון (S1-30a).
    await expect(page).toHaveURL(/moreArchive=40/);
    await expect(archive.getByRole("link", { name: /פנייה ארכיונית/ })).toHaveCount(25);
    await expect(page.getByRole("link", { name: /^טען עוד/ })).toHaveCount(0);
  });

  test("שינוי מסנן מאפס את ההרחבה, ומתג התצוגה משמר אותה", async ({ page }) => {
    await page.getByText("ארכיון · 25").click();
    await page.getByRole("link", { name: "טען עוד · 5" }).click();
    await expect(page).toHaveURL(/moreArchive=40/);

    // מתג התצוגה אינו מסנן — ההרחבה שורדת אותו (S1-30b). קיים בדסקטופ בלבד.
    const toggle = page.getByRole("button", { name: "טבלה", exact: true });
    if (await toggle.isVisible()) {
      await toggle.click();
      await expect(page).toHaveURL(/view=table/);
      await expect(page).toHaveURL(/moreArchive=40/);
    }

    // מסנן אמיתי מאפס: הרשימה מתחלפת, והתקרה שייכת לרשימה שהוצגה.
    await applyFilter(page, "הפניתי", "opened", "direction");
    await expect(page).not.toHaveURL(/moreArchive/);
  });

  test("בזמן סבב הסינון מוצג חיווי, והתוכן נשאר על המסך", async ({ page }) => {
    // צעד ההידרציה כבר קרה (applyFilter של ה-beforeEach), ולכן בחירה ישירה
    // כאן אינה נבלעת. ההשהיה המלאכותית פותחת חלון שבו החיווי חייב להיראות —
    // בלעדיה הבדיקה היא מרוץ נגד שרת מקומי מהיר.
    await page.route("**/board**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue();
    });

    await page.getByLabel("הפניתי", { exact: true }).selectOption("opened");

    // הצ'יפ (PendingNotice) מופיע, והאזור מסומן עסוק (S1-30d).
    const chip = page.getByRole("status").filter({ hasText: "טוען…" });
    await expect(chip).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(1);
    // התוכן הישן לא הוחלף במסך ריק — הכותרת עדיין שם, מעומעמת.
    await expect(page.getByText("ארכיון · 25")).toBeVisible();

    // ובסיום הסבב החיווי נעלם והכתובת עודכנה.
    await expect(page).toHaveURL(/direction=opened/);
    await expect(chip).toBeHidden();

    await page.unroute("**/board**");
  });
});
