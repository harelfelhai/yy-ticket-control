import { expect, test } from "@playwright/test";

/**
 * כותרות האבטחה מוגדרות ב-`next.config.ts` וחלות על כל נתיב. הבדיקה מאמתת
 * שהן באמת יוצאות מהשרת — כולל על מסך הפורטל הלא-מאומת `/p/*`, המשטח הרגיש
 * ביותר. רצה גם מול בניית פיתוח וגם מול production (E2E_PRODUCTION=1), כך
 * שההחמרה של ה-CSP ב-production נבדקת במסלול האמיתי ולא רק ביחידה.
 */

const assertions: Record<string, (value: string) => void> = {
  "content-security-policy": (v) => {
    expect(v).toContain("default-src 'self'");
    expect(v).toContain("frame-ancestors 'none'");
    expect(v).toContain("object-src 'none'");
  },
  "x-frame-options": (v) => expect(v).toBe("DENY"),
  "x-content-type-options": (v) => expect(v).toBe("nosniff"),
  "referrer-policy": (v) => expect(v).toBe("strict-origin-when-cross-origin"),
  "strict-transport-security": (v) => expect(v).toContain("max-age="),
  "permissions-policy": (v) => expect(v).toContain("camera=(self)"),
};

// שני משטחים: מסך פנימי גלוי, ומסך הפורטל עם טוקן שאינו קיים (מציג "הקישור
// אינו בתוקף" ב-200) — שניהם חייבים לשאת את הכותרות.
for (const path of ["/login", "/p/lo-kayam"]) {
  test(`כותרות אבטחה נשלחות על ${path}`, async ({ page }) => {
    const response = await page.goto(path);
    if (!response) throw new Error(`אין תגובה עבור ${path}`);

    const headers = response.headers();
    for (const [name, assertValue] of Object.entries(assertions)) {
      const value = headers[name];
      expect(value, `כותרת ${name} חסרה`).toBeTruthy();
      assertValue(value as string);
    }
  });
}
