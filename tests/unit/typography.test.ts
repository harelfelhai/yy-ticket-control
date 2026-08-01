import { describe, expect, it } from "vitest";
import { TITLE_DESCRIPTIVE, TITLE_IDENTIFYING } from "@/lib/ui";
import { scan } from "./source-scan";

/**
 * שמירה על סקאלת הכותרות — בדיקה על הקוד עצמו ולא על רינדור.
 *
 * הסיבה שהיא קיימת: הסטייה שהיא מונעת **כבר קרתה, ולא נראתה במשך חודשים**.
 * ‏15 כותרות סקציה נכתבו ב-14px — כלומר קטנות מהטקסט שהן מכותרות. אף בדיקת
 * רינדור לא נכשלה, כי כל מסך היה עקבי עם עצמו; רק ההשוואה בין מסכים חשפה
 * את ההיפוך.
 *
 * הבדיקה **אינה** כופה שכל `<h1>` יהיה 24px, וזו הבחנה מכוונת: התקן מחלק
 * לפי תפקיד ולא לפי רמת HTML, ו-`<h1>חיפוש</h1>` הוא 20px בכוונה. מה שנאכף
 * הוא שהגודל מגיע מ-`@/lib/ui` ולא נכתב בקובץ.
 *
 * לכן הבדיקה נשאלת על **המקור**: אף כותרת אינה קובעת את גודלה בעצמה. מי
 * שירצה גודל אחר יצטרך לשנות את `src/lib/ui.ts`, כלומר לקבל החלטה מודעת
 * שנוגעת בכל המערכת — ולא לכתוב מחלקה בקובץ אחד.
 */

/** שורה שיש בה גם `<h1>`/`<h2>` וגם מחלקת גודל — הכותרת קובעת את גודלה בעצמה */
const SELF_SIZED_HEADING = /(?=.*<h[12]\b).*\btext-(xs|sm|base|lg|xl|[2-9]xl)\b/;

/** כותרות בעמוד השגיאה הגלובלי מסוגננות ב-inline styles ואינן נשענות על Tailwind */
const EXEMPT = ["app/global-error.tsx"];

describe("סקאלת הכותרות", () => {
  it("אף `<h1>`/`<h2>` אינו קובע את גודלו בעצמו", () => {
    const offenders = scan(SELF_SIZED_HEADING, EXEMPT);

    expect(offenders, `יש להשתמש ב-TITLE_IDENTIFYING / TITLE_DESCRIPTIVE מ-@/lib/ui:\n${offenders.join("\n")}`)
      .toEqual([]);
  });

  it("הסקאלה עצמה תואמת ל-docs/DESIGN.md", () => {
    // 24px/700 מזהה, 20px/600 מתאר. אם ערך כאן משתנה — התקן חייב להשתנות איתו.
    expect(TITLE_IDENTIFYING).toBe("text-2xl font-bold");
    expect(TITLE_DESCRIPTIVE).toBe("text-xl font-semibold");
  });

  it("כותרת סקציה אינה קטנה מכותרת דף", () => {
    const rank = (className: string) => {
      const match = className.match(/text-(\d)xl/);
      return match ? Number(match[1]) : 1;
    };
    expect(rank(TITLE_IDENTIFYING)).toBeGreaterThan(rank(TITLE_DESCRIPTIVE));
  });
});
