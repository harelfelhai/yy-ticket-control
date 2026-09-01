import "dotenv/config";

/**
 * הרצה בפועל של מנוע ה-AI מול הספק האמיתי.
 *
 * **הבדיקות האוטומטיות מריצות כפילים בכוונה** — הן מאמתות את החוזה שלנו
 * ולא את Gemini, ואין לשלם על קריאה חיצונית בכל ריצת בדיקות. לכן הן
 * יכולות לעבור במלואן בזמן שהמפתח שגוי, המודל אינו קיים, או שהתשובה
 * חוזרת במבנה אחר. הסקריפט הזה סוגר בדיוק את הפער הזה.
 *
 * ‏`smoke-notify` עושה את אותו הדבר לצינור המייל, ומאותו נימוק.
 *
 * הרצה:
 *   npx tsx scripts/smoke-ai.mts <נתיב לקובץ>
 *
 * תמונה או PDF → חילוץ טקסט. אודיו → תמלול. הסוג נגזר מהסיומת.
 * המפתח נקרא מ-`GEMINI_API_KEY` ואינו מודפס לעולם.
 */

const { readFile } = await import("node:fs/promises");
const { extname, basename } = await import("node:path");
const { selectTextExtractor, selectTranscriber, canExtractText } = await import(
  "../src/lib/ai/gemini"
);

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".webm": "audio/webm",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

const path = process.argv[2];
if (!path) {
  console.error("שימוש: npx tsx scripts/smoke-ai.mts <נתיב לקובץ>");
  process.exit(1);
}

const mimeType = MIME_BY_EXT[extname(path).toLowerCase()];
if (!mimeType) {
  console.error(`סיומת לא מוכרת: ${extname(path)}`);
  process.exit(1);
}

const file = await readFile(path);
const isAudio = mimeType.startsWith("audio/");

// הבורר מחזיר null כשאין מפתח — אותה התנהגות בדיוק כמו בעובד, ולכן
// ההודעה כאן היא מה שהמשתמש היה מקבל בפועל.
const engine = isAudio ? selectTranscriber() : selectTextExtractor();
if (!engine) {
  console.error("‏GEMINI_API_KEY אינו מוגדר — במערכת עצמה הקובץ היה מסומן SKIPPED.");
  process.exit(1);
}

if (!isAudio && !canExtractText(mimeType)) {
  console.error(`הסוג ${mimeType} אינו נשלח לחילוץ.`);
  process.exit(1);
}

console.log(`קובץ: ${basename(path)} · ${mimeType} · ${Math.round(file.byteLength / 1024)}KB`);
console.log(`מנוע: ${engine.name} · ${isAudio ? "תמלול" : "חילוץ טקסט"}`);

const started = Date.now();
const text = isAudio
  ? await (engine as import("../src/lib/ai/types").Transcriber).transcribe(file, mimeType)
  : await (engine as import("../src/lib/ai/types").TextExtractor).extract(file, mimeType);

console.log(`\n──────── התוצאה (${Date.now() - started}ms, ${text.length} תווים) ────────`);
console.log(text || "(ריק — הספק לא מצא טקסט)");
