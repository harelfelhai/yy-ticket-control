import { expect, test } from "@playwright/test";

/**
 * חסימת ההתחברות אחרי ניסיונות כושלים — מסלול אמיתי מול השרת.
 *
 * מזהה ייחודי לכל ריצה: ההגבלה נספרת לפי מזהה ונשמרת ב-DB של ה-E2E, שאינו
 * מתאפס בין בדיקות. בלי ייחודיות, הריצה על דסקטופ הייתה מתחילה כשהמזהה כבר
 * חסום מריצת המובייל, והבדיקה נכשלת מסיבה שאינה קשורה לקוד.
 */
test("התחברות נחסמת אחרי ניסיונות כושלים חוזרים", async ({ page }) => {
  const identifier = `rl-${Date.now()}@example.com`;
  const submit = page.getByRole("button", { name: "כניסה" });

  await page.goto("/login");

  // עשרה כשלונות — מעל המכסה (8). כל סבב ממתין לתשובת השרת ולכפתור שחוזר
  // לפעולה: הכפתור מושבת בזמן שהפעולה רצה, ולחיצה עליו אז היא no-op שלא
  // מצטברת. בלי ההמתנה הזו הכשלונות אינם נספרים והחסימה אינה נכנסת לתוקף.
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.getByLabel("טלפון או מייל").fill(identifier);
    await page.getByLabel("סיסמה").fill("password-lo-nachon");
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/login")),
      submit.click(),
    ]);
    await expect(submit).toBeEnabled();
  }

  // אחרי חציית המכסה, הודעת החסימה מוצגת במקום "פרטי ההתחברות אינם נכונים".
  // ‏getByText ולא getByRole("alert"): ל-Next יש route-announcer עם אותו role,
  // ובחירה לפי role הייתה מפרה strict mode על שני אלמנטים.
  await expect(page.getByText(/יותר מדי ניסיונות התחברות/)).toBeVisible();
});
