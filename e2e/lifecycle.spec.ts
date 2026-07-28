import { type Page, expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";

/**
 * התרחיש המרכזי של M1, מקצה לקצה ודרך הממשק בלבד:
 *
 * מנהל פותח פנייה → משייך שני קבלנים → אחד מסמן "טופל" והשני שואל שאלה
 * → הפנייה עוברת ל"דורש ממך" עם הסיבה הנכונה → המנהל עונה → השני מסמן
 * טופל → סגירה → פתיחה מחדש.
 *
 * זו הבדיקה שמאמתת שהמערכת עושה את מה שהיא נועדה לעשות. היא עוברת גם
 * בפורטל הקבלן, שהוא סביבה נפרדת עם אימות אחר לגמרי.
 */

/**
 * מחזיר את הדפדפן למצב "מנהל מחובר".
 *
 * אידמפוטנטי בכוונה: התרחיש עובר הלוך ושוב בין המנהל לפורטל הקבלן, וסשן
 * המנהל שורד את הביקור בפורטל (הפורטל אינו משתמש בעוגייה). קריאה חוזרת
 * ל-/login הייתה מופנית ללוח, ואז הטופס שהבדיקה מחפשת אינו קיים.
 */
async function loginAsManager(page: Page) {
  await page.goto("/board");
  if (new URL(page.url()).pathname === "/login") {
    await page.getByLabel("טלפון או מייל").fill(E2E_ADMIN.phone);
    await page.getByLabel("סיסמה").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "כניסה" }).click();
  }
  await expect(page).toHaveURL(/\/board$/);
}

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).first().click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function addProfessional(page: Page, name: string, phone: string) {
  await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
  await page.getByLabel("שם").fill(name);
  await page.getByLabel("טלפון").fill(phone);
  await page.getByRole("button", { name: "שמור איש מקצוע" }).click();
  await expect(page.getByRole("list", { name: "נמענים", exact: true })).toContainText(name);
}

function recipientRow(page: Page, contractorName: string) {
  return page
    .getByRole("list", { name: "נמענים", exact: true })
    .getByRole("listitem")
    .filter({ hasText: contractorName });
}

/** מציג את קישור הפורטל של קבלן מתוך מסך הפנייה ומחזיר אותו */
async function showLink(page: Page, contractorName: string): Promise<string> {
  await recipientRow(page, contractorName)
    .getByRole("button", { name: `קישור גישה ${contractorName}` })
    .click();

  // ההמתנה היא לכותרת שנושאת את שם הנמען, ולא רק לתיבה: בפנייה עם כמה
  // קבלנים התיבה כבר גלויה עם הקישור הקודם, וקריאה מוקדמת הייתה מחזירה
  // את הקישור של הקבלן הקודם.
  await expect(page.getByText(`קישור עבור ${contractorName}`)).toBeVisible();
  const field = page.getByRole("textbox", { name: "קישור גישה", exact: true });
  return (await field.inputValue()).replace(/^https?:\/\/[^/]+/, "");
}

test("מחזור חיים מלא: יצירה, שני קבלנים, שאלה, מענה, סגירה ופתיחה מחדש", async ({
  page,
}) => {
  const stamp = Date.now();
  const description = `אין חשמל בסלון ${stamp}`;
  const electrician = `חשמלאי ${stamp}`;
  const plumber = `אינסטלטור ${stamp}`;

  // ── 1. המנהל פותח פנייה ומשייך שני קבלנים ─────────────────────────
  await loginAsManager(page);
  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await pick(page, "תחום", "חשמל");
  await page.getByLabel("תיאור").fill(description);
  await addProfessional(page, electrician, `050-${String(stamp).slice(-7)}`);
  await addProfessional(page, plumber, `052-${String(stamp).slice(-7)}`);
  await page.getByRole("button", { name: "שלח לנמענים" }).click();
  await expect(page.getByRole("heading", { name: "שרשור" })).toBeVisible();

  const ticketUrl = new URL(page.url()).pathname;
  const ticketId = ticketUrl.split("/").pop() as string;
  await expect(page.getByText("חדש", { exact: true })).toBeVisible();

  const electricianLink = await showLink(page, electrician);
  const plumberLink = await showLink(page, plumber);

  // ── 2. הקבלן הראשון פותח את הקישור ומסמן שסיים ────────────────────
  await page.goto(electricianLink);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(electrician);

  await page.getByRole("link").filter({ hasText: description }).click();
  await page.getByRole("button", { name: "סיימתי — טופל" }).click();
  await expect(page.getByText("תודה. הפנייה הועברה לאישור מנהל ראשי.")).toBeVisible();

  // ── 3. הקבלן השני שואל שאלה ───────────────────────────────────────
  await page.goto(plumberLink);
  await page.getByRole("link").filter({ hasText: description }).click();
  await page.getByLabel("תגובה").fill("איפה הכניסה לדירה?");
  await page.getByRole("button", { name: "יש לי שאלה" }).click();
  await expect(page.getByText("השאלה נשלחה למנהל ראשי.")).toBeVisible();

  // ── 4. אצל המנהל: הפנייה ב"דורש ממך", והסיבה היא השאלה ───────────
  await loginAsManager(page);
  await page.goto("/board");
  const card = page.getByRole("link").filter({ hasText: description });
  await expect(card).toContainText(`${plumber} שאל שאלה`);

  await card.click();
  await expect(page.getByRole("heading", { name: "שרשור" })).toBeVisible();
  await expect(page.getByText("איפה הכניסה לדירה?")).toBeVisible();

  // ── 5. המנהל עונה, והקבלן השני מסמן שסיים ─────────────────────────
  await page.getByLabel("תגובה").fill("הכניסה מהחניון, קוד 1234");
  await page.getByRole("button", { name: "שלח", exact: true }).click();
  await expect(page.getByText("הכניסה מהחניון, קוד 1234")).toBeVisible();

  await page.goto(plumberLink);
  await page.getByRole("link").filter({ hasText: description }).click();
  await expect(page.getByText("הכניסה מהחניון, קוד 1234")).toBeVisible();
  await page.getByRole("button", { name: "סיימתי — טופל" }).click();
  await expect(page.getByText("תודה. הפנייה הועברה לאישור מנהל ראשי.")).toBeVisible();

  // ── 6. כולם סיימו — הפנייה ממתינה לאישור ─────────────────────────
  await loginAsManager(page);
  await page.goto(ticketUrl);
  await expect(page.getByText("כולם סיימו — ממתין לאישור")).toBeVisible();

  // ── 7. סגירה ────────────────────────────────────────────────────
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "סגור פנייה" }).click();
  await expect(page.getByText("סגור", { exact: true })).toBeVisible();

  // הקבלן כבר אינו יכול להגיב (אפיון §5.ו).
  // ניגשים ישירות לפנייה: אחרי הסגירה היא עוברת לארכיון המקופל בפורטל,
  // וזו התנהגות תקינה — הקבלן לא אמור לראות אותה בין המשימות הפתוחות.
  await page.goto(`${plumberLink}/${ticketId}`);
  await expect(page.getByText("הפנייה נסגרה. פנה למנהל העבודה.")).toBeVisible();

  // ── 8. פתיחה מחדש מאפסת את השיוכים ───────────────────────────────
  await loginAsManager(page);
  await page.goto(ticketUrl);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "פתח מחדש" }).click();

  // exact: התג "נפתחה מחדש" והודעת הסטטוס "הפנייה נפתחה מחדש..." שניהם מכילים
  // את הביטוי; ה-exact מכוון לתג עצמו.
  await expect(page.getByText("נפתחה מחדש", { exact: true })).toBeVisible();
  await expect(page.getByText("חדש", { exact: true })).toBeVisible();
  // שני השיוכים חזרו ל"נשלח" — העבודה לא הושלמה, וזה חייב להיות גלוי.
  await expect(
    page.getByRole("list", { name: "נמענים", exact: true }).getByText("נשלח", { exact: true }),
  ).toHaveCount(2);
});

test("הקישור יציב בין שליחות, ו'צור קישור חדש' מבטל את הקודם", async ({ page }) => {
  const stamp = Date.now();
  const description = `תקלה ${stamp}`;
  const contractor = `קבלן ${stamp}`;

  await loginAsManager(page);
  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await pick(page, "תחום", "חשמל");
  await page.getByLabel("תיאור").fill(description);
  await addProfessional(page, contractor, `053-${String(stamp).slice(-7)}`);
  await page.getByRole("button", { name: "שלח לנמענים" }).click();
  await expect(page.getByRole("heading", { name: "שרשור" })).toBeVisible();

  // הצגה חוזרת מחזירה את **אותו** קישור. זו הסיבה שאפשר לשלוח שוב בבטחה:
  // הודעה ישנה בוואטסאפ של הקבלן ממשיכה לעבוד.
  const firstLink = await showLink(page, contractor);
  await page.reload();
  expect(await showLink(page, contractor)).toBe(firstLink);

  // "צור קישור חדש" הוא המענה לקישור שדלף, ולכן הוא הורג את הקודם.
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "צור קישור חדש" }).click();
  await expect(page.getByText("הקישור הקודם בוטל. שלח לנמען את החדש.")).toBeVisible();
  const rotated = (
    await page.getByRole("textbox", { name: "קישור גישה", exact: true }).inputValue()
  ).replace(/^https?:\/\/[^/]+/, "");
  expect(rotated).not.toBe(firstLink);

  await page.goto(firstLink);
  await expect(page.getByText("הקישור אינו בתוקף")).toBeVisible();

  await page.goto(rotated);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(contractor);
});

test("כפתור וואטסאפ מוכן לשליחה, וחיווי השליחה אומר את האמת", async ({ page }) => {
  const stamp = Date.now();
  const description = `נזילה במטבח ${stamp}`;
  const contractor = `קבלן ${stamp}`;
  const digits = String(stamp).slice(-7);

  await loginAsManager(page);
  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await pick(page, "תחום", "חשמל");
  await page.getByLabel("תיאור").fill(description);
  await addProfessional(page, contractor, `055-${digits}`);
  await page.getByRole("button", { name: "שלח לנמענים" }).click();
  await expect(page.getByRole("heading", { name: "שרשור" })).toBeVisible();

  // לקבלן הזה אין מייל, ולכן המערכת לא שלחה לו דבר — וזה נאמר במפורש.
  // "נשלח" בסטטוס פירושו ששייכנו אותו, לא שהוא יודע.
  const row = recipientRow(page, contractor);
  await expect(row).toContainText("אין מייל — שלח בוואטסאפ");

  const whatsapp = row.getByRole("link", { name: `שלח בוואטסאפ ${contractor}` });
  const href = await whatsapp.getAttribute("href");

  expect(href).toContain(`https://wa.me/97255${digits}?text=`);

  // ההודעה מוכנה בכתובת: שם הקבלן, המיקום, התיאור, והקישור האישי שלו.
  const text = decodeURIComponent(new URL(href as string).searchParams.get("text") ?? "");
  expect(text).toContain(`שלום ${contractor}`);
  expect(text).toContain("בניין א דירה 1, חשמל");
  expect(text).toContain(description);
  expect(text).toContain("/p/");
});

/**
 * שני הכללים שנוגעים להסרת קבלן, ושקל להחליף ביניהם:
 *
 * 1. **הרשאה נבדקת בכל בקשה.** קישור תקף לחלוטין מפסיק לפתוח פנייה שהוסר
 *    ממנה — וזו הסיבה שאפשר להשאיר קישורים ללא תפוגה.
 * 2. **קישור מבוטל כשלא נשאר כלום.** קבלן בלי שיוכים אינו אמור להחזיק סוד
 *    חי, גם אם ממילא לא היה רואה דבר.
 *
 * הבדיקה עוברת את שניהם ברצף על אותו קבלן, כי בדיקה של השני בלבד הייתה
 * מסתירה את הראשון: הקישור מת ממילא, ואי אפשר לדעת אם ההרשאה נבדקה.
 */
test("קבלן שהוסר מאבד את הפנייה מיידית, ואת הקישור רק כשלא נשאר לו כלום", async ({
  page,
}) => {
  const stamp = Date.now();
  const first = `תקלה א ${stamp}`;
  const second = `תקלה ב ${stamp}`;
  const contractor = `קבלן ${stamp}`;

  async function openTicket(description: string, apartment: string, existing: boolean) {
    await page.goto("/tickets/new");
    await pick(page, "בניין", "בניין א");
    await pick(page, "דירה", apartment);
    await pick(page, "תחום", "חשמל");
    await page.getByLabel("תיאור").fill(description);

    if (existing) {
      await page.getByRole("button", { name: /^נמענים/ }).first().click();
      await page.getByRole("option", { name: contractor }).click();
    } else {
      await addProfessional(page, contractor, `054-${String(stamp).slice(-7)}`);
    }

    await page.getByRole("button", { name: "שלח לנמענים" }).click();
    await expect(page.getByRole("heading", { name: "שרשור" })).toBeVisible();
  }

  async function removeFrom(description: string) {
    await page.goto("/board");
    await page.getByRole("link").filter({ hasText: description }).click();
    // הסרת נמען מציגה אישור (אפיון מסך 3): הפנייה תיעלם מרשימתו.
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: `הסר ${contractor}` }).click();
    await expect(page.getByRole("list", { name: "נמענים שהוסרו" })).toContainText(contractor);
  }

  await loginAsManager(page);
  await openTicket(first, "1", false);
  const link = await showLink(page, contractor);
  await openTicket(second, "2", true);

  await page.goto(link);
  await expect(page.getByRole("link").filter({ hasText: first })).toBeVisible();
  await expect(page.getByRole("link").filter({ hasText: second })).toBeVisible();

  // ── כלל 1: הוסר מפנייה אחת — אותו קישור, בלעדיה ──────────────────
  await loginAsManager(page);
  await removeFrom(first);

  await page.goto(link);
  await expect(page.getByRole("link").filter({ hasText: second })).toBeVisible();
  await expect(page.getByRole("link").filter({ hasText: first })).toHaveCount(0);

  // ── כלל 2: הוסר מהאחרונה — הקישור עצמו מת ────────────────────────
  await loginAsManager(page);
  await removeFrom(second);

  await page.goto(link);
  await expect(page.getByText("הקישור אינו בתוקף")).toBeVisible();
});

test("פתיחת הקישור מסמנת 'נצפה' אצל המנהל", async ({ page }) => {
  const stamp = Date.now();
  const description = `בדיקת נצפה ${stamp}`;
  const contractor = `קבלן נצפה ${stamp}`;

  await loginAsManager(page);
  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await pick(page, "תחום", "חשמל");
  await page.getByLabel("תיאור").fill(description);
  await addProfessional(page, contractor, `054-${String(stamp).slice(-7)}`);
  await page.getByRole("button", { name: "שלח לנמענים" }).click();
  await expect(page.getByRole("heading", { name: "שרשור" })).toBeVisible();

  const ticketUrl = new URL(page.url()).pathname;
  const link = await showLink(page, contractor);

  // הקבלן פותח את הפנייה עצמה — הפתיחה היא שמסמנת "נצפה" (בלי פעולה נוספת).
  await page.goto(link);
  await page.getByRole("link").filter({ hasText: description }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("דירה 1");

  // המנהל רואה עכשיו "נצפה" ברצועת הנמענים — כך הוא יודע שהקישור הגיע ליעדו.
  await loginAsManager(page);
  await page.goto(ticketUrl);
  await expect(
    page.getByRole("list", { name: "נמענים", exact: true }).getByText("נצפה", { exact: true }),
  ).toBeVisible();
});
