import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { type Page, expect } from "@playwright/test";
import { openFilters, pick } from "../../e2e/helpers";
import { SITE_A } from "./cast";
import { cdb } from "./db";

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
    await pick(page, "נמענים", name);
  }
  if (input.newProfessional) await addProfessional(page, input.newProfessional);

  const button = input.saveAsDraft ? "שמור כטיוטה" : "שלח לנמענים";
  await page.getByRole("button", { name: button }).click();
  await expect(page).toHaveURL(/\/tickets\/[a-z0-9]+$/);
  return new URL(page.url()).pathname;
}

export function ticketIdFromPath(pathname: string): string {
  const id = pathname.split("/").pop();
  if (!id) throw new Error(`נתיב פנייה לא תקין: ${pathname}`);
  return id;
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
 * מזיז את הפנייה אחורה בזמן. זו הדרך היחידה לאמת את §5.ג בתוך ריצה —
 * הסף הוא 7 ימים, והבדיקה אינה יכולה להמתין.
 */
export async function ageTicket(ticketId: string, days: number): Promise<void> {
  const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await cdb.ticket.update({
    where: { id: ticketId },
    data: { lastActivityAt: at, createdAt: at },
  });
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
