import type { AiStatus } from "@/generated/prisma/enums";
import { he } from "./he";

/**
 * הצורה שבה מדיה מוצגת ללקוח.
 *
 * טיפוסים בקובץ נפרד ולא לצד ה-Server Actions: קובץ עם `"use server"`
 * רשאי לייצא פונקציות אסינכרוניות בלבד, וייצוא טיפוס ממנו מייצר הפניה
 * בזמן ריצה שנופלת רק כשהמסך כבר עלה.
 */

export interface UploadTargetView {
  url: string;
  headers: Record<string, string>;
}

export interface RegisteredMediaView {
  mediaId: string;
  upload: UploadTargetView;
}

/** קובץ שהועלה, כפי שהוא מוצג בשרשור */
export interface MediaView {
  id: string;
  url: string;
  mimeType: string;
  name: string;
  /** תמלול או טקסט שחולץ, כשקיים */
  aiText: string | null;
  /** נוסח מצב ה-AI להצגה, או null כשאין מה לומר */
  aiNote: string | null;
}

/** הקובץ כפי שהוא שמור, בשדות שהתצוגה זקוקה להם בלבד */
export interface MediaRecord {
  id: string;
  mimeType: string;
  originalName: string | null;
  transcription: string | null;
  extractedText: string | null;
  aiStatus: AiStatus;
  /**
   * ב-`FAILED` — הודעת השגיאה. ב-`SKIPPED` — **סיבת הדילוג**
   * (`no-engine` / `unsupported`), שבלעדיה שני מצבים שונים לגמרי נראים זהים.
   */
  aiError: string | null;
}

/**
 * ממיר רשומת מדיה לצורת התצוגה.
 *
 * הטוקן נכנס לכתובת כשהצופה הוא נמען חיצוני: לפורטל אין עוגיית סשן, ובלי
 * הטוקן ה-route שמגיש את הקובץ אינו יודע מי מבקש — והתשובה הנכונה למי
 * שאינו ידוע היא 404.
 */
export function toMediaView(file: MediaRecord, token?: string): MediaView {
  return {
    id: file.id,
    url: token
      ? `/api/media/${file.id}?t=${encodeURIComponent(token)}`
      : `/api/media/${file.id}`,
    mimeType: file.mimeType,
    name: file.originalName ?? "",
    // תמלול וטקסט מחולץ לעולם אינם מופיעים יחד: אודיו מתומלל, תמונה נקראת.
    aiText: file.transcription ?? file.extractedText ?? null,
    aiNote: aiNote(file),
  };
}

/**
 * מה לומר על עיבוד ה-AI כשאין עדיין תוצאה.
 *
 * כשל בעיבוד אינו כשל בקובץ: ההקלטה נשמרה, התמונה נשמרה, והן מוצגות
 * כרגיל. הנוסח מספר מה חסר, ולא מתנצל על משהו שאבד (אפיון §7).
 */
function aiNote(file: MediaRecord): string | null {
  if (file.transcription || file.extractedText) return null;

  const isAudio = mediaKind(file.mimeType) === "audio";

  switch (file.aiStatus) {
    case "PENDING":
    case "PROCESSING":
      return isAudio ? he.ai.transcriptionPending : he.ai.extractionPending;
    case "FAILED":
      return isAudio ? he.ai.transcriptionFailed : he.ai.extractionFailed;
    case "SKIPPED":
      /**
       * ‏`no-engine` בלבד. וידאו וסוגי קובץ שאינם נתמכים מדולגים גם הם, ושם
       * השתיקה נכונה — אין מה לעבד ואין למשתמש מה לעשות.
       *
       * כאן, לעומת זאת, **יש** מה לתמלל ואין במה. עד לתיקון הזה שני המצבים
       * נראו זהים והממשק שתק בשניהם: המנהל הקליט, ראה נגן, ולא ידע שהתמלול
       * לא קרה, שהחיפוש לא ימצא את ההקלטה, ושהתיאור לא יתמלא ממנה.
       */
      if (file.aiError !== "no-engine") return null;
      return isAudio ? he.ai.transcriptionNoEngine : he.ai.extractionNoEngine;
    default:
      // ‏DONE בלי טקסט — תמונה בלי כיתוב. אין מה לומר.
      return null;
  }
}

export type MediaKind = "image" | "video" | "audio" | "file";

/**
 * לפי מה מוצג הקובץ בשרשור.
 *
 * נגזר מסוג ה-MIME ולא מהסיומת: הסיומת מגיעה משם שהמשתמש שלט בו, וטלפון
 * מעלה לעיתים קובץ בלי סיומת כלל.
 */
export function mediaKind(mimeType: string): MediaKind {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base.startsWith("image/")) return "image";
  if (base.startsWith("video/")) return "video";
  if (base.startsWith("audio/")) return "audio";
  return "file";
}
