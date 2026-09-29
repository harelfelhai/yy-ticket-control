/**
 * מה מותר לאחסן, באיזה גודל, ומי שומר על זה בכתיבה מהשרת.
 *
 * הקבועים ישבו עד כה ב-`index.ts`. הם עברו לכאן משום ש-`index.ts` הוא גם
 * מי שמייבא את שני הדרייברים, וכעת הדרייברים עצמם צריכים את רשימת ההיתר
 * ואת התקרה — ייבוא מ-`index.ts` היה סוגר מעגל. קובץ בלי שום תלות שובר
 * את המעגל בלי לשכפל ערך: `index.ts` ממשיך לייצא מכאן הלאה, וכל מי
 * שמייבא מ-`@/lib/storage` אינו מושפע.
 */

/**
 * סוגי הקבצים שמותר להעלות.
 *
 * רשימת היתר ולא רשימת איסור: קובץ שאינו ברשימה נדחה, ולא להפך. הסינון
 * נעשה בשרת ולא רק ב-`accept` של השדה — התכונה הזו היא נוחות בממשק
 * ואינה מונעת דבר ממי שקורא ל-API ישירות.
 */
export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
] as const;

/**
 * מסמכים שנשמרים **בהתכתבות המייל בלבד** (§7 שורה 64): Word ו-Excel.
 *
 * רשימה נפרדת מ-`ALLOWED_MIME_TYPES` בכוונה. זו רשימת ההיתר של ההעלאה
 * מהדפדפן, והוספת Word אליה הייתה מאפשרת להעלות מסמכים לשרשור של פנייה —
 * לנמענים ולקבלנים. כאן הכותב היחיד הוא שירות קליטת המייל, והקובץ נגיש רק
 * למי שרואה את ההתכתבות.
 */
export const CORRESPONDENCE_DOCUMENT_TYPES = [
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

/**
 * למה נכתב הקובץ, ולכן איזו רשימת היתר חלה עליו: מדיה של פנייה, או מסמך
 * שנשמר בהתכתבות המייל בלבד.
 */
export type StoragePurpose = "media" | "correspondence";

/** תקרה לקובץ יחיד. וידאו קצר מהטלפון נכנס בנוחות. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** הסוג בלי פרמטרים ובאותיות קטנות — `audio/webm;codecs=opus` הוא `audio/webm` */
function baseType(value: string): string {
  // codecs מגיע מ-MediaRecorder בצורה `audio/webm;codecs=opus`
  return value.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function isAllowedMimeType(value: string): boolean {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(baseType(value));
}

/** האם הסוג הוא מסמך שנשמר בהתכתבות בלבד (Word, Excel) */
export function isCorrespondenceDocumentType(value: string): boolean {
  return (CORRESPONDENCE_DOCUMENT_TYPES as readonly string[]).includes(baseType(value));
}

/**
 * שומר הסף של `MediaStorage.write` — בדיקה אחת לשני הדרייברים.
 *
 * מסלול ההעלאה מהדפדפן נבדק בשני מקומות: `registerMedia` בודק את הסוג ואת
 * הגודל **שהלקוח הצהיר** עליהם לפני שהוא מחזיר מפתח, ו-`confirmUpload`
 * מודד אחר כך את מה שבאמת נחת. הכתיבה מהשרת עוקפת את שניהם — אין רישום
 * מקדים ואין דפדפן באמצע — ולכן בלי הבדיקה כאן היה קובץ מצורף של 200MB או
 * `application/zip` נכנס לאחסון בדלת האחורית, במקום שבו כבר אי אפשר לדחות.
 *
 * הבדיקה קודמת לכל מגע בדיסק או ברשת בכוונה: כישלון אינו משאיר אובייקט
 * חלקי שמישהו יצטרך לנקות.
 *
 * זו **שגיאת מפתח ולא הודעה למשתמש**: מי שקורא (שירות הקליטה) אמור לסנן
 * קבצים ב-`classifyAttachment` לפני שהוא מגיע לכאן, וזריקה כאן פירושה באג
 * שצריך להגיע ל-Sentry. מכאן גם הטקסט האנגלי-עברי המעורב, בלי `he.ts`.
 *
 * `purpose` בוחר את רשימת ההיתר: מדיה לפנייה, או מסמך להתכתבות בלבד. אין
 * מטרה שמקבלת את שתיהן — Word אינו נכתב כמדיה, ותמונה אינה נכתבת כמסמך.
 */
export function assertWritableObject(
  key: string,
  bytes: Buffer,
  contentType: string,
  purpose: StoragePurpose = "media",
): void {
  const allowed = purpose === "media" ? isAllowedMimeType(contentType) : isCorrespondenceDocumentType(contentType);
  if (!allowed) {
    throw new Error(`סוג הקובץ ${contentType} אינו מותר לאחסון (${key})`);
  }

  // בתים ריקים נדחים כמו במסלול ההעלאה (route של ההעלאה המקומית מחזיר 413
  // על אורך 0): אובייקט ריק הוא בדיוק "רשומת מדיה שמצביעה על כלום" —
  // המצב ש-`head` נועד למנוע. עדיף שהקורא ידע שהקובץ המצורף היה ריק.
  if (bytes.byteLength === 0) {
    throw new Error(`הקובץ ${key} ריק — אין מה לכתוב`);
  }

  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error(
      `הקובץ ${key} גדול מהמותר: ${bytes.byteLength} בתים מול תקרה של ${MAX_FILE_BYTES}`,
    );
  }
}
