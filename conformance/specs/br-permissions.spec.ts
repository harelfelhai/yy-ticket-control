import { expect, test } from "@playwright/test";
import { CAST, PROS, SITE_A, SITE_B } from "../fixtures/cast";
import { loginAs } from "../fixtures/roles";
import { TICKET_SCREEN } from "../fixtures/spec-text";
import { createTicket, uniq } from "../fixtures/world";

/**
 * §5.ז — מטריצת ההרשאות, חיובי ושלילי.
 *
 * זהו החלק שחבילת ה-E2E הקיימת אינה יכולה לכסות: היא רצה כולה כמנהל
 * מערכת, שעבורו כל תשובה היא "כן". כאן כל טענה נבדקת גם מהצד שאמור להיחסם.
 *
 * **גבול מוצהר:** בדיקה בדפדפן מאמתת שהפעולה אינה מוצעת ושכתובת ישירה אינה
 * נפתחת. אכיפת השרת עצמה (קריאה ל-Server Action בעקיפת ה-UI) נבדקת בשכבת
 * ה-integration — `tests/conformance/permissions-server.test.ts` — כי אין
 * דרך יציבה לזייף קריאת Server Action מ-Playwright.
 */

const ADMIN_PAGES = [
  "/admin",
  "/admin/sites",
  "/admin/users",
  "/admin/professionals",
  "/admin/domains",
];

test.describe("§5.ז — מנהל עבודה", () => {
  test("A3-01/A3-09 — מנהל אתר ב׳ אינו מגיע לפנייה של אתר א׳ גם בכתובת ישירה", async ({
    page,
  }) => {
    await loginAs(page, "managerA");
    const description = uniq("פנייה של אתר א");
    const path = await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain: "חשמל",
      description,
      recipients: [PROS.full.name],
    });

    await loginAs(page, "managerB");
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "שרשור" })).toHaveCount(0);
  });

  test("A3-02 — מנהל רואה כל פניות האתר שלו, לא רק את שלו", async ({ page }) => {
    await loginAs(page, "managerA2");
    const description = uniq("נפתחה בידי א2");
    await createTicket(page, {
      building: "בניין ב",
      apartment: "2",
      domain: "אינסטלציה",
      description,
      recipients: [PROS.full.name],
    });

    await loginAs(page, "managerA");
    await page.goto("/board");
    await expect(page.getByText(description)).toBeVisible();
  });

  test("A3-04/A3-08 — מנהל אינו סוגר פנייה שפתח מנהל אחר, וכן סוגר את שלו", async ({
    page,
  }) => {
    await loginAs(page, "managerA");
    const path = await createTicket(page, {
      building: "בניין א",
      apartment: "2",
      domain: "חשמל",
      description: uniq("של מנהל א"),
      recipients: [PROS.full.name],
    });

    // מנהל אחר באותו אתר — רואה, מגיב, אך אינו סוגר.
    await loginAs(page, "managerA2");
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "שרשור" })).toBeVisible();
    await expect(page.getByRole("button", { name: TICKET_SCREEN.close })).toHaveCount(0);

    // הפותח — כן.
    await loginAs(page, "managerA");
    await page.goto(path);
    await expect(page.getByRole("button", { name: TICKET_SCREEN.close })).toBeVisible();
  });

  test("A3-10 — חמשת מסכי הניהול חסומים למנהל עבודה", async ({ page }) => {
    await loginAs(page, "managerA");
    for (const url of ADMIN_PAGES) {
      await page.goto(url);
      await expect(page, `${url} אמור להפנות ללוח`).toHaveURL(/\/board/);
    }
  });

  test("S10-01 — מנהל עבודה מופנה מתצוגת הבעלים ללוח", async ({ page }) => {
    await loginAs(page, "managerA");
    await page.goto("/overview");
    await expect(page).toHaveURL(/\/board/);
  });
});

test.describe("§5.ז — בעלים", () => {
  test("A2-04 — בעלים פותח פנייה בכל אתר", async ({ page }) => {
    await loginAs(page, "owner");
    const description = uniq("בעלים באתר ב");
    await createTicket(page, {
      site: SITE_B,
      building: "בניין ג",
      apartment: "1",
      domain: "חשמל",
      description,
      recipients: [PROS.full.name],
    });
    await expect(page.getByText(description)).toBeVisible();
  });

  test("A2-07 — בעלים אינו סוגר פנייה שלא פתח, וכן סוגר את שלו", async ({ page }) => {
    await loginAs(page, "managerA");
    const foreignPath = await createTicket(page, {
      building: "בניין א",
      apartment: "3",
      domain: "ריצוף",
      description: uniq("של מנהל, לא של בעלים"),
      recipients: [PROS.full.name],
    });

    await loginAs(page, "owner");
    await page.goto(foreignPath);
    await expect(page.getByRole("heading", { name: "שרשור" })).toBeVisible();
    await expect(page.getByRole("button", { name: TICKET_SCREEN.close })).toHaveCount(0);

    const ownPath = await createTicket(page, {
      site: SITE_A,
      building: "בניין א",
      apartment: "1",
      domain: "חשמל",
      description: uniq("של הבעלים"),
      recipients: [PROS.full.name],
    });
    await page.goto(ownPath);
    await expect(page.getByRole("button", { name: TICKET_SCREEN.close })).toBeVisible();
  });

  test("A2-01 — בעלים קורא בכל האתרים", async ({ page }) => {
    await loginAs(page, "managerB");
    const description = uniq("אתר ב לבעלים");
    const path = await createTicket(page, {
      building: "בניין ג",
      apartment: "2",
      domain: "חשמל",
      description,
      recipients: [PROS.full.name],
    });

    await loginAs(page, "owner");
    await page.goto(path);
    await expect(page.getByText(description)).toBeVisible();
  });

  test("A2-05 — בעלים אינו עורך נמענים בפנייה שלא פתח", async ({ page }) => {
    await loginAs(page, "managerA");
    const path = await createTicket(page, {
      building: "בניין ב",
      apartment: "1",
      domain: "נגרות",
      description: uniq("עריכת נמענים לבעלים"),
      recipients: [PROS.full.name],
    });

    await loginAs(page, "owner");
    await page.goto(path);
    await expect(page.getByRole("button", { name: "+ איש מקצוע חדש" })).toHaveCount(0);
  });

  test("A2-08 — חמשת מסכי הניהול חסומים לבעלים", async ({ page }) => {
    await loginAs(page, "owner");
    for (const url of ADMIN_PAGES) {
      await page.goto(url);
      await expect(page, `${url} אמור להפנות ללוח`).toHaveURL(/\/board/);
    }
  });
});

test.describe("§5.ז — מנהל מערכת", () => {
  test("A1-05 — אדמין סוגר ופותח מחדש פנייה שפתח אחר", async ({ page }) => {
    await loginAs(page, "managerA");
    const path = await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain: "מיזוג",
      description: uniq("לסגירה בידי אדמין"),
      recipients: [PROS.full.name],
    });

    await loginAs(page, "admin");
    await page.goto(path);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: TICKET_SCREEN.close }).click();
    await expect(page.getByRole("status")).toContainText(TICKET_SCREEN.closedNotice);
    await expect(page.getByRole("button", { name: TICKET_SCREEN.reopen })).toBeVisible();
  });

  test("A1-01 — אדמין ניגש לפניות בשני האתרים", async ({ page }) => {
    await loginAs(page, "managerB");
    const description = uniq("אתר ב לאדמין");
    const path = await createTicket(page, {
      building: "בניין ג",
      apartment: "3",
      domain: "חשמל",
      description,
      recipients: [PROS.full.name],
    });

    await loginAs(page, "admin");
    await page.goto(path);
    await expect(page.getByText(description)).toBeVisible();
  });
});

test.describe("§5.ז — נמען פנימי", () => {
  test("A4-01/A4-04 — נמען פנימי באותו אתר מקבל את הפנייה בלוח הרגיל שלו", async ({
    page,
  }) => {
    await loginAs(page, "managerA");
    const description = uniq("שיוך פנימי");
    await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain: "חשמל",
      description,
      recipients: [CAST.managerA2.name],
    });

    await loginAs(page, "managerA2");
    await page.goto("/board?direction=received");
    await expect(page.getByText(description)).toBeVisible();
  });

  test("A4-03 — נמען פנימי מאתר אחר אינו ניתן לשיוך כלל", async ({ page }) => {
    /**
     * §5.ז קובע על נמען לטיפול: "אך ורק פניות ששויכו אליו, **מכל האתרים**",
     * ו-§2.2 שלב 3 קובע ש"נמען פנימי רואה את הפנייה בלוח הרגיל שלו".
     *
     * בפועל שני מנגנונים חוסמים את התרחיש: בורר הנמענים מציע רק משתמשים
     * של אותו אתר (`tickets/new/page.tsx:62`), ו-`canViewTicket` עבור
     * ‏SITE_MANAGER בודק אך ורק `viewer.siteId === ticket.siteId` בלי להביט
     * בשיוכים כלל (`permissions.ts:64`). הבדיקה מתעדת את המצב בפועל; הפער
     * מדווח ב-`conformance-report`.
     */
    await loginAs(page, "managerB");
    await page.goto("/tickets/new");
    await page.getByRole("button", { name: /^נמענים/ }).first().click();
    await expect(
      page.getByRole("option", { name: new RegExp(`^${CAST.managerA.name}`) }),
    ).toHaveCount(0);
    // ‏ADMIN ו-OWNER (שאינם משויכים לאתר) כן מוצעים — ולכן ההגבלה היא על
    // משתמשים משויכי-אתר בלבד.
    await expect(
      page.getByRole("option", { name: new RegExp(`^${CAST.owner.name}`) }),
    ).toBeVisible();
  });
});

test.describe("§4 מסך 9 — היקף ההרשאה מסנן את החיפוש", () => {
  test("S9-01 — מנהל אתר ב׳ אינו מוצא בחיפוש פנייה של אתר א׳", async ({ page }) => {
    await loginAs(page, "managerA");
    const needle = uniq("מחט");
    await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain: "חשמל",
      description: `תקלה ${needle}`,
      recipients: [PROS.full.name],
    });

    await loginAs(page, "managerA");
    await page.goto(`/search?q=${encodeURIComponent(needle)}`);
    await expect(page.getByText(needle)).toBeVisible();

    await loginAs(page, "managerB");
    await page.goto(`/search?q=${encodeURIComponent(needle)}`);
    await expect(page.getByText(needle)).toHaveCount(0);
  });
});
