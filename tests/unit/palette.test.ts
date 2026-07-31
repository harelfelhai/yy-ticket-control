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

const SEMANTIC = ["brand", "danger", "success", "warning"] as const;
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
  it.each(SEMANTIC)("‏%s כטקסט על משטח עומד ב-AAA", (name) => {
    // 7.0 ולא 4.5: מסך בשמש ישירה מאבד ניגודיות אפקטיבית, והמכשיר העיקרי
    // כאן הוא טלפון בשטח. זו גם השאיפה שכתובה ב-DESIGN.md § Colors.
    expect(contrast(token(name), SURFACE)).toBeGreaterThanOrEqual(7);
  });

  it.each(SEMANTIC)("‏%s כטקסט על רקע העמוד שומר מרווח אמיתי מעל AA", (name) => {
    // רצפת AA היא 4.5. 6.0 היא מרווח, ולא "עבר בקושי" — הפלטה הקודמת ישבה
    // על 4.59, כלומר כל כוונון עתידי היה מפיל אותה בלי שאיש ישים לב.
    expect(contrast(token(name), BG)).toBeGreaterThanOrEqual(6);
  });

  it.each(SEMANTIC)("טקסט לבן על מילוי %s עומד ב-AAA", (name) => {
    // הווריאנט `solid` של הצ׳יפ, וכפתור ראשי/הרסני. לפני הכיול `success`
    // ו-`warning` נתנו 5.02 בלבד.
    expect(contrast(ON_FILL, token(name))).toBeGreaterThanOrEqual(7);
  });
});

describe("היררכיה סמנטית", () => {
  it("‏`danger` רווי יותר מ-`brand` — עבודה עצורה גוברת על פעולה ראשית", () => {
    expect(oklch(token("danger")).C).toBeGreaterThan(oklch(token("brand")).C);
  });

  it("ארבעת הסמנטיים נושאים משקל נתפס זהה", () => {
    // בהירות אחידה. בלעדיה מצב אחד בולט על פני אחר מפני שהגוון שלו במקרה
    // בהיר יותר — כלומר הפלטה מוסיפה דגש שאיש לא התכוון אליו.
    const lightness = SEMANTIC.map((name) => oklch(token(name)).L);
    expect(Math.max(...lightness) - Math.min(...lightness)).toBeLessThan(0.02);
  });
});

describe("מקור אמת אחד לכחול", () => {
  /**
   * שלושה עותקים, ואי אפשר לאחדם: `@theme` דורש ליטרל ב-CSS, מטא-דאטה של
   * Next דורשת מחרוזת ב-JS, ו-`icon.svg` הוא נכס סטטי שאינו מייבא דבר.
   * מה שכן אפשר הוא למנוע סטייה, וזה מה שקורה כאן.
   */
  it("‏BRAND_COLOR זהה ל-`--color-brand`", () => {
    expect(BRAND_COLOR.toLowerCase()).toBe(token("brand"));
  });

  it("האייקון צבוע באותו כחול", () => {
    // אם זה נכשל אחרי שינוי צבע — יש להריץ גם `npm run gen:icons`, אחרת
    // ה-PNG-ים שנגזרים ממנו נשארים בצבע הישן.
    const hexes = [...ICON.matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0].toLowerCase());
    expect(hexes).toContain(token("brand"));
    expect(new Set(hexes)).toEqual(new Set([token("brand"), "#ffffff"]));
  });
});
