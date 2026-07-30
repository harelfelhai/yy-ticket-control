import { mkdir } from "node:fs/promises";
import path from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { E2E_ADMIN } from "../e2e/global-setup";

/**
 * לוכד את המסכים המרכזיים ל-`.visual/<device>/`.
 *
 * **המסכים מאוכלסים לפני הצילום ולא מצולמים ריקים.** ה-seed יוצר אתר,
 * בניינים ותחומים בלבד — לוח ריק אינו מלמד דבר על היררכיה, על צפיפות או על
 * קריאוּת של כרטיס. כל בעיית עיצוב אמיתית מופיעה רק כשיש תוכן.
 *
 * ההרצה: `npm run visual`. הצילומים אינם snapshot-ים להשוואה אוטומטית אלא
 * חומר לשיפוט מול `docs/DESIGN.md`.
 */

const OUT = ".visual";

/** תרחישים לצילום: פנייה לכל שילוב שהאפיון מבחין ביניהם. */
const TICKETS = [
  { building: "בניין א", apartment: "1", domain: "חשמל", text: "אין חשמל בממ״ד, הפאזה קופצת" },
  { building: "בניין א", apartment: "2", domain: "אינסטלציה", text: "נזילה מתחת לכיור במטבח" },
  { building: "בניין ב", apartment: "3", domain: "ריצוף", text: "אריח שבור בכניסה לסלון" },
];

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("טלפון או מייל").fill(E2E_ADMIN.phone);
  await page.getByLabel("סיסמה").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "כניסה" }).click();
  await expect(page).toHaveURL(/\/board$/);
}

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).first().click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/**
 * מצלם את העמוד הנוכחי — פעמיים.
 *
 * **`fullPage` לבדו מטעה.** אלמנט `sticky` או `fixed` מצולם בו במיקומו
 * בחלון הצפייה, ולכן רצועת הפעולות של הטופס ו-FAB של הלוח נראים כאילו הם
 * יושבים באמצע התוכן וחותכים אותו. זה נקרא כבאג פריסה חמור, והוא אינו קיים.
 * לכן: `-full` לריתמוס ולמרווחים לאורך העמוד, `-view` למה שהמשתמש באמת
 * רואה כשהמסך נפתח.
 *
 * הרכיב `nextjs-portal` (כפתור כלי הפיתוח של Next) מוסתר — הוא ארטיפקט של
 * סביבת הפיתוח שמכסה פינה של כל צילום.
 */
async function shot(page: Page, device: string, name: string) {
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const dir = path.join(OUT, device);
  await page.screenshot({ path: path.join(dir, `${name}-view.png`) });
  await page.screenshot({ path: path.join(dir, `${name}-full.png`), fullPage: true });
}

/** יוצר פנייה משוגרת עם נמען אחד. */
async function createSentTicket(
  page: Page,
  spec: (typeof TICKETS)[number],
  index: number,
): Promise<void> {
  await page.goto("/tickets/new");
  await pick(page, "בניין", spec.building);
  await pick(page, "דירה", spec.apartment);
  await pick(page, "תחום", spec.domain);
  await page.getByLabel("תיאור").fill(spec.text);

  await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
  await page.getByLabel("שם").fill(`קבלן ${spec.domain}`);
  await page.getByLabel("טלפון").fill(`050-100000${index}`);
  await page.getByRole("button", { name: "שמור איש מקצוע" }).click();
  await expect(page.getByRole("list", { name: "נמענים", exact: true })).toContainText(
    `קבלן ${spec.domain}`,
  );

  await page.getByRole("button", { name: "שלח לנמענים" }).click();
  await expect(page.getByRole("heading", { name: "שרשור" })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("לוכד את המסכים המרכזיים", async ({ page }, testInfo) => {
  const device = testInfo.project.name;
  await mkdir(path.join(OUT, device), { recursive: true });

  // מסך ההתחברות — לפני ההתחברות, כי אחריה יש session.
  await page.goto("/login");
  await shot(page, device, "01-login");

  await login(page);

  // הטופס הריק: המסך שבו נפתחת פנייה בשטח, ובו רוב השדות של המערכת.
  await page.goto("/tickets/new");
  await shot(page, device, "02-ticket-new-empty");

  for (const [index, spec] of TICKETS.entries()) {
    await createSentTicket(page, spec, index);
  }
  const lastTicketPath = new URL(page.url()).pathname;

  // טיוטה: בניין ודירה בלבד. מוצגת בלוח במסגרת אדומה, וזה ההבדל הוויזואלי
  // החד ביותר במערכת — שווה לראות אותו לצד פניות רגילות.
  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין ב");
  await pick(page, "דירה", "1");
  await page.getByRole("button", { name: "שמור כטיוטה" }).click();
  await expect(page).toHaveURL(/\/tickets\/[a-z0-9]+$/);
  await shot(page, device, "05-ticket-draft");

  await page.goto("/board");
  // `.first()` — הפרויקט השני רץ על אותו בסיס נתונים (globalSetup רץ פעם אחת
  // לכל ההרצה), ולכן הפניות של המכשיר הקודם עדיין שם. זה מכוון: לוח עמוס
  // יותר הוא דווקא מצב הצילום הנכון.
  await expect(page.getByText("אין חשמל בממ״ד, הפאזה קופצת").first()).toBeVisible();
  await shot(page, device, "03-board");

  // הלוח המסונן — המצב היחיד שבו רצועת המסננים פרושה בנייד. בלי הצילום הזה
  // הפריסה של הרצועה הפתוחה אינה נראית לאיש עד שמשתמש נתקל בה.
  await page.goto("/board?direction=opened");
  await expect(page.getByLabel("הפניתי")).toBeVisible();
  await shot(page, device, "03b-board-filtered");

  await page.goto(lastTicketPath);
  await expect(page.getByRole("heading", { name: "שרשור" })).toBeVisible();
  await shot(page, device, "04-ticket-detail");

  await page.goto("/overview");
  await shot(page, device, "06-overview");

  await page.goto("/search");
  await shot(page, device, "07-search");

  await page.goto("/tags");
  await shot(page, device, "08-tags");

  await page.goto("/admin");
  await shot(page, device, "09-admin");
});
