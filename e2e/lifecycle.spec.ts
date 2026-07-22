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

/** מנפיק קישור פורטל לקבלן מתוך מסך הפנייה ומחזיר אותו */
async function issueLink(page: Page, contractorName: string): Promise<string> {
  const row = page
    .getByRole("list", { name: "נמענים", exact: true })
    .getByRole("listitem")
    .filter({ hasText: contractorName });

  await row.getByRole("button", { name: "צור קישור גישה" }).click();

  // ההמתנה היא לכותרת שנושאת את שם הנמען, ולא רק לתיבה: בפנייה עם כמה
  // קבלנים התיבה כבר גלויה עם הקישור הקודם, וקריאה מוקדמת הייתה מחזירה
  // את הקישור של הקבלן הקודם.
  await expect(page.getByText(`קישור עבור ${contractorName}`)).toBeVisible();
  const field = page.getByRole("textbox", { name: "צור קישור גישה" });
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

  const electricianLink = await issueLink(page, electrician);
  const plumberLink = await issueLink(page, plumber);

  // ── 2. הקבלן הראשון פותח את הקישור ומסמן שסיים ────────────────────
  await page.goto(electricianLink);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(electrician);

  await page.getByRole("link").filter({ hasText: description }).click();
  await page.getByRole("button", { name: "סיימתי — טופל" }).click();
  await expect(page.getByText("סימנת שטופל. מנהל העבודה יאשר ויסגור.")).toBeVisible();

  // ── 3. הקבלן השני שואל שאלה ───────────────────────────────────────
  await page.goto(plumberLink);
  await page.getByRole("link").filter({ hasText: description }).click();
  await page.getByLabel("תגובה").fill("איפה הכניסה לדירה?");
  await page.getByRole("button", { name: "יש לי שאלה" }).click();
  await expect(page.getByText("השאלה נשלחה למנהל העבודה.")).toBeVisible();

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
  await expect(page.getByText("סימנת שטופל. מנהל העבודה יאשר ויסגור.")).toBeVisible();

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

  await expect(page.getByText("נפתחה מחדש")).toBeVisible();
  await expect(page.getByText("חדש", { exact: true })).toBeVisible();
  // שני השיוכים חזרו ל"נשלח" — העבודה לא הושלמה, וזה חייב להיות גלוי.
  await expect(
    page.getByRole("list", { name: "נמענים", exact: true }).getByText("נשלח", { exact: true }),
  ).toHaveCount(2);
});

test("קישור שבוטל אינו פותח את הפורטל", async ({ page }) => {
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

  const firstLink = await issueLink(page, contractor);
  await page.reload();
  const secondLink = await issueLink(page, contractor);
  expect(secondLink).not.toBe(firstLink);

  await page.goto(firstLink);
  await expect(page.getByText("הקישור אינו בתוקף")).toBeVisible();

  await page.goto(secondLink);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(contractor);
});

test("קבלן שהוסר מאבד גישה מיידית, גם עם קישור תקף", async ({ page }) => {
  const stamp = Date.now();
  const description = `תקלה ${stamp}`;
  const contractor = `קבלן ${stamp}`;

  await loginAsManager(page);
  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await pick(page, "תחום", "חשמל");
  await page.getByLabel("תיאור").fill(description);
  await addProfessional(page, contractor, `054-${String(stamp).slice(-7)}`);
  await page.getByRole("button", { name: "שלח לנמענים" }).click();
  await expect(page.getByRole("heading", { name: "שרשור" })).toBeVisible();

  const link = await issueLink(page, contractor);
  await page.goto(link);
  await expect(page.getByRole("link").filter({ hasText: description })).toBeVisible();

  // המנהל מסיר אותו
  await loginAsManager(page);
  await page.goto("/board");
  await page.getByRole("link").filter({ hasText: description }).click();
  await page.getByRole("button", { name: `הסר ${contractor}` }).click();
  await expect(page.getByRole("list", { name: "נמענים שהוסרו" })).toContainText(contractor);

  // אותו קישור בדיוק — הפנייה כבר לא שם
  await page.goto(link);
  await expect(page.getByText("אין כרגע פניות פתוחות אצלך")).toBeVisible();
});
