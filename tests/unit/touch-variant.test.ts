import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SRC, scan } from "./source-scan";

/**
 * **רצפת המגע בוטלה ב-0.7. הקובץ הזה שומר שהיא לא תחזור בשקט.**
 *
 * עד 0.7 הוא עשה את ההפך: השאילתה
 * `(pointer: coarse) and (not (any-pointer: fine))` חיה בשלושה קבצים
 * שחייבים להסכים — ה-CSS שהגדיר את הווריאנט `touch:`, ושתי חבילות
 * ה-Playwright שמודדות `boundingBox` אמיתי ולכן חייבות לשאול את הדפדפן
 * את **אותה** שאלה. הקובץ השווה ביניהם.
 *
 * ההכרעה שהפכה אותו: בעל המוצר ראה את הכפתורים בטלפון, מצא אותם גדולים
 * מדי ביחס לדסקטופ, שמע התנגדות מנומקת, והחליט שגובה הפקד זהה בכל מכשיר.
 * הנימוק המקורי של הרצפה — אצבע בכפפה על מסך בשמש — **לא הופרך**, והמחיר
 * רשום ב-`docs/DESIGN.md` § אזורי מגע.
 *
 * **למה זה עדיין דורש אוכף, ולמה דווקא כאן.** שני מסלולי חזרה, ושניהם
 * שקטים בדרך שונה:
 *
 * ‏1. **`touch:` חוזר לקוד.** הווריאנט נמחק מ-`globals.css`, ולכן המחלקה
 *    אינה מייצרת CSS **כלל** — `min-h-7 touch:min-h-11` נקרא כמו רצפה
 *    קיימת ומתרנדר 28px. קוד שקורא נכון ואינו עושה דבר. את זה תופס
 *    `layout-guards.test.ts`; כאן נאכף הצד השני שלו — שההגדרה עצמה
 *    אינה חוזרת ל-CSS.
 * ‏2. **`pointer-coarse:` המובנה נכתב במקומו.** הוא **כן** יעבוד, ולכן
 *    לא תהיה שום סימן לתקלה — רק פקדים שקופצים ל-44px. וגרוע מכך: זו
 *    הגרסה **השבורה** של הכלל. היא שואלת על המצביע **הראשי**, כך שמחשב
 *    עם מסך מגע עונה "גס" ומקבל 44px למרות שיש עליו עכבר. בדיוק הכשל
 *    שחי חודשיים ב-0.5 והתגלה רק כשמשתמש צילם מסך.
 *
 * **והנקודה שלא השתנתה: אין בדיקת דפדפן שיכולה לתפוס את (2).** נמדד —
 * ‏`{...devices["Desktop Chrome"], hasTouch: true}` מחזירה `any-pointer:
 * fine` **שקר**, כלומר Chromium מדמה מכשיר מגע טהור ולא היברידי. המקרה
 * שנשבר בפועל — מסך מגע *ועכבר* יחד — אינו ניתן לשחזור באמולציה.
 *
 * מכאן שהקובץ הזה נשאר **ההגנה היחידה** על האזור הזה. הוא אינו בודק
 * התנהגות אלא ניסוח, וזו לא פשרה: כשההתנהגות אינה ניתנת למדידה, הניסוח
 * הוא הדבר היחיד שנשאר לאכוף.
 */

const ROOT = join(SRC, "..");

/** השאילתה שהגדירה את הווריאנט עד 0.7 — נשמרת כדי לזהות את חזרתה. */
const RETIRED_QUERY = "(pointer: coarse) and (not (any-pointer: fine))";

function read(...segments: string[]): string {
  return readFileSync(join(ROOT, ...segments), "utf8");
}

describe("רצפת המגע — בוטלה ואינה חוזרת", () => {
  it("‏globals.css אינו מגדיר עוד `@custom-variant touch`", () => {
    const css = read("src", "app", "globals.css");
    const match = /^\s*@custom-variant\s+touch\b/m.exec(css);

    expect(
      match,
      "הווריאנט `touch:` הוגדר מחדש ב-globals.css. הרצפה המותנית-במכשיר " +
        "בוטלה בהכרעת בעל המוצר (DESIGN.md § אזורי מגע); החזרתה היא החלטת " +
        "מוצר ולא תיקון, ומחייבת גם את שתי חבילות המדידה באותה נשימה.",
    ).toBeNull();
  });

  it("שתי חבילות המדידה מודדות רצפה אחת, בלי שאילתת מכשיר", () => {
    /**
     * ‏`TOUCH_QUERY` ו-`MIN_TOUCH` ירדו משתיהן יחד עם הווריאנט. אם אחת
     * מהן תחזיק שאילתת מכשיר בלי שה-CSS מגדיר אחת — היא תמדוד רצפה של
     * ‏44px מול קוד שמייצר 28px, כלומר תיכשל על מכשיר אמיתי בלבד.
     */
    for (const file of [
      ["conformance", "specs", "rtl-mobile.spec.ts"],
      ["e2e", "mobile-qa.spec.ts"],
    ]) {
      const source = read(...file);

      expect(
        source.includes(RETIRED_QUERY),
        `${file.join("/")} עדיין שואל את שאילתת המגע, שאין לה מקבילה ב-CSS`,
      ).toBe(false);
      expect(
        /const TOUCH_QUERY\b/.test(source),
        `${file.join("/")} מחזיק TOUCH_QUERY — הרצפה אינה תלויה עוד במכשיר`,
      ).toBe(false);
    }
  });

  it("‏`pointer-coarse:` המובנה אינו נכנס במקומו", () => {
    /**
     * זהו המסלול המסוכן מבין השניים, מפני שהוא **עובד**. הסריקה עוברת
     * דרך `scan`, שמנטרל הערות — ולכן ההסבר ההיסטורי שלמעלה, ובקבצי
     * הפרימיטיב, אינו נספר כהפרה.
     */
    const offenders = scan(/pointer-coarse:/);
    expect(
      offenders,
      "‏pointer-coarse: הוא הגרסה השבורה של הכלל — הוא שואל על המצביע " +
        "הראשי, ומחיל 44px גם על דסקטופ עם מסך מגע:\n" + offenders.join("\n"),
    ).toEqual([]);

    const css = read("src", "app", "globals.css");
    expect(
      /^\s*@custom-variant\s+\S*\s*\(@media\s*\(pointer:\s*coarse\)\s*\)/m.test(css),
      "‏globals.css מגדיר וריאנט על `(pointer: coarse)` בלבד — הגרסה השבורה",
    ).toBe(false);
  });
});
