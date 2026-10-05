import type { Prisma } from "@/generated/prisma/client";
import type { MailOutcome } from "@/generated/prisma/enums";
import { enqueue } from "@/jobs/queue";
import { JOB_TYPES } from "@/jobs/types";
import { AiRequestError } from "@/lib/ai/gemini";
import { db } from "@/lib/db";
import type { DraftFieldName, DraftState } from "@/lib/draft/fields";
import { mergeChannelIntoDraft } from "@/lib/draft/merge";
import { isAutoReply } from "@/lib/email-intake/auto-reply";
import { classifyAttachment } from "@/lib/email-intake/mime";
import { extractNewText, htmlToText } from "@/lib/email-intake/quote";
import { MailSourceError, type MailSource } from "@/lib/email-intake/source";
import { isIntakeSubject } from "@/lib/email-intake/subject";
import type { MailEnvelope, MailPart } from "@/lib/email-intake/types";
import {
  DEFER_ALARM_ATTEMPTS,
  EXTRACTION_RETRY_MS,
  MAX_DEFER_ATTEMPTS,
  deferDelayMs,
  shouldRetryExtraction,
} from "@/lib/intake/defer-policy";
import type { FieldExtractor } from "@/lib/intake/extraction";
import { type FieldExtraction, type IntakeReport, emptyReport } from "@/lib/intake/types";
import { env } from "@/lib/env";
import { normalizeEmail, normalizeText } from "@/lib/normalize";
import { captureError, logError, logInfo, logWarn } from "@/lib/observability/log";
import type { MediaStorage } from "@/lib/storage";
import { MAX_FILE_BYTES, isCorrespondenceDocumentType, selectStorage } from "@/lib/storage";
import { DRAFT_TICKET_SELECT, type DraftTicket, lockAndLoadDraft, writeDraftState } from "./draft-fields";
import {
  type PreparedPart,
  type SenderUser,
  buildReplyProposal,
  classifyBytes,
  decideReplyVerdict,
  extractionAttachments,
  loadGazetteer,
  planDraft,
  skippedPart,
  storageExtension,
  storePreparedParts,
  toUpdatedItems,
  unprocessedValues,
  writeMedia,
} from "./intake-draft";
import type { Tx } from "./ticket-activity";

/**
 * ההכרעה על מייל נכנס אחד, ובמסלול התקין גם פתיחת הטיוטה ממנו
 * (אפיון §2.6, §5.ה3).
 *
 * **הסולם הוא הליבה של הקובץ.** לכל הודעה בתיבה יש בדיוק הכרעה אחת
 * (`MailOutcome`), והיא נקבעת בסדר של האפיון: כל שלב מסיים את ההודעה,
 * והשלב הבא רץ רק כשקודמו לא הכריע. הסדר אינו שרירותי — תשובה אוטומטית
 * נבדקת לפני זהות השולח, כי משיב אוטומטי של משתמש מורשה הוא עדיין משיב
 * אוטומטי; וזיהוי השרשרת קודם לכלל הכותרת, כי תשובה מזוהה לפי השרשרת ולא
 * לפי הכותרת (§5.ה3 כלל 2).
 *
 * **הודעה שהתעלמנו ממנה נשמרת בלי כותרת ובלי גוף** — מזהים, שולח והכרעה
 * בלבד. התיבה משותפת עם מערכת אחרת, ומייל שאינו נוגע לנו אינו הופך לתוכן
 * בבסיס הנתונים שלנו רק מפני שעבר כאן. כותרת נשמרת רק כשיוצא מייל חוזר —
 * שם היא נדרשת לשרשור (`Re: …`).
 *
 * **כשל זמני לעולם אינו הכרעה.** כשל מול Gmail דוחה את ההודעה עם השהיה
 * גדלה והשורה נשארת PENDING: "לא הצלחנו לקרוא" אינו "התעלמנו". אחרי כיום
 * של דחיות ההודעה נעצרת ומדווחת ל-Sentry (`MAX_DEFER_ATTEMPTS`) — גם זו
 * אינה הכרעה, אבל היא מפסיקה להיות שקטה.
 * לעומת זאת חילוץ שאינו זמין **הוא** הכרעה — אחרי תקציב ניסיונות קצר
 * (EM-11), כי ההבטחה לשולח היא מייל חוזר תוך חמש דקות.
 */

// ─────────────────────────────── החוזה ───────────────────────────────

export interface EmailIntakeDeps {
  /** התיבה. מוזרק כדי שהבדיקות לא ייגעו ברשת. */
  source: MailSource;
  /**
   * המחלץ, או `null` כשאין מנוע בסביבה.
   *
   * `null` אינו תקלה אלא מצב מוכר שיש לו מסלול מלא (EM-11), ולכן הוא ערך
   * ולא זריקה: טיוטה שתוכן המייל הוא התיאור שלה, ומייל חוזר שאומר זאת.
   */
  extractor: FieldExtractor | null;
  now?: Date;
  /** האחסון. ברירת המחדל נבחרת לפי הסביבה, כמו בכל מסלול מדיה. */
  storage?: MediaStorage;
}

/** למה ההודעה נדחתה. משותף ללוג, ל-`detail` ולטיפוס התוצאה. */
export type DeferReason = "gmail" | "extraction" | "attachment";

export type EmailIntakeOutcome = { kind: "email-intake" } & (
  | { status: "missing" }
  /** השורה כבר הוכרעה — ג׳וב כפול, ולא נכתב דבר */
  | { status: "duplicate" }
  /** כשל זמני: ההודעה נדחתה, והג׳וב הבא כבר בתור */
  | { status: "deferred"; reason: DeferReason; nextAttemptAt: Date }
  /** הגג נגמר: ההודעה נעצרה בלי הכרעה, עם issue ב-Sentry */
  | { status: "exhausted"; reason: DeferReason; attempts: number }
  | { status: "decided"; outcome: MailOutcome; ticketId?: string }
);

const KIND = "email-intake" as const;

/** השדות של שורת היומן שהסולם נשען עליהם */
export interface InboundRow {
  id: string;
  gmailMessageId: string | null;
  state: string;
  attempts: number;
  nextAttemptAt: Date | null;
  receivedAt: Date | null;
  /** מה נרשם בדחייה האחרונה — נקרא בחזרה דרך `lastDeferral` */
  detail: string | null;
}

// ─────────────────────────────── הסולם ───────────────────────────────

/**
 * מכריע את גורלה של הודעה נכנסת אחת.
 *
 * הפונקציה **אינה זורקת** על מצב מוכר — גם "ההודעה נמחקה מהתיבה" ו"החילוץ
 * אינו זמין" הם הכרעות שנשמרות. היא כן זורקת על מה שדורש אדם (טוקן שנשלל,
 * בקשה שגויה, תקלת אחסון), כדי שהג׳וב ייכשל ברעש ויגיע ל-Sentry.
 */
export async function handleEmailIntake(
  payload: { mailboxMessageId: string },
  deps: EmailIntakeDeps,
): Promise<EmailIntakeOutcome> {
  const now = deps.now ?? new Date();

  const row = await db.mailboxMessage.findUnique({
    where: { id: payload.mailboxMessageId },
    select: {
      id: true,
      direction: true,
      state: true,
      gmailMessageId: true,
      attempts: true,
      nextAttemptAt: true,
      receivedAt: true,
      detail: true,
    },
  });

  // שורה שנמחקה בין יצירת הג׳וב להרצתו. אין מה להכריע, ואין כאן תקלה.
  if (!row) {
    logWarn("email.intake.missing_row", { mailboxMessageId: payload.mailboxMessageId });
    return { kind: KIND, status: "missing" };
  }

  // שורה יוצאת שהגיעה לכאן היא באג בחיווט: `EMAIL_REPLY` הוא ג׳וב אחר.
  // זריקה ולא דילוג — כשל שקט כאן פירושו מייל חוזר שלא נשלח לעולם.
  if (row.direction !== "INBOUND") {
    throw new Error(`EMAIL_INTAKE על שורה יוצאת: ${row.id}`);
  }

  // 1. כבר הוכרעה → הג׳וב כפול. אין כתיבה, אין קריאה לתיבה.
  if (row.state !== "PENDING") return { kind: KIND, status: "duplicate" };

  // ההודעה נדחתה וזמנה עוד לא הגיע. קורה כשסריקת התקועות של הסבב
  // (`runEmailPoll`) מייצרת ג׳וב שני לשורה שכבר ממתינה — ובלי הבדיקה הזו
  // הוא היה שורף את תקציב הניסיונות לפני הזמן.
  if (row.nextAttemptAt && row.nextAttemptAt.getTime() > now.getTime()) {
    return { kind: KIND, status: "deferred", reason: "gmail", nextAttemptAt: row.nextAttemptAt };
  }

  if (!row.gmailMessageId) {
    throw new Error(`שורת יומן נכנסת בלי מזהה Gmail: ${row.id}`);
  }

  // 2. ההודעה כבר אינה בתיבה (404) → GONE.
  const envelope = await readEnvelope(row, row.gmailMessageId, deps, now);
  if (envelope.deferred) return envelope.outcome;
  if (!envelope.value) return decideIgnored(row, "GONE", null, now);

  return decide(row, envelope.value, deps, now);
}

/**
 * קורא את ההודעה מהתיבה ומתרגם את הכשלים להחלטה.
 *
 * `transient` (רשת, 429, 5xx) דוחה; `not_found` הוא GONE; `auth`, `scope`
 * ו-`permanent` נזרקים — הם דורשים אדם, ודחייה חוזרת רק הייתה מסתירה אותם.
 */
async function readEnvelope(
  row: InboundRow,
  gmailMessageId: string,
  deps: EmailIntakeDeps,
  now: Date,
): Promise<{ deferred: false; value: MailEnvelope | null } | { deferred: true; outcome: EmailIntakeOutcome }> {
  let envelope: MailEnvelope | null;
  try {
    envelope = await deps.source.getMessage(gmailMessageId);
  } catch (error) {
    if (error instanceof MailSourceError && error.kind === "transient") {
      return { deferred: true, outcome: await defer(row, "gmail", error.message, now) };
    }
    if (error instanceof MailSourceError && error.kind === "not_found") {
      return { deferred: false, value: null };
    }
    throw error;
  }

  // תשובה שחזרה בלי שום תוכן ובלי זהות — תשובה קטועה של השירות. הכרעה
  // עליה הייתה קובעת גורל לפי נתונים שלא הגיעו.
  if (envelope && isTruncatedEnvelope(envelope)) {
    return {
      deferred: true,
      outcome: await defer(row, "gmail", `ההודעה ${gmailMessageId} חזרה ריקה מהתיבה`, now),
    };
  }

  return { deferred: false, value: envelope };
}

/**
 * האם התשובה מהתיבה **קטועה** — להבדיל ממייל ריק שאדם שלח.
 *
 * שני התנאים נדרשים, וזו כל הנקודה. מעטפה בלי תוכן לבדה אינה סימן: משתמש
 * מורשה ששולח בטעות מייל בלי נושא ובלי גוף מייצר בדיוק אותה מעטפה, ולו
 * **יש** הכרעה באפיון — כלל הכותרת (§2.6 שלב 1) מתעלם ממנו בשקט. דחייה
 * חוזרת במקומה הייתה משאירה אותו PENDING לנצח, בלי שאיש יראה זאת.
 *
 * מה שמבדיל את השניים הוא הזהות: לכל הודעה אמיתית יש `From` וכותרות,
 * ותשובה חלקית של Gmail (`format=minimal`, payload שנקטע) מגיעה בלעדיהם.
 * הספק ניתן לטובת הדחייה — הכרעה על נתונים שלא הגיעו היא הכשל החמור מבין
 * השניים.
 */
function isTruncatedEnvelope(envelope: MailEnvelope): boolean {
  const hasNoContent =
    envelope.subject.trim() === "" &&
    envelope.text.trim() === "" &&
    (envelope.html === null || envelope.html.trim() === "") &&
    envelope.parts.length === 0;

  return hasNoContent && (envelope.from === null || Object.keys(envelope.headers).length === 0);
}

/**
 * שלבים 3–8 של הסולם, בסדר של §5.ה3.
 *
 * כל שלב מחזיר הכרעה ומסיים; מי שממשיך הוא מי שלא הוכרע עדיין.
 */
async function decide(
  row: InboundRow,
  envelope: MailEnvelope,
  deps: EmailIntakeDeps,
  now: Date,
): Promise<EmailIntakeOutcome> {
  const channel = await db.mailChannelState.findUnique({ where: { channel: "EMAIL" } });

  // 3. לפני הפעלת היכולת (§5.ה3 כלל 5). בהיעדר שורת ערוץ אין רצפה ידועה,
  // ואין להעניש מייל אמיתי על כך — הסבב הוא שיוצר אותה, ורק הוא יוצר שורות.
  if (channel && envelope.receivedAt.getTime() < channel.activatedAt.getTime()) {
    return decideIgnored(row, "IGNORED_BEFORE_ACTIVATION", envelope, now);
  }

  // 4. מהתיבה עצמה, או מייל שאנחנו שלחנו שחזר אליה (§7 שורה 83).
  if (await isOwnMessage(envelope, channel?.mailbox ?? env.gmailUser())) {
    return decideIgnored(row, "IGNORED_OWN_MESSAGE", envelope, now);
  }

  // 5. תשובה אוטומטית (EM-23).
  if (isAutoReply({
    headers: envelope.headers,
    subject: envelope.subject,
    from: envelope.from,
    contentType: envelope.contentType,
  })) {
    return decideIgnored(row, "IGNORED_AUTO_REPLY", envelope, now);
  }

  // 6. שולח שאינו משתמש מורשה ופעיל — לא נקלט **ולא נענה** (EM-03).
  const sender = await findSender(envelope.from?.address ?? null);
  if (!sender) return decideIgnored(row, "IGNORED_UNAUTHORIZED", envelope, now);

  // 7. שייך לשרשרת מוכרת → מסלול התשובה (§2.6 שלב 5–6, §5.ה3 כלל 9).
  const threadId = await findKnownThread(envelope);
  if (threadId) return applyEmailReply(row, envelope, threadId, sender, now, deps);

  // 8. כלל הכותרת מכריע את גורלו של מייל **חדש** (EM-01).
  if (!isIntakeSubject(envelope.subject)) {
    return decideIgnored(row, "IGNORED_SUBJECT", envelope, now);
  }

  return createEmailDraft({ row, envelope, sender, now }, deps);
}

/**
 * האם ההודעה יצאה מאיתנו.
 *
 * שתי בדיקות ולא אחת: הכתובת מזהה מייל שהתיבה שלחה בעצמה, ו-`Message-ID`
 * מזהה מייל **שלנו** שחזר אליה (העתק, רשימת תפוצה, כלל העברה). בלי השנייה
 * המייל החוזר שלנו היה יכול להיקלט כתשובה של השולח.
 */
async function isOwnMessage(envelope: MailEnvelope, mailbox: string | undefined): Promise<boolean> {
  const address = envelope.from?.address ?? null;
  const own = mailbox ? normalizeEmail(mailbox) : "";
  if (address && own && address === own) return true;

  if (!envelope.rfcMessageId) return false;
  const sent = await db.mailboxMessage.count({
    where: { direction: "OUTBOUND", rfcMessageId: envelope.rfcMessageId },
  });
  return sent > 0;
}

/**
 * המשתמש שכתובתו נמצאת על ההודעה, או null.
 *
 * ההרשאה נגזרת מהמשתמש ולא מרשימת כתובות נפרדת (§3.7): פעיל, עם המתג
 * דלוק, והכתובת היא המייל שלו או אחת מהכתובות הנוספות. מצב פיילוט נאכף
 * גם כאן ולא רק בשאילתה של הסבב — שורה שנוצרה בדרך אחרת (סריקת תקועות,
 * הזנה ידנית) אינה אמורה לעקוף את החיתוך.
 */
async function findSender(address: string | null): Promise<SenderUser | null> {
  if (!address) return null;

  const pilot = env.emailIntakePilotAddresses();
  if (pilot.length > 0 && !pilot.includes(address)) return null;

  return db.user.findFirst({
    where: {
      active: true,
      emailIntakeEnabled: true,
      OR: [{ email: address }, { emailAliases: { some: { address } } }],
    },
    select: { id: true, name: true, role: true, siteId: true },
  });
}

/**
 * השרשרת שלנו שההודעה שייכת לה, או null.
 *
 * קודם לפי `In-Reply-To`/`References` מול `Message-ID` שנשמר אצלנו, ורק
 * אחר כך לפי `gmailThreadId`: הראשון תקני וחוצה ספקים, והשני הוא רשת
 * ביטחון ללקוח שאיבד את הכותרות. שניהם מוגבלים לשורות ששויכו לשרשרת
 * (`threadId`), כדי שהודעה שהתעלמנו ממנה לא תגרור אחריה את הבאות.
 */
async function findKnownThread(envelope: MailEnvelope): Promise<string | null> {
  const references = [envelope.inReplyTo, ...envelope.references].filter(
    (id): id is string => typeof id === "string" && id !== "",
  );

  if (references.length > 0) {
    const byReference = await db.mailboxMessage.findFirst({
      where: { rfcMessageId: { in: references }, threadId: { not: null } },
      select: { threadId: true },
    });
    if (byReference?.threadId) return byReference.threadId;
  }

  const byThread = await db.mailboxMessage.findFirst({
    where: { gmailThreadId: envelope.sourceThreadId, threadId: { not: null } },
    select: { threadId: true },
  });
  return byThread?.threadId ?? null;
}

// ─────────────────────────────── כתיבת ההכרעה ───────────────────────────────

/**
 * מה שנשמר על **כל** שורה נכנסת: מזהים, שולח ומועד. אין כאן כותרת ואין
 * גוף — ראה ההערה בראש הקובץ.
 */
function identityOf(envelope: MailEnvelope) {
  return {
    gmailThreadId: envelope.sourceThreadId,
    rfcMessageId: envelope.rfcMessageId,
    inReplyTo: envelope.inReplyTo,
    referenceIds: envelope.references,
    fromAddress: envelope.from?.address ?? null,
    fromName: envelope.from?.name ?? null,
    receivedAt: envelope.receivedAt,
  };
}

/**
 * רושם הכרעה של "לא נקלט", ובכך מסיים את ההודעה.
 *
 * אין כאן שורה יוצאת ואין ג׳וב תשובה: כל ההכרעות שמגיעות לכאן הן בדיוק
 * אלה שעליהן **לא נשלח מייל** (EM-L10).
 */
async function decideIgnored(
  row: InboundRow,
  outcome: MailOutcome,
  envelope: MailEnvelope | null,
  now: Date,
): Promise<EmailIntakeOutcome> {
  await db.mailboxMessage.update({
    where: { id: row.id },
    data: {
      state: "DONE",
      outcome,
      nextAttemptAt: null,
      ...(envelope ? identityOf(envelope) : {}),
      ...(envelope ? {} : { receivedAt: row.receivedAt ?? now }),
    },
  });

  logInfo("email.intake.decided", {
    mailboxMessageId: row.id,
    outcome,
    gmailMessageId: row.gmailMessageId,
  });
  return { kind: KIND, status: "decided", outcome };
}

/**
 * הדחייה האחרונה, כפי שהיא נרשמת בתחילת `detail`: `[extraction 2] …`.
 *
 * **למה תחילית ולא עמודה.** הרצפה של החילוץ צריכה לדעת כמה פעמים נדחינו
 * **מהסיבה הזו**, ו-`attempts` על `MailboxMessage` הוא מונה אחד לשלוש
 * הסיבות. עמודה ייעודית הייתה נקייה יותר, אבל היא מיגרציה בסכימה
 * המשותפת; התחילית נכתבת ונקראת כאן בלבד, וממילא `detail` הוא שדה אבחון
 * שאיש אינו מציג. ראה את הדוח — עמודה היא המשך מתבקש.
 */
const DEFER_TAG = /^\[(gmail|extraction|attachment) (\d+)\]/;

function taggedDetail(reason: DeferReason, count: number, text: string): string {
  return `[${reason} ${count}] ${text}`.slice(0, 1000);
}

/**
 * כמה דחיות **מסיבה מסוימת** כבר נרשמו על השורה.
 *
 * זכור רק המונה של הדחייה **האחרונה**, ולכן דחייה מסיבה אחרת מאפסת את
 * הספירה. הכיוון נכון: הרצפה היא "לפחות שני ניסיונות חילוץ", ואיפוס יכול
 * רק להוסיף ניסיון — לעולם לא לגרוע.
 */
function deferralsOf(detail: string | null, reason: DeferReason): number {
  const match = detail ? DEFER_TAG.exec(detail) : null;
  if (!match || match[1] !== reason) return 0;
  return Number(match[2]);
}

/**
 * דוחה את ההודעה ומתזמן ניסיון נוסף — **בלי להכריע**.
 *
 * הג׳וב הבא נוצר **באותה טרנזאקציה** של הדחייה, כמו כל ג׳וב במערכת: שורה
 * שנדחתה בלי ג׳וב היא מייל שאיש לא יחזור אליו, וזה בדיוק הכשל השקט.
 * `attempts` על השורה — ולא על ה-`Job` — הוא מה שמאפשר ניסיונות רבים:
 * תקציב ה-`Job` הוא שלושה, וזה מעט מדי לספק שלמטה חצי שעה.
 *
 * שני גבולות: דיווח ל-Sentry ב-`DEFER_ALARM_ATTEMPTS`, ועצירה מוחלטת
 * ב-`MAX_DEFER_ATTEMPTS`.
 */
async function defer(
  row: InboundRow,
  reason: DeferReason,
  detail: string,
  now: Date,
  delayMs?: number,
): Promise<EmailIntakeOutcome> {
  const attempts = row.attempts + 1;
  if (attempts >= MAX_DEFER_ATTEMPTS) return exhaust(row, reason, detail, attempts);

  const nextAttemptAt = new Date(now.getTime() + (delayMs ?? deferDelayMs(row.attempts)));

  await db.$transaction(async (tx) => {
    await tx.mailboxMessage.update({
      where: { id: row.id },
      data: {
        state: "PENDING",
        attempts: { increment: 1 },
        nextAttemptAt,
        detail: taggedDetail(reason, deferralsOf(row.detail, reason) + 1, detail),
      },
    });
    await enqueue(tx, JOB_TYPES.emailIntake, { mailboxMessageId: row.id }, nextAttemptAt);
  });

  logWarn("email.intake.deferred", {
    mailboxMessageId: row.id,
    reason,
    attempts,
    nextAttemptAt: nextAttemptAt.toISOString(),
  });

  // אירוע אחד בדיוק להודעה, ולכן בלי חניקה. מכאן והלאה זו כבר לא המתנה
  // מתוכננת אלא מייל של אדם שאינו נענה כבר יותר משעה.
  if (attempts === DEFER_ALARM_ATTEMPTS) {
    captureError(new Error(`קליטת מייל: ${attempts} דחיות רצופות (${reason}) על הודעה אחת`), {
      fingerprint: ["email-intake-deferred", reason],
      level: "warning",
      tags: { reason },
    });
  }

  return { kind: KIND, status: "deferred", reason, nextAttemptAt };
}

/**
 * עצירת הודעה שמיצתה את הניסיונות — **לא הכרעה**.
 *
 * `outcome` נשאר ריק, כי אף ערך ב-`MailOutcome` אינו מתאר "לא הצלחנו
 * לקרוא", והמצאת ערך כזה הייתה נכנסת לדוחות כאילו זו הכרעה עסקית. המצב
 * הוא `FAILED` ולא PENDING משתי סיבות: שורה PENDING עם `nextAttemptAt`
 * עתידי אינה נראית לאף רשת ביטחון, ושורה PENDING בלי ג׳וב הייתה מוחזרת
 * לתור בכל סבב בסריקת התקועים — כלומר אותה לולאה בקצב מהיר יותר.
 *
 * מה שכן קורה: issue ב-Sentry. אדם הוא שיחליט אם להחזיר את ההודעה לתור.
 */
async function exhaust(
  row: InboundRow,
  reason: DeferReason,
  detail: string,
  attempts: number,
): Promise<EmailIntakeOutcome> {
  await db.mailboxMessage.update({
    where: { id: row.id },
    data: {
      state: "FAILED",
      attempts: { increment: 1 },
      nextAttemptAt: null,
      detail: `${attempts} ניסיונות קריאה נכשלו (${reason}) — ההודעה לא הוכרעה: ${detail}`.slice(0, 1000),
    },
  });

  logError("email.intake.exhausted", { mailboxMessageId: row.id, reason, attempts });
  captureError(new Error(`קליטת מייל: ההודעה ${row.gmailMessageId} מיצתה ${attempts} ניסיונות (${reason})`), {
    fingerprint: ["email-intake-exhausted", reason],
    level: "error",
    tags: { reason },
  });

  return { kind: KIND, status: "exhausted", reason, attempts };
}

// ─────────────────────────────── מסלול המייל החדש ───────────────────────────────

export interface CreateEmailDraftInput {
  row: InboundRow;
  envelope: MailEnvelope;
  /** המשתמש שמאחורי כתובת השולח — הוא השחקן, והטיוטה שלו */
  sender: SenderUser;
  now: Date;
}

/**
 * פותח טיוטה ממייל ראשון (§2.6 שלב 3), ומתזמן את המייל החוזר.
 *
 * **השולח הוא השחקן.** הטיוטה נוצרת בשמו (`createdById`), וכל כלל הרשאה
 * חל כאילו פתח אותה במערכת (§5.ז): מנהל עבודה מקבל את האתר שלו, מנהל
 * מערכת ובעלים יכולים לקבל טיוטה בלי אתר, ומנהל עבודה שאינו משויך לאתר
 * אינו יכול לפתוח פנייה כלל — גם לא במייל.
 *
 * **הבתים נכתבים לפני הטרנזאקציה.** העלאה לאחסון בתוך טרנזאקציה מחזיקה
 * אותה פתוחה לאורך כל ההעברה, על בריכה של עשרה חיבורים שמשרתת גם את
 * המסכים. מפתח שנכתב ואיש אינו מפנה אליו הוא בזבוז שקט; טרנזאקציה שננעלה
 * על העלאה היא מסך תלוי.
 */
export async function createEmailDraft(
  input: CreateEmailDraftInput,
  deps: EmailIntakeDeps,
): Promise<EmailIntakeOutcome> {
  const { row, envelope, sender, now } = input;

  // מנהל עבודה בלי אתר: אינו יכול לפתוח פנייה גם במערכת, ולכן אין טיוטה —
  // ויש מייל שמסביר זאת (EM-09, EM-L09). טיוטה בלי אתר לא הייתה עוזרת לו,
  // כי אין אתר שהוא רשאי לבחור.
  if (sender.role === "SITE_MANAGER" && !sender.siteId) {
    return decideWithReply(row, envelope, sender, "NO_SITE", emptyReport(), null, now);
  }

  const body = bodyTextOf(envelope);
  const attachments = await collectAttachments(row, envelope, deps, now);
  if (attachments.deferred) return attachments.outcome;

  const extraction = await extract({ row, envelope, sender, body, parts: attachments.parts, deps, now });
  if (extraction.deferred) return extraction.outcome;

  // החילוץ אינו זמין (EM-11): טיוטה שתוכן המייל הוא התיאור שלה, ושאר
  // השדות ריקים. **הקבצים נכנסים בכל מקרה** (§7 שורה 75) — קליטת קובץ
  // אינה תלויה בשירות החילוץ.
  const plan = extraction.value
    ? await planDraft(extraction.value, sender, haystackOf(envelope, body))
    : { values: unprocessedValues(body, sender), filled: ["DESCRIPTION"] as DraftFieldName[], report: emptyReport() };

  const outcome: MailOutcome = extraction.value ? "DRAFT_CREATED" : "DRAFT_CREATED_UNPROCESSED";
  const stored = await writeAttachments(envelope, attachments.parts, deps);

  const ticketId = await db.$transaction(async (tx) => {
    const ticket = await tx.ticket.create({
      data: {
        channel: "EMAIL",
        isDraft: true,
        createdById: sender.id,
        siteId: plan.values.siteId,
        buildingId: plan.values.buildingId,
        apartmentId: plan.values.apartmentId,
        room: plan.values.room,
        domainId: plan.values.domainId,
        description: plan.values.description,
        draftRecipients: plan.values.recipients as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    // שורת `DraftField` רק לשדה שהמייל מילא: היעדר שורה נקרא כ-meta ריק
    // (`toDraftState`), ושורה ריקה הייתה אותו דבר בעלות של כתיבה.
    if (plan.filled.length > 0) {
      await tx.draftField.createMany({
        data: plan.filled.map((field) => ({ ticketId: ticket.id, field, fromChannel: true })),
      });
    }

    const thread = await tx.mailThread.create({ data: { ticketId: ticket.id }, select: { id: true } });

    await tx.mailboxMessage.update({
      where: { id: row.id },
      data: {
        state: "DONE",
        outcome,
        nextAttemptAt: null,
        detail: null,
        threadId: thread.id,
        authorUserId: sender.id,
        // התיבה שלנו: היא הנמענת, גם כשהיא רק בהעתק (§7 שורה 80)
        toAddress: mailboxAddress(envelope),
        subject: envelope.subject,
        bodyText: body,
        fullText: body,
        report: plan.report as unknown as Prisma.InputJsonValue,
        ...identityOf(envelope),
      },
    });

    const mediaIds = await writeMedia(tx, ticket.id, sender.id, stored);
    await writeMailboxAttachments(tx, row.id, stored, mediaIds);
    await scheduleReply(tx, row.id, envelope, thread.id, envelope.from?.address ?? null);

    return ticket.id;
  });

  logInfo("email.intake.draft_created", {
    mailboxMessageId: row.id,
    ticketId,
    outcome,
    siteId: plan.values.siteId,
    mediaCount: stored.filter((part) => part.storageKey !== null && part.storeAs === "media").length,
    attachmentCount: stored.length,
    notFound: plan.report.notFound.length,
    ambiguous: plan.report.ambiguous.length,
  });
  return { kind: KIND, status: "decided", outcome, ticketId };
}

/**
 * כותב הכרעה שאין איתה מיזוג לטיוטה — רק דוח ומייל חוזר. הליבה המשותפת
 * של `decideWithReply` (NO_SITE, ומסלול התשובה כשאין מה למזג) ושל ההכרעה
 * מחדש בתוך הנעילה כשהמצב השתנה בין הבדיקה הראשונה למיזוג (S7,
 * `applyEmailReply`) — שתיהן צריכות בדיוק את אותה כתיבה, האחת בתוך
 * טרנזאקציה שהיא פותחת (`decideWithReply`) והשנייה בתוך טרנזאקציה שכבר
 * פתוחה ונועלת שורת פנייה (`applyEmailReply`). `db.$transaction` אינו
 * מקנן, ולכן הכתיבה עצמה חייבת לקבל `tx` מבחוץ ולא לפתוח משלה.
 *
 * הכותרת נשמרת כאן ולא בשאר ההכרעות, כי המייל החוזר חייב לצאת באותה
 * שרשרת — ו-Gmail משייך לשרשרת לפי הכותרת (`Re: …`). הגוף עדיין אינו
 * נשמר: הוא לא עובד, ואין טיוטה שתציג אותו.
 */
async function writeReplyOutcome(
  tx: Tx,
  row: InboundRow,
  envelope: MailEnvelope,
  sender: SenderUser,
  outcome: MailOutcome,
  report: IntakeReport,
  threadId: string | null,
): Promise<void> {
  await tx.mailboxMessage.update({
    where: { id: row.id },
    data: {
      state: "DONE",
      outcome,
      nextAttemptAt: null,
      detail: null,
      authorUserId: sender.id,
      subject: envelope.subject,
      report: report as unknown as Prisma.InputJsonValue,
      ...identityOf(envelope),
    },
  });
  await scheduleReply(tx, row.id, envelope, threadId, envelope.from?.address ?? null);
}

/**
 * הכרעה שאין איתה טיוטה אך **יש** מייל חוזר (NO_SITE, ומסלול התשובה
 * כשאין מיזוג: נמחקה, שוגרה, או שהכותב אינו רשאי לערוך).
 */
async function decideWithReply(
  row: InboundRow,
  envelope: MailEnvelope,
  sender: SenderUser,
  outcome: MailOutcome,
  report: IntakeReport,
  threadId: string | null,
  now: Date,
): Promise<EmailIntakeOutcome> {
  await db.$transaction((tx) => writeReplyOutcome(tx, row, envelope, sender, outcome, report, threadId));

  logInfo("email.intake.decided", {
    mailboxMessageId: row.id,
    outcome,
    userId: sender.id,
    at: now.toISOString(),
  });
  return { kind: KIND, status: "decided", outcome };
}

/**
 * יוצר את השורה היוצאת ואת ג׳וב השליחה, **באותה טרנזאקציה** של ההכרעה.
 *
 * השורה נושאת מזהים בלבד; את הנוסח מרכיב `EMAIL_REPLY` בזמן השליחה, מול
 * מצב הטיוטה **אז** (§2.6 שלב 4). `repliesToId` ייחודי בסכימה, ולכן שורה
 * יוצאת שנייה לאותה הודעה אינה יכולה להיווצר — זו האידמפוטנטיות של המייל
 * החוזר.
 */
async function scheduleReply(
  tx: Tx,
  inboundId: string,
  envelope: MailEnvelope,
  threadId: string | null,
  toAddress: string | null,
): Promise<void> {
  const outbound = await tx.mailboxMessage.create({
    data: {
      direction: "OUTBOUND",
      state: "PENDING",
      repliesToId: inboundId,
      threadId,
      gmailThreadId: envelope.sourceThreadId,
      toAddress,
    },
    select: { id: true },
  });
  await enqueue(tx, JOB_TYPES.emailReply, { mailboxMessageId: outbound.id });
}

// ─────────────────────────────── מסלול התשובה (S7) ───────────────────────────────

/** הוכחת type-safety בלבד: `decideReplyVerdict` מחזירה "merge" רק כשיש טיוטה */
function assertTicketForMerge(ticket: DraftTicket | null): asserts ticket is DraftTicket {
  if (!ticket) throw new Error("applyEmailReply: הכרעת המיזוג הגיעה בלי טיוטה");
}

function assertLockedForMerge(
  locked: { ticket: DraftTicket; state: DraftState } | null,
): asserts locked is { ticket: DraftTicket; state: DraftState } {
  if (!locked) throw new Error("applyEmailReply: הכרעת המיזוג הגיעה בלי טיוטה נעולה");
}

/** הפנייה שהשרשרת מוצמדת אליה, ברגע זה — `null` כשהטיוטה נמחקה (§2.6 שלב 6) */
async function loadReplyTicket(threadId: string): Promise<DraftTicket | null> {
  const thread = await db.mailThread.findUniqueOrThrow({
    where: { id: threadId },
    select: { ticket: { select: DRAFT_TICKET_SELECT } },
  });
  return thread.ticket;
}

/**
 * מיישם תשובה בשרשרת של טיוטה — הפונקציה המחליפה את `skipUntilReplyPath`.
 *
 * שני שלבים, בכוונה: כל מה שאיטי או עלול להידחות (הורדת קבצים, קריאה
 * למחלץ) רץ **לפני** כל נעילה — בדיוק כמו `createEmailDraft` במסלול המייל
 * הראשון — כי `defer()` פותח טרנזאקציה משלו, ו-`db.$transaction` אינו
 * מקנן. רק הכתיבה עצמה, אחרי שהכול כבר בידינו, רצה תחת נעילת השורה ועם
 * קריאה חוזרת של המצב (submitDraft הוא התבנית שנקבעה לכך בפרויקט): מה
 * שנבדק לפני ההורדה יכול היה להשתנות בדיוק בזמן שחיכינו לרשת.
 */
async function applyEmailReply(
  row: InboundRow,
  envelope: MailEnvelope,
  threadId: string,
  sender: SenderUser,
  now: Date,
  deps: EmailIntakeDeps,
): Promise<EmailIntakeOutcome> {
  const probe = await loadReplyTicket(threadId);
  const verdict = decideReplyVerdict(probe, sender);
  if (verdict !== "merge") {
    return decideWithReply(row, envelope, sender, verdict, emptyReport(), threadId, now);
  }
  assertTicketForMerge(probe);
  const ticketId = probe.id;

  // הטקסט החדש בלבד (EM-13) — הציטוט, שכולל את המייל החוזר הקודם שלנו על
  // הטיוטה הזו, אסור שייקרא כהוראה. `priorBodies` הן גופי **שאר** ההודעות
  // בשרשרת הזו, בשני הכיוונים — כך ש-Outlook שמצטט תשובה שלנו גם הוא נתפס.
  const priorBodies = await loadPriorBodies(threadId, row.id);
  const { newText } = extractNewText({ text: envelope.text, html: envelope.html, priorBodies });
  const fullText = bodyTextOf(envelope);

  const attachments = await collectAttachments(row, envelope, deps, now);
  if (attachments.deferred) return attachments.outcome;

  const extraction = await extract({
    row,
    envelope,
    sender,
    body: newText,
    parts: attachments.parts,
    deps,
    now,
    isReply: true,
  });
  if (extraction.deferred) return extraction.outcome;

  // הבתים נכתבים לאחסון **בלי** הכרעת הכפילות (EM-25/EM-A05) — בדיוק כמו
  // במסלול המייל הראשון, ומאותה סיבה: אסור לנעול טרנזאקציה על העלאה. מפתח
  // שנכתב לקובץ שיתברר כתחת הנעילה ככפילות הוא בזבוז שקט (ראה ההערה מעל
  // `writeAttachments`) — אבל **נכון**, בשונה מהכרעה לפי חתימה שנקראה לפני
  // הנעילה: מירוץ מול הסרה במסך 7 (ממצא ביקורת S7 #3) יכול להשתנות בדיוק
  // בחלון הזה, וההכרעה חייבת לשקף את המצב שקיים **כשננעלת השורה**, לא לפניה.
  const stored = await writeAttachments(envelope, attachments.parts, deps);

  // §7 שורה 75 (EM-A06): קבצים נכנסים גם כשהחילוץ אינו זמין — רק הטקסט לא
  // ממוזג. EM-11 של התשובה: "התשובה נשמרה בהתכתבות, לא עובדה אוטומטית".
  const outcome: MailOutcome = extraction.value ? "REPLY_APPLIED" : "REPLY_STORED_UNPROCESSED";

  return db.$transaction(async (tx) => {
    const locked = await lockAndLoadDraft(tx, ticketId);

    // השולח נבדק מחדש **גם הוא**, לא רק הטיוטה (ממצא ביקורת S7 #2/#4):
    // תפקיד, שיוך אתר, השבתה או ביטול היכולת יכולים היו להשתנות באותו חלון
    // שבו חיכינו להורדה ולחילוץ — בדיוק כמו שהטיוטה יכולה הייתה להימחק.
    // `null` = הפך ל"זר" (כלל 9 מקרה 3), גם אם הוא השולח המקורי.
    const freshSender = await refetchSender(tx, sender);
    if (!freshSender) {
      await tx.mailboxMessage.update({
        where: { id: row.id },
        data: {
          state: "DONE",
          outcome: "IGNORED_UNAUTHORIZED",
          nextAttemptAt: null,
          // נשארת חלק מהשרשרת (ההתכתבות מציגה שההודעה קרתה, EM-M01) —
          // בשונה מ"זר" מההתחלה, שאותו שלב 6 של הסולם מכריע עוד לפני
          // שנודע לאיזו שרשרת הוא שייך
          threadId,
          ...identityOf(envelope),
        },
      });
      logInfo("email.intake.decided", {
        mailboxMessageId: row.id,
        outcome: "IGNORED_UNAUTHORIZED",
        userId: sender.id,
        at: now.toISOString(),
      });
      return { kind: KIND, status: "decided", outcome: "IGNORED_UNAUTHORIZED" };
    }

    const freshVerdict = decideReplyVerdict(locked?.ticket ?? null, freshSender);
    if (freshVerdict !== "merge") {
      // המצב השתנה בין הבדיקה למעלה להורדה/לחילוץ (נמחקה, שוגרה, או
      // ההרשאה השתנתה) — כותבים את ההכרעה הנכונה **עכשיו**, לא זו שבדקנו
      await writeReplyOutcome(tx, row, envelope, freshSender, freshVerdict, emptyReport(), threadId);
      logInfo("email.intake.decided", {
        mailboxMessageId: row.id,
        outcome: freshVerdict,
        userId: freshSender.id,
        at: now.toISOString(),
      });
      return { kind: KIND, status: "decided", outcome: freshVerdict };
    }
    assertLockedForMerge(locked);
    const { state } = locked;

    // EM-25 (קובץ שהוסר) ו-EM-A05/§7 #74 (קובץ שעדיין פעיל בטיוטה, ולא
    // הוסר מעולם) — שתיהן נקראות **תחת הנעילה**, מהסיבה שבהערה למעלה.
    const dedup = await loadThreadAttachmentShas(tx, threadId);
    const finalParts = markDedupedAttachments(stored, dedup);

    let report = emptyReport();
    if (extraction.value) {
      const built = await buildReplyProposal(tx, extraction.value, freshSender, haystackOf(envelope, newText), state.values);
      const merged = mergeChannelIntoDraft({
        state,
        proposal: built.proposal,
        receivedAt: envelope.receivedAt,
        messageId: row.id,
      });
      report = built.report;
      report.updated = await toUpdatedItems(tx, merged.changes);
      await writeDraftState(tx, ticketId, state, merged.state, true);
    }
    // חילוץ שאינו זמין (REPLY_STORED_UNPROCESSED): אין הצעה ואין מיזוג —
    // הטקסט החדש נשמר על השורה (למטה) ואינו נענה מחדש כשהשירות חוזר.

    const mediaIds = await writeMedia(tx, ticketId, freshSender.id, finalParts);
    await writeMailboxAttachments(tx, row.id, finalParts, mediaIds);

    await tx.mailboxMessage.update({
      where: { id: row.id },
      data: {
        state: "DONE",
        outcome,
        nextAttemptAt: null,
        detail: null,
        threadId,
        authorUserId: freshSender.id,
        subject: envelope.subject,
        bodyText: newText,
        fullText,
        report: report as unknown as Prisma.InputJsonValue,
        ...identityOf(envelope),
      },
    });

    await scheduleReply(tx, row.id, envelope, threadId, envelope.from?.address ?? null);

    logInfo("email.intake.reply_applied", {
      mailboxMessageId: row.id,
      ticketId,
      outcome,
      updated: report.updated.length,
      notFound: report.notFound.length,
      ambiguous: report.ambiguous.length,
    });
    return { kind: KIND, status: "decided", outcome, ticketId };
  });
}

/**
 * קוראת מחדש את פרטי השולח **תחת הנעילה**, ולא מסתפקת ב-`SenderUser` שכבר
 * בידינו מ-`findSender` (שרץ בשלב 6 של הסולם, לפני ההורדה והחילוץ).
 *
 * כתובת ורשימת הפיילוט אינן נקראות שוב: הן תלויות בהודעה ובסביבה, לא
 * במשתמש, ואינן יכולות להשתנות תוך כדי עיבוד הודעה בודדת. תפקיד, שיוך אתר,
 * השבתה וביטול היכולת כן נבדקים מחדש — בדיוק השדות ש-`findSender` עצמו
 * שוער עליהם, ובדיוק מה שיכול היה להשתנות באותו חלון (ממצא ביקורת S7 #2/#4).
 *
 * `null` פירושו שהשולח הפך ל"זר" (כלל 9 מקרה 3) בדיוק באותו חלון — מטופל
 * בקורא כמו שולח שמעולם לא היה מורשה.
 */
async function refetchSender(tx: Tx, sender: SenderUser): Promise<SenderUser | null> {
  const fresh = await tx.user.findUnique({
    where: { id: sender.id },
    select: { id: true, name: true, role: true, siteId: true, active: true, emailIntakeEnabled: true },
  });
  if (!fresh || !fresh.active || !fresh.emailIntakeEnabled) return null;
  return { id: fresh.id, name: fresh.name, role: fresh.role, siteId: fresh.siteId };
}

/**
 * גופי **שאר** ההודעות בשרשרת הזו, ישן לחדש — מה ש-`extractNewText` צריך
 * כ-`priorBodies` כדי לזהות ציטוט בלי סימון (EM-13). בנכנס נשמר `fullText`
 * (כל מה שהגיע, כולל ציטוט קודם); ביוצא — `bodyText` (מה שבאמת נשלח).
 * הסדר אינו נדרש על ידי `extractNewText` עצמה, אבל ישן-לחדש קריא לאבחון.
 */
async function loadPriorBodies(threadId: string, excludeMessageId: string): Promise<string[]> {
  const rows = await db.mailboxMessage.findMany({
    where: { threadId, id: { not: excludeMessageId } },
    select: { direction: true, bodyText: true, fullText: true, receivedAt: true, sentAt: true },
  });

  return rows
    .map((row) => ({ text: row.direction === "INBOUND" ? row.fullText : row.bodyText, at: row.receivedAt ?? row.sentAt }))
    .filter((row): row is { text: string; at: Date | null } => Boolean(row.text))
    .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))
    .map((row) => row.text);
}

/** חתימות (sha256) של קבצי הטיוטה הזו, לפי מה שכבר קיים בשרשרת */
interface ThreadAttachmentShas {
  /** הוסרו במפורש (מסך 7, `removeDraftMedia`) — EM-25 */
  removed: ReadonlySet<string>;
  /** עדיין פעילים בטיוטה (יש להם `MediaFile`, ולא הוסרו) — EM-A05, §7 #74 */
  active: ReadonlySet<string>;
}

/**
 * חתימות הקבצים של השרשרת הזו — מכל הודעה בה, לא רק מהראשונה: לוגו יכול
 * להגיע גם בתשובה שנייה או שלישית. **נקראת תחת הנעילה** (`tx`), לא לפניה:
 * ראה ההערה ב-`applyEmailReply` על מירוץ מול הסרה במסך 7 (ממצא ביקורת S7
 * #3) — הכרעת הכפילות חייבת לשקף את המצב שקיים כשננעלת השורה.
 *
 * שאילתה אחת, לא שתיים: לכל שורת `MailboxAttachment` עם חתימה יש בדיוק
 * שתי אפשרויות — הוסרה (`removedFromDraftAt` קיים) או עדיין מצביעה על
 * `MediaFile` פעיל (`mediaFileId` קיים). כפילות שכבר דוללה בעבר (העתק שני
 * של אותו לוגו, `mediaFileId: null` ו-`removedFromDraftAt: null`) אינה אף
 * אחת מהשתיים, ובכך לא נכנסת לאף קבוצה — נכון, כי היא לא "עדיין פעילה"
 * ולא "הוסרה", היא פשוט לא הייתה מעולם.
 */
async function loadThreadAttachmentShas(tx: Tx, threadId: string): Promise<ThreadAttachmentShas> {
  const rows = await tx.mailboxAttachment.findMany({
    where: { message: { threadId }, sha256: { not: null } },
    select: { sha256: true, removedFromDraftAt: true, mediaFileId: true },
  });

  const removed = new Set<string>();
  const active = new Set<string>();
  for (const row of rows) {
    if (!row.sha256) continue;
    if (row.removedFromDraftAt) removed.add(row.sha256);
    else if (row.mediaFileId) active.add(row.sha256);
  }
  return { removed, active };
}

/**
 * מסמנת חלק שכבר קיים בשרשרת הזו, לפי חתימה: לא ייכתב לאחסון ולא יהפוך
 * למדיה (וממילא לא לג׳וב AI כפול על אותם בתים), אבל עדיין יקבל שורת
 * `MailboxAttachment` משלו על ההודעה הנוכחית — ההתכתבות שומרת כל הופעה.
 *
 * שתי סיבות שונות, אותה תוצאה: **הוסר** (EM-25, "removed_before") —
 * המצבה המקורית נשארת "הוסרה", וההופעה החדשה אינה מחזירה אותה. **עדיין
 * פעיל** (EM-A05/§7 #74, "already_in_draft") — לוגו שאיש לא הסיר מעולם
 * אינו נכפל בכל תשובה. הוסר גובר על פעיל (הם לעולם לא חופפים לאותה חתימה
 * בו-זמנית — ראה `loadThreadAttachmentShas`), כך שסדר הבדיקה אינו קובע
 * בפועל; הוא נשמר מפורש לקריאות. חלק שנפסל מסיבה אחרת (`skippedReason` כבר
 * קיים) אינו כאן: ל-`skipped()` תמיד `sha256: null`.
 */
function markDedupedAttachments(parts: readonly MailPreparedPart[], shas: ThreadAttachmentShas): MailPreparedPart[] {
  return parts.map((part) => {
    if (!part.sha256) return part;
    if (shas.removed.has(part.sha256)) {
      return { ...part, bytes: null, storageKey: null, storeAs: null, skippedReason: "removed_before" };
    }
    if (shas.active.has(part.sha256)) {
      return { ...part, bytes: null, storageKey: null, storeAs: null, skippedReason: "already_in_draft" };
    }
    return part;
  });
}

// ─────────────────────────────── החילוץ ───────────────────────────────

/**
 * מריץ את החילוץ, ומכריע מה לעשות בכשל.
 *
 * **הקו החד של EM-11:** כשל זמני נדחה כל עוד יש תקציב, ואחריו הופך
 * להכרעה סופית — "החילוץ אינו זמין". היעדר מפתח או כשל קבוע (4xx, תשובה
 * שאינה עומדת בסכימה) הולכים ישר להכרעה: אין מה לנסות שוב.
 *
 * התקציב נמדד מהגעת המייל ולא מתחילת העיבוד, עם רצפה של שני ניסיונות —
 * ראה `MIN_EXTRACTION_ATTEMPTS`.
 */
async function extract(input: {
  row: InboundRow;
  envelope: MailEnvelope;
  sender: SenderUser;
  body: string;
  parts: readonly MailPreparedPart[];
  deps: EmailIntakeDeps;
  now: Date;
  /** תשובה בשרשרת (S7): `body` הוא הטקסט החדש בלבד, ו-`op` יכול להיות append/replace/none */
  isReply?: boolean;
}): Promise<{ deferred: false; value: FieldExtraction | null } | { deferred: true; outcome: EmailIntakeOutcome }> {
  const { row, envelope, sender, body, parts, deps, now, isReply = false } = input;
  if (!deps.extractor) return { deferred: false, value: null };

  try {
    const value = await deps.extractor.extract({
      subject: envelope.subject,
      // מייל ראשון נקרא **במלואו**, כולל בלוק שהועבר: שם כתוב הדיווח
      // (§7 שורה 73). בתשובה `body` כבר הוא הטקסט החדש בלבד (EM-13,
      // `extractNewText` נקרא אצל הקורא).
      text: body,
      attachments: extractionAttachments(parts),
      gazetteer: await loadGazetteer(sender),
      isReply,
    });
    return { deferred: false, value };
  } catch (error) {
    if (!(error instanceof AiRequestError)) throw error;

    // הקריאה הנוכחית בכלל הספירה: דחיות החילוץ שכבר נרשמו, ועוד זו
    const attemptsSoFar = deferralsOf(row.detail, "extraction") + 1;
    const retry = shouldRetryExtraction({
      kind: error.kind,
      now,
      receivedAt: envelope.receivedAt,
      extractionAttempts: attemptsSoFar,
    });

    if (retry) {
      return {
        deferred: true,
        outcome: await defer(row, "extraction", error.message, now, EXTRACTION_RETRY_MS),
      };
    }

    // מכאן זו הכרעה ולא כשל: המסלול המלא קיים (EM-11), והשולח יקבל מייל
    // שאומר בדיוק מה קרה.
    logWarn("email.intake.extraction_unavailable", {
      mailboxMessageId: row.id,
      kind: error.kind,
      attempts: attemptsSoFar,
    });
    return { deferred: false, value: null };
  }
}

// ─────────────────────────────── קבצים מצורפים ───────────────────────────────

/** חלק של מייל אחרי הורדה וסיווג — ראה `PreparedPart` */
type MailPreparedPart = PreparedPart<MailPart>;

/**
 * מוריד ומסווג את כל חלקי ההודעה.
 *
 * **לא כל חלק מורד.** קובץ שגדול מהתקרה נרשם בלי בתים, וקובץ שהצהרתו
 * ספציפית ואינה מדיה (Word, ZIP) נרשם בלי הורדה — אין מה לעשות בבתים
 * שלו, ורשימת ההיתר של האחסון דוחה אותם ממילא. הורדה נעשית כשההצהרה
 * כללית (`application/octet-stream`, שכיח ב-PDF סרוק וב-HEIC) או כשהיא
 * מדיה, כי אז החתימה היא מה שקובע.
 */
async function collectAttachments(
  row: InboundRow,
  envelope: MailEnvelope,
  deps: EmailIntakeDeps,
  now: Date,
): Promise<{ deferred: false; parts: MailPreparedPart[] } | { deferred: true; outcome: EmailIntakeOutcome }> {
  const prepared: MailPreparedPart[] = [];

  for (const part of envelope.parts) {
    const declared = classifyAttachment({ filename: part.filename, mimeType: part.mimeType }, null);

    if (part.sizeBytes > MAX_FILE_BYTES) {
      prepared.push(skippedPart(part, declared.mimeType, declared.isMedia, "too-large"));
      continue;
    }

    // מסמך Word/Excel מורד כדי להישמר בהתכתבות (§7 שורה 64), והחתימה שלו
    // נבדקת — ההצהרה לבדה אינה מספיקה כדי לשמור קובץ
    const needsBytes =
      declared.isMedia ||
      declared.mimeType === "application/octet-stream" ||
      isCorrespondenceDocumentType(declared.mimeType);
    if (!needsBytes) {
      prepared.push(skippedPart(part, declared.mimeType, false, declared.isTnef ? "tnef" : "not-media"));
      continue;
    }

    const bytes = await downloadPart(envelope, part, deps);
    if (bytes === "defer") {
      // הקובץ עשוי להיות הדיווח עצמו (צילום של פתק), ולכן ההכרעה ממתינה
      // לו ואינה נופלת בלעדיו
      const detail = `הורדת קובץ מצורף ${part.index} נכשלה זמנית`;
      return { deferred: true, outcome: await defer(row, "attachment", detail, now) };
    }
    if (bytes === null) {
      prepared.push(skippedPart(part, declared.mimeType, declared.isMedia, "download-failed"));
      continue;
    }

    const resolved = classifyAttachment(
      { filename: part.filename, mimeType: part.mimeType },
      bytes.subarray(0, 64),
    );
    prepared.push(classifyBytes(part, resolved, bytes));
  }

  return { deferred: false, parts: prepared };
}

/**
 * הבתים של חלק: מתוך ההודעה, או בהורדה נפרדת.
 *
 * `"defer"` — כשל זמני מול Gmail: אין להכריע בלי הקובץ, כי הוא עשוי
 * להיות הדיווח עצמו (צילום של פתק). `null` — הקובץ אינו שם או שהבקשה
 * נדחתה לצמיתות: הפנייה נפתחת בלעדיו, והסיבה נרשמת על השורה.
 */
async function downloadPart(
  envelope: MailEnvelope,
  part: MailPart,
  deps: EmailIntakeDeps,
): Promise<Buffer | null | "defer"> {
  if (part.data) return part.data;
  if (!part.sourceRef) return null;

  try {
    return await deps.source.getAttachment(envelope.sourceId, part.sourceRef);
  } catch (error) {
    if (error instanceof MailSourceError && error.kind === "transient") return "defer";
    if (error instanceof MailSourceError) {
      logWarn("email.intake.attachment_unavailable", {
        gmailMessageId: envelope.sourceId,
        partIndex: part.index,
        kind: error.kind,
      });
      return null;
    }
    throw error;
  }
}

/**
 * כותב את הבתים לאחסון — **לפני** הטרנזאקציה (ראה `storePreparedParts`),
 * במפתח שנגזר מההודעה ומספר החלק.
 */
async function writeAttachments(
  envelope: MailEnvelope,
  parts: readonly MailPreparedPart[],
  deps: EmailIntakeDeps,
): Promise<MailPreparedPart[]> {
  return storePreparedParts(parts, (prepared) => attachmentStorageKey(envelope, prepared), deps.storage ?? selectStorage());
}

function attachmentStorageKey(envelope: MailEnvelope, prepared: MailPreparedPart): string {
  // מזהה ההודעה נכנס למפתח כפי שהוא, אחרי ניקוי: הוא מגיע משירות חיצוני,
  // והאחסון המקומי פותר מפתח לנתיב על הדיסק
  const source = envelope.sourceId.replace(/[^A-Za-z0-9._-]/g, "_");
  return `media/mail/${source}/${prepared.part.index}.${storageExtension(prepared.mimeType)}`;
}

/**
 * שורת `MailboxAttachment` לכל חלק — **גם למה שלא נכנס לטיוטה**.
 *
 * זו ההתכתבות (§2.6 שלב 3): קובץ Word שהשולח צירף נשאר מתועד, עם הסיבה
 * שלא הפך למדיה. הבתים שלו אינם נשמרים — רשימת ההיתר של האחסון דוחה
 * אותם, ולכן `storageKey` נשאר ריק.
 */
async function writeMailboxAttachments(
  tx: Tx,
  messageId: string,
  parts: readonly MailPreparedPart[],
  mediaIds: ReadonlyMap<number, string>,
): Promise<void> {
  for (const part of parts) {
    await tx.mailboxAttachment.create({
      data: {
        messageId,
        partIndex: part.part.index,
        filename: part.part.filename,
        mimeType: part.mimeType,
        sizeBytes: part.part.sizeBytes,
        sha256: part.sha256,
        storageKey: part.storageKey,
        isMedia: part.isMedia,
        inline: part.part.disposition === "inline",
        skippedReason: part.skippedReason,
        mediaFileId: mediaIds.get(part.part.index) ?? null,
      },
    });
  }
}

// ─────────────────────────────── עזרים ───────────────────────────────

/**
 * גוף המייל כטקסט. ה-HTML הוא גיבוי ולא ברירת המחדל: יש לקוחות ששולחים
 * `text/plain` ריק, ובלעדיו התיאור היה נשאר ריק בלי שאיש יידע.
 */
/**
 * הכתובת שאליה המייל הגיע אצלנו. `GMAIL_USER` ולא הנמען הראשון בכותרת:
 * מייל שהתיבה רק בהעתק בו נקלט כרגיל (§7 שורה 80), ושם `To` הוא מישהו אחר.
 */
function mailboxAddress(envelope: MailEnvelope): string | null {
  const configured = env.gmailUser();
  if (configured) return normalizeEmail(configured);
  return envelope.to[0]?.address ?? null;
}

/**
 * הטקסט שהמחלץ קרא — הכותרת והגוף. מולו נבדק כל ערך שסומן כמופיע בטקסט
 * (`quotedText` ב-`intake-draft.ts`).
 */
function haystackOf(envelope: MailEnvelope, body: string): string {
  return `${envelope.subject}\n${body}`;
}

function bodyTextOf(envelope: MailEnvelope): string {
  const text = normalizeText(envelope.text);
  if (text) return text;
  return envelope.html ? normalizeText(htmlToText(envelope.html)) : "";
}
