import { db } from "@/lib/db";
import { captureError } from "@/lib/observability/log";
import { type WaHealthOutcome, type WaNumberDeps, checkWhatsappConnection } from "@/lib/services/wa-number";
import { HEARTBEAT, setHeartbeat } from "@/watchdog/heartbeat";
import { enqueue } from "../queue";
import { JOB_TYPES } from "../types";

/**
 * הבדיקה התקופתית של חיבור הוואטסאפ (מסך 17) — כל 6 שעות, ומתזמנת את עצמה
 * מחדש כמו הגיבוי. הלוגיקה בשירות (`checkWhatsappConnection`); כאן רק ההרצה,
 * הפעימה והתזמון.
 *
 * **למה ג׳וב ולא ה-watchdog.** ה-watchdog קורא בלבד ואינו משנה מצב, והבדיקה
 * כותבת: היא מעבירה את המספר ל"תקלה" ומשלימה את הסנכרון שהחיבור מחייב. ה-watchdog
 * (`wa-subscription-intact`) קורא את מה שהיא כתבה, ואת הפעימה שלה.
 */

/** כל כמה זמן — אותו קצב של ה-watchdog, ועד ארבעה ניסיונות סנכרון בתוך 24 השעות של Meta */
export const WA_HEALTH_INTERVAL_MS = 6 * 60 * 60_000;

/** `deps.api` מוזרק בבדיקות; ה-worker קורא בלעדיו, והשירות בוחר לפי התצורה */
export async function runWaHealth(
  now: Date = new Date(),
  deps: Pick<WaNumberDeps, "api"> = {},
): Promise<WaHealthOutcome> {
  const outcome = await checkWhatsappConnection({ ...deps, now });

  // **פעימה רק על תשובה.** בדיקה שלא הגיעה ל-Meta אינה יודעת אם החיבור שלם, ופעימה
  // שהייתה נרשמת עליה הייתה משתיקה את ה-watchdog בדיוק כש-Meta אינה זמינה לאורך זמן.
  if (outcome.status !== "unreachable") {
    try {
      await setHeartbeat(HEARTBEAT.waHealth, now);
    } catch (error) {
      captureError(error, { fingerprint: ["heartbeat-write", "wa-health"] });
    }
  }
  return outcome;
}

/** ג׳וב ממתין אחד בדיוק — נקרא בעליית השרת ואחרי כל ריצה, כמו הגיבוי */
export async function ensureWaHealthScheduled(now: Date = new Date()): Promise<void> {
  const pending = await db.job.findFirst({
    where: { type: JOB_TYPES.waHealth, status: "PENDING" },
    select: { id: true },
  });
  if (pending) return;

  await enqueue(db, JOB_TYPES.waHealth, {}, new Date(now.getTime() + WA_HEALTH_INTERVAL_MS));
}
