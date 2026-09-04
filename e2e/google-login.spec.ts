import { expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";

/**
 * מסלול ההתחברות בגוגל, מקצה לקצה — **בלי לפנות לגוגל**.
 *
 * הטענה בכל בדיקה כאן היא "לאן **אנחנו** שלחנו את הדפדפן ומה שמנו בעוגייה",
 * ולא "מה גוגל עשתה". זו אותה פילוסופיה של `captureWhatsAppRedirects`
 * ב-`helpers.ts`: האחריות שלנו נגמרת בכותרת ה-`Location`.
 *
 * ‏`GOOGLE_CLIENT_ID`/`SECRET` מוזרקים כערכי דמה ב-`playwright.config.ts`,
 * ולכן המסלול **מוגדר** כאן — מה שאי אפשר לבדוק מול שרת הפיתוח, שאין לו
 * את המשתנים.
 *
 * מה שנשאר לאימות ידני מול חשבון אמיתי: מסך ההסכמה של גוגל, חילוף הקוד,
 * ואימות ה-ID token. שלושתם דורשים שגוגל תדבר איתנו.
 */

const START = "/api/auth/google/start";
const CALLBACK = "/api/auth/google/callback";

test.describe("הכפתור במסך ההתחברות", () => {
  test("קיים, ומצביע על נתיב הפתיחה", async ({ page }) => {
    await page.goto("/login");

    const link = page.getByRole("link", { name: "התחברות עם Google" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", START);
  });

  test("‏`next` נכנס לכתובת הכפתור", async ({ page }) => {
    // תרחיש אמיתי: קישור למסך פנימי נפתח אחרי שהסשן פג.
    await page.goto("/board");
    await expect(page).toHaveURL(/next=%2Fboard/);

    await expect(page.getByRole("link", { name: "התחברות עם Google" })).toHaveAttribute(
      "href",
      `${START}?next=%2Fboard`,
    );
  });

  test("התחברות בסיסמה לא נשברה", async ({ page }) => {
    // קנרית רגרסיה לצד השינוי: המסלול הראשי חייב להישאר כמות שהוא.
    await page.goto("/login");
    await page.getByLabel("טלפון או מייל").fill(E2E_ADMIN.phone);
    await page.getByLabel("סיסמה").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "כניסה" }).click();

    await expect(page).toHaveURL(/\/board$/);
  });
});

test.describe("פתיחת הזרימה", () => {
  test("מפנה לגוגל עם כל הפרמטרים, ומניחה את עוגיית ה-state", async ({ page }) => {
    const response = await page.request.get(START, { maxRedirects: 0 });

    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);

    const location = response.headers()["location"];
    expect(location, "חייבת להיות כותרת Location").toBeTruthy();

    const target = new URL(location as string);
    expect(target.host).toBe("accounts.google.com");
    expect(target.pathname).toBe("/o/oauth2/v2/auth");

    const params = target.searchParams;
    expect(params.get("response_type")).toBe("code");
    expect(params.get("scope")).toBe("openid email profile");
    expect(params.get("code_challenge_method")).toBe("S256");
    // בלעדיו גוגל עשויה לאשר אוטומטית מול החשבון שהדפדפן מחובר אליו,
    // ולמשתמשים כאן יש חשבון אישי וחשבון עבודה.
    expect(params.get("prompt")).toBe("select_account");
    expect(params.get("client_id")).toBeTruthy();
    expect(params.get("state")).toBeTruthy();
    expect(params.get("nonce")).toBeTruthy();
    expect(params.get("code_challenge")).toBeTruthy();

    // בלי פורט קשיח: החבילה רצה על 3101, הפיתוח על 3100, והפרודקשן על 443.
    expect(params.get("redirect_uri")).toMatch(/\/api\/auth\/google\/callback$/);

    // מה שהמערכת במכוון **אינה** מבקשת.
    expect(params.get("access_type")).toBeNull();
    expect(location).not.toMatch(/calendar/i);

    const setCookie = response.headers()["set-cookie"] ?? "";
    expect(setCookie).toContain("yy_oauth");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toMatch(/SameSite=Lax/i);
    // ‏baseURL הוא http://localhost, ולכן `Secure` אינו מסומן — הכרעת
    // `servedOverHttps`. WebKit מסרב לשמור עוגייה מסומנת מעל http.
    expect(setCookie).not.toMatch(/;\s*Secure/i);
  });

  test("כל פתיחה מייצרת state אחר", async ({ page }) => {
    const first = await page.request.get(START, { maxRedirects: 0 });
    const second = await page.request.get(START, { maxRedirects: 0 });

    const stateOf = (location: string) => new URL(location).searchParams.get("state");

    expect(stateOf(first.headers()["location"] as string)).not.toBe(
      stateOf(second.headers()["location"] as string),
    );
  });

  test("‏`next` חיצוני אינו הופך את המסך למנוע הפניות", async ({ page }) => {
    const response = await page.request.get(`${START}?next=https://evil.example/x`, {
      maxRedirects: 0,
    });

    // ההפניה עדיין לגוגל; מה ש-`safeNextPath` חסם הוא היעד שנשמר בעוגייה,
    // וההוכחה הנגישה לכך היא שכל כשל נוחת על `/login` במקור שלנו.
    expect(new URL(response.headers()["location"] as string).host).toBe("accounts.google.com");
  });
});

test.describe("חזרה מגוגל", () => {
  test("בלי עוגיית state — הזרימה פגה", async ({ page }) => {
    // זהו גם המסלול של Login-CSRF: הדפדפן של הקורבן אינו מחזיק את העוגייה
    // שנוצרה אצל התוקף, ולכן אין `state` להשוות אליו.
    await page.goto(`${CALLBACK}?code=some-code&state=some-state`);

    await expect(page).toHaveURL(/\/login\?error=expired/);
    await expect(page.getByText("תוקף ההתחברות פג. נסה שוב.")).toBeVisible();
  });

  test("‏state שאינו תואם לעוגייה — הזרימה פגה", async ({ page }) => {
    // עוגייה אמיתית מ-`/start`, ואז `state` אחר בכתובת.
    await page.request.get(START, { maxRedirects: 0 });

    await page.goto(`${CALLBACK}?code=some-code&state=not-the-one`);

    await expect(page).toHaveURL(/\/login\?error=expired/);
    await expect(page.getByText("תוקף ההתחברות פג. נסה שוב.")).toBeVisible();
  });

  test("ביטול אצל גוגל מוצג כביטול ולא כתקלה", async ({ page }) => {
    await page.goto(`${CALLBACK}?error=access_denied&state=some-state`);

    await expect(page).toHaveURL(/\/login\?error=denied/);
    await expect(page.getByText("ההתחברות דרך Google בוטלה.")).toBeVisible();
  });

  test("העוגייה נצרכת — ניסיון חוזר אינו מתקדם", async ({ page }) => {
    await page.request.get(START, { maxRedirects: 0 });

    // הראשון צורך את העוגייה; השני מגיע בלי עוגייה כלל, ושניהם `expired`.
    await page.goto(`${CALLBACK}?code=some-code&state=not-the-one`);
    await expect(page).toHaveURL(/error=expired/);

    await page.goto(`${CALLBACK}?code=some-code&state=not-the-one`);
    await expect(page).toHaveURL(/error=expired/);

    const cookies = await page.context().cookies();
    expect(cookies.find((cookie) => cookie.name === "yy_oauth")?.value ?? "").toBe("");
  });
});
