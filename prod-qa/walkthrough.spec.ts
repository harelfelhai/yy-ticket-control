import { type Page, expect, test } from "@playwright/test";
import { openDetails } from "../e2e/ticket-screen";

/**
 * מעבר QA על הפרודקשן החי — כל המסך, וגם כתיבה.
 *
 * מה שזה מוסיף על `test:e2e:prod` שכבר רץ: בסיס נתונים אמיתי, **אחסון R2
 * אמיתי** (בבדיקות המקומיות `MEDIA_STORAGE=local`), משתני סביבה אמיתיים,
 * כותרות אבטחה אמיתיות ורשת אמיתית. אלה בדיוק הדברים שבנייה מקומית אינה
 * יכולה לאמת.
 *
 * כל ישות שנוצרת כאן נושאת את מזהה הריצה (`QA_RUN`) בשמה, וזה מה שמאפשר
 * ל-`run.mts` למחוק בדיוק את מה שנוצר ולא נגיעה אחת מעבר.
 */

const RUN = process.env.QA_RUN as string;
const PHONE = process.env.QA_PHONE as string;
const PASSWORD = process.env.QA_PASSWORD as string;

if (!RUN || !PHONE || !PASSWORD) throw new Error("הרץ דרך prod-qa/run.mts");

/** ‏PNG אמיתי 1×1 — הבדיקה מוודאת שהדפדפן מצייר אותו, וזבל היה נופל שם */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function login(page: Page) {
  await page.goto("/board");
  if (new URL(page.url()).pathname === "/login") {
    await page.getByLabel("טלפון או מייל").fill(PHONE);
    await page.getByLabel("סיסמה").fill(PASSWORD);
    await page.getByRole("button", { name: "כניסה" }).click();
  }
  await expect(page).toHaveURL(/\/board$/);
}

/**
 * ‏`exact: false` בכוונה: שם האפשרות בבורר הנמענים מכיל גם את הטלפון
 * (`"נגר qa… 0543291816"`), ולכן התאמה מדויקת לשם בלבד אינה מוצאת אותה.
 */
async function pick(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).first().click();
  await page.getByRole("option", { name: option }).first().click();
}

async function shot(page: Page, name: string, testInfo: { project: { name: string } }) {
  await page.screenshot({ path: `prod-qa/shots/${testInfo.project.name}/${name}.png` });
}

/** נכשל אם המסך החזיר שגיאת שרת או מסך שגיאה של Next */
async function assertNoError(page: Page) {
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).not.toContainText("Internal Server Error");
}

// ───────────────────────────────────────────────────────────────────────────
// **לא** `mode: "serial"`: הבדיקות אינן תלויות זו בזו (כל אחת מתחברת ויוצרת
// את הנתונים שלה), וב-serial כשל אחד היה מדלג על כל השאר ומסתיר ממצאים.

test("כל המסכים הפנימיים נטענים ומצולמים", async ({ page }, testInfo) => {
  await login(page);

  /**
   * **בלי לדרוש כותרת מכל מסך.** הניסיון הראשון נכשל על `/board` — ובצדק:
   * ללוח אין `<h1>` בכוונה, הוא מסך הבית ושם המערכת יושב ברצועת הניווט.
   * הדרישה הייתה השערה שלי על המבנה, לא תקן. מה שכן נדרש מכל מסך: סטטוס
   * תקין, תוכן שאינו ריק, ואפס מסך שגיאה.
   */
  const screens: [string, string][] = [
    ["/board", "01-board"],
    /*
     * ‏`/overview` ו-`/search` ירדו מהרשימה: שניהם בדלי הפניה מאז סבב
     * הצפיפות, וסריקה שלהם הייתה מאמתת פעמיים את היעד תחת שם שאינו שלו.
     * שני המסכים עצמם נשארים מכוסים — הסקירה בראש `/admin` שברשימה, והחיפוש
     * כמצב של הלוח כאן. ההפניות עצמן נבדקות בבדיקה נפרדת שמתחת.
     */
    [`/board?q=${encodeURIComponent("חשמל")}`, "02-board-search"],
    ["/tags", "04-tags"],
    ["/tickets/new", "05-ticket-new"],
    ["/tickets/batch", "06-batch"],
    ["/admin", "07-admin"],
    ["/admin/users", "08-admin-users"],
    ["/admin/professionals", "09-admin-professionals"],
    ["/admin/domains", "10-admin-domains"],
    ["/admin/sites", "11-admin-sites"],
  ];

  // מסך הבניינים (16) תלוי באתר קיים, ולכן הוא נשלף מרשימת האתרים ונוסף
  // לסריקה. בלעדיו הוא המסך היחיד שאינו נבדק כלל בסבב הפרודקשן.
  await page.goto("/admin/sites");
  const firstSite = page.locator('a[href^="/admin/sites/"]').first();
  if (await firstSite.count()) {
    const sitePath = await firstSite.getAttribute("href");
    if (sitePath) screens.push([sitePath, "12-admin-site-buildings"]);
  }

  for (const [path, name] of screens) {
    const response = await page.goto(path);
    expect(response?.status(), `${path} החזיר ${response?.status()}`).toBeLessThan(400);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("main")).not.toBeEmpty();
    await expect(page.getByRole("navigation")).toBeVisible();
    await assertNoError(page);
    await shot(page, name, testInfo);
  }
});

test("מסלול מלא: פנייה, מדיה ל-R2, פורטל, תגובה, סיום וסגירה", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "מסלול השטח — נייד בלבד");

  const description = `נזילה מתחת לכיור ${RUN}`;
  const contractor = `אינסטלטור ${RUN}`;

  // ── 1. יצירת פנייה עם תמונה מצורפת ────────────────────────────────
  await login(page);
  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await pick(page, "תחום", "אינסטלציה");
  await page.getByLabel("תיאור").fill(description);

  // **ההעלאה האמיתית ל-R2** — רישום, PUT ל-presigned URL, ואישור.
  await page
    .locator('input[type="file"][accept="image/*,application/pdf,video/*"]')
    .setInputFiles({ name: "qa.png", mimeType: "image/png", buffer: Buffer.from(PNG, "base64") });

  // העוגן הוא כפתור ההסרה, שנושא את שם הקובץ: התמונה עצמה נקראת "תמונה
  // מצורפת" ואינה מבדילה בין קבצים. ההמתנה להיעלמות "מעלה…" היא מה שמוודא
  // שההעלאה **הסתיימה** ולא רק התחילה — בלעדיה השיגור יוצא בלי המדיה.
  await expect(page.getByRole("button", { name: /הסר קובץ: qa\.png/ })).toBeVisible();
  await expect(page.getByText(/מעלה/)).toHaveCount(0);

  await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
  await page.getByLabel("שם").fill(contractor);
  await page.getByLabel("טלפון").fill(`053-${String(Date.now()).slice(-7)}`);
  await page.getByRole("button", { name: "שמור איש מקצוע" }).click();
  await expect(page.getByRole("list", { name: "נמענים", exact: true })).toContainText(contractor);

  await shot(page, "12-ticket-new-filled", testInfo);
  await page.getByRole("button", { name: "שלח לנמענים" }).click();
  await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible();
  const ticketUrl = new URL(page.url()).pathname;
  await shot(page, "13-ticket-detail", testInfo);

  // ── 2. הקישור האישי של הקבלן ──────────────────────────────────────
  // הנמענים ירדו לפאנל "פרטים" ב-0.3 (אפיון מסך 2 אזור ב׳).
  await openDetails(page);
  await page
    .getByRole("list", { name: "נמענים", exact: true })
    .getByRole("listitem")
    .filter({ hasText: contractor })
    .getByRole("button", { name: `קישור גישה ${contractor}` })
    .click();
  await expect(page.getByText(`קישור עבור ${contractor}`)).toBeVisible();
  const link = (
    await page.getByRole("textbox", { name: "קישור גישה", exact: true }).inputValue()
  ).replace(/^https?:\/\/[^/]+/, "");
  expect(link).toContain("/p/");

  // ── 3. הקבלן בפורטל: רשימה, פנייה, תגובה, סיום ────────────────────
  await page.goto(link);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(contractor);
  await shot(page, "14-portal-list", testInfo);

  await page.getByRole("link").filter({ hasText: description }).click();
  await assertNoError(page);
  /**
   * **הבדיקה היחידה שאי אפשר להריץ מקומית.** התמונה שהמנהל העלה חייבת
   * להיטען אצל הקבלן — כלומר לצאת מ-R2 ולחזור דרך ה-route שבודק הרשאה.
   * ‏`naturalWidth > 0` ולא קיום התגית: תגית שבורה קיימת גם היא.
   */
  // ‏`getByRole` ולא `main img`: **למסכי הפורטל אין `<main>`** (בשונה
  // מהמסכים הפנימיים) — ראו ההערה בסוף הקובץ.
  const image = page.getByRole("img", { name: "qa.png" });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await shot(page, "15-portal-ticket", testInfo);

  await page.getByLabel("תגובה").fill(`תוקן, מחליף את הסיפון ${RUN}`);
  await page.getByRole("button", { name: "שלח", exact: true }).click();
  await expect(page.getByText(`תוקן, מחליף את הסיפון ${RUN}`)).toBeVisible();

  await page.getByRole("button", { name: "סיימתי — טופל" }).click();
  await expect(page.getByText(/הועברה לאישור/)).toBeVisible();
  await shot(page, "16-portal-done", testInfo);

  // ── 4. המנהל רואה, מגיב וסוגר ─────────────────────────────────────
  await login(page);
  await page.goto(ticketUrl);
  await expect(page.getByText(`תוקן, מחליף את הסיפון ${RUN}`)).toBeVisible();
  await page.getByLabel("תגובה").fill(`מאשר ${RUN}`);
  await page.getByRole("button", { name: "שלח", exact: true }).click();
  await expect(page.getByText(`מאשר ${RUN}`)).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "סגור פנייה" }).click();
  // ‏`role="status"` ולא הטקסט: אחרי הסגירה **שני** אלמנטים נושאים את
  // המחרוזת — שורת הסיבה בכרטיס וההודעה החיובית — ו-strict mode פוסל
  // לוקטור שמוצא שניים. ההודעה היא זו שמוכרזת לקורא מסך, וזו שנבדקת.
  await expect(page.getByRole("status")).toContainText("הפנייה נסגרה");
  await shot(page, "17-ticket-closed", testInfo);
});

test("תגית: יצירה, פתיחה לקבלן וצ׳אט קבוצתי", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "מסלול השטח — נייד בלבד");

  const tagName = `בדק בית ${RUN}`;
  const description = `דלת לא נסגרת ${RUN}`;
  const contractor = `נגר ${RUN}`;

  await login(page);
  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין ב");
  await pick(page, "דירה", "3");
  await pick(page, "תחום", "נגרות");
  await page.getByLabel("תיאור").fill(description);
  await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
  await page.getByLabel("שם").fill(contractor);
  await page.getByLabel("טלפון").fill(`054-${String(Date.now()).slice(-7)}`);
  await page.getByRole("button", { name: "שמור איש מקצוע" }).click();
  await page.getByRole("button", { name: "שלח לנמענים" }).click();
  await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible();

  // תגית נלמדת — נוצרת מתוך מסך הפנייה, מתוך פאנל "פרטים"
  await openDetails(page);
  await page.getByRole("button", { name: /^הוסף תגית/ }).first().click();
  await page.getByRole("textbox", { name: /חיפוש/ }).fill(tagName);
  await page.getByRole("button", { name: /צור חדש/ }).click();
  await expect(page.getByRole("list", { name: "תגיות" })).toContainText(tagName);
  await shot(page, "18-ticket-tagged", testInfo);

  await page.goto("/tags");
  await page.getByRole("link").filter({ hasText: tagName }).click();
  await expect(page.getByRole("heading", { name: "מי רואה את הצ׳אט" })).toBeVisible();
  await shot(page, "19-tag-detail", testInfo);

  // פתיחת התגית לקבלן — הפעולה שחושפת צ׳אט לגורם חיצוני
  await pick(page, "פתח לקבלנים", contractor);
  await page.getByRole("button", { name: "פתח", exact: true }).click();
  await expect(page.getByRole("button", { name: `קישור גישה ${contractor}` })).toBeVisible();

  await page.getByLabel("תגובה").fill(`הודעה בצ׳אט הקבוצתי ${RUN}`);
  await page.getByRole("button", { name: "שלח", exact: true }).click();
  await expect(page.getByText(`הודעה בצ׳אט הקבוצתי ${RUN}`)).toBeVisible();
  await shot(page, "20-tag-chat", testInfo);
});

test("הזנה מרוכזת: שיגור קבוצתי וסיכום", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "מסך דסקטופ בלבד");

  await login(page);
  await page.goto("/tickets/batch");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "2");
  await page.getByLabel("תגית משותפת").fill(`סבב ${RUN}`);

  // תיאור **ותחום** בכל שורה: בלי תחום השרת דוחה בצדק ("הוסף לפחות שורה
  // אחת עם תיאור ותחום") — כך התגלה בריצה הראשונה שהבדיקה שלי הייתה חסרה.
  const rows = page.getByLabel("תיאור הליקוי");
  await rows.nth(0).fill(`שקע שרוף ${RUN}`);
  await rows.nth(1).fill(`חלון תקוע ${RUN}`);
  for (const [index, domain] of [
    [0, "חשמל"],
    [1, "אלומיניום"],
  ] as [number, string][]) {
    await page.getByRole("group", { name: `שורה ${index + 1}` }).getByRole("button", { name: /^תחום/ }).click();
    await page.getByRole("option", { name: domain }).first().click();
  }
  await shot(page, "21-batch-filled", testInfo);

  await page.getByRole("button", { name: "שמור הכל כטיוטה" }).click();
  // מסך הסיכום מזוהה בקישור שרק הוא מציג — הטקסט עצמו תלוי בכמה נוצרו.
  await expect(page.getByRole("link", { name: "פתח את התגית" })).toBeVisible();
  await expect(page.getByText(/נשמרו כטיוטה|נשמרה כטיוטה/)).toBeVisible();
  await shot(page, "22-batch-summary", testInfo);
});

test("ניהול: משתמש חדש, תחום חדש ושינוי שם", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "מסך דסקטופ בלבד");

  await login(page);

  // תחום חדש. אחרי ההוספה הוא מופיע ברשימה כשדה עריכה ש-`aria-label` שלו
  // הוא שם התחום — זה העוגן, ולא `getByDisplayValue` (אינו קיים ב-Playwright).
  await page.goto("/admin/domains");
  await page.getByLabel("תחום חדש").fill(`תחום ${RUN}`);
  await page.getByRole("button", { name: "הוסף תחום" }).click();
  await expect(page.getByLabel(`תחום ${RUN}`)).toBeVisible();
  await shot(page, "23-admin-domain-added", testInfo);

  // משתמש חדש — נשאר `ADMIN` (ברירת המחדל היא מנהל עבודה, שחייב אתר)
  await page.goto("/admin/users");
  await page.getByLabel("שם", { exact: true }).fill(`משתמש ${RUN}`);
  await page.getByLabel("טלפון", { exact: true }).fill(`055${String(Date.now()).slice(-7)}`);
  await page.getByLabel("תפקיד").selectOption({ label: "מנהל מערכת" });
  await page.getByLabel("סיסמה ראשונית").fill(`Qa!${RUN}xyz`);
  await page.getByRole("button", { name: "הוסף משתמש" }).click();
  await expect(page.getByText(`משתמש ${RUN}`)).toBeVisible();
  await shot(page, "24-admin-user-added", testInfo);
});

/**
 * הרצועה מסננת בפועל — **הבדיקה שירשה את מסנן התאריכים.**
 *
 * הבדיקה שהייתה כאן מילאה "מתאריך" במסך החיפוש. שני אלה ירדו יחד בסבב
 * הצפיפות: המסך אוחד לתוך הלוח, ופקדי התאריך לא עברו איתו. מה שהיא באמת
 * שמרה עליו אינו השדה אלא **השרשרת**: פקד → כתובת → שאילתה בשרת, על
 * פרודקשן אמיתי ולא על בנייה מקומית. כאן היא נבדקת דרך מסנן הכיוון.
 *
 * המילוי חוזר על עצמו עד שהכתובת מתעדכנת, כמו בכל שאר הסוויטות: הפקדים
 * מנווטים ב-`onChange` → `router.replace`, ובחירה לפני ההידרציה נבלעת
 * בשקט. על רשת אמיתית החלון הזה רחב יותר מאשר מקומית, לא צר.
 */
test("הלוח: מסנן שנבחר מגיע לכתובת ומסנן בפועל", async ({ page }, testInfo) => {
  await login(page);
  await page.goto("/board");

  await expect
    .poll(
      async () => {
        await page.getByLabel("הפניתי", { exact: true }).selectOption("opened");
        return new URL(page.url()).search;
      },
      { timeout: 20_000, message: "המסנן לא הגיע לכתובת" },
    )
    .toContain("direction=opened");

  // ‏"נקה מסננים" נחשף רק כשיש מסנן פעיל — כלומר השרת באמת קרא את הפרמטר
  // והמסך מסביר את עצמו. בלי זה הטענה היא על הכתובת בלבד.
  await expect(page.getByRole("button", { name: "נקה מסננים" })).toBeVisible();
  await assertNoError(page);
  await shot(page, "25-board-filtered", testInfo);
});

/**
 * הכתובות הישנות ממשיכות לעבוד — **וזה נבדק דווקא בפרודקשן.**
 *
 * ‏`/search` ו-`/overview` נשארו כבדלי הפניה מפני שהן יצאו החוצה: קישורים
 * בוואטסאפ, סימניות של מנהלים, היסטוריית דפדפן. ההבטחה הזו חלה על השרת
 * החי ולא על בנייה מקומית, ולכן זה המקום היחיד שבו יש טעם לאמת אותה.
 */
test("הכתובות שהוחלפו מפנות ואינן 404", async ({ page }) => {
  await login(page);

  const term = "חשמל";
  const searchResponse = await page.goto(`/search?q=${encodeURIComponent(term)}`);
  expect(searchResponse?.status(), "‏/search החזיר שגיאה").toBeLessThan(400);
  await expect(page).toHaveURL(/\/board\?/);
  expect(new URL(page.url()).searchParams.get("q")).toBe(term);

  const overviewResponse = await page.goto("/overview");
  expect(overviewResponse?.status(), "‏/overview החזיר שגיאה").toBeLessThan(400);
  await expect(page).toHaveURL(/\/admin$/);
  await assertNoError(page);
});
