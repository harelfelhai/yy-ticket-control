import type { Prisma } from "@/generated/prisma/client";
import type { WaOutcome } from "@/generated/prisma/enums";
import { enqueue } from "@/jobs/queue";
import { JOB_TYPES, type WaIntakeJobPayload, type WaReplyJobPayload } from "@/jobs/types";
import { AiRequestError, selectTranscriber } from "@/lib/ai/gemini";
import type { Transcriber } from "@/lib/ai/types";
import { db } from "@/lib/db";
import type { DraftFieldName } from "@/lib/draft/fields";
import { classifyAttachment } from "@/lib/email-intake/mime";
import { env } from "@/lib/env";
import {
  DEFER_ALARM_ATTEMPTS,
  EXTRACTION_RETRY_MS,
  MAX_DEFER_ATTEMPTS,
  deferDelayMs,
  shouldRetryExtraction,
} from "@/lib/intake/defer-policy";
import { type FieldExtractor, selectFieldExtractor } from "@/lib/intake/extraction";
import { hasIntakeKeyword } from "@/lib/intake/keyword";
import { type FieldExtraction, emptyReport } from "@/lib/intake/types";
import { normalizeText } from "@/lib/normalize";
import { captureError, logError, logInfo, logWarn } from "@/lib/observability/log";
import { MAX_FILE_BYTES, type MediaStorage, isCorrespondenceDocumentType, selectStorage } from "@/lib/storage";
import type { WaApi } from "@/lib/whatsapp/api";
import { type BurstMessage, type BurstUnit, planBurst } from "@/lib/whatsapp/burst";
import { DRAFT_TICKET_SELECT } from "./draft-fields";
import {
  type PartRef,
  type PreparedPart,
  type SenderUser,
  classifyBytes,
  decideReplyVerdict,
  extractionAttachments,
  loadGazetteer,
  planDraft,
  skippedPart,
  storageExtension,
  storePreparedParts,
  unprocessedValues,
  writeMedia,
} from "./intake-draft";
import type { Tx } from "./ticket-activity";
import { type WaNumberRef, onExternalFailure, waApiForNumber } from "./wa-client";

/**
 * ההכרעה על הדיווחים של שולח אחד בוואטסאפ (§2.7, §5.ה5), ובמצב live גם הביצוע:
 * טיוטה, מדיה, וההודעה לשולח.
 *
 * ההודעות של משתמש מורשה ממתינות ביומן (`wa-webhook.ts`), והג׳וב הזה מקבץ אותן
 * לדיווחים (`whatsapp/burst.ts`) ומכריע על כל דיווח שהגיע זמנו, לפי הסדר של האפיון:
 *
 * 1. **תגובה (Reply) להודעה בשיחה של טיוטה** — מסלול ההשלמה (`decideReplyVerdict`).
 *    **הביצוע שלו הוא W7**: עד אז ההכרעה נרשמת כמו ב-shadow, גם במצב live.
 * 2. **"תקלה" בדיווח** — בטקסט, בכיתוב או בהקלטה — טיוטה חדשה, או `NO_SITE` למנהל
 *    עבודה בלי אתר.
 * 3. **כל השאר** — `IGNORED_NO_KEYWORD`, והתוכן נמחק.
 *
 * **ההקלטות מתומללות לפני הקיבוץ.** בלי התמלול לא ידוע אם נאמרה "תקלה", ודיווח
 * שכולו הקלטה היה ממתין לתקרה של 10 דקות — מעבר לחמש הדקות שהובטחו לאישור (§7
 * שורות 94–95). כשל בתמלול **דוחה** את ההכרעה ואינו הופך ל"לא נקלט".
 *
 * **עבודה חיצונית מחוץ לנעילה, והמצב נבדק שוב בתוכה.** הורדת קבצים, תמלול וחילוץ
 * אורכים שניות, ובזמן הזה יכולה להגיע הודעה נוספת (משלוח מאוחר של Meta) או לרוץ
 * ג׳וב נוסף לאותו שולח. לכן כל כתיבה פותחת טרנזאקציה שנועלת את שורת המשתמש, מקבצת
 * מחדש את מה שממתין, וכותבת רק אם הדיווח זהה למה שהוכרע — הלקח מ-S4/S7 במייל.
 *
 * **כשל זמני לעולם אינו הכרעה.** כשל מול Graph או מול מנוע ה-AI דוחה את **כל
 * ההודעות של השולח** (backoff), עם הג׳וב הבא בתור באותה טרנזאקציה — ובכך נשמר
 * הסדר בין הדיווחים שלו. אחרי כיום של דחיות ההודעה נעצרת (FAILED) ומדווחת ל-Sentry.
 *
 * **ה-wamid מכיל את הטלפון של השולח** — אינו נרשם בלוגים, רק מזהי השורות.
 */

export interface WaIntakeDeps {
  now?: Date;
  /** shadow או live. ברירת המחדל — לפי הסביבה (`WHATSAPP_INTAKE_MODE`). */
  mode?: "shadow" | "live";
  /** וואטסאפ. ברירת המחדל — לפי הטוקן של המספר (`wa-client.ts`); בבדיקות מזויף. */
  api?: WaApi;
  /** `null` — אין מנוע תמלול: ההכרעה על הקלטה נדחית (§7 שורה 95) */
  transcriber?: Transcriber | null;
  /** `null` — אין מחלץ: טיוטה שתוכן ההודעות הוא התיאור שלה (EM-11) */
  extractor?: FieldExtractor | null;
  storage?: MediaStorage;
}

/** למה הדיווח נדחה. משותף ללוג, לתג ב-`detail` ולטיפוס התוצאה. */
export type WaDeferReason = "transcription" | "media" | "extraction";

export interface WaUnitResult {
  size: number;
  /** null — הדיווח נעצר אחרי שמיצה את הניסיונות, בלי הכרעה */
  outcome: WaOutcome | null;
  ticketId?: string;
}

export type WaIntakeOutcome = { kind: "wa-intake" } & (
  | { status: "missing" }
  /** אין הודעות ממתינות לשולח — ג׳וב כפול, או שהקודם כבר הכריע */
  | { status: "nothing-pending" }
  /** כשל זמני, או השולח עוד בהשהיה ממנו — הג׳וב הבא כבר בתור */
  | { status: "deferred"; reason: WaDeferReason | "backoff"; nextAttemptAt: Date }
  | { status: "decided"; units: WaUnitResult[]; waitUntil: Date | null }
);

const KIND = "wa-intake" as const;

// ─────────────────────────────── השורות ───────────────────────────────

const PENDING_SELECT = {
  id: true,
  receivedAt: true,
  contextWamid: true,
  text: true,
  attempts: true,
  nextAttemptAt: true,
  detail: true,
  media: {
    select: { id: true, waMediaId: true, mimeType: true, filename: true, voice: true, transcript: true },
    orderBy: { partIndex: "asc" },
  },
} satisfies Prisma.WaMessageSelect;

type PendingRow = Prisma.WaMessageGetPayload<{ select: typeof PENDING_SELECT }>;

interface Ctx {
  authorUserId: string;
  number: WaNumberRef & { status: string };
  now: Date;
  mode: "shadow" | "live";
  deps: WaIntakeDeps;
}

function pendingWhere(ctx: Pick<Ctx, "authorUserId" | "number">) {
  return {
    authorUserId: ctx.authorUserId,
    numberId: ctx.number.id,
    direction: "INBOUND" as const,
    state: "PENDING" as const,
  };
}

async function loadPending(client: Tx | typeof db, ctx: Pick<Ctx, "authorUserId" | "number">): Promise<PendingRow[]> {
  return client.waMessage.findMany({
    where: pendingWhere(ctx),
    select: PENDING_SELECT,
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
  });
}

/** "תקלה" בטקסט, בכיתוב או בתמלול של הקלטה (§2.7 שלב 1) */
function hasKeyword(row: Pick<PendingRow, "text" | "media">): boolean {
  if (row.text !== null && hasIntakeKeyword(row.text)) return true;
  return row.media.some((media) => media.transcript !== null && hasIntakeKeyword(media.transcript));
}

function toBurstMessage(row: PendingRow, now: Date): BurstMessage {
  return { id: row.id, sentAt: row.receivedAt ?? now, contextWamid: row.contextWamid, keyword: hasKeyword(row) };
}

// ─────────────────────────────── הג׳וב ───────────────────────────────

export async function handleWaIntake(payload: WaIntakeJobPayload, deps: WaIntakeDeps = {}): Promise<WaIntakeOutcome> {
  const now = deps.now ?? new Date();
  const anchor = await db.waMessage.findUnique({
    where: { id: payload.waMessageId },
    select: {
      authorUserId: true,
      direction: true,
      number: { select: { id: true, status: true, tokenCipher: true } },
    },
  });
  if (!anchor?.authorUserId || anchor.direction !== "INBOUND") return { kind: KIND, status: "missing" };

  const ctx: Ctx = {
    authorUserId: anchor.authorUserId,
    number: anchor.number,
    now,
    mode: deps.mode ?? env.whatsappIntakeMode(),
    deps,
  };

  let pending = await loadPending(db, ctx);
  if (pending.length === 0) return { kind: KIND, status: "nothing-pending" };

  // השולח בהשהיה אחרי כשל זמני: ג׳וב שהגיע לפני הזמן (הודעה חדשה שלו) אינו שורף
  // ניסיון, ורק מיישר את ההודעות החדשות למועד הניסיון הבא
  const backoff = backoffUntil(pending, now);
  if (backoff) {
    await db.waMessage.updateMany({
      where: { ...pendingWhere(ctx), OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lt: backoff } }] },
      data: { nextAttemptAt: backoff },
    });
    return { kind: KIND, status: "deferred", reason: "backoff", nextAttemptAt: backoff };
  }

  // מנהל המערכת ניתק את המספר: הודעות שעוד ממתינות אינן נקלטות (§7 שורה 103, מסך 17)
  if (ctx.number.status === "DISCONNECTED") return dropAll(ctx, pending, "IGNORED_DISABLED");

  // השולח נבדק **לפני** התמלול: מי שהושבת או שההרשאה שלו בוטלה מאז שההודעה נרשמה
  // אינו מורשה עוד, וההקלטות שלו אינן מעובדות כלל (§7 שורה 95, §5.ה5 כלל 9)
  const sender = await loadSender(ctx.authorUserId);
  if (!sender) return dropAll(ctx, pending, "IGNORED_UNAUTHORIZED");

  const transcription = await transcribeVoices(ctx, pending);
  if (transcription.outcome) return transcription.outcome;
  if (transcription.changed) pending = await loadPending(db, ctx);

  const plan = planBurst(
    pending.map((row) => toBurstMessage(row, now)),
    now,
  );
  const units: WaUnitResult[] = [];

  for (const unit of plan.ready) {
    const rows = unit.messageIds.map((id) => pending.find((row) => row.id === id)).filter((row) => row !== undefined);
    const outcome = await decideUnit(unit, sender);
    const result = await executeUnit(ctx, unit, rows, sender, outcome);

    if (result.kind === "deferred") return result.outcome;
    if (result.kind === "changed") {
      // הדיווח השתנה בין ההכרעה לכתיבה (הודעה שהגיעה באיחור, ג׳וב מקביל). דבר לא
      // נכתב; ג׳וב מיידי יקבץ מחדש את מה שממתין עכשיו
      await enqueue(db, JOB_TYPES.waIntake, { waMessageId: unit.messageIds[0] } satisfies WaIntakeJobPayload, now);
      logInfo("wa.intake.unit_changed", { waMessageId: unit.messageIds[0], size: unit.messageIds.length });
      return { kind: KIND, status: "decided", units, waitUntil: null };
    }

    units.push(result.unit);
    const last = rows.at(-1);
    logInfo("wa.intake.unit", {
      size: unit.messageIds.length,
      outcome: result.unit.outcome,
      shadow: result.shadow,
      latencySec: last?.receivedAt ? Math.round((now.getTime() - last.receivedAt.getTime()) / 1000) : null,
    });
  }

  const { waitUntil } = plan;
  if (waitUntil) {
    const decided = new Set(plan.ready.flatMap((unit) => unit.messageIds));
    const waiting = pending.filter((row) => !decided.has(row.id));
    await db.$transaction(async (tx) => {
      await tx.waMessage.updateMany({
        where: { id: { in: waiting.map((row) => row.id) }, state: "PENDING" },
        data: { nextAttemptAt: waitUntil },
      });
      const last = waiting.at(-1);
      if (last) {
        await enqueue(tx, JOB_TYPES.waIntake, { waMessageId: last.id } satisfies WaIntakeJobPayload, waitUntil);
      }
    });
  }

  return { kind: KIND, status: "decided", units, waitUntil: plan.waitUntil };
}

/**
 * השולח כפי שהוא **עכשיו**, ולא כפי שהיה ברישום: ההרשאה נבדקת בזמן ההכרעה
 * (§5.ה5 כלל 9). null — הושבת, ההרשאה בוטלה, או שיצא מהפיילוט.
 */
async function loadSender(userId: string): Promise<SenderUser | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, siteId: true, phone: true, active: true, whatsappIntakeEnabled: true },
  });
  if (!user?.active || !user.whatsappIntakeEnabled) return null;
  const pilot = env.whatsappPilotPhones();
  if (pilot.length > 0 && !pilot.includes(user.phone)) return null;
  return { id: user.id, name: user.name, role: user.role, siteId: user.siteId };
}

async function decideUnit(unit: BurstUnit, sender: SenderUser): Promise<WaOutcome> {
  if (unit.contextWamid) {
    // תגובה להודעה **בשיחה של טיוטה** — שלנו או של השולח. תגובה להודעה אחרת
    // בצ'אט (שיחה רגילה עם הצוות) אינה השלמה, ונבחנת כמו כל הודעה
    const quoted = await db.waMessage.findFirst({
      where: { wamid: unit.contextWamid, threadId: { not: null } },
      select: { thread: { select: { ticket: { select: DRAFT_TICKET_SELECT } } } },
    });
    if (quoted?.thread) {
      const verdict = decideReplyVerdict(quoted.thread.ticket, sender);
      return verdict === "merge" ? "REPLY_APPLIED" : verdict;
    }
  }

  if (!unit.keyword) return "IGNORED_NO_KEYWORD";
  if (sender.role === "SITE_MANAGER" && !sender.siteId) return "NO_SITE";
  return "DRAFT_CREATED";
}

// ─────────────────────────────── הביצוע ───────────────────────────────

type UnitResult =
  | { kind: "done"; unit: WaUnitResult; shadow: boolean }
  /** הדיווח השתנה מאז ההכרעה — דבר לא נכתב */
  | { kind: "changed" }
  | { kind: "deferred"; outcome: WaIntakeOutcome };

/** הכרעות שאינן נקלטות — התוכן שלהן אינו נשמר אצלנו (§2.7 שלב 1) */
function dropsContent(outcome: WaOutcome): boolean {
  return outcome.startsWith("IGNORED_") || outcome === "NO_SITE";
}

async function executeUnit(
  ctx: Ctx,
  unit: BurstUnit,
  rows: PendingRow[],
  sender: SenderUser,
  outcome: WaOutcome,
): Promise<UnitResult> {
  const size = unit.messageIds.length;
  // תגובה לשיחה של טיוטה — המיזוג וההודעות של W7. עד אז רק ההכרעה נרשמת.
  const shadow = ctx.mode === "shadow" || outcome.startsWith("REPLY_");

  if (!shadow && outcome === "DRAFT_CREATED") return createWaDraft(ctx, unit, rows, sender);

  const written = await db.$transaction(async (tx) => {
    if (!(await lockUnit(tx, ctx, unit))) return false;
    await writeDecision(tx, unit, outcome, shadow);
    // מנהל עבודה בלי אתר: אין טיוטה, ויש הודעה שמסבירה למה (§2.7 שלב 3)
    if (!shadow && outcome === "NO_SITE") {
      await scheduleReply(tx, ctx, unit.messageIds[unit.messageIds.length - 1], null, sender.id);
    }
    return true;
  });
  return written ? { kind: "done", unit: { size, outcome }, shadow } : { kind: "changed" };
}

/**
 * נועל את השולח, מקבץ מחדש את מה שממתין **עכשיו**, ומאשר שהדיווח זהה למה שהוכרע.
 *
 * הדיווח מזוהה לפי ההודעה הראשונה בו. דיווחים קודמים של אותו שולח שכבר נכתבו אינם
 * משנים את גבולותיו: הגבול נקבע רק מההודעות של הדיווח עצמו (`burst.ts`).
 */
async function lockUnit(tx: Tx, ctx: Ctx, unit: BurstUnit): Promise<boolean> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ctx.authorUserId} FOR UPDATE`;
  const rows = await loadPending(tx, ctx);
  const plan = planBurst(
    rows.map((row) => toBurstMessage(row, ctx.now)),
    ctx.now,
  );
  const now = plan.ready.find((candidate) => candidate.messageIds[0] === unit.messageIds[0]);
  return (
    now !== undefined &&
    now.messageIds.length === unit.messageIds.length &&
    now.messageIds.every((id, index) => id === unit.messageIds[index])
  );
}

/**
 * ההכרעה על השורות של הדיווח. דיווח שאינו נקלט מאבד את התוכן שלו — הטקסט, השם
 * והתמלול: הוא אינו נוגע למערכת (§2.7 שלב 1).
 */
async function writeDecision(tx: Tx, unit: BurstUnit, outcome: WaOutcome, shadow: boolean): Promise<void> {
  const drop = dropsContent(outcome);
  await tx.waMessage.updateMany({
    where: { id: { in: unit.messageIds } },
    data: {
      state: "DONE",
      outcome,
      shadow,
      nextAttemptAt: null,
      detail: null,
      ...(drop ? { text: null, profileName: null } : {}),
    },
  });
  if (drop) {
    await tx.waMedia.updateMany({ where: { messageId: { in: unit.messageIds } }, data: { transcript: null } });
  }
}

/**
 * השורה היוצאת וג׳וב השליחה, **באותה טרנזאקציה** של ההכרעה. השורה נושאת מזהים
 * בלבד; את הנוסח מרכיב `WA_REPLY` בזמן השליחה (`wa-reply.ts`). `repliesToId`
 * ייחודי — **אישור אחד לדיווח**, והוא עונה להודעה האחרונה בו (§2.7 שלב 4).
 */
async function scheduleReply(
  tx: Tx,
  ctx: Ctx,
  lastInboundId: string,
  threadId: string | null,
  userId: string,
): Promise<void> {
  const outbound = await tx.waMessage.create({
    data: {
      direction: "OUTBOUND",
      state: "PENDING",
      numberId: ctx.number.id,
      type: "text",
      repliesToId: lastInboundId,
      threadId,
      authorUserId: userId,
    },
    select: { id: true },
  });
  await enqueue(tx, JOB_TYPES.waReply, { waMessageId: outbound.id } satisfies WaReplyJobPayload);
}

/**
 * כל מה שממתין מהשולח אינו נקלט, בלי קיבוץ ובלי עיבוד — המספר נותק, או שהשולח
 * אינו מורשה עוד. התוכן נמחק, כמו בכל הודעה שאינה נוגעת למערכת.
 */
async function dropAll(
  ctx: Ctx,
  pending: PendingRow[],
  outcome: "IGNORED_DISABLED" | "IGNORED_UNAUTHORIZED",
): Promise<WaIntakeOutcome> {
  const ids = pending.map((row) => row.id);
  await db.$transaction(async (tx) => {
    await tx.waMessage.updateMany({
      where: { id: { in: ids }, state: "PENDING" },
      data: {
        state: "DONE",
        outcome,
        shadow: ctx.mode === "shadow",
        text: null,
        profileName: null,
        nextAttemptAt: null,
        detail: null,
      },
    });
    await tx.waMedia.updateMany({ where: { messageId: { in: ids } }, data: { transcript: null } });
  });
  logInfo("wa.intake.dropped", { numberId: ctx.number.id, outcome, messages: ids.length });
  return { kind: KIND, status: "decided", units: [{ size: ids.length, outcome }], waitUntil: null };
}

// ─────────────────────────────── תמלול ───────────────────────────────

/**
 * מתמלל כל הקלטה ממתינה שעוד לא תומללה — **לפני** הקיבוץ, כי ממנה תלוי אם בדיווח
 * יש "תקלה" (§7 שורה 95). השולח כאן תמיד משתמש מורשה: הודעה של מי שאינו מורשה
 * הוכרעה ברישום ואינה ממתינה, ולכן הקלטות של אחרים אינן מעובדות כלל.
 *
 * התמלול נשמר על הקובץ (`WaMedia.transcript`; ריק — לא נאמר דבר), ובטיוטה הוא
 * התמלול של ההקלטה. **כשל דוחה את השולח**, וגם היעדר מנוע: "התמלול אינו זמין"
 * אינו "לא נאמרה המילה".
 */
async function transcribeVoices(
  ctx: Ctx,
  pending: PendingRow[],
): Promise<{ outcome: WaIntakeOutcome | null; changed: boolean }> {
  const voices = pending.filter((row) => row.media.some((media) => media.voice && media.transcript === null));
  if (voices.length === 0) return { outcome: null, changed: false };

  const transcriber = ctx.deps.transcriber !== undefined ? ctx.deps.transcriber : selectTranscriber();
  let changed = false;

  for (const row of voices) {
    for (const media of row.media.filter((item) => item.voice && item.transcript === null)) {
      if (!transcriber) {
        return { outcome: await deferSender(ctx, row, [row.id], "transcription", "אין מנוע תמלול בסביבה"), changed };
      }

      let transcript = "";
      try {
        const api = await waApiForNumber(ctx.number, ctx.deps.api);
        const download = await api.downloadMedia(media.waMediaId, { maxBytes: MAX_FILE_BYTES });
        if (download.ok) {
          transcript = normalizeText(await transcriber.transcribe(download.media.bytes, download.media.mimeType));
        } else {
          logWarn("wa.intake.voice_too_large", { waMessageId: row.id, sizeBytes: download.sizeBytes });
        }
      } catch (error) {
        if ((await onExternalFailure(error, ctx.number.id)) === "defer") {
          return { outcome: await deferSender(ctx, row, [row.id], "transcription", errorText(error)), changed };
        }
        // ההקלטה אינה (פגה, נדחתה לגופה): לא ידוע שנאמרה בה המילה
        logWarn("wa.intake.voice_unavailable", { waMessageId: row.id, error: errorText(error) });
      }

      await db.waMedia.updateMany({ where: { id: media.id, transcript: null }, data: { transcript } });
      changed = true;
    }
    // ניסיון שהצליח אחרי דחייה מסיר את תג הדחייה — אחרת השולח היה נראה בהשהיה
    if (row.detail !== null) await db.waMessage.updateMany({ where: { id: row.id, state: "PENDING" }, data: { detail: null } });
  }

  logInfo("wa.intake.transcribed", { messages: voices.length });
  return { outcome: null, changed };
}

// ─────────────────────────────── טיוטה חדשה ───────────────────────────────

/** קובץ של הודעת וואטסאפ, כחלק בטיוטה — המיקום שלו בדיווח כולו */
interface WaPart extends PartRef {
  waMediaRowId: string;
  waMessageId: string;
  /** התמלול שנעשה לבדיקת המילה — רק בהקלטה קולית */
  transcript: string | null;
}

type WaPreparedPart = PreparedPart<WaPart>;

/**
 * פותח טיוטה מדיווח (§2.7 שלב 3), ומתזמן את הודעת האישור (שלב 4).
 *
 * **השולח הוא השחקן**, כמו במייל: הטיוטה נוצרת בשמו, וכל כלל הרשאה חל כאילו פתח
 * אותה במערכת. הקבצים נכנסים לטיוטה **גם כשהחילוץ אינו זמין** — קליטת קובץ אינה
 * תלויה בשירות החילוץ (§7 שורה 75), והבתים נכתבים לאחסון **לפני** הטרנזאקציה.
 */
async function createWaDraft(
  ctx: Ctx,
  unit: BurstUnit,
  rows: PendingRow[],
  sender: SenderUser,
): Promise<UnitResult> {
  const last = rows[rows.length - 1];
  if (!last) throw new Error("createWaDraft: דיווח בלי הודעות");

  const collected = await collectMedia(ctx, rows);
  if (collected.kind === "defer") {
    return {
      kind: "deferred",
      outcome: await deferSender(ctx, last, unit.messageIds, "media", collected.detail),
    };
  }

  const text = unitText(rows);
  const extraction = await extract(ctx, last, sender, text, collected.parts);
  if (extraction.kind === "defer") {
    return {
      kind: "deferred",
      outcome: await deferSender(ctx, last, unit.messageIds, "extraction", extraction.detail, EXTRACTION_RETRY_MS),
    };
  }

  const plan = extraction.value
    ? await planDraft(extraction.value, sender, text)
    : { values: unprocessedValues(text, sender), filled: ["DESCRIPTION"] as DraftFieldName[], report: emptyReport() };
  const outcome: WaOutcome = extraction.value ? "DRAFT_CREATED" : "DRAFT_CREATED_UNPROCESSED";

  const stored = await storePreparedParts(
    collected.parts,
    (prepared) => `media/wa/${prepared.part.waMessageId}/${prepared.part.index}.${storageExtension(prepared.mimeType)}`,
    ctx.deps.storage ?? selectStorage(),
  );

  const ticketId = await db.$transaction(async (tx) => {
    if (!(await lockUnit(tx, ctx, unit))) return null;

    const ticket = await tx.ticket.create({
      data: {
        channel: "WHATSAPP",
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

    // שורת `DraftField` רק לשדה שהדיווח מילא — היעדר שורה נקרא כ-meta ריק
    if (plan.filled.length > 0) {
      await tx.draftField.createMany({
        data: plan.filled.map((field) => ({ ticketId: ticket.id, field, fromChannel: true })),
      });
    }

    const thread = await tx.waThread.create({ data: { ticketId: ticket.id }, select: { id: true } });

    await tx.waMessage.updateMany({
      where: { id: { in: unit.messageIds } },
      data: { state: "DONE", outcome, shadow: false, threadId: thread.id, nextAttemptAt: null, detail: null },
    });
    // הדיווח נשמר על ההודעה שהאישור עונה לה — שם `WA_REPLY` קורא אותו
    await tx.waMessage.update({
      where: { id: last.id },
      data: { report: plan.report as unknown as Prisma.InputJsonValue },
    });

    const transcripts = new Map(
      stored.flatMap((part) => (part.part.transcript === null ? [] : [[part.part.index, part.part.transcript] as const])),
    );
    const mediaIds = await writeMedia(tx, ticket.id, sender.id, stored, transcripts);
    for (const part of stored) {
      await tx.waMedia.update({
        where: { id: part.part.waMediaRowId },
        data: {
          mimeType: part.mimeType,
          sizeBytes: part.bytes?.byteLength ?? (part.part.sizeBytes || null),
          sha256: part.sha256,
          storageKey: part.storageKey,
          isMedia: part.isMedia,
          skippedReason: part.skippedReason,
          mediaFileId: mediaIds.get(part.part.index) ?? null,
        },
      });
    }

    await scheduleReply(tx, ctx, last.id, thread.id, sender.id);
    return ticket.id;
  });

  if (!ticketId) return { kind: "changed" };

  logInfo("wa.intake.draft_created", {
    waMessageId: last.id,
    ticketId,
    outcome,
    siteId: plan.values.siteId,
    messages: rows.length,
    mediaCount: stored.filter((part) => part.storageKey !== null && part.storeAs === "media").length,
    notFound: plan.report.notFound.length,
    ambiguous: plan.report.ambiguous.length,
  });
  return { kind: "done", unit: { size: unit.messageIds.length, outcome, ticketId }, shadow: false };
}

/**
 * הטקסט של הדיווח: ההודעות לפי הסדר — הטקסט או הכיתוב, ותמלול ההקלטה. זה מה
 * שהמחלץ קורא ומה שמולו נבדק כל ערך שסומן כמופיע בטקסט (`quotedText`), וכשהחילוץ
 * אינו זמין — התיאור של הטיוטה (EM-11).
 */
function unitText(rows: readonly PendingRow[]): string {
  return rows
    .flatMap((row) => [row.text, ...row.media.map((media) => (media.voice ? media.transcript : null))])
    .map((value) => normalizeText(value ?? ""))
    .filter(Boolean)
    .join("\n");
}

/**
 * מוריד ומסווג את הקבצים של הדיווח, בסדר שבו נשלחו.
 *
 * כמו במייל (`collectAttachments`): קובץ שהצהרתו ספציפית ואינה מדיה (ZIP) נרשם בלי
 * הורדה; Word ו-Excel מורדים כדי להישמר בשיחה בלבד (§7 שורה 64). **כשל זמני דוחה
 * את הדיווח** — הקובץ עשוי להיות הדיווח עצמו (צילום של פתק); מדיה שפגה (7 ימים) או
 * שנדחתה לגופה נרשמת עם הסיבה, והטיוטה נפתחת בלעדיה.
 */
async function collectMedia(
  ctx: Ctx,
  rows: readonly PendingRow[],
): Promise<{ kind: "ok"; parts: WaPreparedPart[] } | { kind: "defer"; detail: string }> {
  const parts: WaPreparedPart[] = [];
  let index = 0;

  for (const row of rows) {
    for (const media of row.media) {
      const part: WaPart = {
        index: index++,
        filename: media.filename,
        sizeBytes: 0,
        waMediaRowId: media.id,
        waMessageId: row.id,
        transcript: media.voice ? media.transcript : null,
      };
      const declared = classifyAttachment({ filename: media.filename, mimeType: media.mimeType }, null);
      const needsBytes =
        declared.isMedia ||
        declared.mimeType === "application/octet-stream" ||
        isCorrespondenceDocumentType(declared.mimeType);
      if (!needsBytes) {
        parts.push(skippedPart(part, declared.mimeType, false, declared.isTnef ? "tnef" : "not-media"));
        continue;
      }

      try {
        const api = await waApiForNumber(ctx.number, ctx.deps.api);
        const download = await api.downloadMedia(media.waMediaId, { maxBytes: MAX_FILE_BYTES });
        if (!download.ok) {
          parts.push(skippedPart({ ...part, sizeBytes: download.sizeBytes }, declared.mimeType, declared.isMedia, "too-large"));
          continue;
        }
        const { bytes } = download.media;
        const resolved = classifyAttachment(
          { filename: media.filename, mimeType: download.media.mimeType },
          bytes.subarray(0, 64),
        );
        parts.push(classifyBytes({ ...part, sizeBytes: bytes.byteLength }, resolved, bytes));
      } catch (error) {
        if ((await onExternalFailure(error, ctx.number.id)) === "defer") {
          return { kind: "defer", detail: `הורדת קובץ ${part.index} נכשלה זמנית: ${errorText(error)}` };
        }
        logWarn("wa.media.skipped", { waMessageId: row.id, partIndex: part.index, error: errorText(error) });
        parts.push(skippedPart(part, declared.mimeType, declared.isMedia, "download-failed"));
      }
    }
  }

  return { kind: "ok", parts };
}

/**
 * החילוץ, בתקציב של EM-11 **מההודעה האחרונה בדיווח** — ההבטחה לאישור נמדדת ממנה
 * (§7 שורה 94). הקלטה שתומללה אינה נשלחת שוב כקובץ: התמלול שלה כבר בטקסט.
 */
async function extract(
  ctx: Ctx,
  last: PendingRow,
  sender: SenderUser,
  text: string,
  parts: readonly WaPreparedPart[],
): Promise<{ kind: "ok"; value: FieldExtraction | null } | { kind: "defer"; detail: string }> {
  const extractor = ctx.deps.extractor !== undefined ? ctx.deps.extractor : selectFieldExtractor();
  if (!extractor) return { kind: "ok", value: null };

  try {
    const value = await extractor.extract({
      channel: "whatsapp",
      subject: "",
      text,
      attachments: extractionAttachments(parts.filter((part) => part.part.transcript === null)),
      gazetteer: await loadGazetteer(sender),
      isReply: false,
    });
    return { kind: "ok", value };
  } catch (error) {
    if (!(error instanceof AiRequestError)) throw error;
    const attemptsSoFar = deferralsOf(last.detail, "extraction") + 1;
    const retry = shouldRetryExtraction({
      kind: error.kind,
      now: ctx.now,
      receivedAt: last.receivedAt ?? ctx.now,
      extractionAttempts: attemptsSoFar,
    });
    if (retry) return { kind: "defer", detail: error.message };

    // מכאן זו הכרעה ולא כשל: המסלול המלא קיים (EM-11), והשולח יקבל הודעה שאומרת
    // בדיוק מה קרה
    logWarn("wa.intake.extraction_unavailable", { waMessageId: last.id, kind: error.kind, attempts: attemptsSoFar });
    return { kind: "ok", value: null };
  }
}

// ─────────────────────────────── דחייה ───────────────────────────────

const DEFER_TAG = /^\[(transcription|media|extraction) (\d+)\]/;

function taggedDetail(reason: WaDeferReason, count: number, text: string): string {
  return `[${reason} ${count}] ${text}`.slice(0, 1000);
}

/** כמה דחיות **מסיבה מסוימת** נרשמו — זכור רק המונה של הדחייה האחרונה, כמו במייל */
function deferralsOf(detail: string | null, reason: WaDeferReason): number {
  const match = detail ? DEFER_TAG.exec(detail) : null;
  if (!match || match[1] !== reason) return 0;
  return Number(match[2]);
}

/** עד מתי השולח בהשהיה: שורה ממתינה שנדחתה ומועד הניסיון שלה עוד לא הגיע */
function backoffUntil(pending: readonly PendingRow[], now: Date): Date | null {
  let until: Date | null = null;
  for (const row of pending) {
    if (!row.detail || !DEFER_TAG.test(row.detail) || !row.nextAttemptAt) continue;
    if (row.nextAttemptAt.getTime() > now.getTime() && (!until || row.nextAttemptAt > until)) until = row.nextAttemptAt;
  }
  return until;
}

/**
 * דוחה את **השולח כולו** ומתזמן ניסיון נוסף — בלי להכריע.
 *
 * המונה והתג נכתבים על השורה שנכשלה (ההקלטה, או ההודעה האחרונה בדיווח); כל שאר
 * ההודעות הממתינות שלו מקבלות את אותו מועד, כדי שהסדר בין הדיווחים יישמר וה-watchdog
 * לא יראה בהן הודעות שנשכחו. הג׳וב הבא נוצר **באותה טרנזאקציה**.
 *
 * אחרי `MAX_DEFER_ATTEMPTS` (כ-19 שעות) ההודעות שנכשלו נעצרות — `FAILED` בלי הכרעה,
 * ו-issue ב-Sentry — וג׳וב מיידי ממשיך עם שאר ההודעות של השולח.
 */
async function deferSender(
  ctx: Ctx,
  failing: PendingRow,
  stopIds: readonly string[],
  reason: WaDeferReason,
  detail: string,
  delayMs?: number,
): Promise<WaIntakeOutcome> {
  const attempts = failing.attempts + 1;
  if (attempts >= MAX_DEFER_ATTEMPTS) return exhaust(ctx, failing, stopIds, reason, detail, attempts);

  const nextAttemptAt = new Date(ctx.now.getTime() + (delayMs ?? deferDelayMs(failing.attempts)));
  await db.$transaction(async (tx) => {
    await tx.waMessage.update({
      where: { id: failing.id },
      data: {
        attempts: { increment: 1 },
        nextAttemptAt,
        detail: taggedDetail(reason, deferralsOf(failing.detail, reason) + 1, detail),
      },
    });
    await tx.waMessage.updateMany({
      where: {
        ...pendingWhere(ctx),
        id: { not: failing.id },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lt: nextAttemptAt } }],
      },
      data: { nextAttemptAt },
    });
    await enqueue(tx, JOB_TYPES.waIntake, { waMessageId: failing.id } satisfies WaIntakeJobPayload, nextAttemptAt);
  });

  logWarn("wa.intake.deferred", {
    waMessageId: failing.id,
    reason,
    attempts,
    nextAttemptAt: nextAttemptAt.toISOString(),
  });
  // אירוע אחד בדיוק להודעה: מכאן זו כבר לא המתנה מתוכננת, אלא דיווח שאינו נענה מעל שעה
  if (attempts === DEFER_ALARM_ATTEMPTS) {
    captureError(new Error(`קליטת וואטסאפ: ${attempts} דחיות רצופות (${reason}) על הודעה אחת`), {
      fingerprint: ["wa-intake-deferred", reason],
      level: "warning",
      tags: { reason },
    });
  }
  return { kind: KIND, status: "deferred", reason, nextAttemptAt };
}

/** עצירה אחרי שמוצו הניסיונות — **לא הכרעה**, ראו `exhaust` ב-`email-intake.ts` */
async function exhaust(
  ctx: Ctx,
  failing: PendingRow,
  stopIds: readonly string[],
  reason: WaDeferReason,
  detail: string,
  attempts: number,
): Promise<WaIntakeOutcome> {
  await db.$transaction(async (tx) => {
    await tx.waMessage.updateMany({
      where: { id: { in: [...stopIds] }, state: "PENDING" },
      data: {
        state: "FAILED",
        nextAttemptAt: null,
        detail: `${attempts} ניסיונות נכשלו (${reason}) — ההודעה לא הוכרעה: ${detail}`.slice(0, 1000),
      },
    });
    // שאר ההודעות של השולח ממשיכות בלי מה שנעצר
    await enqueue(tx, JOB_TYPES.waIntake, { waMessageId: failing.id } satisfies WaIntakeJobPayload, ctx.now);
  });

  logError("wa.intake.exhausted", { waMessageId: failing.id, reason, attempts, messages: stopIds.length });
  captureError(new Error(`קליטת וואטסאפ: ${stopIds.length} הודעות מיצו ${attempts} ניסיונות (${reason})`), {
    fingerprint: ["wa-intake-exhausted", reason],
    level: "error",
    tags: { reason },
  });
  return {
    kind: KIND,
    status: "decided",
    units: [{ size: stopIds.length, outcome: null }],
    waitUntil: null,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
