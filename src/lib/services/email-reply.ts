import type { MailboxMessage } from "@/generated/prisma/client";
import type { MailOutcome } from "@/generated/prisma/enums";
import type { EmailReplyJobPayload } from "@/jobs/types";
import { db } from "@/lib/db";
import { gmailSource } from "@/lib/email-intake/gmail-source";
import { type ComposeIntakeReplyInput, composeIntakeReply } from "@/lib/email-intake/reply/compose";
import { type MailSource, MailSourceError } from "@/lib/email-intake/source";
import type { ReplyKind, ReplyTemplate } from "@/lib/intake/reply-model";
import { env } from "@/lib/env";
import { selectEmailTransport } from "@/lib/notifier/email";
import type { EmailMessage, EmailTransport } from "@/lib/notifier/types";
import { captureError, logInfo, logWarn } from "@/lib/observability/log";
import { REPLY_TICKET_SELECT, type ReplyTicket, draftReplyContent, parseReport, ticketUrl } from "./intake-reply";

/**
 * המייל החוזר לשולח — הצד השני של §2.6 שלב 4: "מייל חוזר תמיד, תוך 5 דקות
 * לכל היותר, באותה שרשרת" (EM-12).
 *
 * **המייל מורכב בזמן השליחה ולא בזמן ההכרעה.** ג׳וב הדואר נושא מזהה בלבד
 * (`jobs/types.ts`), והשירות קורא כאן את הפנייה, את שורות `DraftField` ואת
 * הדיווח שנשמר על ההודעה הנכנסת. הסיבה מעשית: בין הרגע שהמייל נקלט לרגע
 * שהתשובה יוצאת אדם יכול לפתוח את הטיוטה ולערוך אותה, ומייל שהורכב מוקדם
 * היה מתאר לשולח מצב שכבר אינו נכון — בדיוק ההפך מהמטרה של "מה יש בטיוטה
 * עכשיו". מאותה סיבה `IntakeReport` שומר רק מה שאי אפשר לשחזר (מה **המייל
 * הזה** שינה ומה נכתב בו ולא נמצא), והשאר נקרא מחדש.
 *
 * **הניסוח עצמו אינו כאן** אלא ב-`email-intake/reply/compose.ts` (S3), שהוא
 * טהור ומקבל תוויות ולא מזהים, והתיאור של הטיוטה נקרא ב-`intake-reply.ts`,
 * המשותף לכל הערוצים. מה שהשירות מוסיף הוא מה ששייך למייל: בחירת הנמען,
 * שדות השרשור, האידמפוטנטיות מול התיבה, והרישום של מה שקרה בפועל.
 *
 * **מה שנרשם הוא מה שקרה.** ערוץ מדומה נרשם `SIMULATED` ולא `SENT`, מאותו
 * נימוק שבגללו `sendNotification` אינו מסמן `notifiedAt` על ערוץ הקונסולה:
 * מסך שמצהיר "נשלח" על מייל שלא יצא הוא תקלה גרועה יותר מהיעדר שליחה, כי
 * הוא מונע מאדם להרים טלפון.
 */

/** ההבטחה שבאפיון (§2.6 שלב 4), בשניות. מעליה הלוג מסמן שהיא הופרה. */
const LATE_REPLY_SEC = 300;

export interface EmailReplyDeps {
  /** ערוץ השליחה. ברירת המחדל נבחרת לפי הסביבה (`selectEmailTransport`). */
  transport?: EmailTransport;
  /**
   * התיבה, לחיפוש האידמפוטנטיות בלבד. `null` פירושו במפורש "אין תיבה
   * לשאול" — אז ניסיון חוזר נשלח בלי אימות מוקדם.
   */
  mailSource?: MailSource | null;
  /** "עכשיו". פרמטר ולא `new Date()` בפנים, כדי שמדידת ההשהיה תהיה נבדקת. */
  now?: Date;
}

/** למה לא יצא מייל. כל אחד מהם נרשם על השורה היוצאת כ-`SKIPPED` + `detail`. */
export type EmailReplySkipReason =
  | "dispatched"
  | "deleted"
  | "no-recipient"
  | "no-inbound"
  | "no-sender-name"
  | "outcome";

export type EmailReplyOutcome =
  | {
      status: "sent";
      template: ReplyTemplate;
      to: string;
      via: string;
      /** הערוץ רק כתב ללוג — ראה `EmailTransport.simulated` */
      simulated: boolean;
      latencySec: number | null;
    }
  /** ההודעה כבר בתיבה: היא יצאה בניסיון קודם, והתשובה עליו אבדה */
  | { status: "found-in-mailbox"; to: string }
  | { status: "skipped"; reason: EmailReplySkipReason }
  | { status: "noop"; reason: "missing" | "not-pending" };

/**
 * ה-`Message-ID` של המייל היוצא — **נגזר ממזהה השורה, ולכן זהה בכל ניסיון**.
 *
 * זו הצלע השנייה של האידמפוטנטיות, לצד `repliesToId` הייחודי: `repliesToId`
 * מונע שורה יוצאת שנייה, והמזהה הקבוע הוא מה שמאפשר **לשאול את התיבה** אם
 * ההודעה כבר שם. מזהה אקראי בכל ניסיון היה הופך "האם שלחתי?" לשאלה שאין
 * עליה תשובה, והבחירה הייתה בין מייל כפול לבין שתיקה.
 *
 * הדומיין הוא זה של כתובת המערכת (`APP_BASE_URL`) ולא של Gmail: לפי RFC 5322
 * החלק הימני של המזהה הוא דומיין שהשולח מחזיק, ו-`gmail.com` משותף לכל העולם.
 */
export function intakeReplyMessageId(outboundId: string): string {
  return `yy-${outboundId}@${messageIdHost()}`;
}

function messageIdHost(): string {
  try {
    return new URL(env.appBaseUrl()).hostname;
  } catch {
    // כתובת בסיס חסרה או פגומה אינה סיבה לא לשלוח מייל. המזהה נשאר תקף
    // וקבוע, ורק נראה פחות טוב.
    return "localhost";
  }
}

/**
 * שולח את המייל החוזר על הודעה נכנסת אחת.
 *
 * `mailboxMessageId` הוא **השורה היוצאת** (`jobs/types.ts`), אך גם מזהה של
 * ההודעה הנכנסת מתקבל ומתורגם לשורה היוצאת שלה. הסובלנות הזו זולה ומונעת
 * את הכשל שאין עליו סימן: ג׳וב שנוצר עם המזהה השני היה נכשל על "שורה לא
 * נמצאה" בזמן שהשורה קיימת.
 */
export async function sendEmailReply(
  { mailboxMessageId }: EmailReplyJobPayload,
  deps: EmailReplyDeps = {},
): Promise<EmailReplyOutcome> {
  const now = deps.now ?? new Date();
  const pair = await loadPair(mailboxMessageId);

  if (!pair?.outbound) {
    // אין שורה יוצאת: הג׳וב מצביע על משהו שאינו קיים עוד. לא כשל — פנייה
    // שנמחקה גוררת איתה את ההתכתבות.
    logWarn("email.reply.missing", { mailboxMessageId });
    return { status: "noop", reason: "missing" };
  }

  const { outbound, inbound } = pair;
  // ההגנה הראשונה מפני שליחה כפולה, והזולה שבהן: ג׳וב שרץ פעמיים (תפיסה
  // כפולה, ניסיון חוזר אחרי הצלחה) מוצא שורה שכבר הוכרעה ויוצא.
  if (outbound.state !== "PENDING") return { status: "noop", reason: "not-pending" };

  if (!inbound) {
    return skip(outbound, "no-inbound", "לשורה היוצאת אין הודעה נכנסת (`repliesToId`) — אי אפשר לנסח תשובה", true);
  }

  const kind = replyKindOf(inbound.outcome);
  if (!kind) {
    // הכרעה שאין עליה מענה — IGNORED_*, GONE, או שורה שלא הוכרעה. אסור
    // לשלוח (EM-03, EM-L10: מענה לזר מאשר לו שמישהו קורא את התיבה), וגם
    // אסור לשתוק בלי סימן: שורה יוצאת כזו לא הייתה אמורה להיווצר.
    return skip(outbound, "outcome", `אין נוסח מייל להכרעה ${inbound.outcome ?? "ללא"}`, true);
  }

  const recipient = inbound.fromAddress;
  if (!recipient) {
    return skip(outbound, "no-recipient", "להודעה הנכנסת אין כתובת שולח", true);
  }

  const ticket = await loadTicket(inbound.threadId ?? outbound.threadId);

  // §7 שורה 77 (EM-A08): הטיוטה שוגרה או נמחקה בין ההכרעה לשליחה. המייל
  // מתאר "מה יש בטיוטה עכשיו", וטיוטה שכבר אינה קיימת הופכת אותו לשגוי
  // ברגע שהוא יוצא. **הכלל חל רק על הנוסחים שמתארים את הטיוטה**: "כבר
  // נשלחה" ו"נמחקה" הם בדיוק המענה על המצב הזה, ו"אין הרשאה"/"אינך משויך
  // לאתר" אינם נוגעים בה כלל.
  if (kind === "DRAFT") {
    if (!ticket) return skip(outbound, "deleted", `הטיוטה נמחקה בין ההכרעה לשליחה ${SKIPPED_AFTER_CLOSE}`);
    if (!ticket.isDraft) return skip(outbound, "dispatched", `הטיוטה שוגרה בין ההכרעה לשליחה ${SKIPPED_AFTER_CLOSE}`);
  }
  // "פנייה #[מספר] כבר נשלחה" (EM-L05) דורש מספר וקישור; בלי הפנייה אין מה
  // לומר, והמצב הוא אותו מצב של שורה 77 — היא נמחקה אחרי השיגור.
  if (kind === "AFTER_DISPATCH" && !ticket) {
    return skip(outbound, "deleted", `הפנייה ששוגרה נמחקה לפני שהמייל יצא ${SKIPPED_AFTER_CLOSE}`);
  }
  // "אפשר לפנות ל[שם השולח]" (EM-L08) — בלי השם המשפט נשבר, ו-`compose`
  // זורק. עדיף לדלג ברעש מאשר להפיל את הג׳וב שוב ושוב.
  const senderName = ticket?.createdBy.name ?? "";
  if (kind === "NOT_PERMITTED" && !senderName.trim()) {
    return skip(outbound, "no-sender-name", "אין שם לשולח המקורי לנוסח EM-L08", true);
  }

  const input = await composeInput({ kind, inbound, ticket, senderName });
  const composed = composeIntakeReply(input);

  const messageId = intakeReplyMessageId(outbound.id);
  // המונה עולה **לפני** השליחה, ולא אחרי: תהליך שנפל בין הקריאה היוצאת לבין
  // רישום התוצאה חייב להיראות בניסיון הבא כניסיון שני, אחרת החיפוש בתיבה
  // לא ירוץ בדיוק במקרה שבשבילו הוא קיים.
  await db.mailboxMessage.update({ where: { id: outbound.id }, data: { attempts: { increment: 1 } } });

  if (outbound.attempts > 0) {
    const source = deps.mailSource === undefined ? defaultMailSource() : deps.mailSource;
    const existing = source ? await findInMailbox(source, messageId, outbound.id) : null;
    if (existing) {
      await db.mailboxMessage.update({
        where: { id: outbound.id },
        data: {
          state: "SENT",
          sentAt: now,
          toAddress: recipient,
          subject: composed.subject,
          rfcMessageId: messageId,
          gmailMessageId: existing,
          nextAttemptAt: null,
          detail: "נמצא בתיבה מניסיון קודם — לא נשלח שוב",
        },
      });
      logWarn("email.reply.recovered", { mailboxMessageId: outbound.id, gmailMessageId: existing });
      return { status: "found-in-mailbox", to: recipient };
    }
  }

  const transport = deps.transport ?? selectEmailTransport();
  const message: EmailMessage = {
    to: recipient,
    subject: composed.subject,
    text: composed.text,
    html: composed.html,
    messageId,
    // שדות השרשור מגיעים מההודעה הנכנסת ולא מהטיוטה: "באותה שרשרת" הוא
    // מושג של המייל, והשרשרת היא זו שההודעה הזו הגיעה בה.
    ...(inbound.rfcMessageId ? { inReplyTo: inbound.rfcMessageId } : {}),
    references: referencesFor(inbound),
    ...(inbound.gmailThreadId ? { threadId: inbound.gmailThreadId } : {}),
    // הכותרות שמונעות מ"מחוץ למשרד" של הנמען לענות למענה שלנו (§5.ה3 כלל 7)
    autoReply: true,
  };

  let result;
  try {
    result = await transport.send(message);
  } catch (error) {
    // השורה נשארת PENDING: כשל שליחה אינו הכרעה, והג׳וב יחזור. מה שנשמר
    // הוא הסיבה, כדי שההתכתבות תראה למה התשובה מתעכבת.
    await db.mailboxMessage.update({
      where: { id: outbound.id },
      data: { detail: `שליחה נכשלה: ${errorText(error)}` },
    });
    throw error;
  }

  const simulated = transport.simulated === true;
  const latencySec = inbound.receivedAt
    ? Math.round((now.getTime() - inbound.receivedAt.getTime()) / 1000)
    : null;

  await db.mailboxMessage.update({
    where: { id: outbound.id },
    data: {
      state: simulated ? "SIMULATED" : "SENT",
      sentAt: now,
      toAddress: recipient,
      subject: composed.subject,
      // ביוצא `bodyText` הוא "מה שנשלח" — גרסת הטקסט, שהיא זו שנקראת
      // בהתכתבות. ה-HTML הוא אותו תוכן בעטיפה, ואין טעם לשמור אותו פעמיים.
      bodyText: composed.text,
      // מה ש**יצא** ולא מה שביקשנו: Gmail רשאי לכתוב מזהה משלו, ומי ששומר
      // את הבקשה לא ימצא את התשובה שתגיע עליה (EM-14).
      rfcMessageId: result.messageId ?? messageId,
      ...(simulated ? {} : { gmailMessageId: result.id ?? null }),
      gmailThreadId: result.threadId ?? inbound.gmailThreadId,
      nextAttemptAt: null,
      detail: null,
    },
  });

  logInfo("email.reply.sent", {
    mailboxMessageId: outbound.id,
    ticketId: ticket?.id ?? null,
    template: composed.template,
    via: transport.name,
    simulated,
    latencySec,
  });

  // ההבטחה אינה מוצהרת אלא נמדדת: בלי הלוג הזה החמרה הדרגתית מחמש דקות
  // לחצי שעה לא הייתה נראית לאיש (MONITORING.md §3).
  if (latencySec !== null && latencySec > LATE_REPLY_SEC) {
    logWarn("email.reply.late", {
      mailboxMessageId: outbound.id,
      ticketId: ticket?.id ?? null,
      latencySec,
      limitSec: LATE_REPLY_SEC,
    });
  }

  return { status: "sent", template: composed.template, to: recipient, via: transport.name, simulated, latencySec };
}

/**
 * מסמן שהמייל החוזר **הפסיק לנסות** — נקרא רק אחרי שנגמרו הניסיונות.
 *
 * מבנה זהה ל-`markNotifyFailed` ול-`markAiFailed`, ומאותו נימוק: השירות
 * זורק, והעטיפה ב-worker היא זו שיודעת אם זה היה הניסיון האחרון
 * (`job.attempts >= MAX_ATTEMPTS`). ניסיון שנכשל יחזור בעוד דקה, ואין טעם
 * לקבוע עובדה על מה שייפתר לבדו.
 *
 * **למה השורה חייבת מצב סופי בכלל.** לשורה **יוצאת** אין מסלול חזרה לתור:
 * סריקת התקועים (`services/email-poll.ts`) מסוננת לנכנס בלבד, ולכן שורה
 * שנשארה PENDING אחרי שהג׳וב מת נשארת כך לתמיד. מאותו רגע היא נספרת
 * ב-invariant `email-intake-not-stuck` בכל ריצה של ה-watchdog, כל שש שעות,
 * בלי שום דרך לסגור — ואזעקה שאי אפשר לסגור נלמדת להתעלם ממנה, בדיוק
 * הנימוק שכתוב ב-`watchdog/predicates.ts` להפוך את `jobs-not-failing`
 * לחלון. תקלה רגעית מול Gmail אינה מחיר סביר לשחיקת הגלאי כולו.
 *
 * הכתיבה מותנית ב-PENDING: ניסיון שהצליח ונפל אחריו (כשל אחרי `send`
 * שהתקבל) לא יידרס ל-FAILED, ומה שנרשם ממשיך להיות מה שקרה. העטיפה
 * ב-try/catch היא זו של `markNotifyFailed` — כשל בעדכון החיווי אינו אמור
 * להחליף את סיבת הכשל המקורית, שהיא מה שצריך להגיע ל-Sentry.
 */
export async function markReplyFailed({ mailboxMessageId }: EmailReplyJobPayload, error: unknown): Promise<void> {
  try {
    const outbound = (await loadPair(mailboxMessageId))?.outbound;
    if (!outbound) return;

    const { count } = await db.mailboxMessage.updateMany({
      where: { id: outbound.id, state: "PENDING" },
      data: { state: "FAILED", detail: `מיצה את הניסיונות: ${errorText(error)}`, nextAttemptAt: null },
    });
    if (count === 0) return;

    logWarn("email.reply.failed", { mailboxMessageId: outbound.id, error: errorText(error) });
  } catch (markError) {
    captureError(markError, {
      tags: { mailboxMessageId, phase: "email-reply-mark-failed" },
      fingerprint: ["email-reply-mark-failed-failed"],
    });
  }
}

// ─────────────────────────────── טעינה ───────────────────────────────

/** ההודעה הנכנסת, עם שם המשתמש שזוהה כשולח */
type InboundRow = MailboxMessage & { authorUser: { name: string } | null };

/**
 * השורה היוצאת וההודעה הנכנסת שהיא עונה לה — משני כיווני הקשר.
 *
 * הקשר `repliesToId` ייחודי, ולכן לכל הודעה נכנסת יש לכל היותר תשובה אחת:
 * זו האידמפוטנטיות ברמת הסכימה, ולא צריך לבדוק אותה כאן.
 */
async function loadPair(id: string): Promise<{ outbound: MailboxMessage | null; inbound: InboundRow | null } | null> {
  const row = await db.mailboxMessage.findUnique({
    where: { id },
    include: {
      authorUser: { select: { name: true } },
      repliesTo: { include: { authorUser: { select: { name: true } } } },
      reply: true,
    },
  });
  if (!row) return null;
  return row.direction === "OUTBOUND"
    ? { outbound: row, inbound: row.repliesTo }
    : { outbound: row.reply, inbound: row };
}

/**
 * הפנייה שההתכתבות מוצמדת לה, או null כשאין כזו.
 *
 * מחיקת פנייה מאפסת את `MailThread.ticketId` (`onDelete: SetNull`), ולכן
 * "אין פנייה" הוא בדיוק הסימן לטיוטה שנמחקה — וההתכתבות עצמה שורדת כתיעוד.
 */
async function loadTicket(threadId: string | null): Promise<ReplyTicket | null> {
  if (!threadId) return null;
  const thread = await db.mailThread.findUnique({ where: { id: threadId }, select: { ticketId: true } });
  if (!thread?.ticketId) return null;
  return db.ticket.findUnique({ where: { id: thread.ticketId }, select: REPLY_TICKET_SELECT });
}

// ─────────────────────────── מהכרעה לנוסח ───────────────────────────

/**
 * ההכרעה על ההודעה הנכנסת → סוג המייל החוזר. `null` = **לא נשלח מייל**.
 *
 * `switch` ממצה בלי `default`, כדי שהכרעה חדשה ב-`MailOutcome` תפיל את
 * הקומפילציה ותידרש להחליט. השתיקה היא ההתנהגות המסוכנת כאן: הכרעה חדשה
 * שתיפול ל-`default` הייתה או שולחת מייל שגוי או בולעת מייל שחייב לצאת.
 */
function replyKindOf(outcome: MailOutcome | null): ReplyKind | null {
  switch (outcome) {
    case "NO_SITE":
      return "NO_SITE";
    case "REPLY_NOT_PERMITTED":
      return "NOT_PERMITTED";
    case "REPLY_AFTER_DISPATCH":
      return "AFTER_DISPATCH";
    case "REPLY_AFTER_DELETION":
      return "AFTER_DELETION";
    case "DRAFT_CREATED":
    case "DRAFT_CREATED_UNPROCESSED":
    case "REPLY_APPLIED":
    case "REPLY_STORED_UNPROCESSED":
      return "DRAFT";
    // EM-L10 — על אלה לא נשלח מייל בשום מצב
    case "IGNORED_BEFORE_ACTIVATION":
    case "IGNORED_OWN_MESSAGE":
    case "IGNORED_AUTO_REPLY":
    case "IGNORED_UNAUTHORIZED":
    case "IGNORED_SUBJECT":
    case "GONE":
    case null:
      return null;
  }
}

/** תשובה בשרשרת, להבדיל ממייל ראשון — קובע את L07 ואת "עודכן מהתשובה שלך" */
function isReplyOutcome(outcome: MailOutcome | null): boolean {
  return outcome !== null && outcome.startsWith("REPLY_");
}

/** §2.6 שלב 3 — החילוץ לא היה זמין, והטיוטה נשמרה בלי פרטים (EM-11, EM-L07) */
function isUnprocessed(outcome: MailOutcome | null): boolean {
  return outcome === "DRAFT_CREATED_UNPROCESSED" || outcome === "REPLY_STORED_UNPROCESSED";
}

/** אוסף את מה שהניסוח הטהור צריך — הכול נקרא **עכשיו**, לא בזמן ההכרעה */
async function composeInput(args: {
  kind: ReplyKind;
  inbound: InboundRow;
  ticket: ReplyTicket | null;
  senderName: string;
}): Promise<ComposeIntakeReplyInput> {
  const { kind, inbound, ticket, senderName } = args;
  const base: ComposeIntakeReplyInput = {
    kind,
    // השם מהמערכת קודם לשם התצוגה בכותרת המייל: הוא מה שהשולח רואה בכל
    // מקום אחר במערכת, ושם תצוגה נקבע בלקוח הדואר ולעתים אינו שם כלל.
    recipientName: inbound.authorUser?.name ?? inbound.fromName ?? "",
    originalSubject: inbound.subject ?? "",
    isReply: isReplyOutcome(inbound.outcome),
  };

  switch (kind) {
    case "NO_SITE":
    case "AFTER_DELETION":
      return base;
    case "NOT_PERMITTED":
      return { ...base, senderName };
    case "AFTER_DISPATCH":
      return { ...base, ticketSeq: ticket?.seq, ticketLink: ticket ? ticketUrl(ticket.id) : undefined };
    case "DRAFT": {
      if (!ticket) throw new Error("sendEmailReply: נוסח טיוטה בלי פנייה");
      return {
        ...base,
        extractionUnavailable: isUnprocessed(inbound.outcome),
        ...(await draftReplyContent(ticket)),
        report: parseReport(inbound.report, inbound.id) ?? undefined,
      };
    }
  }
}

// ─────────────────────────── שליחה ואידמפוטנטיות ───────────────────────────

/**
 * `References` של התשובה: אלה של ההודעה שעליה עונים, ואחריהן המזהה שלה
 * (RFC 5322 §3.6.4). לקוח דואר בונה מהן את עץ השיחה כשה-`In-Reply-To` לבדו
 * אינו מספיק.
 */
function referencesFor(inbound: MailboxMessage): string[] {
  const ids = [...inbound.referenceIds, inbound.rfcMessageId].filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}

/**
 * ברירת המחדל לחיפוש בתיבה: אותו טוקן שממנו קוראים דואר. בסביבה שאין בה
 * טוקן (פיתוח, בדיקות) אין מה לשאול, ואין כאן כשל — ממילא לא יצא מייל אמיתי
 * שאפשר לשלוח פעמיים.
 */
function defaultMailSource(): MailSource | null {
  const config = env.gmailApi();
  return config ? gmailSource(config) : null;
}

/**
 * האם ההודעה שלנו כבר בתיבה — `rfc822msgid:` על המזהה הקבוע.
 *
 * למה זה קיים: Gmail יכול לקבל את השליחה ולאבד את התשובה (פסק זמן, ניתוק).
 * מבחינת התהליך שלנו זה כשל, והניסיון הבא היה שולח מייל שני לאותו אדם על
 * אותה טיוטה. השאלה הזו היא ההוכחה שאין דרך אחרת להשיג: השורה אצלנו אינה
 * יודעת מה קרה בצד השני.
 *
 * **כשל בחיפוש אינו מכריע במקומנו.** כשל חולף (5xx, הגבלת קצב) מוחזר
 * לקורא, והג׳וב ינסה שוב — עדיפה תשובה מאוחרת על תשובה כפולה. כשל שלא
 * ייפתר מעצמו (היקף חסר, טוקן שנשלל, בקשה שגויה) מדווח וממשיך לשליחה:
 * חיבור קריאה שבור לצמיתות אינו יכול לחסום את כל המיילים החוזרים.
 */
async function findInMailbox(source: MailSource, messageId: string, outboundId: string): Promise<string | null> {
  try {
    const { ids } = await source.listIds(`rfc822msgid:${messageId}`);
    return ids[0] ?? null;
  } catch (error) {
    if (error instanceof MailSourceError && error.kind === "transient") throw error;
    captureError(error, {
      tags: { mailboxMessageId: outboundId, phase: "email-reply-lookup" },
      fingerprint: ["email-reply-lookup-failed"],
    });
    return null;
  }
}

/**
 * רושם על השורה היוצאת שלא נשלח מייל, ולמה.
 *
 * `SKIPPED` ולא `FAILED`: אין כאן ניסיון שנגמר אלא החלטה. ה-`detail` הוא
 * אבחון — הוא מתעד בהתכתבות מה קרה (§7 שורה 77), ואינו נוסח שמוצג לשולח,
 * שהרי לשולח לא יצא דבר.
 *
 * `bug` מסמן מצב שלא היה אמור להיווצר (שורה יוצאת להכרעה שאין עליה מענה,
 * הודעה נכנסת בלי כתובת). הוא שקט מדי מכדי להישאר רק בשדה במסד.
 */
/**
 * הסימון בסוף `detail` של מייל חוזר שדולג כי הטיוטה שוגרה או נמחקה לפני
 * שיצא (§7 שורה 77). ההתכתבות (`email-correspondence.ts`) מזהה לפיו את
 * הדילוג הצפוי ומבדילה אותו מדילוג מסיבה אחרת — שלושת המקומות כאן הם היחידים
 * שכותבים אותו.
 */
export const SKIPPED_AFTER_CLOSE = "(§7 שורה 77)";

async function skip(
  outbound: MailboxMessage,
  reason: EmailReplySkipReason,
  detail: string,
  bug = false,
): Promise<EmailReplyOutcome> {
  await db.mailboxMessage.update({
    where: { id: outbound.id },
    data: { state: "SKIPPED", detail, nextAttemptAt: null },
  });
  logWarn("email.reply.skipped", { mailboxMessageId: outbound.id, reason });
  if (bug) {
    captureError(new Error(`email-reply: ${detail}`), {
      tags: { mailboxMessageId: outbound.id, reason },
      fingerprint: ["email-reply-skipped", reason],
    });
  }
  return { status: "skipped", reason };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
