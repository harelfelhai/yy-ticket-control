import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { type Page, expect } from "@playwright/test";
import { openFilters, pick } from "../../e2e/helpers";
import { SITE_A } from "./cast";
import { query } from "./db";

export { openFilters, pick };

/**
 * בוני-תרחיש לחבילת ההתאמה.
 *
 * **הכלל:** מה שנבנה כאן הוא **הקשר**, לא הדרישה הנבדקת. פנייה שנוצרת כאן
 * דרך הממשק משמשת נקודת פתיחה לבדיקת סגירה או הרשאה; היצירה עצמה נבדקת
 * במקומה (`s4-quick-create.spec.ts`). גישה ישירה למסד מותרת להבאת מצב
 * (להזיז תאריך אחורה) ולקריאת עובדות — לעולם לא כדי לעקוף פעולה נבדקת.
 */

let counter = 0;
/** מזהה ייחודי לריצה — הבסיס מצטבר בין שני הפרויקטים (mobile/desktop) */
export function uniq(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/** טלפון ייחודי: זיהוי כפילות איש מקצוע הוא לפי טלפון */
export function uniqPhone(): string {
  counter += 1;
  return `05${String(Date.now()).slice(-7)}${String(counter % 10)}`;
}

/**
 * פותח את מסך יצירת הפנייה עבור אתר מסוים.
 *
 * לאדמין ולבעלים יש **שני** אתרים בחבילה הזו, ולכן המסך מציג בורר אתר לפני
 * הטופס (`tickets/new/page.tsx:39`). זו אינה תקלה אלא דרישה: "בחירה שרירותית
 * הייתה משייכת פניות לאתר הלא נכון". מנהל עבודה מגיע ישר לטופס.
 */
export async function gotoNewTicket(page: Page, siteName: string = SITE_A): Promise<void> {
  await page.goto("/tickets/new");
  const chooser = page.getByRole("link", { name: siteName, exact: true });
  if (await chooser.isVisible().catch(() => false)) {
    await chooser.click();
  }
  await expect(page.getByRole("button", { name: /^בניין/ }).first()).toBeVisible();
}

export interface TicketDraftInput {
  building?: string;
  apartment?: string;
  domain?: string;
  description?: string;
  /** אנשי מקצוע קיימים או משתמשים פנימיים, לפי שם */
  recipients?: string[];
  /** איש מקצוע חדש שנוצר תוך כדי */
  newProfessional?: { name: string; phone?: string; email?: string };
  site?: string;
  saveAsDraft?: boolean;
}

/**
 * בוחר נמען קיים מתוך הבורר.
 *
 * לא `pick`: אפשרות של נמען מציגה גם רמז (טלפון או מייל) בתוך אותו
 * `role="option"` (`learned-select.tsx:152`), ולכן השם הנגיש שלה הוא
 * "קבלן מלא 0521111111" והתאמה מדויקת לשם לבדו אינה מוצאת אותה. זו הסיבה
 * שהמסלול הזה לא נבדק עד היום — הבדיקות הקיימות תמיד **יוצרות** נמען חדש
 * ואינן בוחרות קיים.
 */
export async function pickRecipient(page: Page, name: string): Promise<void> {
  await page
    .getByRole("button", { name: /^נמענים/ })
    .first()
    .click();
  await page
    .getByRole("option", { name: new RegExp(`^${escapeRegExp(name)}`) })
    .first()
    .click();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** יוצר איש מקצוע חדש מתוך בורר הנמענים */
export async function addProfessional(
  page: Page,
  input: { name: string; phone?: string; email?: string },
): Promise<void> {
  await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
  await page.getByLabel("שם").fill(input.name);
  if (input.phone) await page.getByLabel("טלפון").fill(input.phone);
  if (input.email) await page.getByLabel("מייל").fill(input.email);
  await page.getByRole("button", { name: "שמור איש מקצוע" }).click();
  await expect(page.getByRole("list", { name: "נמענים", exact: true })).toContainText(input.name);
}

/**
 * יוצר פנייה דרך הממשק ומחזיר את הנתיב שלה.
 *
 * מחזיר נתיב ולא מזהה, כי זה מה שהבדיקות צריכות (`page.goto`), והמזהה נגזר
 * ממנו ב-`ticketIdFromPath`.
 */
export async function createTicket(page: Page, input: TicketDraftInput = {}): Promise<string> {
  await gotoNewTicket(page, input.site ?? SITE_A);

  if (input.building) await pick(page, "בניין", input.building);
  if (input.apartment) await pick(page, "דירה", input.apartment);
  if (input.domain) await pick(page, "תחום", input.domain);
  if (input.description) await page.getByLabel("תיאור").fill(input.description);

  for (const name of input.recipients ?? []) {
    await pickRecipient(page, name);
  }
  if (input.newProfessional) await addProfessional(page, input.newProfessional);

  const button = input.saveAsDraft ? "שמור כטיוטה" : "שלח לנמענים";
  await page.getByRole("button", { name: button }).click();
  await expect(page).toHaveURL(TICKET_URL);
  return new URL(page.url()).pathname;
}

/**
 * כתובת של פנייה קיימת — **ולא** `/tickets/new` או `/tickets/batch`.
 *
 * ‏`/\/tickets\/[a-z0-9]+$/` נראה נכון והוא מלכודת: `new` תואם אותו. המתנה
 * לניווט אחרי השיגור הסתיימה מיד, `createTicket` החזיר `/tickets/new`, וכל
 * בדיקה שהמשיכה משם עבדה על המסך הלא נכון — כולל בדיקת הרשאה שהחזירה 200
 * על טופס היצירה במקום 404 על פנייה זרה. הכשל נראה כפער במוצר.
 */
export const TICKET_URL = /\/tickets\/(?!new$|batch$)[a-z0-9]+$/;

export function ticketIdFromPath(pathname: string): string {
  const id = pathname.split("/").pop();
  if (!id || id === "new" || id === "batch") {
    throw new Error(`נתיב פנייה לא תקין: ${pathname}`);
  }
  return id;
}

/**
 * קבוצה בלוח, לפי כותרתה.
 *
 * הקבוצות הן `<section>` בלי `aria-label`, ולכן אין להן תפקיד `region`
 * בעץ הנגישות ו-`getByRole("region")` לא ימצא אותן. הלוקטור מסתמך על
 * הכותרת שבתוכן — שהיא ממילא מה שהאפיון מחייב שיהיה שם (S1-03/05/07).
 */
export function boardSection(page: Page, label: string) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: new RegExp(`^${label}`) }) });
}

/** הארכיון המקופל — `<details>` ולא `<section>` (S1-08) */
export function boardArchive(page: Page) {
  return page.locator("details").filter({ hasText: "ארכיון" });
}

/** כרטיס פנייה בלוח, לפי טקסט שמופיע בו */
export function boardCard(page: Page, text: string) {
  return page.locator('a[href^="/tickets/"]').filter({ hasText: text });
}

/**
 * מסך "הקישור אינו בתוקף" (§4 מסך 8, שורה 329).
 *
 * שני חלקים ולא משפט אחד: המימוש מפצל את הנוסח לכותרת ולפסקה. הפיצול
 * מדווח כפער ניסוח, אך ההתנהגות — חסימת הגישה — נבדקת כאן.
 */
export async function expectExpiredLink(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "הקישור אינו בתוקף" })).toBeVisible();
  await expect(page.getByText("פנה למנהל העבודה שלך.")).toBeVisible();
}

/** שורת נמען ברצועת הנמענים במסך הפנייה */
export function recipientRow(page: Page, name: string) {
  return page
    .getByRole("list", { name: "נמענים", exact: true })
    .getByRole("listitem")
    .filter({ hasText: name });
}

/** מציג את קישור הפורטל של קבלן ומחזיר אותו כנתיב יחסי */
export async function showLink(page: Page, contractorName: string): Promise<string> {
  await recipientRow(page, contractorName)
    .getByRole("button", { name: `קישור גישה ${contractorName}` })
    .click();
  await expect(page.getByText(`קישור עבור ${contractorName}`)).toBeVisible();
  const field = page.getByRole("textbox", { name: "קישור גישה", exact: true });
  return (await field.inputValue()).replace(/^https?:\/\/[^/]+/, "");
}

/**
 * נכנס לפורטל הקבלן ופותח משם פנייה מסוימת.
 *
 * הניווט הוא דרך **הלוח** ולא ישירות לכתובת הפנייה, כי זו הדרישה עצמה:
 * "הכניסה בקישור אישי… ומציג לו לוח בקרה אישי — לא פנייה בודדת" (§4 מסך 8).
 * בדיקה שקופצת ישר לפנייה מדלגת על מה שהאפיון מחייב.
 */
export async function openPortalTicket(
  page: Page,
  link: string,
  description: string,
): Promise<void> {
  await page.goto(link);
  await page.getByRole("link").filter({ hasText: description }).first().click();
  await expect(page.getByText(description).first()).toBeVisible();
}

/**
 * מזיז את הפנייה אחורה בזמן. זו הדרך היחידה לאמת את §5.ג בתוך ריצה —
 * הסף הוא 7 ימים, והבדיקה אינה יכולה להמתין.
 */
export async function ageTicket(ticketId: string, days: number): Promise<void> {
  const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await query(`update "Ticket" set "lastActivityAt" = $1, "createdAt" = $1 where id = $2`, [
    at,
    ticketId,
  ]);
}

/** קורא את מספר הטוקנים הפעילים של איש מקצוע — לאימות יציבות הקישור (V02-06) */
export async function activeTokenCount(professionalName: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `select count(*)::text as count
       from "AccessToken" t
       join "Professional" p on p.id = t."professionalId"
      where p.name = $1 and t."revokedAt" is null`,
    [professionalName],
  );
  return Number(rows[0]?.count ?? 0);
}

/** מריץ ג׳וב אמיתי של המערכת (לא שכפול שלו) מול בסיס הבדיקות */
export function runJob(command: "escalate" | "drain", now?: Date): string {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const result = spawnSync(
    process.execPath,
    [
      require.resolve("tsx/cli"),
      "conformance/run-job.ts",
      command,
      ...(now ? [now.toISOString()] : []),
    ],
    {
      env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL ?? "" },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(`הרצת הג׳וב ${command} נכשלה:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}
