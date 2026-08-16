import type { AiStatus } from "@/generated/prisma/enums";
import { canExtractText } from "@/lib/ai/extract";
import type { TextExtractor, Transcriber } from "@/lib/ai/types";
import { db } from "@/lib/db";
import { normalizeText } from "@/lib/normalize";
import { selectStorage } from "@/lib/storage";

/**
 * עיבוד ה-AI על קובץ מדיה: תמלול הקלטה, או חילוץ טקסט מתמונה ומ-PDF.
 *
 * שני כללים חוצים את הקובץ:
 *
 * 1. **הקובץ הוא המקור, התוצר הוא נגזרת.** כשל בעיבוד מסומן על הרשומה
 *    ואינו נוגע בקובץ. המשתמש ימשיך לראות את התמונה ולהאזין להקלטה, עם
 *    שורה שאומרת מה לא הצליח.
 * 2. **בלי מפתח — מדלגים, לא נכשלים.** מערכת שרצה בלי מנוע AI היא מערכת
 *    שעובדת פחות טוב, לא מערכת שבורה. ג'וב שנכשל שוב ושוב על הגדרה חסרה
 *    רק מייצר רעש אדום שמסתיר כשלים אמיתיים.
 */

export interface AiJobPayload {
  mediaId: string;
}

export interface AiEngines {
  transcriber: Transcriber | null;
  extractor: TextExtractor | null;
}

export type AiOutcome =
  | { status: "done"; chars: number; engine: string }
  | { status: "skipped"; reason: "no-engine" | "unsupported" | "missing" | "not-uploaded" };

export async function runTranscription(
  payload: AiJobPayload,
  engines: AiEngines,
): Promise<AiOutcome> {
  const media = await loadReady(payload.mediaId);
  if (!media) return { status: "skipped", reason: "missing" };

  if (!engines.transcriber) {
    await markSkipped(media.id, "no-engine");
    return { status: "skipped", reason: "no-engine" };
  }

  await mark(media.id, "PROCESSING");

  const audio = await selectStorage().read(media.storageKey);
  const text = normalizeText(await engines.transcriber.transcribe(audio, media.mimeType));

  await db.mediaFile.update({
    where: { id: media.id },
    data: { transcription: text || null, aiStatus: "DONE", aiError: null },
  });

  if (text) await fillEmptyDescription(media.id, text);

  return { status: "done", chars: text.length, engine: engines.transcriber.name };
}

export async function runTextExtraction(
  payload: AiJobPayload,
  engines: AiEngines,
): Promise<AiOutcome> {
  const media = await loadReady(payload.mediaId);
  if (!media) return { status: "skipped", reason: "missing" };

  if (!canExtractText(media.mimeType)) {
    await markSkipped(media.id, "unsupported");
    return { status: "skipped", reason: "unsupported" };
  }
  if (!engines.extractor) {
    await markSkipped(media.id, "no-engine");
    return { status: "skipped", reason: "no-engine" };
  }

  await mark(media.id, "PROCESSING");

  const file = await selectStorage().read(media.storageKey);
  const text = normalizeText(await engines.extractor.extract(file, media.mimeType));

  await db.mediaFile.update({
    where: { id: media.id },
    data: { extractedText: text || null, aiStatus: "DONE", aiError: null },
  });

  return { status: "done", chars: text.length, engine: engines.extractor.name };
}

/**
 * מסמן כשל על הרשומה. נקרא מהעובד כשהניסיונות אזלו.
 *
 * נפרד מהכשלת הג'וב: הג'וב יחזור וינסה שוב, ורק כשלא נותרו ניסיונות
 * המשתמש צריך לראות "התמלול נכשל". סימון מוקדם היה מציג כשל שנפתר לבדו
 * דקה אחר כך.
 */
export async function markAiFailed(mediaId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db.mediaFile.updateMany({
    where: { id: mediaId },
    data: { aiStatus: "FAILED", aiError: message.slice(0, 1000) },
  });
}

/** רק קובץ שהבתים שלו באמת עלו. לפני כן אין מה לתמלל. */
async function loadReady(mediaId: string) {
  return db.mediaFile.findFirst({ where: { id: mediaId, uploaded: true } });
}

async function mark(mediaId: string, aiStatus: AiStatus): Promise<void> {
  await db.mediaFile.update({ where: { id: mediaId }, data: { aiStatus } });
}

/**
 * שתי סיבות שונות לגמרי לאותו סטטוס — ולכן הן נשמרות.
 *
 * ‏`unsupported` הוא "אין מה לעבד כאן" (וידאו, סוג קובץ שאינו נתמך). למשתמש
 * אין מה לעשות עם המידע, והממשק שותק.
 *
 * ‏`no-engine` הוא "יש מה לעבד, ואין במה". קודם לכן שתיהן נשמרו כ-`SKIPPED`
 * בלי סיבה, והממשק שתק בשתיהן — כלומר המנהל הקליט הקלטה, ראה נגן, ולא קיבל
 * שום רמז לכך שהתמלול לא קרה, שהחיפוש לא ימצא אותה, ושהתיאור לא התמלא. זה
 * ההבדל שהופך תקלה שקטה לתקלה גלויה.
 */
export type SkipReason = "no-engine" | "unsupported";

async function markSkipped(mediaId: string, reason: SkipReason): Promise<void> {
  // ‏SKIPPED ולא FAILED: אין כאן תקלה שתיפתר בניסיון חוזר.
  await db.mediaFile.update({
    where: { id: mediaId },
    data: { aiStatus: "SKIPPED", aiError: reason },
  });
}

/**
 * ממלא את תיאור הפנייה מהתמלול, אם התיאור עדיין ריק.
 *
 * זהו כל הרעיון של פתיחת פנייה בקול: המנהל מדבר, והתיאור נכתב מעצמו.
 * **רק כשריק** — טקסט שאדם הקליד לעולם אינו נדרס בידי מכונה.
 */
async function fillEmptyDescription(mediaId: string, text: string): Promise<void> {
  const media = await db.mediaFile.findUnique({
    where: { id: mediaId },
    select: { message: { select: { ticketId: true } } },
  });

  const ticketId = media?.message?.ticketId;
  if (!ticketId) return;

  await db.ticket.updateMany({
    where: { id: ticketId, description: "" },
    data: { description: text },
  });
}
