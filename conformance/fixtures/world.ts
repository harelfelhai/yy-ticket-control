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
 * לאדמין ולבעלים יש **שני** אתרים בחבילה הזו, ולכן האתר אינו נבחר מאליו והם
 * בוחרים אותו **מפורשות** בבורר שבראש הטופס: "בחירה שרירותית הייתה משייכת
 * פניות לאתר הלא נכון". למנהל עבודה יש אתר אחד, ואצלו אין בורר כלל — האתר
 * מוצג כערך קבוע — ולכן הבחירה מדולגת.
 *
 * **התנאי הוא קיום הבורר, לא נראוּת שלו.** תנאי נראוּת היה עובר תמיד ומדלג
 * על הבחירה בשקט, ופניות של אדמין היו נוצרות באתר ברירת המחדל בלי שאיש
 * יבחין. וההמתנה ל-hydration קודמת לו: `LearnedSelect` מושבת עד שהמטפלים
 * חוברו, והלחיצה עליו לפני כן נבלעת.
 */
export async function gotoNewTicket(page: Page, siteName: string = SITE_A): Promise<void> {
  await page.goto("/tickets/new");
  await expect(page.getByRole("button", { name: "שלח לנמענים" })).toBeEnabled();

  if ((await page.getByRole("button", { name: /^אתר/ }).count()) > 0) {
    await pick(page, "אתר", siteName);
  }
  await expect(page.getByRole("button", { name: /^בניין/ }).first()).toBeEnabled();
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
  await page.getByLabel("שם").last().fill(input.name);
  if (input.phone) await page.getByLabel("טלפון").last().fill(input.phone);
  if (input.email) await page.getByLabel("מייל").last().fill(input.email);
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

  /*
   * **הפאנל אינו נפתח כאן, ומ-0.4 זו ההתנהגות הנכונה.**
   *
   * כל עוד "פרטים" היה `<details>`, השארתו פתוח הייתה נוחות בלי מחיר —
   * הוא אינו חוסם דבר. הדיאלוג שהחליף אותו לוכד את המשתמש בכוונה, ולכן
   * מסך שנשאר עם פאנל פתוח הוא מסך שאי אפשר לפעול בו: כל בדיקה שהמשיכה
   * לקומפוזר או ל"סגור פנייה" הייתה נתקעת על
   * `overlay intercepts pointer events`.
   *
   * ברירת המחדל הבטוחה היא **סגור**, ומי שצריך את הנמענים או את התגיות
   * קורא ל-`openDetails` במפורש. זה גם קריא יותר: התלות בפאנל נראית
   * בבדיקה עצמה ולא מוסתרת בבונה.
   */
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
 * טקסט כפי שהוא **מוצג על המסך** — ולא כפי שהוא יושב בתוך פקד קלט.
 *
 * **למה זה קיים.** ‏`getByText(x)` מתאים גם `<textarea>` שערכו `x`:
 * פלייררייט מתאים טקסט גם לערכי פקדים ולא רק לתוכן. לכן
 * ‏`expect(page.getByText(t)).toBeVisible()` שבא אחרי `fill(t)` נפתר
 * **מיד עם ההקלדה**, בלי להמתין לשרת — טענה ריקה מתוכן שנראית ירוקה.
 * הצעד שאחריה מתחרה אז בכתיבה שטרם נחתה.
 *
 * זה מה שהפיל את BR-34: הרעננון יצא לדרך **47ms לפני** שההודעה השנייה
 * נכתבה, והשרשור שהתקבל היה נכון לזמנו. ובבדיקת החיפוש זה היה גרוע
 * יותר — הטענה נפתרה על תיבת החיפוש, כלומר מעולם לא נבדק שיש תוצאות.
 *
 * ‏`and(:not(textarea):not(input))` ולא צמצום לאזור מסוים: המלכודת חוצה
 * מסכים (שרשור, צ׳אט תגית, פורטל, חיפוש, רשימות ניהול), ולכל אחד מהם
 * מבנה אחר. מה שמשותף לכולם הוא בדיוק מה שצריך להוציא.
 */
export function shownText(page: Page, text: string) {
  return page.getByText(text).and(page.locator(":not(textarea):not(input)"));
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
  return page.locator("details").filter({ has: page.locator("summary") });
}

/** פותח את הארכיון המקופל. הלחיצה היא על ה-`summary` ולא על טקסט "ארכיון",
 *  כי אותו טקסט מופיע גם בתיאור של פנייה שנשמרה שם. */
export async function expandArchive(page: Page): Promise<void> {
  const summary = boardArchive(page).locator("summary").first();
  if (await summary.isVisible().catch(() => false)) await summary.click();
}

/** כרטיס פנייה בלוח, לפי טקסט שמופיע בו */
export function boardCard(page: Page, text: string) {
  return boardCards(page).filter({ hasText: text });
}

/** כל כרטיסי הפניות בלוח — בלי קישורי הניווט `/tickets/new` ו-`/tickets/batch`,
 *  ששניהם תואמים `a[href^="/tickets/"]` ויושבים בכותרת העמוד. */
export function boardCards(page: Page) {
  return page.locator(
    'a[href^="/tickets/"]:not([href="/tickets/batch"]):not([href="/tickets/new"])',
  );
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

/**
 * פותח את דיאלוג "פרטים" במסך הפנייה, אם אינו כבר פתוח.
 *
 * **למה זה נדרש בכלל.** המטא-דאטה של הפנייה — הנמענים, התגיות, שם הדייר
 * והמחיקה — אינה על המסך הראשי: מגרסה 0.3 היא ישבה בפאנל `<details>`
 * מקופל, ומ-0.4 בדיאלוג צף. השרשור הוא גוף המסך, והשאר מאחורי מוצא אחד.
 *
 * **המעבר לדיאלוג הקל דווקא על הבדיקות.** תוכן של `<details>` סגור מוסר
 * מעץ הנגישות, כלומר `getByRole` תחתיו נפתר לאפס אלמנטים — לא רק ש-`click`
 * נכשל, גם `toHaveCount(0)` הפך ירוק-שקר. דיאלוג סגור **אינו מרונדר**,
 * וההבחנה בין "לא קיים" ל"קיים ומוסתר" חוזרת להיות אמיתית.
 *
 * **בטיוטה אין דיאלוג ואין כפתור** — מסך ההשלמה פרוש על המסך וכל מה
 * שהבדיקה מחפשת כבר גלוי, ולכן הפונקציה יוצאת בשקט.
 */
export async function openDetails(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "פרטים" });
  if (await dialog.isVisible()) return;

  /*
   * **קודם ממתינים שמסך הפנייה ירונדר, ורק אז שואלים אם יש כפתור.**
   *
   * ‏`count() === 0` אחרי ניווט פירושו לרוב "העמוד עוד לא כאן", ולא "אין
   * כפתור". בלי ההמתנה הזו הפונקציה יצאה בשקט, הבדיקה המשיכה למסך סגור,
   * ונפלה 60 שניות מאוחר יותר על כפתור שיושב בתוך הפאנל. זו בדיוק המחלה
   * ש-`harness-guards` נכתב בגללה: תנאי מגודר שמדלג בלי לומר.
   *
   * ‏`region "שרשור"` הוא העוגן: הוא קיים בכל מסך פנייה, גם בטיוטה.
   */
  await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible({ timeout: 30_000 });

  const trigger = page.getByRole("button", { name: "פרטים", exact: true });
  // רק עכשיו ההיעדר משמעותי: בטיוטה אין כפתור, והתוכן פרוש על המסך.
  if ((await trigger.count()) === 0) return;

  /*
   * ‏`toPass` ולא לחיצה אחת, וזה **הבדל אמיתי מ-`<details>`**.
   *
   * הפאנל הקודם היה HTML נייטיב: הוא נפתח גם לפני שה-JavaScript נטען.
   * הדיאלוג הוא רכיב לקוח, ולחיצה שמגיעה לפני ה-hydration פוגעת בכפתור
   * שעדיין אין לו מאזין — כלומר "נלחצת" ולא קורה דבר. הבדיקה נפלה בדיוק
   * כך אחרי ניווט, והצילום הראה את המסך עם הכפתור ובלי הדיאלוג.
   */
  await expect(async () => {
    if (!(await dialog.isVisible())) await trigger.click();
    await expect(dialog).toBeVisible({ timeout: 2_000 });

    /*
     * **ונשאר פתוח.** הפתיחה לבדה אינה מספיקה: מצב הדיאלוג חי ברכיב
     * לקוח, ותגובת RSC שנוחתת אחרי הניווט מרכיבה אותו מחדש ומאפסת אותו —
     * כלומר הפאנל נסגר מעצמו רגע אחרי שנפתח. ההמתנה הקצרה נותנת לעמוד
     * להתייצב, והטענה השנייה מחזירה את הלולאה לפתיחה נוספת אם נסגר.
     */
    await page.waitForTimeout(300);
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

/** סוגר את הדיאלוג, כדי לגשת למה שמאחוריו — הכיסוי לוכד את המשתמש. */
export async function closeDetails(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "פרטים" });
  if (!(await dialog.isVisible())) return;

  await dialog.getByRole("button", { name: "סגור", exact: true }).click();
  await expect(dialog).toHaveCount(0);
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
  await openDetails(page);
  await recipientRow(page, contractorName)
    .getByRole("button", { name: `קישור גישה ${contractorName}` })
    .click();
  // המתנה ארוכה במפורש: הצגת הקישור היא Server Action, והקריאה הראשונה
  // אליה בשרת פיתוח מקמפלת אותה תוך כדי. ההמתנה היא לכותרת הנושאת את שם
  // הנמען ולא רק לתיבה — בפנייה עם כמה קבלנים התיבה כבר מציגה את הקישור
  // הקודם, וקריאה מוקדמת הייתה מחזירה את הקישור של הקבלן האחר.
  await expect(page.getByText(`קישור עבור ${contractorName}`)).toBeVisible({
    timeout: 45_000,
  });
  const field = page.getByRole("textbox", { name: "קישור גישה", exact: true });
  const link = (await field.inputValue()).replace(/^https?:\/\/[^/]+/, "");

  /*
   * **הדיאלוג נסגר לפני החזרה.** עד 0.4 ישב כאן `<details>` פתוח, שאינו
   * חוסם דבר; דיאלוג לוכד את המשתמש בכוונה, ולכן כל קורא שהמשיך לפעולות
   * המסך אחרי `showLink` נתקע על `overlay intercepts pointer events`.
   */
  await closeDetails(page);
  return link;
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
  ticketId?: string,
): Promise<void> {
  await page.goto(link);
  const card = page.getByRole("link").filter({ hasText: description }).first();

  if (await card.isVisible().catch(() => false)) {
    await card.click();
    await expect(page.getByText(description).first()).toBeVisible();
    return;
  }

  /**
   * פנייה שנסגרה יורדת ללשונית הארכיון המקופלת (§4 מסך 8) — **ושם הכרטיס
   * אינו מציג את התיאור כלל**: `p/[token]/page.tsx:95-99` מרנדר בארכיון רק
   * בניין, דירה ותחום. סינון לפי התיאור לא יכול היה למצוא אותו לעולם, וזו
   * הסיבה שהבדיקה נתקעה עד ל-timeout ולא נכשלה מהר. לכן, כשהתיאור אינו
   * נמצא, פותחים את הארכיון ומאתרים לפי מזהה הפנייה שבכתובת.
   */
  const summary = page.locator("details > summary").first();
  if (await summary.isVisible().catch(() => false)) await summary.click();

  if (ticketId) {
    await page.locator(`a[href$="/${ticketId}"]`).first().click();
    await expect(page.getByRole("main")).toBeVisible();
    return;
  }

  await card.click();
  await expect(page.getByText(description).first()).toBeVisible();
}

/**
 * מזיז את הפנייה אחורה בזמן. זו הדרך היחידה לאמת את §5.ג בתוך ריצה —
 * הסף הוא 7 ימים, והבדיקה אינה יכולה להמתין.
 */
export async function ageTicket(ticketId: string, days: number): Promise<void> {
  /**
   * חשבון הזמן נעשה **בתוך** Postgres ולא בצד הלקוח.
   *
   * העברת אובייקט `Date` דרך `pg` לעמודת `timestamp` חסרת אזור-זמן מאבדת את
   * ההיסט: השעון הישראלי הוא UTC+3 בקיץ, ולכן "לפני 9 ימים" נשמר כ-8 ימים
   * ו-21 שעות, ו-`Math.floor` בחישוב הגיל החזיר **8**. הבדיקה נכשלה על
   * "ללא תנועה 8 ימים" ונראתה כפער במוצר.
   *
   * גם `now()` לבדו אינו מספיק: הוא `timestamptz`, וההשמה לעמודה חסרת
   * אזור-זמן שומרת את השעה **המקומית**. Prisma קורא אותה כ-UTC, והתוצאה
   * מוקדמת בשלוש שעות — אותה טעות בדיוק, בכיוון ההפוך. לכן
   * `now() at time zone 'utc'`.
   */
  await query(
    `update "Ticket"
        set "lastActivityAt" = (now() at time zone 'utc') - ($1 || ' days')::interval - interval '2 hours',
            "createdAt"      = (now() at time zone 'utc') - ($1 || ' days')::interval - interval '2 hours'
      where id = $2`,
    [String(days), ticketId],
  );
}

/**
 * מאשר כל דיאלוג `confirm` בעמוד, פעם אחת לכל הבדיקה.
 *
 * ‏`page.once("dialog", …)` פעמיים באותה בדיקה נכשל עם
 * "Cannot accept dialog which is already handled" ברגע ששני דיאלוגים
 * מגיעים בזה אחר זה — מטפל אחד ומתמיד עדיף.
 */
const dialogsHandled = new WeakSet<Page>();

export function acceptDialogs(page: Page): void {
  // ‏idempotent: קריאה גם ב-`beforeEach` וגם בגוף הבדיקה רשמה שני מאזינים,
  // ושניהם ניסו לאשר את אותו דיאלוג — "Cannot accept dialog which is
  // already handled".
  if (dialogsHandled.has(page)) return;
  dialogsHandled.add(page);
  page.on("dialog", (dialog) => {
    void dialog.accept();
  });
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
