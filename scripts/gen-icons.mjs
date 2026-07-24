/**
 * מייצר את אייקוני ה-PNG של האפליקציה מתוך מקור יחיד: `src/app/icon.svg`.
 *
 * למה סקריפט ולא קבצים ידניים: האייקון הוא ה-SVG. ה-PNG-ים נגזרים ממנו,
 * וכך שינוי עיצוב מתגלגל לכל הגדלים בהרצה אחת (`npm run gen:icons`) במקום
 * לערוך חמישה קבצים בינאריים ביד ולפספס אחד.
 *
 * הגדלים נדרשים לשלושה צרכנים שונים:
 * - 192 ו-512 (‏purpose "any"): קריטריון ההתקנה של Chrome באנדרואיד.
 * - 512 maskable: כדי שאנדרואיד יציג אייקון מלא בצורת המכשיר, בלי מסגרת
 *   לבנה מכוערת. הגליף שלנו כבר בתוך אזור הבטיחות, ולכן אותו מקור מתאים.
 * - 180 (‏apple-icon): ‏iOS אינו קורא את ה-manifest אלא את apple-touch-icon.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(path.join(root, "src/app/icon.svg"));

mkdirSync(path.join(root, "public/icons"), { recursive: true });

const targets = [
  { file: "public/icons/icon-192.png", size: 192 },
  { file: "public/icons/icon-512.png", size: 512 },
  { file: "public/icons/icon-maskable-512.png", size: 512 },
  { file: "src/app/apple-icon.png", size: 180 },
];

for (const { file, size } of targets) {
  await sharp(svg, { density: 512 })
    .resize(size, size)
    .png()
    .toFile(path.join(root, file));
  console.log(`נוצר ${file} (${size}px)`);
}

/**
 * ‏favicon.ico — אייקון לשונית הדפדפן, כתחליף למותג של create-next-app.
 *
 * ‏sharp אינו כותב ICO, אבל פורמט ICO תומך ב-PNG מוטמע (מאז Windows Vista),
 * ולכן די לעטוף PNG 48×48 בכותרת ICO של רשומה אחת. הדפדפנים המודרניים ממילא
 * מעדיפים את `icon.svg`; זהו נפילה-לאחור על-מותגית במקום הלוגו של Next.
 */
const icoPng = await sharp(svg, { density: 512 }).resize(48, 48).png().toBuffer();
const ico = Buffer.alloc(6 + 16);
ico.writeUInt16LE(0, 0); // שמור
ico.writeUInt16LE(1, 2); // סוג: אייקון
ico.writeUInt16LE(1, 4); // מספר תמונות
ico.writeUInt8(48, 6); // רוחב
ico.writeUInt8(48, 7); // גובה
ico.writeUInt8(0, 8); // מספר צבעים (0 = לא בשימוש)
ico.writeUInt8(0, 9); // שמור
ico.writeUInt16LE(1, 10); // planes
ico.writeUInt16LE(32, 12); // ביט לפיקסל
ico.writeUInt32LE(icoPng.length, 14); // גודל תמונת ה-PNG
ico.writeUInt32LE(22, 18); // היסט תחילת התמונה (6 + 16)
writeFileSync(path.join(root, "src/app/favicon.ico"), Buffer.concat([ico, icoPng]));
console.log("נוצר src/app/favicon.ico (48px, PNG מוטמע)");
