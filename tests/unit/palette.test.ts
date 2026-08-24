import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_COLOR } from "@/lib/brand";

/**
 * הפלטה הסמנטית — נמדדת, לא נצפית.
 *
 * הבדיקה קוראת את הערכים מ-`globals.css` ומחשבת מהם ניגודיות ומיקום ב-OKLCH.
 * היא אינה משכפלת אותם, ולכן אי אפשר "לתקן" אותה בלי לתקן את המקור.
 *
 * מה שהיא מונעת כבר קרה: הפלטה הקודמת נלקחה כמות שהיא מסולם ה-700 של
 * Tailwind, ושתי תוצאות עברו בשקט — `success` ו-`warning` ישבו על 4.59 מול
 * רקע העמוד, תשע מאיות מעל רצפת ה-AA, ו-`brand` היה **רווי יותר מ-`danger`**.
 * כלומר כפתור "פנייה חדשה" צעק חזק יותר ממצב שבו העבודה בשטח עצורה.
 */

const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const ICON = readFileSync(join(process.cwd(), "src/app/icon.svg"), "utf8");

function token(name: string): string {
  const match = CSS.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, "i"));
  if (!match) throw new Error(`הטוקן --color-${name} אינו מוגדר ב-globals.css`);
  return match[1].toLowerCase();
}

/**
 * ארבעת **המצבים**. ‏`brand` אינו ביניהם, ומאז המעבר לגרפיט זו הכרעה ולא
 * השמטה: הוא הדיו של המערכת — המילוי של פעולה ראשית — ולא מצב שהפנייה
 * נמצאת בו. המשמעות היחידה שהייתה לו כמצב, "פנייה חדשה שטרם נצפתה", עברה
 * ל-`info`. בדיקות שחלות עליו כעוגן נייטרלי יושבות ב-describe נפרד למטה.
 */
const STATES = ["info", "danger", "success", "warning"] as const;
const SURFACE = token("surface");
const BG = token("bg");
const ON_FILL = token("brand-fg");

const dec = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const channels = (hex: string) => [1, 3, 5].map((i) => dec(parseInt(hex.slice(i, i + 2), 16) / 255));

function luminance(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** בהירות ורוויה נתפסות. sRGB לבדו אינו מודד אותן — ערוץ ירוק "כבד" יותר. */
function oklch(hex: string): { L: number; C: number } {
  const [r, g, b] = channels(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    C: Math.hypot(
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ),
  };
}

describe("ניגודיות", () => {
  it.each(STATES)("‏%s כטקסט על משטח עומד ב-AAA", (name) => {
    // 7.0 ולא 4.5: מסך בשמש ישירה מאבד ניגודיות אפקטיבית, והמכשיר העיקרי
    // כאן הוא טלפון בשטח. זו גם השאיפה שכתובה ב-DESIGN.md § Colors.
    expect(contrast(token(name), SURFACE)).toBeGreaterThanOrEqual(7);
  });

  it.each(STATES)("‏%s כטקסט על רקע העמוד שומר מרווח אמיתי מעל AA", (name) => {
    // רצפת AA היא 4.5. 6.0 היא מרווח, ולא "עבר בקושי" — הפלטה הקודמת ישבה
    // על 4.59, כלומר כל כוונון עתידי היה מפיל אותה בלי שאיש ישים לב.
    expect(contrast(token(name), BG)).toBeGreaterThanOrEqual(6);
  });

  it.each(STATES)("טקסט לבן על מילוי %s עומד ב-AAA", (name) => {
    // הווריאנט `solid` של הצ׳יפ, וכפתור ראשי/הרסני. לפני הכיול `success`
    // ו-`warning` נתנו 5.02 בלבד.
    expect(contrast(ON_FILL, token(name))).toBeGreaterThanOrEqual(7);
  });
});

describe("היררכיה סמנטית", () => {
  it("‏`danger` רווי יותר מכל מצב אחר — עבודה עצורה גוברת", () => {
    // ההשוואה היא מול **כל** המצבים ולא מול `brand` בלבד, כפי שהיה כשהוא
    // עוד היה אחד מהם. הכלל שנשמר הוא הכלל עצמו: אין מצב שצועק חזק יותר
    // מ"העבודה בשטח עצורה".
    const danger = oklch(token("danger")).C;
    for (const name of STATES.filter((state) => state !== "danger")) {
      expect(danger).toBeGreaterThan(oklch(token(name)).C);
    }
  });

  it("ארבעת המצבים נושאים משקל נתפס זהה", () => {
    // בהירות אחידה. בלעדיה מצב אחד בולט על פני אחר מפני שהגוון שלו במקרה
    // בהיר יותר — כלומר הפלטה מוסיפה דגש שאיש לא התכוון אליו.
    const lightness = STATES.map((name) => oklch(token(name)).L);
    expect(Math.max(...lightness) - Math.min(...lightness)).toBeLessThan(0.02);
  });
});

/**
 * ‏`brand` הוא הדיו ולא מצב — ולכן הכללים שחלים עליו שונים.
 *
 * הבדיקות כאן הן מה שמחליף את חברותו במשפחה הסמנטית. בלעדיהן המעבר לגרפיט
 * היה מוציא את הצבע הנפוץ ביותר במערכת מכל פיקוח: הוא היה נשאר מכוסה רק
 * בבדיקת ה"מקור אחד" למטה, שמוודאת שלושה עותקים זהים — ולא שהערך עצמו קריא.
 */
describe("‏brand — עוגן נייטרלי", () => {
  it("כהה מכל אחד מארבעת המצבים", () => {
    // זו כל ההכרעה של הגרפיט בשורה אחת: הפעולה שקטה מהמצב. אילו brand היה
    // מטפס חזרה לבהירות של המצבים, הכפתורים היו שוב מתחרים במידע.
    const brand = oklch(token("brand")).L;
    for (const name of STATES) {
      expect(brand).toBeLessThan(oklch(token(name)).L);
    }
  });

  it("טקסט לבן על מילוי brand עומד ב-AAA", () => {
    expect(contrast(ON_FILL, token("brand"))).toBeGreaterThanOrEqual(7);
  });

  it("‏brand אינו משמש לטקסט על משטח — הוא בלתי-מובחן מטקסט רגיל", () => {
    /**
     * לא בדיקת ניגודיות אלא **תיעוד של המלכודת**, במספר.
     *
     * ‏brand מול fg יושב על ~1.26 — כלומר קישור בצבע המותג נראה בדיוק כמו
     * טקסט גוף. זו הסיבה ש-DESIGN.md § Colors אוסר `text-brand` וקובע
     * שקישור מסומן בקו תחתון. אם מישהו יבהיר את brand בעתיד עד שההבחנה
     * תחזור, הבדיקה תיכשל ותכריח לקרוא מחדש את ההחלטה.
     */
    expect(contrast(token("brand"), token("fg"))).toBeLessThan(1.5);
  });
});

describe("טבעת מיקוד", () => {
  /**
   * הכלל של `focus` שונה מזה של כל שאר הפלטה: לא AAA מול משטח אחד, אלא
   * ‏3:1 — רצפת WCAG לרכיב שאינו טקסט — מול **שני** הקצוות. הטבעת מופיעה
   * גם על שדה לבן וגם על כפתור ראשי גרפיט, וערך שעובר רק על אחד מהם משאיר
   * את מי שמנווט במקלדת בלי סימן על מחצית מהמסך.
   */
  it.each([
    ["משטח לבן", "surface"],
    ["מילוי גרפיט", "brand"],
    ["רקע העמוד", "bg"],
  ] as const)("נקראת על %s", (_label, against) => {
    expect(contrast(token("focus"), token(against))).toBeGreaterThanOrEqual(3);
  });
});

describe("מקור אמת אחד לצבע המותג", () => {
  /**
   * שלושה עותקים, ואי אפשר לאחדם: `@theme` דורש ליטרל ב-CSS, מטא-דאטה של
   * Next דורשת מחרוזת ב-JS, ו-`icon.svg` הוא נכס סטטי שאינו מייבא דבר.
   * מה שכן אפשר הוא למנוע סטייה, וזה מה שקורה כאן.
   */
  it("‏BRAND_COLOR זהה ל-`--color-brand`", () => {
    expect(BRAND_COLOR.toLowerCase()).toBe(token("brand"));
  });

  it("האייקון צבוע באותו גרפיט", () => {
    // אם זה נכשל אחרי שינוי צבע — יש להריץ גם `npm run gen:icons`, אחרת
    // ה-PNG-ים שנגזרים ממנו נשארים בצבע הישן.
    const hexes = [...ICON.matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0].toLowerCase());
    expect(hexes).toContain(token("brand"));
    expect(new Set(hexes)).toEqual(new Set([token("brand"), "#ffffff"]));
  });

  it("‏frontmatter של DESIGN.md נושא את אותם ערכים", () => {
    /**
     * העותק הרביעי, והוא היה **לגמרי ללא שמירה** עד עכשיו.
     *
     * ה-frontmatter הוא הצורה שקריאה למכונה של התקן — `npm run design:lint`
     * קורא אותו, וכך גם כל כלי עיצוב שיתחבר אליו. אבל הלינטר מוודא רק
     * שההפניות מתאימות זו לזו **בתוך המסמך**, ולא שהערכים תואמים לקוד:
     * הפלטה בקובץ הזה יכלה להישאר כחולה בעוד המערכת כולה גרפיט, והבדיקה
     * הייתה ירוקה. הפער הזה נמצא בפועל, בסבב הגרפיט.
     */
    const doc = readFileSync(join(process.cwd(), "docs/DESIGN.md"), "utf8");
    const frontmatter = doc.slice(0, doc.indexOf("\n---", 4));

    for (const [docName, cssName] of [
      ["primary", "brand"],
      ["onPrimary", "brand-fg"],
      ["bg", "bg"],
      ["surface", "surface"],
      ["border", "border"],
      ["fg", "fg"],
      ["muted", "muted"],
      ["focus", "focus"],
      ["info", "info"],
      ["danger", "danger"],
      ["success", "success"],
      ["warning", "warning"],
    ] as const) {
      const match = frontmatter.match(new RegExp(`^ +${docName}: "(#[0-9a-f]{6})"`, "im"));
      expect(match?.[1]?.toLowerCase(), `‏${docName} חסר ב-frontmatter`).toBe(token(cssName));
    }
  });

  it("חץ הבורר צבוע ב-`--color-muted`", () => {
    /**
     * העותק הרביעי, והוא היה עד עכשיו ללא שמירה.
     *
     * ‏`.control-chevron` מקודד את הצבע בתוך `data:` URI, שם משתנה CSS אינו
     * ניתן להשתלה — כלומר הכפילות בלתי נמנעת. מה שכן נמנע הוא סטייה שקטה:
     * בלי הבדיקה הזו שינוי של `--color-muted` היה משאיר חץ בגוון הישן בכל
     * בורר במערכת, ואף בדיקה קיימת לא הייתה מבחינה — `field.test.tsx`
     * מוודא רק ששני הפקדים חולקים את המחלקה, לא מה צבעה.
     */
    const encoded = token("muted").replace("#", "%23");
    expect(CSS).toContain(`stroke='${encoded}'`);
  });
});
