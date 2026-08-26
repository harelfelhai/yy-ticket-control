import { mkdir } from "node:fs/promises";
import path from "node:path";
import { type Locator, type Page, expect, test } from "@playwright/test";
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

/**
 * ‏WebM אודיו מינימלי — מספיק כדי שהשרת יסווג את הקובץ כאודיו.
 *
 * בלי הקלטה בשרשור, סבב הצילום לא כלל ולו תמונה אחת של נגן אודיו — ולכן
 * גם סוכן ה-design-review לא היה יכול לראות את הליקוי שדווח מהשטח (הנגן
 * שהתכווץ לכפתור ⋮). ‏`setInputFiles` ולא `MediaRecorder`: הקלטה אמיתית
 * דורשת מיקרופון.
 */
const WEBM_BASE64 =
  "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAAHTEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHGTbuMU6uEElTDZ1OsggEXTbuMU6uEHFO7a1OsggG97AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

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

/** בוחר מ-LearnedSelect בתוך אזור נתון — בהזנה מרוכזת יש בורר לכל שורה */
async function pickIn(scope: Locator, label: string, option: string) {
  await scope
    .getByRole("button", { name: new RegExp(`^${label}`) })
    .first()
    .click();
  await scope.page().getByRole("option", { name: option, exact: true }).click();
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
  await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible();
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

  // הודעת הקלטה **בלי טקסט** — המקרה שבו הבועה מתכווצת לתוכן, ולכן המצב
  // היחיד שבו כדאי לראות את הנגן בצילום.
  await page
    .locator('input[type="file"][accept="image/*,application/pdf,video/*"]')
    .setInputFiles({
      name: "הקלטה קולית.webm",
      mimeType: "audio/webm",
      buffer: Buffer.from(WEBM_BASE64, "base64"),
    });
  await expect(page.getByText("מעלה…")).toHaveCount(0);
  await page.getByRole("button", { name: "שלח", exact: true }).click();
  await expect(page.getByRole("region", { name: "שרשור" }).locator("audio")).toBeVisible();

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

  // תצוגת הטבלה (0.3). נלכדת בשני הרוחבים אף שהמתג אליה מוסתר בנייד:
  // הכתובת ניתנת להגעה, ורשת עמודות ברוחב 390px היא בדיוק המצב שצריך
  // לראות כדי לדעת אם ההסתרה מספיקה.
  await page.goto("/board?view=table");
  // ההמתנה היא לכותרת הקיבוץ ולא לכותרת עמודה: בנייד הטבלה מוסתרת בכוונה
  // ומוצגים כרטיסים, וזה בדיוק מה שהצילום הזה נועד להראות.
  await expect(page.getByRole("heading", { name: /^אצל הנמענים/ })).toBeVisible();
  await shot(page, device, "03c-board-table");

  // המצב הממוין (0.4) — החץ בכותרת הוא הרמז החזותי היחיד שהמיון פעיל,
  // ובלי הצילום הזה איש אינו רואה אותו עד שמישהו לוחץ בשטח.
  await page.goto("/board?view=table&sort=domain&dir=asc");
  await expect(page.getByRole("heading", { name: /^אצל הנמענים/ })).toBeVisible();
  await shot(page, device, "03d-board-table-sorted");

  // הלוח המסונן. הרצועה גלויה בכל רוחב מאז סבב הצפיפות, ולכן הצילום הזה
  // אינו עוד "המצב היחיד שבו היא פרושה" — מה שהוא מראה הוא **הרצועה עם
  // ערך פעיל**: הבורר שאינו על ברירת המחדל ו"נקה מסננים" שנחשף לצדו.
  await page.goto("/board?direction=opened");
  await expect(page.getByLabel("הפניתי")).toBeVisible();
  await shot(page, device, "03b-board-filtered");

  await page.goto(lastTicketPath);
  await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible();
  await shot(page, device, "04-ticket-detail");

  /*
   * ‏`/overview` ו-`/admin` היו שני צילומים והפכו לאחד: סקירת האתרים עברה
   * לראש מסך הניהול, ושתי הכתובות מובילות עכשיו לאותו מסך. צילום נוסף של
   * אותו URL אינו מוסיף מידע לסבב הביקורת — הוא רק מכפיל את מה שיש לקרוא.
   *
   * ההמתנה לכותרת ולא ל-`networkidle` לבדו: המסך מרנדר שתי שכבות, והמדדים
   * מגיעים משאילתה — צילום מוקדם היה לוכד את הכותרת מעל מצב ריק.
   */
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "סקירת אתרים" })).toBeVisible();
  await shot(page, device, "06-admin-overview");

  /*
   * החיפוש אינו מסך משלו אלא **מצב** של הלוח: רשימה שטוחה עם מונה תוצאות,
   * שמחליפה את שלוש קבוצות הקיבוץ. זו פריסה שונה לגמרי מהלוח הרגיל, ובלי
   * מונח פעיל בכתובת הצילום היה יוצא זהה ל-`03-board`.
   */
  await page.goto(`/board?q=${encodeURIComponent("חשמל")}`);
  await expect(page.getByText(/\d+ תוצאות/)).toBeVisible();
  await shot(page, device, "07-board-search");

  // מסך 13 — אנשי מקצוע. לא נלכד עד 0.4, ולכן מתג ההשבתה שנוסף בו לא היה
  // נראה לאיש עד שמישהו נתקל בו בשטח.
  //
  // ‏0.7: הפעולות ירדו מהשורה לדיאלוג, ולכן ההמתנה היא על **כרטיס** ולא על
  // כפתור "השבת" שכבר אינו על המסך. הכרטיס נושא `aria-label` שהוא שם
  // הרשומה, ואין מחרוזת קבועה לחכות לה — ולכן ההמתנה היא על הרשימה.
  await page.goto("/admin/professionals");
  await expect(page.getByRole("listitem").first()).toBeVisible();
  await shot(page, device, "15-admin-professionals");

  // מסך 16 — בניינים ודירות. הנתיב תלוי באתר קיים ולכן נשלף ולא נכתב קשיח.
  // בלי הלכידה הזו זהו המסך היחיד שסבב ה-design-review אינו רואה כלל.
  await page.goto("/admin/sites");
  await expect(page.getByRole("listitem").first()).toBeVisible();
  await shot(page, device, "13-admin-sites");

  /*
   * **‏0.7: הקישור לבניינים ודירות עבר אל תוך דיאלוג הפרטים**, ולכן
   * הניווט לכאן הוא בן שני שלבים — פתיחת הכרטיס ואז הקישור שבתוכו.
   *
   * זו בדיוק התלות שקל לפספס: הצילום `14` נשען על `a[href^="/admin/sites/"]`
   * שהיה על הכרטיס, ובלי העדכון הזה הוא היה מדלג בשקט (ה-`if` מכסה על
   * היעדר הקישור) ומשאיר את מסך 16 מחוץ לסבב הביקורת בלי שאיש ישים לב.
   */
  const firstSiteCard = page.getByRole("listitem").first().getByRole("button");
  if (await firstSiteCard.count()) {
    await firstSiteCard.click();
    const details = page.getByRole("dialog");
    await details.getByRole("link", { name: "בניינים ודירות" }).click();
    // בלי ההמתנה הזו הצילום נלכד לפני שהניווט הסתיים, והקובץ שנקרא
    // "מסך הבניינים" מכיל בפועל את מסך האתרים — תקלה שקטה שהתגלתה רק
    // כשהסתכלתי על התמונה.
    await page.waitForURL(/\/admin\/sites\/.+/);
    await expect(page.getByLabel("שם הבניין")).toBeVisible();
    await shot(page, device, "14-admin-site-buildings");
  }

  /*
   * ‏0.8: שני המסכים שהסבב שינה ולא היו נלכדים מעולם.
   *
   * עד כאן חבילת הצילום כיסתה אתרים, בניינים ואנשי מקצוע — ודילגה על
   * **תחומים ומשתמשים**. זה היה פער ולא בחירה: שניהם מסכי ניהול
   * מלאים, ומסך התחומים הוא היחיד שנושא את זוג הפעולות בקצה הכרטיס
   * בצורה גלויה. סבב ביקורת שאינו רואה אותם אינו יכול לחוות דעה עליהם.
   */
  await page.goto("/admin/users");
  await expect(page.getByRole("listitem").first()).toBeVisible();
  await shot(page, device, "16-admin-users");

  await page.goto("/admin/domains");
  await expect(page.getByRole("listitem").first()).toBeVisible();
  await shot(page, device, "17-admin-domains");

  await captureBatchAndTag(page, device);
});

/**
 * הזנה מרוכזת ומסך התגית.
 *
 * שני המסכים הצפופים ביותר במערכת, ושניהם היו מחוץ ללכידה עד כה: ההזנה
 * המרוכזת היא רשת של פקדים קטנים (שורה לכל ליקוי, בורר לכל שורה), ומסך
 * התגית מחזיק את שדות הקישור לצ׳אט. שניהם עברו הגירה לפרימיטיבים בלי
 * שאיש הסתכל על התוצאה.
 *
 * הרצף גם מייצר תגית אמיתית — בלעדיה `/tags` מצולם ריק ואינו מלמד דבר.
 */
async function captureBatchAndTag(page: Page, device: string): Promise<void> {
  await page.goto("/tickets/batch");
  await shot(page, device, "10-batch-empty");

  const aside = page.getByRole("complementary");
  await pickIn(aside, "בניין", "בניין א");
  await pickIn(aside, "דירה", "1");
  await aside.getByLabel("תגית משותפת").fill("בדק בית · בניין א דירה 1");

  const row = (n: number) => page.getByRole("group", { name: `שורה ${n}`, exact: true });

  await row(1).getByLabel("תיאור הליקוי").fill("אין חשמל בסלון, המפסק קופץ");
  await pickIn(row(1), "תחום", "חשמל");
  await row(1).getByRole("button", { name: "+ איש מקצוע חדש" }).click();
  await row(1).getByLabel("שם", { exact: true }).fill("חשמלאי הבניין");
  await row(1).getByLabel("טלפון").fill("050-2000001");
  await row(1).getByRole("button", { name: "שמור איש מקצוע" }).click();
  await expect(row(1).getByRole("list", { name: "נמענים", exact: true })).toContainText(
    "חשמלאי הבניין",
  );

  await row(2).getByLabel("תיאור הליקוי").fill("שקע שרוף במטבח");
  await pickIn(row(2), "תחום", "חשמל");

  // שורה בלי נמען — היא נשמרת כטיוטה, וזה המצב שכדאי לראות בצילום לצד
  // שורה מלאה: שתי השורות נבדלות רק בפרט אחד.
  await row(3).getByLabel("תיאור הליקוי").fill("נזילה מתחת לכיור");

  await shot(page, device, "11-batch-filled");

  await page.getByRole("button", { name: "שגר הכל" }).click();
  await page.getByRole("link", { name: "פתח את התגית" }).click();
  // ‏waitForURL ולא התאמת כותרת: הכותרת "הזנה מרוכזת מדוח בדק בית" מכילה את
  // שם התגית, ולכן `getByRole("heading", {name: /בדק בית/})` נפתר מיד על
  // העמוד הישן — והצילום יצא לפני הניווט.
  await page.waitForURL(/\/tags\/[a-z0-9]+$/);
  await shot(page, device, "12-tag-detail");

  // אחרי שנוצרה תגית — הרשימה מציגה תוכן ולא מצב ריק.
  await page.goto("/tags");
  await shot(page, device, "08-tags");
}
