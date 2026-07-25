import { enqueue } from "@/jobs/queue";
import { JOB_TYPES, type JobType } from "@/jobs/types";
import { UserFacingError } from "@/lib/action-result";
import { canExtractText } from "@/lib/ai/extract";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import {
  type Viewer,
  canCommentOnTicket,
  canViewTagChat,
  canViewTicket,
} from "@/lib/permissions";
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
  /**
   * הפנייה שאליה הקובץ מיועד.
   *
   * אופציונלי, כי במסך היצירה הפנייה עדיין אינה קיימת — וזה בדיוק המסלול
   * שבו מצלמים: המנהל עומד מול הדירה, מצלם, ורק אז ממלא את השדות. קובץ
   * בלי פנייה שמור אך אינו נגיש לאיש עד שהוא מצורף להודעה.
   */
  ticketId?: string;
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

  if (input.ticketId) {
    const ticket = await db.ticket.findUnique({
      where: { id: input.ticketId },
      include: { assignments: true },
    });
    if (!ticket) throw new MediaError(he.ticket.notFound);
    if (!canCommentOnTicket(viewer, ticket, ticket.assignments)) {
      throw new MediaError(he.common.notAllowed);
    }
  } else if (viewer.kind !== "user") {
    // בלי פנייה אין מה לבדוק מולה, ולכן המסלול פתוח למשתמשים פנימיים
    // בלבד — הם היחידים שפותחים פניות. נמען חיצוני חייב לציין פנייה
    // קיימת שהוא משויך אליה.
    throw new MediaError(he.common.notAllowed);
  }

  const storageKey = buildStorageKey(input.mimeType, now);

  const media = await db.mediaFile.create({
    data: {
      storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      originalName: input.originalName ?? null,
      // הבעלות נשמרת כדי שרק המעלה יוכל לאשר את ההעלאה (ראה confirmUpload).
      uploaderUserId: viewer.kind === "user" ? viewer.id : null,
      uploaderProfessionalId: viewer.kind === "professional" ? viewer.id : null,
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
export async function confirmUpload(viewer: Viewer, mediaId: string) {
  const media = await db.mediaFile.findUnique({ where: { id: mediaId } });
  if (!media) throw new MediaError(he.media.notFound);

  // רק המעלה מאשר את הקובץ שלו: בלי הבדיקה כל משתמש מחובר (או כל קבלן עם
  // טוקן חי) יכול לסמן קובץ של אחר כ"הועלה" ולהפעיל עליו ג'ובי AI בתשלום.
  // רשומה ששני המזהים בה null היא ישנה (מלפני שהבעלות נשמרה) — נדחית, כי
  // אי אפשר לאמת בעלות עליה.
  const ownedByViewer =
    viewer.kind === "user"
      ? media.uploaderUserId === viewer.id
      : media.uploaderProfessionalId === viewer.id;
  if (!ownedByViewer) throw new MediaError(he.common.notAllowed);

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
 * שולף קובץ להגשה, אחרי בדיקת הרשאה על ההקשר שאליו הוא שייך.
 *
 * לקובץ שני הקשרים אפשריים, לפי סוג ההודעה שהוא מצורף אליה:
 * - **הודעת פנייה** — ההרשאה נבדקת על הפנייה (`canViewTicket`).
 * - **הודעת צ׳אט תגית** — ההרשאה נבדקת על הצ׳אט (`canViewTagChat`): קבלן
 *   רואה את הקובץ רק אם התגית נפתחה לו. בלי הענף הזה דוח בדק בית שיושב
 *   בצ׳אט התגית לא היה נגיש לאיש, כי הוא אינו מצורף לשום פנייה.
 *
 * קובץ שאינו קשור להודעה כלשהי אינו נגיש לאיש מלבד מי שהעלה אותו — והוא
 * ממילא במצב ביניים קצר, בין הרישום לבין צירופו להודעה.
 */
export async function getViewableMedia(viewer: Viewer, mediaId: string) {
  const media = await db.mediaFile.findUnique({
    where: { id: mediaId },
    include: {
      message: {
        include: {
          ticket: { include: { assignments: true } },
          tag: { include: { access: { select: { professionalId: true } } } },
        },
      },
    },
  });

  if (!media || !media.uploaded) return null;

  const ticket = media.message?.ticket;
  if (ticket) {
    return canViewTicket(viewer, ticket, ticket.assignments) ? media : null;
  }

  const tag = media.message?.tag;
  if (tag) {
    const grantedIds = tag.access.map((a) => a.professionalId);
    return canViewTagChat(viewer, grantedIds) ? media : null;
  }

  return null;
}

