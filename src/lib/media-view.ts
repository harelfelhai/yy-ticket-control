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
  const base = baseMimeType(mimeType);
  if (base.startsWith("image/")) return "image";
  if (base.startsWith("video/")) return "video";
  if (base.startsWith("audio/")) return "audio";
  return "file";
}

/** סוג ה-MIME בלי הפרמטרים שאחרי `;` (למשל `charset`) */
function baseMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

/**
 * ‏PDF אינו `MediaKind` משלו, ובכוונה.
 *
 * בשרשור הוא קובץ ככל קובץ — קישור להורדה — ולכן הוספת ערך חמישי ל-`MediaKind`
 * הייתה מחייבת כל `switch` להתייחס למקרה שאין לו התנהגות נפרדת. מה שכן ייחודי
 * ל-PDF הוא ש**הדפדפן יודע להציג אותו בעצמו**, וזו שאלה נפרדת מ"איך הוא נראה
 * בבועה" — ולכן פרדיקט ולא ענף.
 */
export function isPdf(mimeType: string): boolean {
  return baseMimeType(mimeType) === "application/pdf";
}

/**
 * האם הדפדפן יכול להציג את הקובץ מכתובת `blob:` מקומית, לפני שהועלה.
 *
 * זו השאלה שקובעת אם כדאי ליצור `URL.createObjectURL` בזמן הבחירה. תמונה
 * ו-PDF כן; וידאו ואודיו לא — לא מפני שהדפדפן אינו יודע, אלא מפני שאיש אינו
 * מציג אותם לפני העלאה, ו-object URL שנוצר ולא נצרך הוא דליפת זיכרון עד
 * לרענון הדף.
 *
 * **‏PDF נוסף כאן במסך 5**, שבו הדוח מוצג בצד כהקשר קבוע (אפיון מסך 5,
 * שורה 271) — והתצוגה חייבת להיות מקומית: הקובץ עדיין אינו מצורף לשום
 * פנייה, ולכן `getViewableMedia` מחזיר עליו `null` בכוונה.
 */
export function canPreviewLocally(mimeType: string): boolean {
  return mediaKind(mimeType) === "image" || isPdf(mimeType);
}
