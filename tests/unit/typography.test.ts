import { describe, expect, it } from "vitest";
import { METRIC_VALUE, TITLE_DESCRIPTIVE, TITLE_IDENTIFYING } from "@/lib/ui";
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

/**
 * מחלקת גודל **בתוך תגית** `<h1>`/`<h2>` — הכותרת קובעת את גודלה בעצמה.
 *
 * ‏`[^>]*` ולא lookahead עם `.*`: הניסוח הקודם, `(?=.*<h[12]\b).*\btext-…`,
 * גרם ל-backtracking ריבועי וחצה 5 שניות על הקוד הנוכחי. הניסוח הזה ליניארי,
 * וגם מדויק יותר — `<h1>טקסט</h1> <span className="text-lg">` באותה שורה אינו
 * כותרת שקובעת את גודלה, והנוסח הישן היה סופר אותו כהפרה.
 */
const SELF_SIZED_HEADING = /<h[12]\b[^>]*\btext-(xs|sm|base|lg|xl|[2-9]xl)\b/;

/**
 * כל מחלקת גודל מעל 16px, **בכל אלמנט** — לא רק בכותרת.
 *
 * זהו החור שפער 29 חשף: `overview/page.tsx` כתב `text-2xl font-bold` על
 * `<span>` — ליטרל זהה תו-בתו ל-`TITLE_IDENTIFYING` — וחמק, כי `SELF_SIZED_HEADING`
 * דורש `<h1>`/`<h2>` באותה שורה.
 *
 * הכלל הזה אוכף לראשונה גם את "`text-lg` ו-`text-3xl` ומעלה — אסורים"
 * (DESIGN.md § חוקים), שלא היה לו עד היום שום אוכף.
 */
const LARGE_TEXT = /\btext-(lg|xl|[2-9]xl)\b/;

/** כותרות בעמוד השגיאה הגלובלי מסוגננות ב-inline styles ואינן נשענות על Tailwind */
const EXEMPT = ["app/global-error.tsx"];

/** ‏`lib/ui.ts` הוא **המקור** לגדלים — הוא המקום היחיד שמותר לו לכתוב אותם */
const LARGE_TEXT_EXEMPT = [...EXEMPT, "lib/ui.ts"];

describe("סקאלת הכותרות", () => {
  it("אף `<h1>`/`<h2>` אינו קובע את גודלו בעצמו", () => {
    const offenders = scan(SELF_SIZED_HEADING, EXEMPT);

    expect(offenders, `יש להשתמש ב-TITLE_IDENTIFYING / TITLE_DESCRIPTIVE מ-@/lib/ui:\n${offenders.join("\n")}`)
      .toEqual([]);
  });

  /**
   * **שני הכללים נחוצים, ואף אחד אינו מכיל את השני.**
   *
   * `<h2 className="text-sm">` — כותרת קטנה מהטקסט שהיא מכותרת, בדיוק פער 9 —
   * נתפס ב-`SELF_SIZED_HEADING` בלבד. `<span className="text-2xl">` — פער 29 —
   * נתפס ב-`LARGE_TEXT` בלבד. איחודם היה פותח מחדש אחד משני החורים.
   */
  it("אין מחלקת גודל מעל 16px מחוץ ל-`lib/ui.ts`", () => {
    const offenders = scan(LARGE_TEXT, LARGE_TEXT_EXEMPT);

    expect(offenders, `גודל מעל 16px מגיע מקבוע ב-@/lib/ui, לא נכתב בקובץ:\n${offenders.join("\n")}`)
      .toEqual([]);
  });

  it("הסקאלה עצמה תואמת ל-docs/DESIGN.md", () => {
    // 24px/700 מזהה, 20px/600 מתאר. אם ערך כאן משתנה — התקן חייב להשתנות איתו.
    expect(TITLE_IDENTIFYING).toBe("text-2xl font-bold");
    expect(TITLE_DESCRIPTIVE).toBe("text-xl font-semibold");
  });

  it("`METRIC_VALUE` הוא תפקיד על רמה קיימת, לא רמה שביעית", () => {
    // הסקאלה סגורה בשש רמות (DESIGN.md § חוקים). ערך-מדד חולק את 24px/700 עם
    // כותרת מזהה — בדיוק כמו `body` ו-`bodyStrong` שחולקים 16px.
    expect(METRIC_VALUE).toBe(TITLE_IDENTIFYING);
  });

  it("כותרת סקציה אינה קטנה מכותרת דף", () => {
    const rank = (className: string) => {
      const match = className.match(/text-(\d)xl/);
      return match ? Number(match[1]) : 1;
    };
    expect(rank(TITLE_IDENTIFYING)).toBeGreaterThan(rank(TITLE_DESCRIPTIVE));
  });
});
