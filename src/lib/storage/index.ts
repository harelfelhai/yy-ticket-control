import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { localStorage } from "./local";
import { r2Storage } from "./r2";
import type { MediaStorage } from "./types";

export type { MediaStorage, UploadTarget } from "./types";

/**
 * בוחר את האחסון לפי הסביבה — אותו היגיון בדיוק כמו בבחירת ערוץ המייל.
 *
 * בפרודקשן חוסר הגדרה הוא כשל רועש: מערכת שנראית עובדת ובשקט מאבדת את
 * התמונה שמנהל צילם בשטח היא בדיוק מה שהמערכת נועדה למנוע.
 */
export function selectStorage(): MediaStorage {
  const config = env.r2();
  if (config) return r2Storage(config);

  if (env.isProduction()) {
    throw new Error("אחסון המדיה אינו מוגדר: חסרים משתני R2_*. ראה .env.example");
  }

  return localStorage(env.appBaseUrl());
}

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

/** תקרה לקובץ יחיד. וידאו קצר מהטלפון נכנס בנוחות. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function isAllowedMimeType(value: string): boolean {
  // ‏codecs מגיע מ-MediaRecorder בצורה `audio/webm;codecs=opus`
  const base = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(base);
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
