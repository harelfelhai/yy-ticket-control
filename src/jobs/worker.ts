import type { Job } from "@/generated/prisma/client";
import { selectTextExtractor } from "@/lib/ai/extract";
import { selectTranscriber } from "@/lib/ai/transcribe";
import type { TextExtractor, Transcriber } from "@/lib/ai/types";
import { selectEmailTransport } from "@/lib/notifier/email";
import { type DeliveryOutcome, sendNotification } from "@/lib/notifier";
import type { EmailTransport } from "@/lib/notifier/types";
import {
  type AiEngines,
  type AiJobPayload,
  type AiOutcome,
  markAiFailed,
  runTextExtraction,
  runTranscription,
} from "./handlers/ai";
import {
  type BackupOutcome,
  ensureDailyBackupScheduled,
  runDailyBackup,
} from "./handlers/backup";
import {
  type EscalationOutcome,
  ensureDailyEscalationScheduled,
  runDailyEscalation,
} from "./handlers/escalation";
import { cleanupRateLimits } from "@/lib/rate-limit";
import { MAX_ATTEMPTS, claimNextJob, completeJob, failJob } from "./queue";
import { JOB_TYPES, type NotifyJobPayload } from "./types";

/**
 * העובד שמריץ את התור.
 *
 * הוא רץ **בתוך תהליך השרת** ולא כשירות נפרד — לוח זמנים של עשרות עבודות
 * ביום אינו מצדיק תהליך שני לתחזק ולנטר. זו גם הסיבה שהאירוח הוא שרת Node
 * קבוע ולא serverless: שם התהליך מת בין בקשות, ואיתו התור.
 *
 * הפונקציות מחולקות כך שהלולאה היא רק העטיפה: `processNextJob` מריץ עבודה
 * אחת ומחזיר תוצאה, ובדיקות קוראות לו ישירות במקום להמתין לטיימר. בדיקה
 * שתלויה בשינה של שתי שניות היא בדיקה שנעשית לא יציבה ואז מבוטלת.
 */

/** כל כמה זמן העובד בודק אם יש עבודה. */
const POLL_INTERVAL_MS = 2_000;

/** כמה עבודות לכל היותר בסבב אחד — ראה `drainJobs` */
const MAX_JOBS_PER_TICK = 20;

/** השהיה אחרי כשל לא צפוי בלולאה עצמה, כדי לא להציף את הלוג */
const ERROR_BACKOFF_MS = 10_000;

export type JobOutcome = DeliveryOutcome | AiOutcome | EscalationOutcome | BackupOutcome;

export type JobResult =
  | { job: Job; status: "done"; outcome?: JobOutcome }
  | { job: Job; status: "failed"; error: string };

/**
 * הספקים החיצוניים שהעובד עשוי להזדקק להם.
 *
 * מוזרקים ולא נבחרים בפנים, כדי שבדיקה תריץ את המסלול המלא מול ספקים
 * מדומים. שדה שלא נמסר נבחר לפי הסביבה; שדה שנמסר כ-`null` פירושו
 * במפורש "אין ספק כזה" — וזו הדרך לבדוק את מסלול הדילוג.
 */
export interface WorkerDeps {
  transport?: EmailTransport;
  transcriber?: Transcriber | null;
  extractor?: TextExtractor | null;
}

/** מריץ עבודה אחת מהתור, אם יש כזו. מחזיר null כשהתור ריק. */
export async function processNextJob(
  deps: WorkerDeps = {},
  now: Date = new Date(),
): Promise<JobResult | null> {
  const job = await claimNextJob(now);
  if (!job) return null;

  try {
    // בחירת הספקים נעשית **בתוך ה-try ולכל עבודה בנפרד**, ולא כברירת מחדל
    // של הפרמטר. בפרודקשן בלי מפתח Resend הבחירה זורקת — ואם היא הייתה
    // מחוץ ל-try, השגיאה הייתה נבלעת בלולאה, העבודות היו נשארות PENDING
    // לנצח, ואיש לא היה יודע למה ההודעות לא יוצאות. כך היא נרשמת על
    // העבודה עצמה, ב-`lastError`, וניתן לראות אותה.
    const outcome = await runJob(job, deps, now);
    await completeJob(job.id);
    return { job, status: "done", outcome };
  } catch (error) {
    await failJob(job.id, job.attempts, error, now);
    return {
      job,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * מרוקן את התור עד שאין יותר עבודות שהגיע זמנן, או עד התקרה.
 *
 * התקרה אינה קישוט: אחרי הזנה מרוכזת של בדק בית נוצרות עשרות עבודות
 * ברצף, וריקון של כולן בלולאה אחת חוסם את התהליך — אותו תהליך שמגיש את
 * המסכים. מנהל שפותח את הלוח באותו רגע היה ממתין. מה שנשאר מעל התקרה
 * ממתין בתור ונלקח בסבב הבא, שתי שניות אחר כך.
 */
export async function drainJobs(
  deps: WorkerDeps = {},
  now: Date = new Date(),
  limit: number = MAX_JOBS_PER_TICK,
): Promise<JobResult[]> {
  const results: JobResult[] = [];

  while (results.length < limit) {
    const next = await processNextJob(deps, now);
    if (!next) break;
    results.push(next);
  }

  return results;
}

async function runJob(job: Job, deps: WorkerDeps, now: Date): Promise<JobOutcome> {
  switch (job.type) {
    case JOB_TYPES.notify: {
      const payload = job.payload as unknown as NotifyJobPayload;
      return sendNotification(payload, deps.transport ?? selectEmailTransport());
    }

    case JOB_TYPES.transcribe:
      return runAi(job, deps, runTranscription);

    case JOB_TYPES.extract:
      return runAi(job, deps, runTextExtraction);

    case JOB_TYPES.escalate: {
      const escalated = await runDailyEscalation(now);
      // ניקוי יומי של חלונות הגבלת-קצב שפגו — כאן, כי זו כבר נקודת התחזוקה
      // היומית של המערכת, ואין צורך בג'וב נפרד לזה.
      await cleanupRateLimits(now);
      // מתזמן את המחרת רק אחרי שהריצה הצליחה. אם היא נכשלה, הג'וב חוזר
      // לתור ומנסה שוב, והתזמון הבא ייווצר כשיצליח — כך אין יום שנדלג
      // עליו בשקט בגלל כשל רגעי.
      await ensureDailyEscalationScheduled(now);
      return { kind: "escalation", escalated };
    }

    case JOB_TYPES.backup: {
      const outcome = await runDailyBackup(now);
      // מתזמן את המחרת רק אחרי הצלחה, כמו ההסלמה: גיבוי שנכשל חוזר לתור
      // ומנסה שוב, והתזמון הבא ייווצר כשיצליח — כך אין לילה שנדלג עליו בשקט.
      await ensureDailyBackupScheduled(now);
      return outcome;
    }

    default:
      // סוג לא מוכר אינו קורס בשקט: הוא נכשל, נשאר בטבלה, ומופיע כ-FAILED
      // עם הסיבה. זה קורה רק אם קוד ישן קרא לשורה שנוצרה בגרסה חדשה.
      throw new Error(`סוג עבודה לא מוכר: ${job.type}`);
  }
}

/**
 * מריץ עבודת AI, ומסמן כשל על הקובץ **רק כשנגמרו הניסיונות**.
 *
 * ההפרדה חשובה: ניסיון שנכשל יחזור בעוד דקה, ואין סיבה שהמשתמש יראה
 * "התמלול נכשל" על משהו שייפתר לבדו. רק כשלא נותר ניסיון נוסף זו עובדה.
 */
async function runAi(
  job: Job,
  deps: WorkerDeps,
  handler: (payload: AiJobPayload, engines: AiEngines) => Promise<AiOutcome>,
): Promise<AiOutcome> {
  const payload = job.payload as unknown as AiJobPayload;
  const engines: AiEngines = {
    transcriber: deps.transcriber !== undefined ? deps.transcriber : selectTranscriber(),
    extractor: deps.extractor !== undefined ? deps.extractor : selectTextExtractor(),
  };

  try {
    return await handler(payload, engines);
  } catch (error) {
    if (job.attempts >= MAX_ATTEMPTS) await markAiFailed(payload.mediaId, error);
    throw error;
  }
}

let running = false;

/**
 * מפעיל את הלולאה. אידמפוטנטי — קריאה שנייה אינה יוצרת עובד שני.
 *
 * ‏`unref` על הטיימר: בלעדיו התהליך מסרב להיסגר כי יש טיימר תלוי, ועצירה
 * של שרת הפיתוח הייתה נתקעת עד ל-timeout.
 */
export function startWorker(): void {
  if (running) return;
  running = true;

  // מוודא שהג'ובים היומיים מתוזמנים כבר בעלייה, בלי לחכות לסבב הראשון. אם
  // התזמון אבד (השרת היה למטה בשעת היעד), הג'וב הממתין מתוזמן כעת ונלקח מיד.
  void ensureDailyEscalationScheduled(new Date()).catch((error) => {
    console.error("[jobs] תזמון ההסלמה היומית נכשל", error);
  });
  void ensureDailyBackupScheduled(new Date()).catch((error) => {
    console.error("[jobs] תזמון הגיבוי היומי נכשל", error);
  });

  const tick = async () => {
    try {
      await drainJobs();
    } catch (error) {
      // כשל כאן פירושו שהתור עצמו לא נגיש (בסיס נתונים למטה). ממשיכים
      // לנסות: העבודות ממתינות בטבלה ואינן הולכות לאיבוד.
      console.error("[jobs] הלולאה נכשלה", error);
      await new Promise((resolve) => setTimeout(resolve, ERROR_BACKOFF_MS));
    } finally {
      setTimeout(tick, POLL_INTERVAL_MS).unref?.();
    }
  };

  setTimeout(tick, POLL_INTERVAL_MS).unref?.();
}
