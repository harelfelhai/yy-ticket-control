import type { WaOutcome } from "@/generated/prisma/enums";
import { enqueue } from "@/jobs/queue";
import { JOB_TYPES, type WaIntakeJobPayload } from "@/jobs/types";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hasIntakeKeyword } from "@/lib/intake/keyword";
import { logInfo } from "@/lib/observability/log";
import { type BurstUnit, planBurst } from "@/lib/whatsapp/burst";
import { DRAFT_TICKET_SELECT } from "./draft-fields";
import { type SenderUser, decideReplyVerdict } from "./intake-draft";
import type { Tx } from "./ticket-activity";

/**
 * ההכרעה על הדיווחים של שולח אחד בוואטסאפ (§2.7, §5.ה5) — **במצב shadow**.
 *
 * ההודעות של משתמש מורשה ממתינות ביומן (`wa-webhook.ts`), והג׳וב הזה מקבץ
 * אותן לדיווחים (`whatsapp/burst.ts`) ומכריע על כל דיווח שהגיע זמנו, לפי
 * הסדר של האפיון:
 *
 * 1. **תגובה (Reply) להודעה בשיחה של טיוטה** — מסלול ההשלמה, עם ההכרעה של
 *    המייל על מחיקה, הרשאה ושיגור (`decideReplyVerdict`).
 * 2. **"תקלה" בדיווח** — טיוטה חדשה, או `NO_SITE` למנהל עבודה בלי אתר.
 * 3. **כל השאר** — `IGNORED_NO_KEYWORD`, והטקסט נמחק.
 *
 * **במצב shadow ההכרעה נרשמת ואינה מבוצעת**: אין טיוטה, אין קובץ ואין
 * הודעה לשולח — `shadow: true` על השורות, ושורת לוג לכל דיווח. כך אפשר
 * להשוות את מה שהמערכת הייתה עושה מול מה שקרה בצ'אט, לפני שהיא עונה לאיש.
 *
 * **הקלטה קולית עדיין אינה מתומללת** (W6), ולכן דיווח שכולו הקלטה נרשם כאן
 * בלי המילה. המגבלה ידועה ומוצהרת; התמלול נכנס עם יצירת הטיוטה.
 */

export type WaIntakeOutcome = { kind: "wa-intake" } & (
  | { status: "missing" }
  /** אין הודעות ממתינות לשולח — ג׳וב כפול, או שהקודם כבר הכריע */
  | { status: "nothing-pending" }
  | { status: "decided"; units: { size: number; outcome: WaOutcome }[]; waitUntil: Date | null }
);

const KIND = "wa-intake" as const;

export async function handleWaIntake(
  payload: WaIntakeJobPayload,
  deps: { now?: Date } = {},
): Promise<WaIntakeOutcome> {
  const now = deps.now ?? new Date();
  const anchor = await db.waMessage.findUnique({
    where: { id: payload.waMessageId },
    select: { authorUserId: true, numberId: true, direction: true },
  });
  if (!anchor?.authorUserId || anchor.direction !== "INBOUND") return { kind: KIND, status: "missing" };
  const authorUserId = anchor.authorUserId;

  return db.$transaction(async (tx) => {
    // נעילה לפי השולח: שני ג׳ובים לאותו שולח (משלוח כפול, דחייה שנפגשה עם
    // הודעה חדשה) היו מכריעים את אותו דיווח פעמיים
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${authorUserId} FOR UPDATE`;

    const pending = await tx.waMessage.findMany({
      where: { authorUserId, numberId: anchor.numberId, direction: "INBOUND", state: "PENDING" },
      select: { id: true, receivedAt: true, contextWamid: true, text: true },
      orderBy: { receivedAt: "asc" },
    });
    if (pending.length === 0) return { kind: KIND, status: "nothing-pending" };

    const plan = planBurst(
      pending.map((row) => ({
        id: row.id,
        sentAt: row.receivedAt ?? now,
        contextWamid: row.contextWamid,
        keyword: row.text !== null && hasIntakeKeyword(row.text),
      })),
      now,
    );

    const sender = await loadSender(tx, authorUserId);
    const units: { size: number; outcome: WaOutcome }[] = [];
    for (const unit of plan.ready) {
      const outcome = await decideUnit(tx, unit, sender);
      await writeShadowDecision(tx, unit, outcome);
      units.push({ size: unit.messageIds.length, outcome });

      const last = pending.find((row) => row.id === unit.messageIds.at(-1));
      logInfo("wa.intake.unit", {
        size: unit.messageIds.length,
        outcome,
        shadow: true,
        latencySec: last?.receivedAt ? Math.round((now.getTime() - last.receivedAt.getTime()) / 1000) : null,
      });
    }

    if (plan.waitUntil) {
      const waiting = pending.filter((row) => !plan.ready.some((unit) => unit.messageIds.includes(row.id)));
      await tx.waMessage.updateMany({
        where: { id: { in: waiting.map((row) => row.id) } },
        data: { nextAttemptAt: plan.waitUntil },
      });
      const last = waiting.at(-1);
      if (last) {
        await enqueue(tx, JOB_TYPES.waIntake, { waMessageId: last.id } satisfies WaIntakeJobPayload, plan.waitUntil);
      }
    }

    return { kind: KIND, status: "decided", units, waitUntil: plan.waitUntil };
  });
}

/**
 * השולח כפי שהוא **עכשיו**, ולא כפי שהיה ברישום: ההרשאה נבדקת בזמן ההכרעה
 * (§5.ה5 כלל 9). null — הושבת, ההרשאה בוטלה, או שיצא מהפיילוט.
 */
async function loadSender(tx: Tx, userId: string): Promise<SenderUser | null> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, siteId: true, phone: true, active: true, whatsappIntakeEnabled: true },
  });
  if (!user?.active || !user.whatsappIntakeEnabled) return null;
  const pilot = env.whatsappPilotPhones();
  if (pilot.length > 0 && !pilot.includes(user.phone)) return null;
  return { id: user.id, name: user.name, role: user.role, siteId: user.siteId };
}

async function decideUnit(tx: Tx, unit: BurstUnit, sender: SenderUser | null): Promise<WaOutcome> {
  if (!sender) return "IGNORED_UNAUTHORIZED";

  if (unit.contextWamid) {
    // תגובה להודעה **בשיחה של טיוטה** — שלנו או של השולח. תגובה להודעה אחרת
    // בצ'אט (שיחה רגילה עם הצוות) אינה השלמה, ונבחנת כמו כל הודעה
    const quoted = await tx.waMessage.findFirst({
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

/**
 * ההכרעה על השורות של הדיווח, **בלי לבצע אותה**. דיווח שלא נקלט מאבד את
 * התוכן שלו — הוא אינו נוגע למערכת (§2.7 שלב 1).
 */
async function writeShadowDecision(tx: Tx, unit: BurstUnit, outcome: WaOutcome): Promise<void> {
  const ignored = outcome.startsWith("IGNORED_");
  await tx.waMessage.updateMany({
    where: { id: { in: unit.messageIds } },
    data: {
      state: "DONE",
      outcome,
      shadow: true,
      nextAttemptAt: null,
      ...(ignored ? { text: null, profileName: null } : {}),
    },
  });
}
