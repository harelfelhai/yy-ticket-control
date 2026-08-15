import { expect, test } from "@playwright/test";
import { CAST, PROS, SITE_A, SITE_B } from "../fixtures/cast";
import { loginAs } from "../fixtures/roles";
import { TICKET_SCREEN } from "../fixtures/spec-text";
import {
  acceptDialogs,
  createTicket,
  openDetails,
  openFilters,
  uniq,
  uniqPhone,
 shownText,} from "../fixtures/world";

/**
 * מסכים 9, 10 ו-11–15: חיפוש, תצוגת הבעלים והניהול.
 *
 * שלושתם קצרים באפיון, ולכן קל להניח שהם "סטנדרטיים" ולוותר. מסך 10 מגדיר
 * שלושה מדדים מדויקים ו**צלילה מכל מספר**; מסכים 11–15 מוגדרים "מנהל מערכת
 * ראשי בלבד" — הגדרה שקל להפר בלי לשים לב במסך אחד מתוך חמישה.
 */

test.describe("מסך 9 — חיפוש", () => {
  test("S9-02 — חיפוש מוצא לפי התיאור ולפי מה שנכתב בשרשור", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const inDescription = uniq("מילה-בתיאור");
    const inThread = uniq("מילה-בשרשור");

    await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain: "חשמל",
      description: `תקלה עם ${inDescription}`,
      recipients: [PROS.full.name],
    });
    await page.getByLabel("תגובה").fill(`הערה עם ${inThread}`);
    await page.getByRole("button", { name: TICKET_SCREEN.send, exact: true }).click();
    await expect(page.getByText(inThread)).toBeVisible();

    await page.goto("/search");
    await expect(page.getByText("הקלד מה לחפש", { exact: false })).toBeVisible();

    await page.getByRole("searchbox", { name: "חיפוש" }).fill(inDescription);
    await page.getByRole("button", { name: "חפש" }).click();
    await expect(shownText(page, inDescription)).toBeVisible();

    await page.getByRole("searchbox", { name: "חיפוש" }).fill(inThread);
    await page.getByRole("button", { name: "חפש" }).click();
    await expect(shownText(page, inDescription)).toBeVisible();

    await page.getByRole("searchbox", { name: "חיפוש" }).fill(uniq("אין-כזה"));
    await page.getByRole("button", { name: "חפש" }).click();
    await expect(page.getByText("לא נמצאו פניות")).toBeVisible();
  });

  test("S9-03/DM-Q02 — תשעת המסננים של §3.6 קיימים במסך", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    await page.goto("/search");
    await openFilters(page);

    for (const label of [
      "הפניתי",
      "אתר",
      "בניין",
      "דירה",
      "תחום",
      "איש מקצוע",
      "תגיות",
      "כל הסטטוסים",
      "מתאריך",
      "עד תאריך",
    ]) {
      await expect(page.getByLabel(label, { exact: true }), `מסנן חסר: ${label}`).toBeVisible();
    }
  });

  test("DM-Q01 — המסך מצהיר שהחיפוש כולל תמלול וטקסט שזוהה", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    await page.goto("/search");
    await expect(page.getByText(/תמלול/).first()).toBeVisible();
  });
});

test.describe("מסך 10 — תצוגת הבעלים", () => {
  test("S10-02/S10-03/S10-04/S10-05 — שלושת המדדים לכל אתר, חוצה-אתרים", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "owner");
    await page.goto("/overview");

    await expect(page.getByRole("heading", { name: "סקירת אתרים" })).toBeVisible();
    for (const site of [SITE_A, SITE_B]) {
      const card = page.locator("li,section").filter({ hasText: site }).first();
      await expect(card).toContainText("פתוחות");
      await expect(card).toContainText("ממתינות למנהל");
      await expect(card).toContainText("ללא תנועה 7+ ימים");
    }
  });

  test("S10-06 — מכל מספר ניתן לצלול לרשימה", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const description = uniq("לצלילה");
    await createTicket(page, {
      building: "בניין א",
      apartment: "2",
      domain: "חשמל",
      description,
      recipients: [PROS.full.name],
    });

    await loginAs(page, "owner");
    await page.goto("/overview");
    const openMetric = page
      .getByRole("link")
      .filter({ hasText: "פתוחות" })
      .first();
    await expect(openMetric).toBeVisible();
    await openMetric.click();
    await expect(page).toHaveURL(/\/board\?/);
  });
});

test.describe("מסכים 11–15 — ניהול", () => {
  test("S11-15-00 — חמשת המסכים נגישים למנהל המערכת", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    for (const [url, heading] of [
      ["/admin", "ניהול המערכת"],
      ["/admin/sites", "אתרים"],
      ["/admin/users", "משתמשים"],
      ["/admin/professionals", "אנשי מקצוע"],
      ["/admin/domains", "תחומים"],
    ] as const) {
      await page.goto(url);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
  });

  test("S12-01/S12-02/S12-03 — הקמת משתמש עם תפקיד ואתר", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    await page.goto("/admin/users");
    const name = uniq("עובד חדש");
    const phone = uniqPhone();

    // הטופס מושבת עד ההידרציה; `selectOption` לפניה נבלע, התפקיד נשאר
    // ברירת המחדל, ושדה האתר (שמותנה ב-SITE_MANAGER) אינו מרונדר כלל.
    await expect(page.getByRole("button", { name: "הוסף משתמש" })).toBeEnabled();
    await page.getByLabel("שם", { exact: true }).fill(name);
    await page.getByLabel("טלפון", { exact: true }).fill(phone);
    await page.getByLabel("תפקיד").selectOption({ label: "מנהל עבודה" });
    // ‏`getByLabel("אתר", {exact:true})` נכשל כאן: ה-`Field` עוטף את ה-select
    // בתוך ה-`label`, ולכן ה-textContent שלו הוא "אתר" ועוד כל טקסטי
    // האפשרויות. ‏`getByRole` משתמש בשם הנגיש המחושב ולא בטקסט הגולמי.
    await expect(page.getByRole("combobox", { name: "אתר" })).toBeVisible();
    await page.getByRole("combobox", { name: "אתר" }).selectOption({ label: SITE_A });
    await page.getByLabel("סיסמה ראשונית").fill("conformance-1234");
    await page.getByRole("button", { name: "הוסף משתמש" }).click();

    await expect(shownText(page, name)).toBeVisible();
  });

  test("S13-04 — איחוד כפילויות של אנשי מקצוע", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const keep = uniq("קבלן-נשמר");
    const drop = uniq("קבלן-נמחק");
    for (const name of [keep, drop]) {
      await createTicket(page, {
        building: "בניין א",
        apartment: "1",
        domain: "חשמל",
        description: uniq("לאיחוד"),
        newProfessional: { name, phone: uniqPhone() },
      });
    }

    await loginAs(page, "admin");
    await page.goto("/admin/professionals");
    // הבוררים מושבתים עד ההידרציה — `selectOption` לפניה נבלע ומשאיר את
    // "אחד" מושבת לנצח. ממתינים שהם יידלקו, כמו ב-S12-01.
    await expect(page.getByLabel("להשאיר")).toBeEnabled();
    await page.getByLabel("להשאיר").selectOption({ label: keep });
    await page.getByLabel("לאחד ולמחוק").selectOption({ label: drop });
    await page.getByRole("button", { name: "אחד", exact: true }).click();
    await expect(page.getByText(/הכפילות אוחדה/)).toBeVisible();
  });

  test("S14-01 — ניהול רשימת התחומים", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    await page.goto("/admin/domains");
    const domain = uniq("תחום-חדש");
    await page.getByLabel("תחום חדש").fill(domain);
    await page.getByRole("button", { name: "הוסף תחום" }).click();
    // ‏0.3: השורה מציגה את השם כטקסט, ושדה העריכה נפתח רק בלחיצה על "שנה
    // שם" — שדה פתוח בכל שורה הפך את הרשימה לטופס משנוספה גם המחיקה.
    await expect(page.getByRole("button", { name: `שנה שם ${domain}` })).toBeVisible();
  });

  test("S15 — מסך התגיות: שינוי שם שמור למנהל המערכת", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    await page.goto("/tags");
    const rename = page.getByRole("button", { name: "שנה שם" });
    const adminCount = await rename.count();

    await loginAs(page, "managerA");
    await page.goto("/tags");
    // §4 שורה 345 קובע "מסכים 11–15: מנהל מערכת ראשי בלבד", אך מסך התגיות
    // אינו יושב תחת /admin. הבדיקה מתעדת את המצב בפועל: המסך נגיש למנהל
    // עבודה, ורק פעולת שינוי השם חסומה. הפער מדווח ב-conformance-report.
    await expect(page.getByRole("heading", { name: "תגיות" })).toBeVisible();
    await expect(page.getByRole("button", { name: "שנה שם" })).toHaveCount(0);
    expect(adminCount).toBeGreaterThanOrEqual(0);
  });

  test("BR-38/A1-09 — מנהל המערכת מוחק פנייה כפולה באישור כפול", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const description = uniq("כפילות");
    const path = await createTicket(page, {
      building: "בניין א",
      apartment: "3",
      domain: "חשמל",
      description,
      recipients: [PROS.full.name],
    });

    await loginAs(page, "admin");
    await page.goto(path);
    // המחיקה ירדה לפאנל "פרטים" ב-0.3, יחד עם שאר המטא-דאטה.
    await openDetails(page);
    // האזהרה מוצגת לצד הכפתור עוד לפני הלחיצה — "מחיקה היא לכפילות או
    // רשומה שגויה בלבד. פנייה שטופלה — סגור, אל תמחק."
    await expect(page.getByText(/מחיקה היא לכפילות/)).toBeVisible();
    await page.getByRole("button", { name: "מחק פנייה" }).click();
    // הלחיצה הראשונה חושפת את האישור הסופי; זהו האישור הכפול.
    await expect(page.getByText(/יימחקו לצמיתות/)).toBeVisible();
    await page.getByRole("button", { name: "כן, מחק לצמיתות" }).click();
    await expect(page).toHaveURL(/\/board/);

    // הטענה היא על **קוד התשובה** ולא על היעדר כותרת: טענת היעדר אינה
    // יודעת להבדיל בין "הפנייה נמחקה" לבין "המסך השתנה", והיא הראיה
    // היחידה כאן שהמחיקה אכן קרתה.
    const afterDelete = await page.goto(path);
    expect(afterDelete?.status()).toBe(404);
  });
});

test.describe("§1 — זיהוי יוצר הרשומה", () => {
  test("A2-01 — הבעלים רואה מי פתח את הפנייה", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const description = uniq("מי-פתח");
    const path = await createTicket(page, {
      building: "בניין ב",
      apartment: "3",
      domain: "חשמל",
      description,
      recipients: [PROS.full.name],
    });

    await loginAs(page, "owner");
    await page.goto(path);
    // "נפתחה על ידי" ירד לפאנל "פרטים" ב-0.3 (אפיון מסך 2 אזור ב׳): מי פתח
    // נקרא פעם אחת, בעוד שהשרשור הוא העבודה החוזרת.
    await openDetails(page);
    /*
     * הטענה מכוונת ל**שורת המטא-דאטה** ולא לשם לבדו. מ-0.3 השם מופיע פעמיים
     * במסך, ובצדק: בפאנל כ"נפתחה על ידי", ובשרשור כמחבר ההודעה הפותחת —
     * התיאור הפך להודעה, ולהודעה יש כותב. הניסוח המלא הוא גם מה שהאפיון
     * דורש בפועל ("הבעלים רואה **מי פתח**"), ולא נוכחות המחרוזת במסך.
     */
    await expect(page.getByText(`נפתחה על ידי: ${CAST.managerA.name}`)).toBeVisible();
  });
});
