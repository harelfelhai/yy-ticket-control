import type { Prisma } from "@/generated/prisma/client";
import type { WaOutcome } from "@/generated/prisma/enums";
import type { WaReplyJobPayload } from "@/jobs/types";
import { db } from "@/lib/db";
import type { IntakeReplyInput, ReplyKind, ReplyTemplate } from "@/lib/intake/reply-model";
import { captureError, logInfo, logWarn } from "@/lib/observability/log";
import type { WaApi } from "@/lib/whatsapp/api";
import { WINDOW_CLOSED_CODE, WaApiError } from "@/lib/whatsapp/errors";
import { composeWhatsappReply } from "@/lib/whatsapp/render";
import type { WaRecipient } from "@/lib/whatsapp/send";
import {
  REPLY_TICKET_SELECT,
  type ReplyTicket,
  SKIPPED_AFTER_CLOSE,
  draftReplyContent,
  parseReport,
  ticketUrl,
} from "./intake-reply";
import { waApiForNumber } from "./wa-client";
import { reportWaIssue } from "./wa-number";

/**
 * הודעת האישור לשולח בוואטסאפ — §2.7 שלב 4: "תמיד, תוך 5 דקות מההודעה האחרונה
 * בדיווח, באותו צ'אט, כתגובה להודעה האחרונה שלו" (WA-08).
 *
 * **ההודעה מורכבת בזמן השליחה ולא בזמן ההכרעה**, בדיוק כמו המייל החוזר
 * (`email-reply.ts`): הג׳וב נושא מזהה בלבד, והטיוטה נקראת עכשיו — בין ההכרעה לשליחה
 * אדם יכול היה לערוך אותה. הניסוח ב-`whatsapp/render.ts`, והתיאור של הטיוטה ב-
 * `intake-reply.ts`, המשותף לשני הערוצים.
 *
 * **`context.message_id` הוא מה שמחבר את השיחה.** ההודעה יוצאת כתגובה להודעה
 * האחרונה בדיווח, וה-wamid שלה נשמר: תגובה (Reply) עליה חוזרת לטיוטה (§2.7 שלב 5).
 *
 * **"לפחות פעם אחת".** ל-Cloud API אין מפתח אידמפוטנטיות ואין דרך לשאול אם הודעה
 * כבר יצאה, ולכן כשל אחרי שהבקשה התקבלה עלול לשלוח אישור שני. אישור כפול נדיר
 * עדיף על אישור שלא נשלח — זה מה שמבדיל לשולח בין "נקלט" ל"לא זוהה".
 *
 * **מחוץ לחלון 24 השעות ההודעה אינה נשלחת בדרך אחרת** (§7 שורה 102): וואטסאפ
 * מתירה שם רק תבנית, שאינה בתחולה. היא מסומנת FAILED עם הקוד של Meta (131047),
 * והשיחה במסך 7 תציג "לא נשלחה" (W8).
 */

/** ההבטחה שבאפיון (§7 שורה 94), בשניות — מעליה הלוג מסמן שהיא הופרה */
const LATE_REPLY_SEC = 300;

/** חלון שירות הלקוחות של וואטסאפ — מההודעה של השולח */
export const SERVICE_WINDOW_MS = 24 * 60 * 60_000;

export interface WaReplyDeps {
  /** וואטסאפ. ברירת המחדל — לפי הטוקן של המספר; בבדיקות מזויף. */
  api?: WaApi;
  now?: Date;
}

/** למה לא יצאה הודעה. כל אחד נרשם על השורה היוצאת כ-`SKIPPED` + `detail`. */
export type WaReplySkipReason = "dispatched" | "deleted" | "no-inbound" | "no-recipient" | "outcome";

export type WaReplyOutcome = { kind: "wa-reply" } & (
  | { status: "sent"; template: ReplyTemplate; latencySec: number | null }
  /** לא נשלחה ולא תישלח: החלון נסגר, המספר נותק, או ש-Meta דחתה אותה לגופה */
  | { status: "failed"; code: number | null }
  | { status: "skipped"; reason: WaReplySkipReason }
  | { status: "noop"; reason: "missing" | "not-pending" }
);

const KIND = "wa-reply" as const;


export async function sendWaReply({ waMessageId }: WaReplyJobPayload, deps: WaReplyDeps = {}): Promise<WaReplyOutcome> {
  const now = deps.now ?? new Date();
  const outbound = await db.waMessage.findUnique({
    where: { id: waMessageId },
    include: {
      repliesTo: { include: { authorUser: { select: { name: true } } } },
      number: { select: { id: true, phoneNumberId: true, tokenCipher: true, status: true } },
    },
  });

  if (!outbound || outbound.direction !== "OUTBOUND") {
    logWarn("wa.reply.missing", { waMessageId });
    return { kind: KIND, status: "noop", reason: "missing" };
  }
  // ההגנה הראשונה מפני שליחה כפולה, והזולה שבהן: ג׳וב שרץ פעמיים מוצא שורה שהוכרעה
  if (outbound.state !== "PENDING") return { kind: KIND, status: "noop", reason: "not-pending" };

  const inbound = outbound.repliesTo;
  if (!inbound) return skip(outbound.id, "no-inbound", "לשורה היוצאת אין הודעה נכנסת (`repliesToId`)", true);

  const kind = replyKindOf(inbound.outcome);
  // הכרעה שאין עליה הודעה (WA-L11) — שורה יוצאת כזו לא הייתה אמורה להיווצר
  if (!kind) return skip(outbound.id, "outcome", `אין נוסח להכרעה ${inbound.outcome ?? "ללא"}`, true);

  const ticket = await loadTicket(inbound.threadId ?? outbound.threadId);
  // §7 שורה 77: הנוסחים שמתארים את הטיוטה אינם נשלחים על טיוטה שכבר אינה טיוטה
  if (kind === "DRAFT") {
    if (!ticket) return skip(outbound.id, "deleted", `הטיוטה נמחקה בין ההכרעה לשליחה ${SKIPPED_AFTER_CLOSE}`);
    if (!ticket.isDraft) return skip(outbound.id, "dispatched", `הטיוטה שוגרה בין ההכרעה לשליחה ${SKIPPED_AFTER_CLOSE}`);
  }
  if (kind === "AFTER_DISPATCH" && !ticket) {
    return skip(outbound.id, "deleted", `הפנייה ששוגרה נמחקה לפני שההודעה יצאה ${SKIPPED_AFTER_CLOSE}`);
  }

  // הטלפון כפי שוואטסאפ מסרה; למי שהסתיר אותו — המזהה (§7 שורה 107)
  const recipient: WaRecipient | null = inbound.waId
    ? { phone: inbound.waId }
    : inbound.bsuid
      ? { bsuid: inbound.bsuid }
      : null;
  if (!recipient) return skip(outbound.id, "no-recipient", "להודעה הנכנסת אין טלפון ואין מזהה", true);

  if (outbound.number.status === "DISCONNECTED") {
    return fail(outbound.id, null, "המספר העסקי נותק לפני שההודעה יצאה", false);
  }
  if (inbound.receivedAt && now.getTime() - inbound.receivedAt.getTime() >= SERVICE_WINDOW_MS) {
    // §7 שורה 102: אחרי 24 שעות מותרת רק תבנית — ההודעה אינה נשלחת בדרך אחרת
    return fail(outbound.id, WINDOW_CLOSED_CODE, "עברו 24 שעות מההודעה של השולח — וואטסאפ אינה מתירה הודעה רגילה", false);
  }

  const composed = composeWhatsappReply(await composeInput(kind, inbound, ticket));

  // המונה עולה **לפני** השליחה: תהליך שנפל בין הבקשה לרישום ייראה בניסיון הבא כניסיון שני
  await db.waMessage.update({ where: { id: outbound.id }, data: { attempts: { increment: 1 } } });

  let wamid: string;
  try {
    const api = await waApiForNumber(outbound.number, deps.api);
    ({ wamid } = await api.sendText({
      phoneNumberId: outbound.number.phoneNumberId,
      to: recipient,
      body: composed.text,
      contextWamid: inbound.wamid,
    }));
  } catch (error) {
    if (error instanceof WaApiError && (error.kind === "permanent" || error.kind === "not_found")) {
      // הכרעה של Meta על ההודעה הזו — ניסיון חוזר יחזיר אותה תשובה. 131047 הוא החלון,
      // וכל קוד אחר הוא הפתעה שצריך לראות
      return fail(outbound.id, error.code ?? null, `וואטסאפ דחתה את ההודעה: ${error.message}`, error.code !== WINDOW_CLOSED_CODE);
    }
    if (error instanceof WaApiError && error.kind === "auth") {
      await reportWaIssue(outbound.number.id, { code: "token_revoked" });
    }
    // השורה נשארת PENDING: כשל זמני אינו הכרעה, והג׳וב יחזור
    await db.waMessage.update({
      where: { id: outbound.id },
      data: { detail: `שליחה נכשלה: ${errorText(error)}`.slice(0, 1000) },
    });
    throw error;
  }

  const latencySec = inbound.receivedAt ? Math.round((now.getTime() - inbound.receivedAt.getTime()) / 1000) : null;
  await db.waMessage.update({
    where: { id: outbound.id },
    data: {
      state: "SENT",
      wamid,
      sentAt: now,
      // ביוצא `text` הוא מה שנשלח — כך הוא מוצג בשיחה של הטיוטה (W8)
      text: composed.text,
      waId: inbound.waId,
      bsuid: inbound.bsuid,
      nextAttemptAt: null,
      detail: null,
    },
  });

  logInfo("wa.reply.sent", { waMessageId: outbound.id, ticketId: ticket?.id ?? null, template: composed.template, latencySec });
  // ההבטחה נמדדת ולא מוצהרת: בלי הלוג הזה החמרה הדרגתית לא הייתה נראית (MONITORING.md).
  // היא חלה על אישור של דיווח (§7 שורה 94). ההסבר החד-פעמי עונה להודעה בלי "תקלה",
  // שמוכרעת רק בתקרה של 10 דקות (§7 שורה 93) — אצלו "איחור" הוא התכנון, ורישום שלו
  // היה הופך את האות לרעש קבוע
  if (kind !== "HINT" && latencySec !== null && latencySec > LATE_REPLY_SEC) {
    logWarn("wa.reply.late", { waMessageId: outbound.id, ticketId: ticket?.id ?? null, latencySec, limitSec: LATE_REPLY_SEC });
  }
  return { kind: KIND, status: "sent", template: composed.template, latencySec };
}

/**
 * מסמן שהאישור **הפסיק לנסות** — נקרא מה-worker רק אחרי שנגמרו הניסיונות, מאותו
 * נימוק של `markReplyFailed` במייל: לשורה יוצאת אין מסלול חזרה לתור, ושורה שנשארה
 * PENDING הייתה נספרת ב-`wa-intake-not-stuck` לנצח.
 */
export async function markWaReplyFailed({ waMessageId }: WaReplyJobPayload, error: unknown): Promise<void> {
  try {
    const { count } = await db.waMessage.updateMany({
      where: { id: waMessageId, direction: "OUTBOUND", state: "PENDING" },
      data: { state: "FAILED", detail: `מיצה את הניסיונות: ${errorText(error)}`.slice(0, 1000), nextAttemptAt: null },
    });
    if (count > 0) logWarn("wa.reply.failed", { waMessageId, error: errorText(error) });
  } catch (markError) {
    captureError(markError, {
      tags: { waMessageId, phase: "wa-reply-mark-failed" },
      fingerprint: ["wa-reply-mark-failed-failed"],
    });
  }
}

// ─────────────────────────────── מהכרעה לנוסח ───────────────────────────────

/**
 * ההכרעה על הדיווח → סוג ההודעה. `null` = **לא נשלחת הודעה** (WA-L11).
 *
 * `switch` ממצה בלי `default`, כדי שהכרעה חדשה ב-`WaOutcome` תפיל את הקומפילציה
 * ותידרש להחליט — בדיוק כמו `replyKindOf` של המייל.
 *
 * **`IGNORED_NO_KEYWORD` הוא ההסבר החד-פעמי (WA-L10).** ההודעה עצמה לא נקלטה, ושורה
 * יוצאת עליה נוצרת רק כשהשולח זכאי להסבר (`wa-intake.ts`) — לכן ההכרעה מספיקה כדי
 * לדעת מה לשלוח, בלי סימון נוסף על השורה.
 */
function replyKindOf(outcome: WaOutcome | null): ReplyKind | null {
  switch (outcome) {
    case "NO_SITE":
      return "NO_SITE";
    case "IGNORED_NO_KEYWORD":
      return "HINT";
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
    case "IGNORED_DISABLED":
    case "IGNORED_BEFORE_ACTIVATION":
    case "IGNORED_ECHO":
    case "IGNORED_UNSUPPORTED":
    case "IGNORED_UNAUTHORIZED":
    case "IGNORED_UNIDENTIFIED":
    case null:
      return null;
  }
}

type InboundRow = Prisma.WaMessageGetPayload<{ include: { authorUser: { select: { name: true } } } }>;

async function composeInput(kind: ReplyKind, inbound: InboundRow, ticket: ReplyTicket | null): Promise<IntakeReplyInput> {
  const base: IntakeReplyInput = {
    kind,
    // השם מהמערכת, כמו במייל — הוא מה שהשולח רואה בכל מקום אחר. השם באפליקציה
    // (`profileName`) נקבע בטלפון ולעיתים אינו שם כלל.
    recipientName: inbound.authorUser?.name ?? inbound.profileName ?? "",
    isReply: inbound.outcome !== null && inbound.outcome.startsWith("REPLY_"),
  };

  switch (kind) {
    case "NO_SITE":
    case "AFTER_DELETION":
    case "HINT":
    // הנוסח של וואטסאפ אינו מזכיר את השולח המקורי (§7 שורה 105) — ולכן גם טיוטה
    // שנמחקה בינתיים אינה מונעת את ההודעה, שנכונה גם אז
    case "NOT_PERMITTED":
      return base;
    case "AFTER_DISPATCH":
      return { ...base, ticketSeq: ticket?.seq, ticketLink: ticket ? ticketUrl(ticket.id) : undefined };
    case "DRAFT": {
      if (!ticket) throw new Error("sendWaReply: נוסח טיוטה בלי פנייה");
      return {
        ...base,
        extractionUnavailable:
          inbound.outcome === "DRAFT_CREATED_UNPROCESSED" || inbound.outcome === "REPLY_STORED_UNPROCESSED",
        ...(await draftReplyContent(ticket)),
        report: parseReport(inbound.report, inbound.id) ?? undefined,
      };
    }
  }
}

/**
 * הפנייה שהשיחה מוצמדת לה, או null. מחיקת פנייה מאפסת את `WaThread.ticketId`
 * (`onDelete: SetNull`), ולכן "אין פנייה" הוא בדיוק הסימן לטיוטה שנמחקה.
 */
async function loadTicket(threadId: string | null): Promise<ReplyTicket | null> {
  if (!threadId) return null;
  const thread = await db.waThread.findUnique({ where: { id: threadId }, select: { ticketId: true } });
  if (!thread?.ticketId) return null;
  return db.ticket.findUnique({ where: { id: thread.ticketId }, select: REPLY_TICKET_SELECT });
}

// ─────────────────────────────── רישום ───────────────────────────────

/**
 * לא נשלחה הודעה, במכוון. `bug` — מצב שלא היה אמור להיווצר, ושקט מדי מכדי להישאר
 * רק בשדה במסד.
 */
async function skip(id: string, reason: WaReplySkipReason, detail: string, bug = false): Promise<WaReplyOutcome> {
  await db.waMessage.update({ where: { id }, data: { state: "SKIPPED", detail, nextAttemptAt: null } });
  logWarn("wa.reply.skipped", { waMessageId: id, reason });
  if (bug) {
    captureError(new Error(`wa-reply: ${detail}`), { tags: { waMessageId: id, reason }, fingerprint: ["wa-reply-skipped", reason] });
  }
  return { kind: KIND, status: "skipped", reason };
}

/** ההודעה לא נשלחה ולא תישלח — "לא נשלחה" בשיחה של הטיוטה (§7 שורה 102) */
async function fail(id: string, code: number | null, detail: string, alarm: boolean): Promise<WaReplyOutcome> {
  await db.waMessage.update({
    where: { id },
    data: { state: "FAILED", errorCode: code, detail: detail.slice(0, 1000), nextAttemptAt: null },
  });
  logWarn("wa.reply.failed", { waMessageId: id, code });
  if (alarm) {
    captureError(new Error(`wa-reply: ${detail}`), { tags: { waMessageId: id }, fingerprint: ["wa-reply-rejected", String(code)] });
  }
  return { kind: KIND, status: "failed", code };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
