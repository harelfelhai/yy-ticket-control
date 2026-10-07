import type { MessageDirection, MessageState, WaOutcome } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import type { Viewer } from "@/lib/permissions";
import { type WaDelivery, waDelivery } from "@/lib/whatsapp/delivery";
import { canViewCorrespondence } from "./email-correspondence";
import { SKIPPED_AFTER_CLOSE } from "./intake-reply";

/**
 * שיחת הוואטסאפ של פנייה — קריאה בלבד (WA-M01, §3.2 שדה 20, מסך 7).
 *
 * **"אותן שורות עצמן", כמו בהתכתבות המייל** (`email-correspondence.ts`). היומן
 * שמבטיח "אותה הודעה נמסרה פעמיים — נקלטה פעם אחת" (`WaMessage`) הוא גם השיחה
 * שמוצגת: כל שורה ששייכת ל-`WaThread` של הפנייה **היא** השיחה, בלי פרויקציה
 * ובלי העתקה.
 *
 * **מה נכלל.** שורה מקבלת `threadId` רק כשהיא חלק מהטיוטה: הדיווח שפתח אותה,
 * תגובה (Reply) בשיחה שלה, והודעות האישור. כל השאר — הודעה בלי "תקלה", שולח לא
 * מורשה, סטיקר, הודעה מהטלפון של העסק — אינו מקבל שרשור כלל, ולכן "הודעות אחרות
 * באותו צ'אט אינן מוצגות" (מסך 7) נאכף כבר בכתיבה. **תגובה שלא נקלטה** (אין הרשאה,
 * הפנייה כבר שוגרה) כן בשיחה, בלי התוכן שלה (§2.7 שלב 5): "התשובה שלו קרתה" היא
 * עובדה, כמו ב-EM-M01, ובלעדיה האישור "אין לך הרשאה…" היה תלוי באוויר.
 *
 * **מה מסונן: `PENDING` בלבד** — "עדיין לא". אישור שעוד לא יצא מורכב רק בזמן
 * השליחה, ואין בו תוכן להציג.
 *
 * **הסדר** — `createdAt`, כמו בהתכתבות המייל: השדה היחיד שקיים על כל שורה ומשקף
 * את סדר הרישום. אישור נרשם אחרי ההכרעה על ההודעות שהוא עונה עליהן.
 */

/** קובץ בהודעה — לתצוגה ולקישור ההורדה (`api/wa-media/[id]`) */
export interface WaConversationFile {
  /** מזהה `WaMedia` — המפתח לקישור ההורדה */
  id: string;
  mimeType: string;
  filename: string | null;
  /** הקלטה קולית — התמלול מוצג מתחת לנגן */
  transcript: string | null;
  /** למה הקובץ לא נשמר או לא נכנס לטיוטה — גדול מדי, Word, הוסר קודם... */
  skippedReason: string | null;
  /**
   * האם יש לקובץ בתים שמורים. רק קובץ כזה מקבל קישור: הנתיב מחזיר 404 לכל
   * השאר, וקישור אליהם היה קישור מת.
   */
  downloadable: boolean;
}

/** הודעה אחת בשיחה — מהשולח או מהמערכת, לפי הסדר */
export interface WaConversationMessage {
  id: string;
  direction: MessageDirection;
  /** הודעה מהשולח: שמו כפי שהוא בכרטיס שלו במערכת. הודעת מערכת — null */
  authorName: string | null;
  text: string | null;
  /** מהשולח — מתי שלח (וואטסאפ); מהמערכת — מתי יצאה, ואם לא יצאה — מתי נרשמה */
  at: Date;
  outcome: WaOutcome | null;
  /** הודעת מערכת בלבד: מצב המסירה */
  delivery: WaDelivery | null;
  /** הודעת מערכת שדולגה כי הטיוטה שוגרה או נמחקה לפני שיצאה (§7 שורה 77) — אינה כשל */
  skippedAfterClose: boolean;
  files: WaConversationFile[];
}

/**
 * מרכיב את שיחת הוואטסאפ של פנייה, לפי הסדר. שלוש תוצאות, כמו בהתכתבות המייל:
 * `null` — הפנייה אינה קיימת או שהצופה אינו רשאי (באותה צורה, בכוונה); `[]` —
 * אין לה שיחה; ומערך — השיחה.
 */
export async function getTicketWaConversation(
  viewer: Viewer,
  ticketId: string,
  /**
   * רק מה שנוצר עד הרגע הזה. חלון "פרטים" של פנייה משוגרת מציג את השיחה שקדמה
   * לשיגור (מסך 2, WA-S2-01): ההודעה "כבר נשלחה" על תגובה מאוחרת אינה חלק ממנה.
   */
  options: { before?: Date } = {},
): Promise<WaConversationMessage[] | null> {
  if (!(await canViewCorrespondence(viewer, ticketId))) return null;

  const thread = await db.waThread.findUnique({
    where: { ticketId },
    include: {
      messages: {
        where: {
          state: { not: "PENDING" },
          ...(options.before ? { createdAt: { lte: options.before } } : {}),
        },
        orderBy: { createdAt: "asc" },
        include: {
          media: { orderBy: { partIndex: "asc" } },
          authorUser: { select: { name: true } },
        },
      },
    },
  });
  if (!thread) return [];

  return thread.messages.map(toConversationMessage);
}

function toConversationMessage(message: {
  id: string;
  direction: MessageDirection;
  state: MessageState;
  outcome: WaOutcome | null;
  text: string | null;
  receivedAt: Date | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
  detail: string | null;
  authorUser: { name: string } | null;
  media: {
    id: string;
    mimeType: string;
    filename: string | null;
    voice: boolean;
    transcript: string | null;
    skippedReason: string | null;
    storageKey: string | null;
  }[];
}): WaConversationMessage {
  const inbound = message.direction === "INBOUND";
  return {
    id: message.id,
    direction: message.direction,
    authorName: inbound ? (message.authorUser?.name ?? null) : null,
    text: message.text,
    at: (inbound ? message.receivedAt : message.sentAt) ?? message.createdAt,
    outcome: message.outcome,
    delivery: inbound ? null : waDelivery(message),
    skippedAfterClose: message.state === "SKIPPED" && (message.detail ?? "").includes(SKIPPED_AFTER_CLOSE),
    files: message.media.map((media) => ({
      id: media.id,
      mimeType: media.mimeType,
      filename: media.filename,
      transcript: media.voice ? media.transcript : null,
      skippedReason: media.skippedReason,
      downloadable: media.storageKey !== null,
    })),
  };
}
