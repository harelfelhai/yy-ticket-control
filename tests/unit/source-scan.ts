import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * תשתית לבדיקות ששומרות על התקן בסריקת קוד מקור (לא רינדור).
 *
 * הרציונל המשותף לכולן: הסטיות שהן מונעות אינן נראות במסך בודד — כל מסך
 * עקבי עם עצמו — ולכן שום בדיקת רינדור לא תתפוס אותן. מקור אחד לסריקה,
 * כדי שתיקון באג בה (ראו `stripComments`) יתקן את כל הבדיקות בבת אחת.
 */

export const SRC = join(process.cwd(), "src");

export function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * הערות מנוטרלות לפני הסריקה — קבצים מתעדים בהערות את מה שאוחד ("היה
 * `min-h-9`"), והתיעוד אסור שייספר כהפרה. שני כללים שנלמדו בקושי:
 *
 * - שורת `//` מרוקנת ולא רק מסומנת, אבל **רק כשהיא פותחת את השורה** — אחרת
 *   `https://` בתוך מחרוזת בולע את שארית השורה ומסתיר הפרה אמיתית.
 * - בלוק `/* *\/` מוחלף בשורות ריקות **באותו מספר** ולא נמחק: מחיקה מזיזה
 *   את כל מה שאחריה, והדיווח מצביע על שורה שגויה (נתפס בפועל: 231 מול 238).
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => "\n".repeat(block.split("\n").length - 1))
    .split("\n")
    .map((line) => (line.trimStart().startsWith("//") ? "" : line))
    .join("\n");
}

/** סורק את `src` ומחזיר `path:line — תוכן` לכל שורה שתואמת. */
export function scan(pattern: RegExp, exempt: string[] = []): string[] {
  return sourceFiles(SRC).flatMap((file) => {
    const rel = relative(SRC, file).replaceAll("\\", "/");
    if (exempt.includes(rel)) return [];

    return stripComments(readFileSync(file, "utf8"))
      .split("\n")
      .flatMap((text, index) =>
        pattern.test(text) ? [`${rel}:${index + 1} — ${text.trim()}`] : [],
      );
  });
}
