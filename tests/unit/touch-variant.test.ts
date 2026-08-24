import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * שאילתת המדיה של רצפת המגע — שלושה עותקים שחייבים להסכים.
 *
 * **למה בכלל שלושה.** ה-CSS מגדיר את הווריאנט `touch:` ב-`globals.css`;
 * שתי חבילות הבדיקות (`conformance` ו-`e2e`) מודדות `boundingBox` אמיתי
 * ולכן חייבות **לשאול את הדפדפן את אותה שאלה בדיוק** — אחרת הן מודדות
 * מכשיר אחד ואוכפות תקן של אחר. אי אפשר לייבא מחרוזת מ-CSS, ואי אפשר
 * לייבא מ-`src/` בלי לקשור את חבילת הבדיקות לקוד האפליקציה בשביל מחרוזת.
 *
 * הפתרון הוא לא לאסור את השכפול אלא **לאכוף אותו**: הקובץ הזה קורא את
 * שלושת המקומות ומשווה. אותה תבנית שבה נשמרת פלטת ה-frontmatter של
 * ‏`DESIGN.md` מול `globals.css`.
 *
 * **ולמה זה שווה בדיקה משלו.** הכלל הקודם היה `pointer-coarse:` המובנה של
 * ‏Tailwind, והוא היה שגוי בשקט: הוא שואל על המצביע **הראשי**, ולכן מחשב
 * עם מסך מגע ענה "גס" והעלה כל פקד במערכת ל-44px — כלומר סבב הצפיפות כולו
 * לא הגיע למי שיש לו מסך מגע. שום בדיקה לא נכשלה, מפני שאמולציית הדסקטופ
 * של Playwright אינה מדווחת coarse. הכשל התגלה רק כשמשתמש צילם מסך.
 *
 * **והנקודה המכריעה: אין בדיקת דפדפן שיכולה לתפוס את זה.** נמדד — הרצת
 * ‏`{...devices["Desktop Chrome"], hasTouch: true}` מחזירה `any-pointer:
 * fine` **שקר**, כלומר Chromium מדמה מכשיר מגע טהור ולא מכשיר היברידי.
 * המקרה שנשבר בפועל — מסך מגע *ועכבר* יחד — אינו ניתן לשחזור באמולציה,
 * ולכן `conformance` ו-`e2e` יעברו בין אם הכלל נכון ובין אם לא.
 *
 * מכאן שהקובץ הזה הוא **ההגנה היחידה** על התיקון. הוא אינו בודק התנהגות
 * אלא ניסוח, וזו לא פשרה: כשההתנהגות אינה ניתנת למדידה, הניסוח הוא הדבר
 * היחיד שנשאר לאכוף.
 */

const ROOT = join(__dirname, "..", "..");

/** מה שהמכשיר חייב לענות עליו "כן" כדי לקבל 44px. */
const EXPECTED = "(pointer: coarse) and (not (any-pointer: fine))";

function read(...segments: string[]): string {
  return readFileSync(join(ROOT, ...segments), "utf8");
}

describe("רצפת המגע — שאילתה אחת בשלושה קבצים", () => {
  it("‏globals.css מגדיר את הווריאנט `touch` בשאילתה המצופה", () => {
    const css = read("src", "app", "globals.css");
    // חמדני במתכוון: הסוגר האחרון סוגר את `(@media …)`, וכל השאר הוא השאילתה.
    const match = /@custom-variant\s+touch\s+\(@media\s+(.+)\);/.exec(css);

    expect(match, "‏@custom-variant touch לא נמצא ב-globals.css").not.toBeNull();
    expect(match?.[1].trim()).toBe(EXPECTED);
  });

  it("‏conformance ו-e2e שואלים את אותה שאילתה", () => {
    for (const file of [
      ["conformance", "specs", "rtl-mobile.spec.ts"],
      ["e2e", "mobile-qa.spec.ts"],
    ]) {
      const source = read(...file);
      const match = /const TOUCH_QUERY = "([^"]+)";/.exec(source);

      expect(match, `‏TOUCH_QUERY לא נמצא ב-${file.join("/")}`).not.toBeNull();
      expect(match?.[1], `${file.join("/")} מודד מכשיר אחר מזה שה-CSS מגדיר`).toBe(EXPECTED);
    }
  });

  it("‏`pointer-coarse:` המובנה אינו חוזר לקוד", () => {
    /**
     * הווריאנט המובנה עדיין קיים ב-Tailwind ויעבוד — ולכן מי שיכתוב אותו
     * מתוך הרגל לא יקבל שגיאה, רק פקד שקופץ ל-44px בדסקטופ. זו בדיוק
     * הצורה שבה הכשל המקורי חי חודשיים.
     *
     * הסריקה מתירה אזכור בפרוזה (```pointer-coarse:```) ואוסרת שימוש
     * כמחלקה — ההבדל הוא הגרשיים האחוריים שלפניו.
     */
    const files = [
      ["src", "components", "ui", "button.tsx"],
      ["src", "components", "ui", "field.tsx"],
      ["src", "app", "globals.css"],
    ];

    for (const file of files) {
      const source = read(...file);
      const offenders = source
        .split("\n")
        .filter((line) => /(?<!`)pointer-coarse:/.test(line) && !line.includes("`pointer-coarse:`"));

      expect(offenders, `${file.join("/")} משתמש ב-pointer-coarse: במקום touch:`).toEqual([]);
    }
  });
});
