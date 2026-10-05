import { enqueue } from "@/jobs/queue";
import { JOB_TYPES, type WaEventJobPayload, type WaIntakeJobPayload } from "@/jobs/types";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { captureError, logInfo, logWarn } from "@/lib/observability/log";
import { BURST_QUIET_MS } from "@/lib/whatsapp/burst";
import { type SenderMatch, cheapDecision } from "@/lib/whatsapp/decision";
import { phoneFromWaId } from "@/lib/whatsapp/phone";
import {
  type WaInboundMessage,
  type WaStatusUpdate,
  type WebhookItem,
  WebhookParseError,
  parseWebhook,
} from "@/lib/whatsapp/webhook";

/**
 * קליטת משלוח webhook של וואטסאפ — **לאשר מהר, להכריע בתור, לא לאבד.**
 *
 * שני שלבים, ובכוונה:
 *
 * 1. **ה-route** (`recordWebhookEvent`): הגוף הגולמי נשמר וג׳וב `WA_EVENT`
 *    נוצר, בטרנזאקציה אחת — ורק אז 200. ל-Cloud API אין דרך לשלוף הודעה
 *    שכבר נמסרה, ולכן המשלוח הוא העותק היחיד; כשל בשמירה מחזיר 500, ו-Meta
 *    מנסה שוב עד שבעה ימים.
 * 2. **הג׳וב** (`processWebhookEvent`): פענוח, שורה ביומן לכל הודעה (`wamid`
 *    ייחודי — משלוח כפול נרשם פעם אחת), ו**ההכרעות הזולות** כבר כאן: קליטה
 *    כבויה, לפני החיבור, שולח שאינו מורשה, סוג שאינו נקלט. שורה שהוכרעה כך
 *    נשמרת בלי תוכן ובלי ג׳וב. השאר — הודעות של משתמשים מורשים — ממתינות
 *    לקיבוץ לדיווחים (`wa-intake.ts`).
 *
 * **ה-wamid מכיל את הטלפון של השולח** (base64), ולכן אינו נרשם בלוגים —
 * רק המזהה הפנימי של השורה.
 */

// ─────────────────────────────── 1. ה-route ───────────────────────────────

/** שומר את הגוף כמו שהגיע, ויוצר את ג׳וב הפענוח — באותה טרנזאקציה */
export async function recordWebhookEvent(rawBody: string): Promise<{ eventId: string }> {
  return db.$transaction(async (tx) => {
    const event = await tx.waWebhookEvent.create({ data: { body: rawBody }, select: { id: true } });
    await enqueue(tx, JOB_TYPES.waEvent, { webhookEventId: event.id } satisfies WaEventJobPayload);
    return { eventId: event.id };
  });
}

// ─────────────────────────────── 2. הג׳וב ───────────────────────────────

export interface WaEventCounts {
  pending: number;
  ignored: number;
  duplicates: number;
  unknownNumber: number;
  statuses: number;
  invalid: number;
}

export type WaEventOutcome = { kind: "wa-event" } & (
  | { status: "missing" }
  | { status: "already-processed" }
  /** הגוף אינו במבנה של Meta — נשאר שמור עם השגיאה, ודווח ל-Sentry */
  | { status: "unparseable" }
  | ({ status: "processed" } & WaEventCounts)
);

const KIND = "wa-event" as const;

export async function processWebhookEvent(
  payload: WaEventJobPayload,
  deps: { now?: Date } = {},
): Promise<WaEventOutcome> {
  const now = deps.now ?? new Date();
  const event = await db.waWebhookEvent.findUnique({
    where: { id: payload.webhookEventId },
    select: { id: true, body: true, processedAt: true },
  });
  if (!event) return { kind: KIND, status: "missing" };
  if (event.processedAt || event.body === null) return { kind: KIND, status: "already-processed" };

  let items: WebhookItem[];
  try {
    items = parseWebhook(event.body);
  } catch (error) {
    if (!(error instanceof WebhookParseError)) throw error;
    // הגוף נשאר: אחרי תיקון הפענוח אפשר להריץ אותו מחדש. `processedAt` נקבע
    // כדי שהג׳וב לא ינסה שוב את אותו גוף שבור — הדיווח ל-Sentry הוא ההתראה.
    await db.waWebhookEvent.update({
      where: { id: event.id },
      data: { processedAt: now, error: error.message.slice(0, 1000) },
    });
    captureError(error, { fingerprint: ["wa-webhook-unparseable"], tags: { webhookEventId: event.id } });
    return { kind: KIND, status: "unparseable" };
  }

  const counts: WaEventCounts = { pending: 0, ignored: 0, duplicates: 0, unknownNumber: 0, statuses: 0, invalid: 0 };
  const numbers = await loadNumbers(items);
  const invalidReasons: string[] = [];

  for (const item of items) {
    switch (item.kind) {
      case "message": {
        const number = numbers.get(item.message.phoneNumberId);
        if (!number) {
          counts.unknownNumber += 1;
          continue;
        }
        const result = await recordMessage(number, item.message, now);
        counts[result] += 1;
        break;
      }
      case "status":
        if (numbers.has(item.status.phoneNumberId)) {
          counts.statuses += await applyStatus(item.status);
        } else {
          counts.unknownNumber += 1;
        }
        break;
      case "other":
        logInfo("wa.webhook.other", { field: item.field, webhookEventId: event.id });
        break;
      case "invalid":
        counts.invalid += 1;
        invalidReasons.push(item.reason);
        break;
    }
  }

  if (counts.unknownNumber > 0) {
    // מספר של מערכת אחרת על אותה אפליקציה של Meta — לא תקלה, אבל כדאי לדעת
    logInfo("wa.webhook.unknown_number", { webhookEventId: event.id, count: counts.unknownNumber });
  }
  if (invalidReasons.length > 0) {
    captureError(new Error(`וואטסאפ: ${invalidReasons.length} פריטים שאינם במבנה של Meta`), {
      fingerprint: ["wa-webhook-invalid-item"],
      level: "warning",
      tags: { webhookEventId: event.id },
    });
  }

  const touched = [...numbers.values()].map((number) => number.id);
  if (touched.length > 0) {
    await db.waNumber.updateMany({ where: { id: { in: touched } }, data: { lastWebhookAt: now } });
  }

  // הגוף מאופס רק כשכל פריט עובד: תוכן של שיחות שלא נקלטו אינו נשמר אצלנו.
  // פריט שאינו במבנה משאיר את הגוף, כדי שאפשר יהיה לעבד אותו אחרי תיקון.
  await db.waWebhookEvent.update({
    where: { id: event.id },
    data:
      invalidReasons.length > 0
        ? { processedAt: now, error: invalidReasons.join("; ").slice(0, 1000) }
        : { processedAt: now, body: null, error: null },
  });

  logInfo("wa.webhook.processed", { webhookEventId: event.id, ...counts });
  return { kind: KIND, status: "processed", ...counts };
}

interface KnownNumber {
  id: string;
  status: string;
  activatedAt: Date;
}

/** המספרים העסקיים שבמשלוח, שאילתה אחת. מספר שאינו כאן שייך למערכת אחרת. */
async function loadNumbers(items: readonly WebhookItem[]): Promise<Map<string, KnownNumber>> {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.kind === "message") ids.add(item.message.phoneNumberId);
    if (item.kind === "status") ids.add(item.status.phoneNumberId);
  }
  if (ids.size === 0) return new Map();
  const rows = await db.waNumber.findMany({
    where: { phoneNumberId: { in: [...ids] } },
    select: { id: true, phoneNumberId: true, status: true, activatedAt: true },
  });
  return new Map(rows.map((row) => [row.phoneNumberId, row]));
}

// ─────────────────────────────── השולח ───────────────────────────────

/**
 * מזהה את השולח (§2.7 שלב 2): הטלפון שבכרטיס של משתמש פעיל שהמתג שלו דלוק,
 * ואם וואטסאפ הסתירה את הטלפון — המזהה שנשמר עליו בפעם הראשונה שזוהה לפי
 * טלפון. הפיילוט, כשהוא מוגדר, חותך מעל ההרשאה.
 *
 * **המזהה נשמר כאן**, בהודעה הראשונה שזוהתה לפי טלפון: בלעדיו משתמש שיפעיל
 * "שם משתמש" בוואטסאפ ייראה מחר כזר.
 */
export async function findSender(message: Pick<WaInboundMessage, "waId" | "bsuid">): Promise<SenderMatch> {
  const phone = phoneFromWaId(message.waId);
  const select = { id: true, phone: true, active: true, whatsappIntakeEnabled: true, whatsappUserId: true } as const;

  const byPhone = phone ? await db.user.findUnique({ where: { phone }, select }) : null;
  // המזהה משמש **רק כשהטלפון הוסתר**. כשיש טלפון, הוא הזהות (§7 שורה 104):
  // מי שכותב ממספר שאינו בכרטיס אינו מזוהה, גם אם המזהה שלו מוכר.
  const byBsuid =
    !phone && message.bsuid ? await db.user.findUnique({ where: { whatsappUserId: message.bsuid }, select }) : null;
  const user = byPhone ?? byBsuid;

  if (!user) return { kind: phone ? "unauthorized" : "unidentified" };

  if (byPhone && message.bsuid && byPhone.whatsappUserId !== message.bsuid) {
    await rememberBsuid(byPhone.id, message.bsuid);
  }

  if (!user.active || !user.whatsappIntakeEnabled) return { kind: "unauthorized" };
  const pilot = env.whatsappPilotPhones();
  if (pilot.length > 0 && !pilot.includes(user.phone)) return { kind: "unauthorized" };
  return { kind: "user", userId: user.id };
}

/** שומר את המזהה על המשתמש. מזהה שכבר שייך למשתמש אחר אינו נדרס — רק נרשם. */
async function rememberBsuid(userId: string, bsuid: string): Promise<void> {
  try {
    await db.user.update({ where: { id: userId }, data: { whatsappUserId: bsuid } });
  } catch (error) {
    if ((error as { code?: unknown }).code !== "P2002") throw error;
    logWarn("wa.sender.bsuid_conflict", { userId });
  }
}

// ─────────────────────────────── רישום ההודעה ───────────────────────────────

type RecordResult = "pending" | "ignored" | "duplicates";

/**
 * שורה ביומן להודעה אחת, ואם היא ממתינה — הג׳וב שיקבץ אותה, **באותה
 * טרנזאקציה**. הודעה שכבר רשומה (משלוח כפול של Meta) מדולגת על האינדקס
 * הייחודי ולא בבדיקה מוקדמת — כך גם שני ג׳ובים מקבילים לא ירשמו אותה פעמיים.
 */
async function recordMessage(number: KnownNumber, message: WaInboundMessage, now: Date): Promise<RecordResult> {
  if (await db.waMessage.findUnique({ where: { wamid: message.wamid }, select: { id: true } })) return "duplicates";

  const enabled = env.whatsappIntakeEnabled();
  // בקליטה כבויה אין גם זיהוי: לא נוגעים בטבלת המשתמשים בשביל הודעה שלא תיקלט
  const sender: SenderMatch = enabled ? await findSender(message) : { kind: "unauthorized" };
  const outcome = cheapDecision({ enabled, number, message, sender });

  const identity = {
    direction: "INBOUND" as const,
    numberId: number.id,
    wamid: message.wamid,
    waId: message.waId,
    bsuid: message.bsuid,
    type: message.type,
    receivedAt: message.sentAt,
    contextWamid: message.contextWamid,
    forwarded: message.forwarded,
  };

  try {
    if (outcome) {
      // בלי תוכן ובלי שם: ההודעה אינה נוגעת למערכת (§2.7 שלב 2)
      await db.waMessage.create({ data: { ...identity, state: "DONE", outcome } });
      return "ignored";
    }

    // `cheapDecision` מחזירה null רק לשולח מזוהה; אחרת זה באג, לא הודעה לדלג עליה
    if (sender.kind !== "user") throw new Error("וואטסאפ: הודעה ממתינה בלי שולח מזוהה");
    const userId = sender.userId;
    const runAt = new Date(Math.max(now.getTime(), message.sentAt.getTime() + BURST_QUIET_MS));
    await db.$transaction(async (tx) => {
      const row = await tx.waMessage.create({
        data: {
          ...identity,
          state: "PENDING",
          authorUserId: userId,
          profileName: message.profileName,
          text: message.text,
          nextAttemptAt: runAt,
          ...(message.media
            ? {
                media: {
                  create: {
                    waMediaId: message.media.mediaId,
                    mimeType: message.media.mimeType,
                    sha256: message.media.sha256,
                    filename: message.media.filename,
                    voice: message.media.voice,
                  },
                },
              }
            : {}),
        },
        select: { id: true },
      });
      await enqueue(tx, JOB_TYPES.waIntake, { waMessageId: row.id } satisfies WaIntakeJobPayload, runAt);
    });
    return "pending";
  } catch (error) {
    if ((error as { code?: unknown }).code === "P2002") return "duplicates";
    throw error;
  }
}

// ─────────────────────────────── סטטוסים ───────────────────────────────

/**
 * סטטוס על הודעה **שלנו** — נמסרה, נקראה, נכשלה. סטטוס על הודעה שלא אנחנו
 * שלחנו (הצוות מהאפליקציה בטלפון) אינו מוצא שורה, ואינו נרשם. מחזיר כמה שורות
 * עודכנו.
 */
async function applyStatus(status: WaStatusUpdate): Promise<number> {
  const where = { wamid: status.wamid, direction: "OUTBOUND" as const };
  switch (status.status) {
    case "delivered":
      return (await db.waMessage.updateMany({ where, data: { deliveredAt: status.at } })).count;
    case "read":
      return (await db.waMessage.updateMany({ where, data: { readAt: status.at } })).count;
    case "failed":
      return (
        await db.waMessage.updateMany({
          where,
          data: {
            state: "FAILED",
            errorCode: status.errorCode,
            detail: status.errorTitle ? `וואטסאפ: ${status.errorTitle}`.slice(0, 1000) : null,
          },
        })
      ).count;
    default:
      // `sent` ומה שיתווסף: מועד השליחה כבר נרשם כשהשליחה הצליחה
      return 0;
  }
}
