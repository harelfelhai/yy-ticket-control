import { type Page, expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";
import { openFilters } from "./helpers";

/**
 * תגיות וצ׳אט קבוצתי (מסך 6), מקצה לקצה ודרך הממשק בלבד.
 *
 * הכלל שהבדיקה נבנתה סביבו: **פתיחת תגית לקבלן חושפת את הצ׳אט בלבד,
 * לעולם לא את הפניות** (אפיון §5.ה). לכן היא עוברת גם בפורטל הקבלן —
 * סביבה נפרדת עם אימות אחר — ומוודאת שם ששום פנייה אינה דולפת דרך הצ׳אט.
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

/** מציג את קישור הפורטל של קבלן מתוך מסך הפנייה ומחזיר אותו כנתיב */
async function showTicketLink(page: Page, contractor: string): Promise<string> {
  await page
    .getByRole("list", { name: "נמענים", exact: true })
    .getByRole("listitem")
    .filter({ hasText: contractor })
    .getByRole("button", { name: `קישור גישה ${contractor}` })
    .click();
  await expect(page.getByText(`קישור עבור ${contractor}`)).toBeVisible();
  const field = page.getByRole("textbox", { name: "קישור גישה", exact: true });
  return (await field.inputValue()).replace(/^https?:\/\/[^/]+/, "");
}

test("תגית: תיוג, צ׳אט קבוצתי, ופתיחה לקבלן שרואה צ׳אט בלבד", async ({ page }) => {
  const stamp = Date.now();
  const description = `ליקוי בדק ${stamp}`;
  const contractor = `קבלן ${stamp}`;
  const tagName = `בדק בית דירה 1 ${stamp}`;
  const managerMessage = `מי לוקח את הליקוי? ${stamp}`;
  const contractorMessage = `אני לוקח ${stamp}`;

  // ── 1. פנייה עם קבלן משויך ─────────────────────────────────────────
  await loginAsManager(page);
  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await pick(page, "תחום", "חשמל");
  await page.getByLabel("תיאור").fill(description);
  await addProfessional(page, contractor, `050-${String(stamp).slice(-7)}`);
  await page.getByRole("button", { name: "שלח לנמענים" }).click();
  await expect(page.getByRole("heading", { name: "שרשור" })).toBeVisible();

  const ticketUrl = new URL(page.url()).pathname;
  const contractorLink = await showTicketLink(page, contractor);

  // ── 2. תיוג הפנייה — התגית נלמדת ונוצרת מהשם ──────────────────────
  await page.goto(ticketUrl);
  await page.getByRole("button", { name: /^הוסף תגית/ }).click();
  await page.getByRole("textbox", { name: /הוסף תגית/ }).fill(tagName);
  await page.getByRole("button", { name: `צור חדש: "${tagName}"` }).click();
  await expect(page.getByRole("list", { name: "תגיות" })).toContainText(tagName);

  // ── 3. מסך התגית: הפנייה ברשימה, המונה, והצ׳אט ────────────────────
  await page.goto("/tags");
  await page.getByRole("link").filter({ hasText: tagName }).click();
  // ההמתנה לכותרת לפני קריאת ה-URL: click אינו ממתין לניווט, וקריאה מוקדמת
  // הייתה מחזירה עדיין את "/tags" (עמוד הרשימה) במקום את נתיב התגית.
  await expect(page.getByRole("heading", { name: tagName })).toBeVisible();
  const tagUrl = new URL(page.url()).pathname;
  const tagId = tagUrl.split("/").pop() as string;

  await expect(page.getByText("1 פתוחות · 0 סגורות")).toBeVisible();
  await expect(page.getByText("פניות בתגית")).toBeVisible();
  await expect(page.getByRole("link").filter({ hasText: "בניין א" })).toBeVisible();

  await page.getByLabel("תגובה").fill(managerMessage);
  await page.getByRole("button", { name: "שלח", exact: true }).click();
  await expect(page.getByText(managerMessage)).toBeVisible();

  // ── 4. שלילי: הקבלן תקף אך התגית טרם נפתחה לו — אין גישה לצ׳אט ─────
  await page.goto(`${contractorLink.replace(/\/$/, "")}/tag/${tagId}`);
  await expect(page.getByText("הקישור אינו בתוקף")).toBeVisible();

  // ── 5. פתיחת התגית לקבלן, עם נוסח האזהרה מהאפיון ──────────────────
  await page.goto(tagUrl);
  await page.getByRole("button", { name: /^פתח לקבלנים/ }).click();
  await page.getByRole("option", { name: contractor }).click();
  await page.getByRole("button", { name: "פתח", exact: true }).click();
  await expect(
    page.getByText(`התגית נפתחה ל${contractor}. הם יראו את הצ׳אט הקבוצתי בלבד, לא את הפניות.`),
  ).toBeVisible();

  // הקישור לקבלן זמין למנהל מרשימת מי-שנפתח (החוליה שסוגרת את הפעולה).
  await page.getByRole("button", { name: `קישור גישה ${contractor}` }).click();
  await expect(page.getByRole("textbox", { name: `קישור עבור ${contractor}` })).toHaveValue(/\/p\//);

  // ── 6. בפורטל הקבלן: צ׳אט קבוצתי — ובלי רשימת פניות ───────────────
  await page.goto(contractorLink);
  await expect(page.getByText("צ׳אטים קבוצתיים")).toBeVisible();
  await page.getByRole("link").filter({ hasText: tagName }).click();

  await expect(page.getByText(managerMessage)).toBeVisible();
  // הכלל המרכזי: הקבלן אינו רואה את רשימת הפניות של התגית.
  await expect(page.getByText("פניות בתגית")).toHaveCount(0);

  await page.getByLabel("תגובה").fill(contractorMessage);
  await page.getByRole("button", { name: "שלח", exact: true }).click();
  await expect(page.getByText(contractorMessage)).toBeVisible();

  // ── 7. אצל המנהל: תגובת הקבלן מופיעה בצ׳אט ────────────────────────
  await loginAsManager(page);
  await page.goto(tagUrl);
  await expect(page.getByText(contractorMessage)).toBeVisible();

  // ── 8. מסנן התגית בלוח מציג את הפנייה ─────────────────────────────
  await page.goto("/board");
  await openFilters(page);
  await page.getByLabel("תגיות", { exact: true }).selectOption({ label: tagName });
  await expect(page.getByRole("link").filter({ hasText: description })).toBeVisible();
});
