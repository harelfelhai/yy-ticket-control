import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { MailOutcome, Role, Room } from "@/generated/prisma/enums";
import { enqueue } from "@/jobs/queue";
import { JOB_TYPES, type JobType } from "@/jobs/types";
import { AiRequestError, canExtractText } from "@/lib/ai/gemini";
import { db } from "@/lib/db";
import type {
  DraftFieldName,
  DraftRecipient,
  DraftState,
  DraftValues,
  RecipientRef,
  RecipientsProposal,
} from "@/lib/draft/fields";
import { type EmailProposal, type FieldChange, mergeEmailIntoDraft } from "@/lib/draft/merge";
import { isAutoReply } from "@/lib/email-intake/auto-reply";
import type {
  ExtractionAttachment,
  FieldExtractor,
  Gazetteer,
} from "@/lib/email-intake/extraction";
import {
  type Candidate,
  type MatchResult,
  matchApartment,
  matchBuilding,
  matchName,
  mentionedIn,
} from "@/lib/email-intake/matching";
import { classifyAttachment } from "@/lib/email-intake/mime";
import { extractNewText, htmlToText } from "@/lib/email-intake/quote";
import { MailSourceError, type MailSource } from "@/lib/email-intake/source";
import { isIntakeSubject } from "@/lib/email-intake/subject";
import {
  type AmbiguousItem,
  type FieldExtraction,
  type IntakeReport,
  type MailEnvelope,
  type MailPart,
  type Mention,
  type NotFoundItem,
  type UpdatedItem,
  emptyReport,
} from "@/lib/email-intake/types";
import { env } from "@/lib/env";
import { he } from "@/lib/he";
import { normalizeEmail, normalizeText } from "@/lib/normalize";
import { captureError, logError, logInfo, logWarn } from "@/lib/observability/log";
import { type Viewer, canCreateTicketInSite, canEditTicketFields } from "@/lib/permissions";
import type { MediaStorage } from "@/lib/storage";
import { MAX_FILE_BYTES, isAllowedMimeType, selectStorage } from "@/lib/storage";
import { DRAFT_TICKET_SELECT, type DraftTicket, lockAndLoadDraft, writeDraftState } from "./draft-fields";
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

// ─────────────────────────────── קבועים ───────────────────────────────

/**
 * ההשהיות של דחיית הודעה, בדקות, לפי מספר הניסיונות שכבר נעשו. הערך
 * האחרון חוזר על עצמו עד `MAX_DEFER_ATTEMPTS`.
 */
const DEFER_MINUTES = [1, 2, 5, 10, 20, 40, 60] as const;

/**
 * מאיזה ניסיון הדחייה מדווחת ל-Sentry כ-issue ולא כלוג.
 *
 * כאן הבקאוף כבר מתייצב על שעה, כלומר ההודעה נדחית מעל שעה ורבע ואין שום
 * סיכוי לקיים את ההבטחה של חמש הדקות (§2.6 שלב 4). **ההנחה הקודמת שנרשמה
 * כאן — ש-`email-intake-not-stuck` יתריע ממילא — שגויה:** ה-check סופר רק
 * שורות שבהן `nextAttemptAt` ריק או עבר, ושורה בלולאת דחייה נמצאת במצב
 * הזה שניות ספורות בכל שעה. אותו תנאי בדיוק מוציא אותה גם מסריקת התקועים
 * של הסבב. בלי הדיווח כאן אין בכל המערכת מי שרואה אותה.
 *
 * הדיווח הוא אירוע **אחד** להודעה (שוויון מדויק), ולכן אינו זקוק לחניקה.
 */
const DEFER_ALARM_ATTEMPTS = 6;

/**
 * הגג: אחרי כך וכך דחיות ההודעה נעצרת, ולא נוצר לה ג׳וב נוסף.
 *
 * 24 ניסיונות הם כ-19 שעות (78 דקות לשש הראשונות, ואז שעה לכל אחד). זהו
 * שינוי מכוון מול "לנסות שוב לנצח": דחייה בלי גג יוצרת שורת `Job` חדשה
 * כל שעה לנצח, והשורה נשארת PENDING לעד — בניגוד ל-invariant שבראש
 * הקובץ, שלפיו לכל הודעה יש בדיוק הכרעה אחת. העצירה **אינה הכרעה**
 * (`outcome` נשאר ריק): היא אומרת "לא הצלחנו לקרוא", ומשאירה את התיקון
 * לאדם שמקבל את ה-issue.
 */
const MAX_DEFER_ATTEMPTS = 24;

const MINUTE_MS = 60_000;

/** ההשהיה בין ניסיונות חילוץ — קצרה, כי התקציב כולו הוא ארבע דקות */
const EXTRACTION_RETRY_MS = 30_000;

/**
 * התקציב לחילוץ, נמדד **מהגעת המייל** ולא מתחילת העיבוד: ההבטחה בשלב 4
 * של §2.6 היא חמש דקות מהגעה, והמייל החוזר עוד צריך להישלח אחרי זה.
 */
const EXTRACTION_BUDGET_MS = 4 * MINUTE_MS;

/**
 * מינימום **קריאות למחלץ**, גם כשהתקציב כבר אזל.
 *
 * מייל שנקלט באיחור (סבב שנתקע, שרת שהיה למטה) מגיע לכאן כשארבע הדקות
 * מאחוריו, ובלי הרצפה הזו תקלה רגעית אחת אצל הספק הייתה נרשמת מיד כהכרעה
 * "החילוץ אינו זמין" — הכרעה שאין ממנה חזרה.
 *
 * **נספרות דחיות החילוץ בלבד, ולא `attempts`.** `attempts` הוא מונה משותף
 * לשלוש סיבות הדחייה, ושתי דחיות מול Gmail היו שוחקות את הרצפה עד אפס —
 * כלומר הכרעה סופית אחרי קריאה אחת למחלץ, בדיוק במקרה שהרצפה נכתבה בשבילו.
 */
const MIN_EXTRACTION_ATTEMPTS = 2;

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

/** המשתמש שמאחורי כתובת השולח — הוא גם השחקן של הטיוטה (§2.6 שלב 3) */
export interface SenderUser {
  id: string;
  name: string;
  role: Role;
  siteId: string | null;
}

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

  const minutes = DEFER_MINUTES[Math.min(row.attempts, DEFER_MINUTES.length - 1)];
  const nextAttemptAt = new Date(now.getTime() + (delayMs ?? minutes * MINUTE_MS));

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
    ? await planDraft(extraction.value, envelope, sender, body)
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
        data: plan.filled.map((field) => ({ ticketId: ticket.id, field, fromEmail: true })),
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
    mediaCount: stored.filter((part) => part.storageKey !== null).length,
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

/**
 * מי משלושת המצבים חל על תשובה שמגיעה **עכשיו** לטיוטה, או שיש למזג
 * (§2.6 שלבים 5–6, §5.ה3 כלל 9, §7 שורה 76).
 *
 * **סדר הבדיקות הוא הכלל, לא מקרה.** הרשאת העריכה נבדקת **לפני** מצב
 * השיגור: תשובה ממשתמש מורשה שאינו רשאי לערוך מקבלת "אין לך הרשאה" **גם
 * כשהפנייה כבר שוגרה** — לא "כבר נשלחה" (§7 שורה 76, EM-A07). מייל "כבר
 * נשלחה" נושא מספר פנייה וקישור אליה, ואלה אינם שייכים למי שאין לו הרשאה
 * עליה. מחיקה נבדקת ראשונה מטעם מבני ולא לפי סדר עדיפות: בלי טיוטה אין
 * `siteId`/`createdById` לבדוק מולם הרשאה כלל.
 *
 * **מקרה 3 של כלל 9 (זר) אינו כאן.** "כתובת שאינה של משתמש מורשה" כבר
 * הוכרע בשלב 6 של הסולם — `findSender` — **לפני** שהגענו לכאן: הפונקציה
 * הזו נקראת אך ורק כשיש `sender` לא-null, וזה בדיוק ה"מורשה" של כלל 9.
 * שולח שהושבת או שההרשאה שלו בוטלה נכשל באותו `findSender`, כי הוא נבדק
 * מול הנתונים **החיים** ולא מול מה שהיה נכון כשהטיוטה נוצרה — ולכן הוא
 * "זר" באותה מידה בדיוק, גם אם הוא השולח המקורי.
 */
type ReplyVerdict = "merge" | Extract<MailOutcome, "REPLY_AFTER_DELETION" | "REPLY_NOT_PERMITTED" | "REPLY_AFTER_DISPATCH">;

function decideReplyVerdict(ticket: DraftTicket | null, sender: SenderUser): ReplyVerdict {
  if (!ticket) return "REPLY_AFTER_DELETION";
  if (!canEditTicketFields(viewerOf(sender), ticket)) return "REPLY_NOT_PERMITTED";
  if (!ticket.isDraft) return "REPLY_AFTER_DISPATCH";
  return "merge";
}

/** השחקן שמאחורי התשובה, כפי שהרשאות המערכת רואות אותו (§5.ז) */
function viewerOf(sender: SenderUser): Viewer {
  return { kind: "user", id: sender.id, role: sender.role, siteId: sender.siteId };
}

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
      const built = await buildReplyProposal(tx, extraction.value, envelope, freshSender, newText, state.values);
      const merged = mergeEmailIntoDraft({
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
function markDedupedAttachments(parts: readonly PreparedPart[], shas: ThreadAttachmentShas): PreparedPart[] {
  return parts.map((part) => {
    if (!part.sha256) return part;
    if (shas.removed.has(part.sha256)) {
      return { ...part, bytes: null, storageKey: null, skippedReason: "removed_before" };
    }
    if (shas.active.has(part.sha256)) {
      return { ...part, bytes: null, storageKey: null, skippedReason: "already_in_draft" };
    }
    return part;
  });
}

/**
 * בונה `EmailProposal` מחילוץ של **תשובה** — המקבילה של `planDraft` למסלול
 * הזה. ההבדל המהותי: אין כאן טיוטה חדשה שנוצרת, יש טיוטה **קיימת** שכבר
 * יש לה אתר/בניין אפשריים. התאמת בניין ודירה חייבת להתבצע מול **האתר
 * שהמייל הזה מדבר עליו** — האתר שהמייל הציע, ורק אם הוא לא הציע דבר, האתר
 * שכבר בטיוטה (ראה ההערה הארוכה מעל `mergeEmailIntoDraft` ב-`draft/merge.ts`
 * על "תלויים מאותו מייל כשהאתר או הבניין לא נכנסו").
 *
 * רץ תחת הנעילה (`tx`) ולא לפניה: "האתר שכבר בטיוטה" חייב להיות **הערך
 * הנעול**, לא זה שנקרא לפני שהמתנו לקבצים ולמחלץ.
 */
async function buildReplyProposal(
  tx: Tx,
  extraction: FieldExtraction,
  envelope: MailEnvelope,
  sender: SenderUser,
  newText: string,
  current: DraftValues,
): Promise<{ proposal: EmailProposal; report: IntakeReport }> {
  const report = emptyReport();
  const haystack = `${envelope.subject}\n${newText}`;
  const written = (mention: Mention, field: DraftFieldName): string | null => quotedText(mention, field, haystack);
  const proposal: EmailProposal = {};

  // ── אתר ── מנהל עבודה: בלי התאמה כלל, בדיוק כמו `planDraft` — האתר נגזר
  // מהשולח ותשובה אינה יכולה לשנות אותו. מנהל מערכת/בעלים: כמו במייל ראשון.
  if (sender.role !== "SITE_MANAGER") {
    const siteText = written(extraction.site, "SITE");
    if (siteText) {
      const sites = await candidates(tx.site.findMany({ select: { id: true, name: true } }));
      const resolved = resolve("SITE", siteText, matchName(siteText, sites), report, sites);
      // "בתשובה, שינוי אתר חל רק אם הכותב רשאי לפתוח פנייה באתר החדש"
      // (הכרעת מימוש, לא אפיון מפורש). כיום תמיד true למנהל מערכת/בעלים —
      // הבדיקה נשארת כרשת ביטחון לתפקיד עתידי; אתר שאין הרשאה לפתוח בו
      // נזרק בשקט (לא מדווח כ"לא נמצא" — הוא נמצא, רק אין הרשאה עליו).
      if (resolved && canCreateTicketInSite(viewerOf(sender), resolved)) proposal.site = resolved;
    }
  }

  const effectiveSiteId = proposal.site ?? current.siteId;
  // האתר משתנה מהמייל הזה — גם כשהוא זהה למה שכבר בטיוטה `proposal.site`
  // עדיין "undefined" כלומר לא הוצע, ולכן ההשוואה ל-`current.siteId` נכונה
  const siteChanging = proposal.site !== undefined && proposal.site !== current.siteId;

  if (effectiveSiteId) {
    const buildingText = written(extraction.building, "BUILDING");
    if (buildingText) {
      const buildings = await candidates(
        tx.building.findMany({ where: { siteId: effectiveSiteId }, select: { id: true, name: true } }),
      );
      const resolved = resolve("BUILDING", buildingText, matchBuilding(buildingText, buildings), report, buildings);
      if (resolved) proposal.building = resolved;
    }

    // הבניין להתאמת דירה: מה שהמייל הזה נתן, ואם לא — הבניין שכבר בטיוטה,
    // **רק אם האתר לא השתנה מהמייל הזה**. אם האתר השתנה והמייל לא נתן
    // בניין, אין בניין בהקשר הנכון להתאים דירה מולו.
    const effectiveBuildingId = proposal.building ?? (siteChanging ? null : current.buildingId);
    if (effectiveBuildingId) {
      const apartmentText = written(extraction.apartment, "APARTMENT");
      if (apartmentText) {
        const rows = await tx.apartment.findMany({
          where: { buildingId: effectiveBuildingId },
          select: { id: true, number: true },
        });
        const apartments = rows.map((row) => ({ id: row.id, label: row.number }));
        const resolved = resolve("APARTMENT", apartmentText, matchApartment(apartmentText, apartments), report, null);
        if (resolved) proposal.apartment = resolved;
      }
    }
  }

  // ── חדר ── כמו במייל ראשון: ערך של הספירה, לא טקסט — אין כאן התאמה
  if (extraction.room.value && extraction.room.source !== "none") proposal.room = extraction.room.value;

  // ── תחום ──
  const domainText = written(extraction.domain, "DOMAIN");
  if (domainText) {
    const domains = await candidates(tx.domain.findMany({ select: { id: true, name: true } }));
    const resolved = resolve("DOMAIN", domainText, matchName(domainText, domains), report, domains);
    if (resolved) proposal.domain = resolved;
  }

  // ── תיאור ── `append`/`replace`/`set` כולם עוברים למנוע המיזוג כמו שהם;
  // רק המנוע יודע אם זו תוספת (EM-C07) או שדה שיוכרע מול עריכה במערכת.
  if (extraction.description.op !== "none") {
    const text = normalizeText(extraction.description.text);
    if (text) proposal.description = { op: extraction.description.op, text };
  }

  // ── נמענים ── הוספה **והסרה** (§5.ה4) — בשונה ממייל ראשון
  const recipients = await resolveRecipientsProposal(extraction, report, haystack, tx);
  if (recipients) proposal.recipients = recipients;

  return { proposal, report };
}

interface ReplyLabels {
  site: Map<string, string>;
  building: Map<string, string>;
  apartment: Map<string, string>;
  domain: Map<string, string>;
  professional: Map<string, string>;
  user: Map<string, string>;
}

async function idLabelMap(
  ids: ReadonlySet<string>,
  load: (ids: string[]) => Promise<{ id: string; name: string }[]>,
): Promise<Map<string, string>> {
  if (ids.size === 0) return new Map();
  return new Map((await load([...ids])).map((row) => [row.id, row.name]));
}

/**
 * ממיר את `MergeResult.changes` (מזהים גולמיים) ל-`UpdatedItem[]` — תוויות
 * להצגה, הבסיס ל"עודכן מהתשובה שלך" (EM-C03). ממחזר את **דפוס** תרגום
 * המזהים לתוויות שכבר קיים ב-`services/email-reply.ts` (S6, `systemLabel`/
 * `emailLabel`/`loadLabels`, סביב שורה 600) — אבל לא את הפונקציות עצמן,
 * שאינן מיוצאות משם. שתי קריאות ל-DB לכל סוג רשומה, לא אחת לכל שינוי.
 */
async function toUpdatedItems(tx: Tx, changes: readonly FieldChange[]): Promise<UpdatedItem[]> {
  if (changes.length === 0) return [];

  const siteIds = new Set<string>();
  const buildingIds = new Set<string>();
  const apartmentIds = new Set<string>();
  const domainIds = new Set<string>();
  const professionalIds = new Set<string>();
  const userIds = new Set<string>();
  const addRef = (ref: RecipientRef) => (ref.kind === "professional" ? professionalIds : userIds).add(ref.id);

  for (const change of changes) {
    for (const value of [change.before, change.after]) {
      switch (change.field) {
        case "SITE":
          if (typeof value === "string") siteIds.add(value);
          break;
        case "BUILDING":
          if (typeof value === "string") buildingIds.add(value);
          break;
        case "APARTMENT":
          if (typeof value === "string") apartmentIds.add(value);
          break;
        case "DOMAIN":
          if (typeof value === "string") domainIds.add(value);
          break;
        case "RECIPIENTS":
          (value as RecipientRef[] | undefined)?.forEach(addRef);
          break;
        case "ROOM":
        case "DESCRIPTION":
          break;
      }
    }
  }

  const [site, building, apartment, domain, professional, user] = await Promise.all([
    idLabelMap(siteIds, (ids) => tx.site.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })),
    idLabelMap(buildingIds, (ids) =>
      tx.building.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    ),
    idLabelMap(apartmentIds, async (ids) =>
      (await tx.apartment.findMany({ where: { id: { in: ids } }, select: { id: true, number: true } })).map((row) => ({
        id: row.id,
        name: row.number,
      })),
    ),
    idLabelMap(domainIds, (ids) => tx.domain.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })),
    idLabelMap(professionalIds, (ids) =>
      tx.professional.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    ),
    idLabelMap(userIds, (ids) => tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })),
  ]);
  const labels: ReplyLabels = { site, building, apartment, domain, professional, user };

  return changes.map((change) => ({
    field: change.field,
    before: replyDisplayValue(change.field, change.before, labels),
    after: replyDisplayValue(change.field, change.after, labels),
  }));
}

function replyDisplayValue(field: DraftFieldName, raw: unknown, labels: ReplyLabels): string | null {
  switch (field) {
    case "SITE":
      return typeof raw === "string" ? (labels.site.get(raw) ?? null) : null;
    case "BUILDING":
      return typeof raw === "string" ? (labels.building.get(raw) ?? null) : null;
    case "APARTMENT":
      return typeof raw === "string" ? (labels.apartment.get(raw) ?? null) : null;
    case "DOMAIN":
      return typeof raw === "string" ? (labels.domain.get(raw) ?? null) : null;
    case "ROOM":
      return raw ? he.room[raw as Room] : null;
    case "DESCRIPTION":
      return typeof raw === "string" && raw !== "" ? raw : null;
    case "RECIPIENTS": {
      const refs = (raw as RecipientRef[] | undefined) ?? [];
      const names = refs
        .map((ref) => (ref.kind === "professional" ? labels.professional : labels.user).get(ref.id) ?? "")
        .filter(Boolean);
      return names.length > 0 ? names.join(he.emailIntake.listSeparator) : null;
    }
  }
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
  parts: readonly PreparedPart[];
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

    const retryable = error.kind === "transient" || error.kind === "quota";
    const inBudget = now.getTime() + EXTRACTION_RETRY_MS < envelope.receivedAt.getTime() + EXTRACTION_BUDGET_MS;
    // הקריאה הנוכחית בכלל הספירה: דחיות החילוץ שכבר נרשמו, ועוד זו
    const attemptsSoFar = deferralsOf(row.detail, "extraction") + 1;

    if (retryable && (inBudget || attemptsSoFar < MIN_EXTRACTION_ATTEMPTS)) {
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

/** הקבצים שנכנסים לקריאת החילוץ — רק מה שהבתים שלו בידינו */
function extractionAttachments(parts: readonly PreparedPart[]): ExtractionAttachment[] {
  return parts.flatMap((part) =>
    part.bytes && part.isMedia
      ? [{ filename: part.part.filename, mimeType: part.mimeType, bytes: part.bytes }]
      : [],
  );
}

/**
 * הרשומות הקיימות כטקסט, להקשר זיהוי בלבד (`Gazetteer`).
 *
 * **הרשימה תחומה בהרשאה של השולח**: מנהל עבודה רואה את האתר שלו בלבד,
 * ולכן גם המחלץ מקבל רק אותו — אחרת המודל היה "מזהה" אתר שהשולח אינו
 * רשאי לפתוח בו פנייה, וההתאמה הייתה נכשלת אחר כך בלי הסבר. מנהל מערכת
 * ובעלים פותחים בכל אתר, ולכן מקבלים את הכול.
 */
async function loadGazetteer(sender: SenderUser): Promise<Gazetteer> {
  const siteFilter = sender.role === "SITE_MANAGER" && sender.siteId ? { id: sender.siteId } : {};

  const [sites, buildings, apartments, domains, professionals, users] = await Promise.all([
    db.site.findMany({ where: siteFilter, select: { name: true } }),
    db.building.findMany({ where: { site: siteFilter }, select: { name: true } }),
    db.apartment.findMany({ where: { building: { site: siteFilter } }, select: { number: true } }),
    db.domain.findMany({ select: { name: true } }),
    // מושבת אינו מועמד להתאמה (§2.6 שלב 3), ולכן גם אינו בהקשר: שם
    // שהמודל יקרא ולא יימצא אחר כך היה מדווח "לא נמצא ברשימה" על אדם קיים.
    db.professional.findMany({ where: { active: true }, select: { name: true } }),
    db.user.findMany({ where: { active: true }, select: { name: true } }),
  ]);

  return {
    sites: sites.map((site) => site.name),
    buildings: buildings.map((building) => building.name),
    apartments: apartments.map((apartment) => apartment.number),
    domains: domains.map((domain) => domain.name),
    professionals: professionals.map((professional) => professional.name),
    users: users.map((user) => user.name),
  };
}

// ─────────────────────────────── מהחילוץ לטיוטה ───────────────────────────────

interface DraftValuesPlan {
  siteId: string | null;
  buildingId: string | null;
  apartmentId: string | null;
  room: Room | null;
  domainId: string | null;
  description: string;
  recipients: DraftRecipient[];
}

interface DraftPlan {
  values: DraftValuesPlan;
  filled: DraftFieldName[];
  report: IntakeReport;
}

function emptyValues(): DraftValuesPlan {
  return {
    siteId: null,
    buildingId: null,
    apartmentId: null,
    room: null,
    domainId: null,
    description: "",
    recipients: [],
  };
}

/**
 * האתר שנגזר **מהשולח** (§2.6 שלב 3), ולא מהמייל.
 *
 * מקור אחד לשתי הכניסות — המסלול המלא ומסלול EM-11 — כי זה בדיוק מה
 * שנשמט: כלל "מנהל עבודה — האתר נגזר ממנו" אינו מותנה בחילוץ, וטיוטה בלי
 * אתר שמורה למנהל מערכת ולבעלים (EM-10). טיוטה בלי אתר שנוצרת למנהל
 * עבודה אינה גלויה לשולח שלה עצמו — לא במסך הפנייה, לא בלוח ולא במסנן
 * "פתחתי" — והמייל החוזר מפנה אותו לקישור שיחזיר 404.
 */
function siteOfSender(sender: SenderUser): string | null {
  return sender.role === "SITE_MANAGER" ? sender.siteId : null;
}

/**
 * המסלול של EM-11: תוכן המייל הוא התיאור, ושאר השדות ריקים.
 *
 * "שאר השדות ריקים" מדבר על מה שנקרא מהמייל. האתר של מנהל עבודה אינו
 * נקרא מהמייל אלא נגזר מהמשתמש, ולכן הוא כאן — ובלי שורת `DraftField`,
 * בדיוק כמו במסלול המלא.
 */
function unprocessedValues(body: string, sender: SenderUser): DraftValuesPlan {
  return { ...emptyValues(), siteId: siteOfSender(sender), description: normalizeText(body) };
}

/**
 * מתרגם חילוץ אחד לערכי הטיוטה ולדוח לשולח.
 *
 * **הסדר הוא חלק מהכלל:** בניין מותאם מול האתר שנקבע, ודירה מול הבניין.
 * בלי זה "דירה 12" הייתה מתאימה לדירה 12 של כל בניין בחברה, והקבלן היה
 * נשלח לכתובת אחרת (§2.5).
 *
 * **בטיוטה בלי אתר אין התאמת בניין ודירה כלל** (§7 שורה 66): אין מול מה
 * להתאים, והם מדווחים כחסרים ולא כ"לא נמצאו ברשימה" — השולח אכן כתב
 * אותם, ומה שחסר הוא האתר.
 */
async function planDraft(
  extraction: FieldExtraction,
  envelope: MailEnvelope,
  sender: SenderUser,
  body: string,
): Promise<DraftPlan> {
  const values = emptyValues();
  const filled: DraftFieldName[] = [];
  const report = emptyReport();
  const haystack = `${envelope.subject}\n${body}`;

  const written = (mention: Mention, field: DraftFieldName): string | null =>
    quotedText(mention, field, haystack);

  // ── אתר ──
  if (sender.role === "SITE_MANAGER") {
    // "השולח מנהל עבודה: האתר נגזר ממנו, כמו בפתיחה במערכת" (§2.6 שלב 3).
    // לכן אין כאן התאמה ואין דיווח: מה שכתב על אתר אינו יכול לשנות דבר.
    values.siteId = siteOfSender(sender);
  } else {
    const siteText = written(extraction.site, "SITE");
    if (siteText) {
      const sites = await candidates(db.site.findMany({ select: { id: true, name: true } }));
      values.siteId = resolve("SITE", siteText, matchName(siteText, sites), report, sites);
      if (values.siteId) filled.push("SITE");
    }
  }

  // ── בניין ודירה, בתוך האתר בלבד ──
  if (values.siteId) {
    const buildingText = written(extraction.building, "BUILDING");
    if (buildingText) {
      const buildings = await candidates(
        db.building.findMany({ where: { siteId: values.siteId }, select: { id: true, name: true } }),
      );
      values.buildingId = resolve("BUILDING", buildingText, matchBuilding(buildingText, buildings), report, buildings);
      if (values.buildingId) filled.push("BUILDING");
    }

    if (values.buildingId) {
      const apartmentText = written(extraction.apartment, "APARTMENT");
      if (apartmentText) {
        const rows = await db.apartment.findMany({
          where: { buildingId: values.buildingId },
          select: { id: true, number: true },
        });
        const apartments = rows.map((row) => ({ id: row.id, label: row.number }));
        values.apartmentId = resolve(
          "APARTMENT",
          apartmentText,
          matchApartment(apartmentText, apartments),
          report,
          // רשימת הדירות אינה נשלחת לשולח (EM-L02) — כ-50 באתר
          null,
        );
        if (values.apartmentId) filled.push("APARTMENT");
      }
    }
  }

  // ── חדר ──
  // החדר חוזר מהמחלץ כערך של הספירה (`Room`) ולא כטקסט, ולכן אין כאן
  // התאמה (`matchRoom` משרת את מי שקורא טקסט חופשי). הוא גם אינו שדה חובה
  // ואינו מדווח כ"לא נמצא": ערך שאינו ברשימה הסגורה פשוט לא נכתב.
  if (extraction.room.value && extraction.room.source !== "none") {
    values.room = extraction.room.value;
    filled.push("ROOM");
  }

  // ── תחום ──
  const domainText = written(extraction.domain, "DOMAIN");
  if (domainText) {
    const domains = await candidates(db.domain.findMany({ select: { id: true, name: true } }));
    values.domainId = resolve("DOMAIN", domainText, matchName(domainText, domains), report, domains);
    if (values.domainId) filled.push("DOMAIN");
  }

  // ── תיאור ──
  // `set` בלבד: מייל ראשון פותח תיאור, ו-`append`/`replace` הם של תשובה.
  if (extraction.description.op === "set") {
    const description = normalizeText(extraction.description.text);
    if (description) {
      values.description = description;
      filled.push("DESCRIPTION");
    }
  }

  // ── נמענים ──
  const recipients = await resolveRecipients(extraction, report, haystack);
  if (recipients.length > 0) {
    values.recipients = recipients;
    filled.push("RECIPIENTS");
  }

  return { values, filled, report };
}

/**
 * הערך כפי שנכתב, או null כשאין לקחת אותו.
 *
 * **שומר מפני הזיה** (S0 ממצא 3): ערך שסומן `source: "text"` ואינו מופיע
 * מילה במילה בכותרת או בגוף נזרק. ערך מקובץ מצורף אינו נבדק — אין לו טקסט
 * להשוות אליו.
 */
function quotedText(mention: Mention, field: DraftFieldName, haystack: string): string | null {
  if (mention.source === "none" || mention.text.trim() === "") return null;
  if (mention.source === "text" && !mentionedIn(mention.text, haystack)) {
    logWarn("email.extraction.dropped_unquoted", { field, chars: mention.text.length });
    return null;
  }
  return mention.text;
}

async function candidates(query: Promise<{ id: string; name: string }[]>): Promise<Candidate[]> {
  return (await query).map((row) => ({ id: row.id, label: row.name }));
}

/**
 * מזהה אחד, או null + שורה בדוח.
 *
 * "לא נמצא" ו"כמה התאמות" אינם כשל אלא **מידע לשולח** (EM-07, EM-08):
 * המערכת אינה יוצרת רשומה ואינה מנחשת, והמייל החוזר אומר מה נכתב ומה
 * קיים. `options` נמסר רק לשדות שרשימתם קצרה מספיק למייל (EM-L02).
 */
function resolve(
  field: DraftFieldName,
  writtenText: string,
  result: MatchResult<Candidate>,
  report: IntakeReport,
  options: readonly Candidate[] | null,
): string | null {
  if (result.kind === "match") return result.candidate.id;

  if (result.kind === "ambiguous") {
    const item: AmbiguousItem = {
      field,
      written: writtenText,
      // תוויות ייחודיות: איש מקצוע ומשתמש יכולים לשאת אותו שם, ושורה
      // שאומרת לשולח `כתבת "יוסי" — יוסי לוי, יוסי לוי` אינה עוזרת לו
      // לבחור. העמימות עצמה נשארת — אף רשומה לא נבחרה
      matches: [...new Set(result.candidates.map((candidate) => candidate.label))],
    };
    report.ambiguous.push(item);
    return null;
  }

  const item: NotFoundItem = {
    field,
    written: writtenText,
    options: options ? options.map((candidate) => candidate.label) : null,
  };
  report.notFound.push(item);
  return null;
}

/**
 * מאגר המועמדים לנמענים — אנשי מקצוע ומשתמשים **ברשימה אחת**: השולח כתב
 * שם, ולא "קבלן" או "משתמש". שם שמתאים לשניהם הוא עמימות אמיתית (EM-08)
 * ולא ברירה שרירותית לפי סוג הרשומה.
 *
 * מקור אחד למייל ראשון (`resolveRecipients`) ולתשובה (`resolveRecipientsProposal`,
 * S7) — שתיהן צריכות בדיוק אותו מאגר, ובנייתו פעמיים הייתה מסתכנת בהבדל
 * שקט (למשל שכחת `active: true`) בין שני המסלולים.
 */
async function recipientPool(client: Tx | typeof db = db): Promise<(Candidate & { ref: RecipientRef })[]> {
  const [professionals, users] = await Promise.all([
    client.professional.findMany({ where: { active: true }, select: { id: true, name: true } }),
    client.user.findMany({ where: { active: true }, select: { id: true, name: true } }),
  ]);

  return [
    ...professionals.map((row) => ({
      id: `professional:${row.id}`,
      label: row.name,
      ref: { kind: "professional" as const, id: row.id },
    })),
    ...users.map((row) => ({
      id: `user:${row.id}`,
      label: row.name,
      ref: { kind: "user" as const, id: row.id },
    })),
  ];
}

/**
 * מתאים רשימת אזכורים (מה שהמחלץ החזיר ב-`recipients.add` או ב-`recipients.remove`)
 * לנמענים קיימים במאגר. הליבה המשותפת של הוספה והסרה — ראה `recipientPool`.
 */
function matchRecipientRefs(
  mentions: readonly Mention[],
  pool: readonly (Candidate & { ref: RecipientRef })[],
  report: IntakeReport,
  haystack: string,
): RecipientRef[] {
  const wanted = mentions
    .map((mention) => quotedText(mention, "RECIPIENTS", haystack))
    .filter((text): text is string => text !== null);

  const chosen: RecipientRef[] = [];
  for (const writtenText of wanted) {
    const result = matchName(writtenText, pool);
    if (result.kind === "match") {
      const { ref } = result.candidate;
      // שם שנכתב פעמיים הוא הדגשה, לא שני נמענים
      if (!chosen.some((item) => item.kind === ref.kind && item.id === ref.id)) chosen.push(ref);
      continue;
    }
    resolve("RECIPIENTS", writtenText, result, report, null);
  }
  return chosen;
}

/**
 * הנמענים שהמייל ביקש להוסיף (מייל ראשון).
 *
 * `remove` אינו מטופל כאן — אין ממה להסיר במייל שפותח טיוטה. ההסרה שייכת
 * לתשובה בשרשרת (§5.ה4, `resolveRecipientsProposal`).
 */
async function resolveRecipients(
  extraction: FieldExtraction,
  report: IntakeReport,
  haystack: string,
): Promise<DraftRecipient[]> {
  if (extraction.recipients.add.length === 0) return [];
  const pool = await recipientPool();
  const refs = matchRecipientRefs(extraction.recipients.add, pool, report, haystack);
  return refs.map((ref) => ({ ...ref, origin: "EMAIL" as const, removedBySystemAt: null }));
}

/**
 * הצעת הנמענים של תשובה — הוספה **והסרה** (§5.ה4), כ-`RecipientsProposal`
 * שמנוע המיזוג (`merge.ts`) מכריע לפיו לכל נמען בנפרד. `undefined` כשהמייל
 * לא הזכיר אף נמען — כדי ש-`mergeEmailIntoDraft` לא יראה בכך "הרשימה ריקה".
 */
async function resolveRecipientsProposal(
  extraction: FieldExtraction,
  report: IntakeReport,
  haystack: string,
  client: Tx | typeof db = db,
): Promise<RecipientsProposal | undefined> {
  if (extraction.recipients.add.length === 0 && extraction.recipients.remove.length === 0) return undefined;
  const pool = await recipientPool(client);
  const add = matchRecipientRefs(extraction.recipients.add, pool, report, haystack);
  const remove = matchRecipientRefs(extraction.recipients.remove, pool, report, haystack);
  if (add.length === 0 && remove.length === 0) return undefined;
  return { add, remove };
}

// ─────────────────────────────── קבצים מצורפים ───────────────────────────────

/** חלק אחד אחרי הורדה וסיווג — מה שהטרנזאקציה תכתוב ממנו */
interface PreparedPart {
  part: MailPart;
  /** הסוג **שנפתר** (`classifyAttachment`), ולא מה שהוצהר */
  mimeType: string;
  isMedia: boolean;
  bytes: Buffer | null;
  sha256: string | null;
  storageKey: string | null;
  /** למה הקובץ אינו נכנס לטיוטה. null — הוא כן נכנס. */
  skippedReason: string | null;
}

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
): Promise<{ deferred: false; parts: PreparedPart[] } | { deferred: true; outcome: EmailIntakeOutcome }> {
  const prepared: PreparedPart[] = [];

  for (const part of envelope.parts) {
    const declared = classifyAttachment({ filename: part.filename, mimeType: part.mimeType }, null);

    if (part.sizeBytes > MAX_FILE_BYTES) {
      prepared.push(skipped(part, declared.mimeType, declared.isMedia, "too-large"));
      continue;
    }

    const needsBytes = declared.isMedia || declared.mimeType === "application/octet-stream";
    if (!needsBytes) {
      prepared.push(skipped(part, declared.mimeType, false, declared.isTnef ? "tnef" : "not-media"));
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
      prepared.push(skipped(part, declared.mimeType, declared.isMedia, "download-failed"));
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

function skipped(part: MailPart, mimeType: string, isMedia: boolean, reason: string): PreparedPart {
  return { part, mimeType, isMedia, bytes: null, sha256: null, storageKey: null, skippedReason: reason };
}

/**
 * מה נעשה בחלק שהבתים שלו בידינו.
 *
 * מדיה = תמונה, וידאו, אודיו או PDF (§3.1). **גם מדיה אינה נכנסת אם היא
 * מחוץ לרשימת ההיתר של האחסון** — למשל SVG, שהוא מסמך XML שיכול להריץ
 * סקריפט כשהוא מוגש מהדומיין שלנו.
 */
function classifyBytes(
  part: MailPart,
  resolved: { mimeType: string; isMedia: boolean; isTnef: boolean },
  bytes: Buffer,
): PreparedPart {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const base: PreparedPart = {
    part,
    mimeType: resolved.mimeType,
    isMedia: resolved.isMedia,
    bytes,
    sha256,
    storageKey: null,
    skippedReason: null,
  };

  if (resolved.isTnef) return { ...base, bytes: null, skippedReason: "tnef" };
  if (!resolved.isMedia) return { ...base, bytes: null, skippedReason: "not-media" };
  if (!isAllowedMimeType(resolved.mimeType)) {
    return { ...base, bytes: null, skippedReason: "unsupported-type" };
  }
  // בתים ריקים נדחים באחסון ממילא (`assertWritableObject`), ורשומת מדיה
  // שמצביעה על כלום גרועה מהיעדרה
  if (bytes.byteLength === 0) return { ...base, bytes: null, skippedReason: "empty" };

  return base;
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
 * כותב את הבתים לאחסון — **לפני** הטרנזאקציה.
 *
 * המפתח דטרמיניסטי (הודעה + מספר חלק), ולא אקראי כמו ב-`buildStorageKey`:
 * ריצה חוזרת אחרי קריסה כותבת לאותו מקום במקום להשאיר עותק יתום נוסף.
 */
async function writeAttachments(
  envelope: MailEnvelope,
  parts: readonly PreparedPart[],
  deps: EmailIntakeDeps,
): Promise<PreparedPart[]> {
  const storage = deps.storage ?? selectStorage();
  const written: PreparedPart[] = [];

  for (const prepared of parts) {
    if (!prepared.bytes || prepared.skippedReason) {
      written.push(prepared);
      continue;
    }
    const key = attachmentStorageKey(envelope, prepared);
    await storage.write(key, prepared.bytes, prepared.mimeType);
    written.push({ ...prepared, storageKey: key });
  }

  return written;
}

function attachmentStorageKey(envelope: MailEnvelope, prepared: PreparedPart): string {
  // מזהה ההודעה נכנס למפתח כפי שהוא, אחרי ניקוי: הוא מגיע משירות חיצוני,
  // והאחסון המקומי פותר מפתח לנתיב על הדיסק
  const source = envelope.sourceId.replace(/[^A-Za-z0-9._-]/g, "_");
  return `media/mail/${source}/${prepared.part.index}.${extensionOf(prepared.mimeType)}`;
}

/** הסיומת נגזרת מהסוג שנפתר — מקור אחד, בלי טבלת המרה שנייה */
function extensionOf(mimeType: string): string {
  const subtype = mimeType.split("/")[1]?.split(";")[0]?.replace(/[^a-z0-9]/gi, "").toLowerCase() ?? "";
  return subtype || "bin";
}

/**
 * הודעת המדיה בשרשור, ורשומת `MediaFile` לכל קובץ שנכנס לטיוטה.
 *
 * הודעה אחת לכל הקבצים ולא הודעה לקובץ, כמו ב-`attachInitialMedia`:
 * השולח תיאר אירוע אחד. `uploaded: true` כי הבתים כבר באחסון — כאן אין
 * דפדפן שעלול להיקטע באמצע.
 */
async function writeMedia(
  tx: Tx,
  ticketId: string,
  authorUserId: string,
  parts: readonly PreparedPart[],
): Promise<Map<number, string>> {
  const created = new Map<number, string>();
  const media = parts.filter((part) => part.storageKey !== null);
  if (media.length === 0) return created;

  const message = await tx.message.create({
    data: { ticketId, kind: "MEDIA", authorUserId },
    select: { id: true },
  });

  for (const part of media) {
    const file = await tx.mediaFile.create({
      data: {
        messageId: message.id,
        storageKey: part.storageKey as string,
        mimeType: part.mimeType,
        sizeBytes: part.bytes?.byteLength ?? part.part.sizeBytes,
        originalName: part.part.filename,
        uploaderUserId: authorUserId,
        uploaded: true,
      },
      select: { id: true },
    });
    created.set(part.part.index, file.id);

    const jobType = aiJobFor(part.mimeType);
    if (jobType) await enqueue(tx, jobType, { mediaId: file.id });
    // בלי סוג מתאים (וידאו) הרשומה מסומנת מיד כמדולגת ולא נשארת "ממתינה"
    // לנצח — הממשק היה מציג עליה "קורא את הטקסט…" שלא ייגמר.
    else await tx.mediaFile.update({ where: { id: file.id }, data: { aiStatus: "SKIPPED" } });
  }

  return created;
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
  parts: readonly PreparedPart[],
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

/**
 * איזה עיבוד AI מתאים לקובץ.
 *
 * **שכפול מודע** של `aiJobFor` ב-`services/media.ts`, שאינו מיוצא ואינו
 * קובץ של המודול הזה. שני הכללים חייבים להישאר זהים; ראה הדוח — הפתרון
 * הוא ייצוא אחד משותף.
 */
function aiJobFor(mimeType: string): JobType | null {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base.startsWith("audio/")) return JOB_TYPES.transcribe;
  if (canExtractText(base)) return JOB_TYPES.extract;
  return null;
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

function bodyTextOf(envelope: MailEnvelope): string {
  const text = normalizeText(envelope.text);
  if (text) return text;
  return envelope.html ? normalizeText(htmlToText(envelope.html)) : "";
}
