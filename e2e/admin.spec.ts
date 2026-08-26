import { type Page, expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";
import { openDetails } from "./ticket-screen";

/**
 * מסכי הניהול (11–15), מקצה לקצה.
 *
 * הפעולה הרגישה כאן היא **איחוד כפילויות**: היא מוחקת איש מקצוע ומעבירה
 * את ההיסטוריה שלו לאחר. הבדיקה מאמתת שהיא עובדת דרך הממשק, כולל אישור.
 */

async function loginAsAdmin(page: Page) {
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

async function createTicketWithProfessional(page: Page, description: string, contractor: string, phone: string) {
  await page.goto("/tickets/new");
  await pick(page, "בניין", "בניין א");
  await pick(page, "דירה", "1");
  await pick(page, "תחום", "חשמל");
  await page.getByLabel("תיאור").fill(description);
  await page.getByRole("button", { name: "+ איש מקצוע חדש" }).click();
  await page.getByLabel("שם").fill(contractor);
  await page.getByLabel("טלפון").fill(phone);
  await page.getByRole("button", { name: "שמור איש מקצוע" }).click();
  await expect(page.getByRole("list", { name: "נמענים", exact: true })).toContainText(contractor);
  await page.getByRole("button", { name: "שלח לנמענים" }).click();
  await expect(page.getByRole("region", { name: "שרשור" })).toBeVisible();
}

// הערה: אין כאן בדיקת הקמת אתר. הקמת אתר שני משנה את מסך יצירת הפנייה
// למנהל מערכת (הוא נדרש לבחור אתר), וזיהום כזה של בסיס ה-E2E המשותף היה
// מפיל specs אחרים שיוצרים פניות. הקמת האתר מכוסה בבדיקת האינטגרציה.
test("מנהל מערכת מקים משתמש ותחום", async ({ page }) => {
  const stamp = Date.now();
  const managerName = `מנהל ${stamp}`;
  const domainName = `תחום ${stamp}`;

  await loginAsAdmin(page);

  // ── משתמש חדש — מנהל עבודה משויך לאתר ה-seed ──────────────────────
  //
  // ‏0.7: הטופס ירד מהפאנל הצדדי לדיאלוג שנפתח מכפתור שצמוד לכותרת.
  // השדות עצמם לא השתנו, ולכן רק שורת הפתיחה נוספה כאן.
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "הוסף משתמש חדש" }).click();

  const newUser = page.getByRole("dialog");
  await newUser.getByLabel("שם", { exact: true }).fill(managerName);
  await newUser.getByLabel("טלפון").fill(`050${String(stamp).slice(-7)}`);
  // התפקיד "מנהל עבודה" הוא ברירת המחדל, ולכן בורר האתר גלוי.
  await newUser.getByLabel("אתר").selectOption({ label: "אתר לדוגמה" });
  await newUser.getByLabel("סיסמה ראשונית").fill("sod-chazak-123");
  await newUser.getByRole("button", { name: "הוסף משתמש", exact: true }).click();

  // הדיאלוג נסגר בהצלחה, והמשתמש מופיע ברשימה שמאחוריו.
  await expect(newUser).toBeHidden();
  await expect(page.getByRole("button", { name: managerName, exact: true })).toBeVisible();

  // ── תחום חדש ──────────────────────────────────────────────────────
  //
  // מסך התחומים **נשאר** על טופס בצד (§ שלב 6): לתחום שדה אחד, ודיאלוג
  // סביבו היה מוסיף שתי לחיצות בלי להוסיף מקום. מה שהשתנה הוא שהכפתור
  // הוא `+` — והשם הנגיש נשמר, ולכן הבורר כאן לא זז.
  await page.goto("/admin/domains");
  await page.getByLabel("תחום חדש").fill(domainName);
  await page.getByRole("button", { name: "הוסף תחום" }).click();
  // ‏0.3: שם התחום מוצג כטקסט, ושדה העריכה נפתח בלחיצה על "שנה שם" — משנוספה
  // המחיקה לשורה, שדה קלט פתוח בכל שורה הפך את הרשימה לטופס.
  // ‏0.7: הכפתור נושא אייקון עיפרון, ואותו שם נגיש בדיוק.
  await expect(page.getByRole("button", { name: `שנה שם ${domainName}` })).toBeVisible();
});

test("מנהל מערכת מאחד שני אנשי מקצוע כפולים", async ({ page }) => {
  const stamp = Date.now();
  const keep = `כפיל ראשי ${stamp}`;
  const drop = `כפיל משני ${stamp}`;
  const digits = String(stamp).slice(-7);

  await loginAsAdmin(page);
  await createTicketWithProfessional(page, `תקלה א ${stamp}`, keep, `050${digits}`);
  await createTicketWithProfessional(page, `תקלה ב ${stamp}`, drop, `052${digits}`);

  await page.goto("/admin/professionals");

  // ‏0.7: טופס האיחוד ירד מהפאנל הקבוע לדיאלוג — זו הפעולה הנדירה ביותר
  // במסך, והיא זו שתפסה פאנל לצד הרשימה.
  await page.getByRole("button", { name: "איחוד כפילויות" }).click();
  const mergeDialog = page.getByRole("dialog");

  // הבחירה עטופה ב-toPass: כשבסיס הנתונים המשותף צובר אנשי מקצוע רבים,
  // ‏selectOption על select מבוקר ב-React נכשל לעיתים להירשם במצב — flake
  // של סביבת הבדיקה. חוזרים על הבחירה עד שהכפתור מאופשר.
  const mergeButton = mergeDialog.getByRole("button", { name: "אחד", exact: true });
  await expect(async () => {
    await mergeDialog.getByLabel("להשאיר").selectOption({ label: keep });
    await mergeDialog.getByLabel("לאחד ולמחוק").selectOption({ label: drop });
    await expect(mergeButton).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });

  page.once("dialog", (d) => d.accept());
  await mergeButton.click();

  await expect(mergeDialog.getByText(`הכפילות אוחדה. הכול הועבר ל"${keep}".`)).toBeVisible();

  // הכפיל נמחק — אינו מופיע עוד ברשימה. הבדיקה על הכרטיס ולא על טקסט
  // חופשי: הדיאלוג הפתוח עדיין מחזיק את שמו בהודעת האישור שמעליו.
  await mergeDialog.getByRole("button", { name: "סגור", exact: true }).click();
  await expect(page.getByRole("button", { name: drop, exact: true })).toHaveCount(0);
});

test("מנהל מערכת מוחק פנייה כפולה — אישור כפול", async ({ page }) => {
  const stamp = Date.now();
  const description = `פנייה כפולה למחיקה ${stamp}`;

  await loginAsAdmin(page);
  await createTicketWithProfessional(page, description, `קבלן ${stamp}`, `053${String(stamp).slice(-7)}`);
  const ticketUrl = new URL(page.url()).pathname;

  // המחיקה ירדה לפאנל "פרטים" ב-0.3, יחד עם שאר המטא-דאטה.
  await openDetails(page);

  // לחיצה ראשונה רק חושפת את האזהרה — אישור כפול.
  await page.getByRole("button", { name: "מחק פנייה" }).click();
  await expect(page.getByText("הפנייה וכל השרשור שלה יימחקו לצמיתות. הפעולה אינה הפיכה.")).toBeVisible();

  // לחיצה שנייה על הכפתור האדום הנפרד מוחקת, ומעבירה ללוח.
  await page.getByRole("button", { name: "כן, מחק לצמיתות" }).click();
  await expect(page).toHaveURL(/\/board$/);
  await expect(page.getByRole("link").filter({ hasText: description })).toHaveCount(0);

  // הפנייה עצמה נעלמה — כניסה ישירה לכתובתה מחזירה 404.
  //
  // הטענה היא על **קוד התשובה** ולא על היעדר כותרת במסך, וזה מכוון: טענת
  // היעדר אינה יודעת להבדיל בין "הרשומה נמחקה" לבין "המסך השתנה". רגע לפני
  // שהשרשור הופך לגוף העמוד, טענה כזו הייתה נשארת ירוקה לנצח בלי לבדוק דבר.
  const afterDelete = await page.goto(ticketUrl);
  expect(afterDelete?.status()).toBe(404);
});
