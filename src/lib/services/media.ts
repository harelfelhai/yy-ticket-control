import { enqueue } from "@/jobs/queue";
import { JOB_TYPES, type JobType } from "@/jobs/types";
import { UserFacingError } from "@/lib/action-result";
import { canExtractText } from "@/lib/ai/extract";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import { type Viewer, canCommentOnTicket, canViewTicket } from "@/lib/permissions";
import {
  MAX_FILE_BYTES,
  buildStorageKey,
  isAllowedMimeType,
  selectStorage,
} from "@/lib/storage";
import type { UploadTarget } from "@/lib/storage";

/**
 * מדיה: רישום הקובץ, יעד ההעלאה, והגשה מאובטחת.
 *
 * המסלול הוא בשלושה שלבים ולא באחד, וזו הכרעה מרכזית:
 *
 * 1. **רישום** — השרת בודק הרשאה, מוודא שהסוג והגודל מותרים, יוצר שורת
 *    `MediaFile` עם `uploaded=false`, ומחזיר יעד העלאה חתום.
 * 2. **העלאה** — הדפדפן שולח את הבתים ישירות לאחסון, בלי לעבור בשרת.
 * 3. **אישור** — הלקוח מדווח שההעלאה הצליחה, והשורה מסומנת `uploaded=true`.
 *
 * הסיבה לשלב השלישי: העלאה מטלפון באתר בנייה נקטעת. בלי סימון מפורש,
 * שורה שנוצרה בשלב 1 הייתה נראית בשרשור כקובץ קיים — ולחיצה עליה הייתה
 * מחזירה שגיאה. עכשיו קובץ שלא הושלם פשוט אינו מוצג.
 */

export class MediaError extends UserFacingError {}

export interface RegisterMediaInput {
  ticketId: string;
  mimeType: string;
  sizeBytes: number;
  originalName?: string;
}

export interface RegisteredMedia {
  mediaId: string;
  upload: UploadTarget;
}

/**
 * רושם קובץ חדש ומחזיר לאן להעלות אותו.
 *
 * ההרשאה היא **הרשאת כתיבה לפנייה** ולא הרשאת צפייה: מי שאינו רשאי להגיב
 * אינו רשאי לצרף. כך קבלן שהוסר מהפנייה, או כל אחד בפנייה סגורה, אינו
 * יכול לדחוף קבצים לאחסון שלנו.
 */
export async function registerMedia(
  viewer: Viewer,
  input: RegisterMediaInput,
  now: Date = new Date(),
): Promise<RegisteredMedia> {
  if (!isAllowedMimeType(input.mimeType)) {
    throw new MediaError(he.media.unsupportedType);
  }
  if (input.sizeBytes <= 0 || input.sizeBytes > MAX_FILE_BYTES) {
    throw new MediaError(he.media.tooLarge);
  }

  const ticket = await db.ticket.findUnique({
    where: { id: input.ticketId },
    include: { assignments: true },
  });
  if (!ticket) throw new MediaError(he.ticket.notFound);
  if (!canCommentOnTicket(viewer, ticket, ticket.assignments)) {
    throw new MediaError(he.common.notAllowed);
  }

  const storageKey = buildStorageKey(input.mimeType, now);

  const media = await db.mediaFile.create({
    data: {
      storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      originalName: input.originalName ?? null,
      // ה-AI מתחיל לעבוד רק אחרי שהבתים באמת עלו. עד אז אין מה לתמלל.
      aiStatus: "PENDING",
    },
  });

  const upload = await selectStorage().createUploadTarget(storageKey, input.mimeType);
  return { mediaId: media.id, upload };
}

/**
 * מסמן שההעלאה הושלמה, ומכניס לתור את עיבוד ה-AI המתאים.
 *
 * אידמפוטנטי: קריאה שנייה אינה מייצרת ג'וב שני. לקוח שמדווח פעמיים
 * (רענון, לחיצה כפולה) אינו תרחיש נדיר, ותמלול כפול עולה כסף אמיתי.
 *
 * העיבוד נכנס לתור ואינו רץ כאן: תמלול לוקח שניות, והמשתמש באותו רגע
 * ממתין למסך כדי להמשיך להקליד.
 */
export async function confirmUpload(mediaId: string) {
  const media = await db.mediaFile.findUnique({ where: { id: mediaId } });
  if (!media) throw new MediaError(he.media.notFound);
  if (media.uploaded) return media;

  return db.$transaction(async (tx) => {
    const updated = await tx.mediaFile.update({
      where: { id: mediaId },
      data: { uploaded: true },
    });

    const jobType = aiJobFor(updated.mimeType);
    if (jobType) await enqueue(tx, jobType, { mediaId });
    // בלי סוג מתאים (וידאו) הרשומה מסומנת מיד כמדולגת, ולא נשארת "ממתינה"
    // לנצח — הממשק היה מציג עליה "קורא את הטקסט…" שלא ייגמר.
    else await tx.mediaFile.update({ where: { id: mediaId }, data: { aiStatus: "SKIPPED" } });

    return updated;
  });
}

/** אודיו מתומלל, תמונה ו-PDF נקראים, וידאו אינו מעובד בגרסה זו */
function aiJobFor(mimeType: string): JobType | null {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base.startsWith("audio/")) return JOB_TYPES.transcribe;
  if (canExtractText(base)) return JOB_TYPES.extract;
  return null;
}

/**
 * שולף קובץ להגשה, אחרי בדיקת הרשאה על הפנייה שאליה הוא שייך.
 *
 * קובץ שאינו קשור להודעה כלשהי אינו נגיש לאיש מלבד מי שהעלה אותו — והוא
 * ממילא במצב ביניים קצר, בין הרישום לבין צירופו להודעה.
 */
export async function getViewableMedia(viewer: Viewer, mediaId: string) {
  const media = await db.mediaFile.findUnique({
    where: { id: mediaId },
    include: {
      message: {
        include: { ticket: { include: { assignments: true } } },
      },
    },
  });

  if (!media || !media.uploaded) return null;

  const ticket = media.message?.ticket;
  if (!ticket) return null;
  if (!canViewTicket(viewer, ticket, ticket.assignments)) return null;

  return media;
}

