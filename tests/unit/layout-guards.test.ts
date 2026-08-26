import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_WIDTH, DIALOG_WIDE, FULL_WIDTH, PAGE_BLEED, PAGE_X } from "@/lib/ui";
import { SRC, scan } from "./source-scan";

const ROOT = join(SRC, "..");

/** גובה בפיקסלים של מחלקת `min-h-N` של Tailwind (בסיס 4px) */
function heightOf(source: string, key: string): number {
  const match = new RegExp(`${key}:\\s*"min-h-(\\d+)`).exec(source);
  if (!match) throw new Error(`לא נמצא גובה עבור ${key}`);
  return Number(match[1]) * 4;
}

/**
 * שני אוכפים שנולדו מסבב הביקורת הראשון של סוכן design-review (1.8.2026).
 *
 * שני הפערים שהם שומרים — רוחבי תוכן (10) ואזורי מגע (14) — כבר סומנו ✅
 * פעם אחת, בלי אוכף, **וזלגו**: 13 `max-w-*` ישירים הצטברו בעמודים (כולל
 * ערכים שאינם קיימים בתקן), ו-`NAV_LINK` ישב על 40px מתחת לאף אחד. זו
 * הסיבה שהבדיקות האלה קיימות: "תוקן" אינו "נסגר" כל עוד אין מי שאוכף.
 */

describe("רוחבי תוכן", () => {
  /**
   * ‏`max-w` בשמות גודל (`sm`…`7xl`) הוא רוחב תוכן, ומקורו היחיד הוא
   * הקבועים ב-`src/lib/ui.ts` — "שני ערכים בלבד" (DESIGN.md § רוחבי תוכן).
   * ‏`max-w` מספרי (כמו `max-w-44` על `FilterSelect`) הוא אילוץ פקד, לא
   * רוחב תוכן, ולכן מותר — זה קו הגבול בין שני השימושים.
   */
  const NAMED_MAX_W = /\bmax-w-(xs|sm|md|lg|xl|[2-9]xl|prose|screen-\w+|\[)/;

  it("אין `max-w-*` ישיר — רוחב תוכן מגיע מ-`src/lib/ui.ts`", () => {
    const offenders = scan(NAMED_MAX_W, ["lib/ui.ts"]);
    expect(
      offenders,
      `יש להשתמש ב-CONTENT_WIDTH / WIDE_WIDTH מ-@/lib/ui:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("רוחב הקריאה תואם לתקן — 768px", () => {
    // אם ערך כאן משתנה, DESIGN.md § רוחבי תוכן חייב להשתנות איתו.
    expect(CONTENT_WIDTH).toContain("max-w-3xl");
  });

  it("רוחב הדיאלוג הרחב תואם לתקן — 672px", () => {
    // כנ"ל: DESIGN.md § Dialog מונה את הערך הזה בשמו.
    expect(DIALOG_WIDE).toContain("max-w-2xl");
  });

  it("מסך שסורקים בו אינו מוגבל ואינו ממורכז", () => {
    /**
     * הבדיקה שהחליפה את `WIDE_WIDTH === max-w-5xl`.
     *
     * הערך הישן היה תקרה, וההכרעה החדשה היא שאין תקרה — ולכן אין טעם לנעול
     * מספר. מה שכן צריך נעילה הוא ש-`FULL_WIDTH` לא יצמיח בשקט `mx-auto`
     * או `max-w`: שניהם מחזירים בדיוק את העמודה הממורכזת שהוסרה, ושניהם
     * ייכתבו בתום לב על ידי מי שינסה "לרסן" מסך רחב במקום לרסן את הרכיב.
     */
    expect(FULL_WIDTH).toBe("w-full");
  });

  it("ריפוד העמוד והבליטה הדביקה הם אותו ערך", () => {
    /**
     * רצועה דביקה נמתחת לקצה ב-`-mx-*` שחייב להיות בדיוק הריפוד של העמוד.
     * פער לכיוון אחד משאיר פסים ריקים בצדדים שהתוכן זולג מתחתם; לכיוון
     * השני מייצר גלישה אופקית שנכשלת רק בבדיקת המובייל, כלומר רחוק ממי
     * שכתב אותה.
     */
    expect(PAGE_BLEED).toBe(`-${PAGE_X.replace("px-", "mx-")}`);
  });
});

describe("אזורי מגע", () => {
  /**
   * **הרצפה המותנית-במכשיר בוטלה ב-0.7, והאוכף התהפך.**
   *
   * עד כאן ישבו כאן שתי בדיקות ששמרו על **זוג**: `min-h` נמוך חייב
   * ‏`touch:min-h-11` באותה שורה, ו-`touch:min-h-11` חייב גובה בסיס לפניו.
   * הן שירתו כלל שכבר אינו קיים — בעל המוצר הכריע שגובה הפקד זהה בכל
   * מכשיר (‏28px/32px), אחרי שהתנגדות מנומקת הוצגה לו ונדחתה. הנימוק
   * המקורי של הרצפה — אצבע בכפפה על מסך בשמש — **לא הופרך**, והמחיר רשום
   * ב-`docs/DESIGN.md` § אזורי מגע.
   *
   * **מה שנשאר לאכוף הוא שהכלל לא יחזור בשקט.** הווריאנט `touch:` נמחק
   * מ-`globals.css`, ולכן מחלקה שנכתבת איתו **אינה מייצרת CSS כלל**:
   * ‏`min-h-7 touch:min-h-11` נראה בקוד כמו רצפה קיימת, ומתרנדר כ-28px.
   * זהו בדיוק סוג הכשל השקט שהמערכת הזו נבנתה לתפוס — קוד שקורא נכון
   * ואינו עושה דבר.
   *
   * ‏`pointer-coarse:` המובנה של Tailwind נאסר בנפרד ב-
   * `touch-variant.test.ts`: הוא **כן** יעבוד, ולכן מי שיכתוב אותו מתוך
   * הרגל יחזיר את הרצפה — ובגרסה השבורה שלה, זו ששואלת על המצביע הראשי
   * ומחילה 44px גם על דסקטופ עם מסך מגע.
   */
  const TOUCH_VARIANT = /\btouch:/;

  it("הווריאנט `touch:` אינו חוזר — הוא נמחק ולכן אינו מייצר CSS", () => {
    const offenders = scan(TOUCH_VARIANT);
    expect(
      offenders,
      "‏touch: בוטל ב-0.7 ואינו מוגדר עוד ב-globals.css — מחלקה שנכתבת " +
        "איתו אינה עושה דבר. הגובה זהה בכל מכשיר (DESIGN.md § אזורי מגע):\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  /**
   * **הרצפה הנמדדת נגזרת מהקוד, ואינה מוקלדת.**
   *
   * שתי חבילות Playwright מודדות גובה אמיתי בדפדפן (`rtl-mobile` סורק כל
   * כפתור וקישור ב-15 מסכים; `mobile-qa` בודק את מסך ההתחברות), ולשתיהן
   * קבוע משלהן לרצפה בעכבר. עד 0.6 שלושת המספרים — הוא, הוא, ו-`compact`
   * ב-`button.tsx` — הסכימו **במקרה**.
   *
   * זה הפך למסוכן ברגע שהרצפה ירדה: היא **המדידה היחידה** בפרויקט על גובה
   * פקדים, וכל השאר הן סריקות מחרוזת. מספר שנשאר מאחור אינו מכשיל דבר —
   * הוא פשוט מפסיק לתפוס, ואז פקד שנוחת על גובה שגוי הוא בלתי נראה.
   *
   * זו אותה תבנית בדיוק של `touch-variant.test.ts`, שנולד מפני שהשאילתה
   * חיה בשלושה קבצים שחייבים להסכים.
   */
  it("רצפת העכבר בחבילות המדידה זהה לגובה `compact` שבפרימיטיב", () => {
    const compact = heightOf(readFileSync(join(SRC, "components/ui/button.tsx"), "utf8"), "compact");

    const suites = [
      ["conformance/specs/rtl-mobile.spec.ts", /const MIN_POINTER_FINE = (\d+);/],
      ["e2e/mobile-qa.spec.ts", /const MIN_POINTER_FINE_PX = (\d+);/],
    ] as const;

    for (const [file, pattern] of suites) {
      const match = pattern.exec(readFileSync(join(ROOT, file), "utf8"));
      expect(match, `לא נמצאה רצפת העכבר ב-${file}`).not.toBeNull();
      expect(
        Number(match?.[1]),
        `${file} מודד מול רצפה שאינה גובה \`compact\` (${compact}px). ` +
          `שינוי גובה בפרימיטיב מחייב את שתי החבילות באותה נשימה.`,
      ).toBe(compact);
    }
  });
});

/**
 * **מספרי הגובה ב-DESIGN.md מושווים לקוד.**
 *
 * ‏`design:lint` מוודא שההפניות במסמך מתאימות זו לזו **בתוך המסמך**, ולא
 * שהערכים תואמים למה שהקוד עושה — בדיוק הפער ש-`palette.test.ts` סוגר
 * לצבעים. עד 0.6 חמישה גבהים מתועדים חיו בלי שום קישור לקוד, וזה הסבב
 * שבו הם השתנו: בלי האוכף הזה אפשר היה להוריד גובה ולהשאיר את המסמך
 * מספר-אחד אחורה, והלינט היה נשאר ירוק.
 */
describe("גבהים מתועדים מול הקוד", () => {
  const DOC = readFileSync(join(ROOT, "docs/DESIGN.md"), "utf8");

  /** `height: 32px` בתוך בלוק ה-frontmatter של רכיב נתון */
  function documented(component: string): number {
    const block = new RegExp(`^  ${component}:$([\\s\\S]*?)^  \\S`, "m").exec(DOC);
    const height = /height:\s*(\d+)px/.exec(block?.[1] ?? "");
    if (!height) throw new Error(`לא נמצא גובה מתועד עבור ${component}`);
    return Number(height[1]);
  }

  it.each([
    ["button-primary", "components/ui/button.tsx", "default"],
    ["button-secondary", "components/ui/button.tsx", "default"],
    ["button-danger", "components/ui/button.tsx", "default"],
    ["button-compact", "components/ui/button.tsx", "compact"],
    ["input", "components/ui/field.tsx", "default"],
    ["input-compact", "components/ui/field.tsx", "compact"],
  ])("‏%s במסמך תואם לקוד", (component, file, key) => {
    const inCode = heightOf(readFileSync(join(SRC, file), "utf8"), key);
    expect(
      documented(component),
      `DESIGN.md מתעד גובה אחר מהקוד עבור ${component}. ` +
        `המסמך הוא מקור האמת — לעדכן אותו, ולא את הבדיקה.`,
    ).toBe(inCode);
  });
});

/**
 * ‏`justify-between` — § Layout: "אלמנט לא נדחף לקצה הנגדי של מיכל רחב.
 * תג, מונה או **פעולה** שמתייחסים לכותרת נצמדים אליה".
 *
 * **פער 25 נסגר ואז זלג (פער 33)**, ובזליגה הופיעה גם צורה **מוסווית**:
 * ‏`flex-1` על ילד יחיד מייצר בדיוק את אותה תוצאה, וחומק מאוכף שמחפש את
 * הביטוי. לכן שתי בדיקות ולא אחת — אחת על הניסוח, ואחת על ההתנהגות.
 */
describe("אלמנט אינו נדחף לקצה הנגדי", () => {
  it("אין justify-between", () => {
    const offenders = scan(/\bjustify-between\b/);

    expect(
      offenders,
      `אלמנט נצמד למה שהוא מתייחס אליו (flex-wrap + gap) — DESIGN.md § Layout:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  /**
   * הצורה המוסווית, מצומצמת למה שהיא באמת: **תווית טקסט שנמתחת**.
   *
   * ‏`flex-1` עצמו לגיטימי ברוב מופעיו — שלד עמוד שממלא גובה, שדה קלט
   * שגדל, שני כפתורים שחולקים שורה בחלקים שווים. הניסיון הראשון שלי אסר
   * אותו גורף וסימן שבעה מופעים תקינים; אוכף שמייצר רעש נמחק בסבב הבא,
   * ואז הכלל נשאר בלי שמירה בכלל.
   *
   * מה ש**כן** מוסווה הוא `flex-1` על `<span>` של טקסט: הוא אינו ממלא
   * מקום לצורך עצמו אלא דוחף את מה שאחריו לקצה — כלומר `justify-between`
   * בשם אחר. זו הצורה שנמצאה ב-`domains-list`, ובה בלבד.
   */
  it("אין flex-1 על תווית טקסט — הצורה המוסווית של אותה הפרה", () => {
    const offenders = scan(/<span[^>]*\bflex-1\b/);

    expect(
      offenders,
      `תווית שנמתחת דוחפת את שכניה לקצה — זהו justify-between בשם אחר (DESIGN.md § Layout):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
