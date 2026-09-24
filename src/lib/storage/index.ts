import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { localStorage } from "./local";
import { r2Storage } from "./r2";
import type { MediaStorage } from "./types";

export type { MediaStorage, UploadTarget } from "./types";

// רשימת ההיתר והתקרה ישבו כאן, ועברו ל-`limits.ts` כשגם הדרייברים נזקקו
// להן (`MediaStorage.write` נכתב מהשרת ואינו עובר ברישום המדיה). הייצוא
// מכאן נשמר כדי שמסלול הייבוא `@/lib/storage` יישאר אחד.
export {
  ALLOWED_MIME_TYPES,
  MAX_FILE_BYTES,
  assertWritableObject,
  isAllowedMimeType,
} from "./limits";

/**
 * בוחר את האחסון לפי הסביבה — אותו היגיון בדיוק כמו בבחירת ערוץ המייל.
 *
 * בפרודקשן חוסר הגדרה הוא כשל רועש: מערכת שנראית עובדת ובשקט מאבדת את
 * התמונה שמנהל צילם בשטח היא בדיוק מה שהמערכת נועדה למנוע.
 *
 * `MEDIA_STORAGE=local` הוא ויתור **מפורש** על הכלל הזה. הוא נדרש בשני
 * מצבים אמיתיים: בדיקות שרצות מול בנייה של פרודקשן (בנייה, לא פריסה),
 * והתקנה על שרת יחיד שבו הקבצים יושבים על הדיסק במכוון. ההבדל בין
 * "שכחתי להגדיר" לבין "החלטתי כך" חייב להיות מפורש בסביבה, ולא ניחוש.
 */
export function selectStorage(): MediaStorage {
  const config = env.r2();
  if (config) return r2Storage(config);

  if (env.isProduction() && !env.forceLocalStorage()) {
    throw new Error(
      "אחסון המדיה אינו מוגדר: חסרים משתני R2_*. להרצה מקומית מכוונת הגדר MEDIA_STORAGE=local",
    );
  }

  return localStorage(env.appBaseUrl());
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
};

/**
 * בונה מפתח אחסון חדש.
 *
 * מזהה אקראי ולא שם הקובץ המקורי: שם שמגיע מהמשתמש עלול להכיל תווים
 * שמשמעותם נתיב, והוא גם אינו ייחודי — שני מנהלים יעלו "IMG_0001.jpg".
 * השם המקורי נשמר בנפרד ב-`originalName` לצורך תצוגה והורדה.
 *
 * החלוקה לפי שנה וחודש נועדה לג'וב הגיבוי (M6): היא מאפשרת לסנכרן רק את
 * מה שהתווסף, במקום לסרוק תיקייה אחת שגדלה בלי גבול.
 */
export function buildStorageKey(mimeType: string, at: Date): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  const extension = EXTENSIONS[base] ?? "bin";
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");

  return `media/${year}/${month}/${randomUUID()}.${extension}`;
}
