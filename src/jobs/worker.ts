import type { Job } from "@/generated/prisma/client";
import { selectTextExtractor, selectTranscriber } from "@/lib/ai/gemini";
import type { TextExtractor, Transcriber } from "@/lib/ai/types";
import { selectEmailTransport } from "@/lib/notifier/email";
import { type DeliveryOutcome, markNotifyFailed, sendNotification } from "@/lib/notifier";
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
import { runEmailIntake } from "./handlers/email";
import { startEmailPoller } from "./email-poller";
import type { FieldExtractor } from "@/lib/email-intake/extraction";
import type { MailSource } from "@/lib/email-intake/source";
import type { EmailIntakeOutcome } from "@/lib/services/email-intake";
import { type EmailReplyOutcome, markReplyFailed, sendEmailReply } from "@/lib/services/email-reply";
import { cleanupRateLimits } from "@/lib/rate-limit";
import { captureError } from "@/lib/observability/log";
import { HEARTBEAT, seedHeartbeat } from "@/watchdog/heartbeat";
import { runWatchdog } from "@/watchdog/runner";
import { MAX_ATTEMPTS, claimNextJob, completeJob, failJob, reclaimOrphanedJobs } from "./queue";
import {
  JOB_TYPES,
  type EmailIntakeJobPayload,
  type EmailReplyJobPayload,
  type JobLane,
  type NotifyJobPayload,
} from "./types";

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

/**
 * כל כמה זמן העובד בודק אם יש עבודה.
 *
 * בפיתוח הקצב מואט פי חמישה: הבדיקה פוגעת ב-DB גם כשהתור ריק, ועל שרת dev
 * ארוך-ריצה היא עומס רקע מצטבר (אבחון 27.8.2026). הבדיקות אינן מושפעות —
 * הן קוראות ל-`processNextJob` ישירות ואינן ממתינות לטיימר.
 */
const POLL_INTERVAL_MS = process.env.NODE_ENV === "development" ? 10_000 : 2_000;

/** כמה עבודות לכל היותר בסבב אחד — ראה `drainJobs` */
const MAX_JOBS_PER_TICK = 20;

/** השהיה אחרי כשל לא צפוי בלולאה עצמה, כדי לא להציף את הלוג */
const ERROR_BACKOFF_MS = 10_000;

/**
 * גג לעבודה בודדת — **רשת הביטחון שמונעת מהעובד למות בשקט**.
 *
 * הכשל שזה סוגר: `tick` מתזמן את הסבב הבא ב-`finally`, וה-`finally` רץ רק
 * כשה-`try` **מסתיים**. קריאה יוצאת שאינה נפתרת לעולם אינה מסתיימת ואינה
 * זורקת, ולכן `await drainJobs()` היה תלוי לנצח, ה-`finally` לא היה רץ,
 * והטיימר הבא **לא היה נקבע לעולם**. התוצאה: אין עוד התראות, אין הסלמה
 * יומית ואין גיבוי לילי — עד ל-restart. ‏`try/catch` מטפל בכשל ואינו מטפל
 * בהיתקעות; אלה שני מצבים שונים.
 *
 * הגג נמצא כאן ולא סביב `drainJobs` כולו, כדי שהכשל ייזקף ל**עבודה** שנתקעה:
 * ה-`catch` הקיים ב-`processNextJob` קורא ל-`failJob`, הסיבה נשמרת
 * ב-`Job.lastError`, והעבודה חוזרת לתור. הלולאה ממשיכה מיד לעבודה הבאה.
 *
 * הערך גבוה מכל גג של קריאה בודדת (‏120 שניות לתמלול ולחילוץ), כדי שהוא
 * יירה רק כשמשהו באמת נתקע — ולא יקטע עבודה איטית אך תקינה.
 */
const JOB_TIMEOUT_MS = 180_000;

/**
 * מריץ הבטחה עם גג זמן. אינו מבטל את העבודה התלויה — אי אפשר — אבל משחרר
 * את הקורא, וזה כל מה שנדרש כדי שהלולאה תמשיך לנשום.
 */
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} לא הסתיים תוך ${Math.round(ms / 1000)} שניות`)),
      ms,
    );
    // בלי unref התהליך מסרב להיסגר עד שהטיימר פג, כמו בלולאת ה-poll.
    timer.unref?.();
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/**
 * חלון throttle ללכידת כשל לולאה ל-Sentry. כשל בלולאה פירושו בדרך כלל
 * ש-DB למטה, והלולאה חוזרת כל 10 שניות — לכידה בכל פעם הייתה שורפת את
 * מכסת ה-5K שגיאות/חודש תוך שעה. Sentry ממזג ל-issue אחד, אבל נפח האירועים
 * עדיין נספר, ולכן לוכדים לכל היותר פעם ב-10 דקות.
 */
const LOOP_ERROR_CAPTURE_INTERVAL_MS = 10 * 60_000;

/** כל כמה זמן ה-watchdog בודק את ה-invariants ומדווח check-in ל-Sentry */
const WATCHDOG_INTERVAL_MS = 6 * 60 * 60_000;

/**
 * כמה להמתין לריצת ה-watchdog הראשונה אחרי עלייה. מספיק כדי שזריעת
 * פעימות-הלב שבאתחול תסתיים, וקצר מספיק כדי שכל עלייה תניב check-in.
 */
const WATCHDOG_STARTUP_DELAY_MS = 30_000;

export type JobOutcome =
  | DeliveryOutcome
  | AiOutcome
  | EscalationOutcome
  | BackupOutcome
  | EmailIntakeOutcome
  | EmailReplyOutcome;

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
  /**
   * התיבה הנכנסת — לשני ג׳ובי הדואר.
   *
   * שדה נפרד ולא שימוש חוזר ב-`transport`: הקריאה והשליחה הן שני ממשקים
   * שונים (`MailSource` מול `EmailTransport`), גם כשבפרודקשן אותו טוקן
   * Gmail עומד מאחורי שניהם.
   */
  mailSource?: MailSource;
  /**
   * מחלץ שדות הטיוטה מהמייל. **אינו** `extractor` שמעליו: זה חילוץ טקסט
   * מקובץ מדיה (`TextExtractor`), וזה קריאת שדות מגוף מייל
   * (`FieldExtractor`). שני מנועים, שני מסלולים, ושם דומה שכבר גרם לבלבול.
   *
   * `null` מפורש פירושו "אין מנוע בסביבה" — המסלול של EM-11.
   */
  fieldExtractor?: FieldExtractor | null;
}

/**
 * מריץ עבודה אחת מהתור, אם יש כזו. מחזיר null כשהתור (או הנתיב) ריק.
 *
 * `lane` אופציונלי ובלעדיו נתפסת כל עבודה — ראו `laneFilter` ב-`queue.ts`.
 */
export async function processNextJob(
  deps: WorkerDeps = {},
  now: Date = new Date(),
  lane?: JobLane,
): Promise<JobResult | null> {
  const job = await claimNextJob(now, lane);
  if (!job) return null;

  try {
    // בחירת הספקים נעשית **בתוך ה-try ולכל עבודה בנפרד**, ולא כברירת מחדל
    // של הפרמטר. בפרודקשן בלי מפתח Resend הבחירה זורקת — ואם היא הייתה
    // מחוץ ל-try, השגיאה הייתה נבלעת בלולאה, העבודות היו נשארות PENDING
    // לנצח, ואיש לא היה יודע למה ההודעות לא יוצאות. כך היא נרשמת על
    // העבודה עצמה, ב-`lastError`, וניתן לראות אותה.
    // עטוף בגג זמן — ראה `JOB_TIMEOUT_MS`. בלעדיו קריאה יוצאת שנתקעת
    // הורגת את לולאת העובד כולה, ולא רק את העבודה הזו.
    const outcome = await withTimeout(runJob(job, deps, now), JOB_TIMEOUT_MS, `עבודה ${job.type}`);
    await completeJob(job.id);
    return { job, status: "done", outcome };
  } catch (error) {
    await failJob(job.id, job.attempts, error, now);

    // לכידה ל-Sentry **רק על כשל סופי**. `claimNextJob` כבר הגדיל את
    // attempts, ולכן `>= MAX_ATTEMPTS` כאן זהה בדיוק ל-`exhausted` של
    // failJob — אותה שורה שהופכת ל-FAILED. ניסיון זמני שיחזור בעוד דקה
    // אינו אירוע שצריך להעיר מישהו; רק כשלא נותר ניסיון זו עובדה גלויה.
    // fingerprint לפי סוג העבודה → issue אחד לכל סוג (מייל/AI/גיבוי/הסלמה).
    if (job.attempts >= MAX_ATTEMPTS) {
      captureError(error, {
        tags: { jobType: job.type, jobId: job.id },
        fingerprint: ["job-failed", job.type],
      });
    }

    // ג'וב יומי מתזמן את המחר רק כשהוא **מצליח** (ב-runJob). אם נכשל סופית,
    // בלי זה השרשרת היומית נעצרת עד ל-restart. הקריאה אידמפוטנטית: בחלון
    // ה-retry עדיין קיים PENDING ולא נוצר כפול; אחרי FAILED סופי נוצר המחר.
    // עטוף כדי שכשל בתזמון לא יסתיר את תוצאת הכשל המקורית.
    try {
      await ensureDailyRescheduled(job.type, now);
    } catch (rescheduleError) {
      // תזמון-מחדש שנכשל פירושו ששרשרת יומית עלולה להיעצר — קריטי, ולכן
      // ל-Sentry ולא ל-console בלבד.
      captureError(rescheduleError, {
        tags: { jobType: job.type, phase: "reschedule-after-failure" },
        fingerprint: ["reschedule-failed", job.type],
      });
    }
    return {
      job,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * מוודא שג'וב יומי (הסלמה/גיבוי) מתוזמן למחר, בלי קשר להצלחת הריצה הנוכחית.
 * לכל סוג אחר — no-op. מיוצא לבדיקה: זהו החיווט שמונע שרשרת יומית שנעצרת
 * אחרי כשל סופי.
 */
export async function ensureDailyRescheduled(jobType: string, now: Date): Promise<void> {
  if (jobType === JOB_TYPES.escalate) await ensureDailyEscalationScheduled(now);
  else if (jobType === JOB_TYPES.backup) await ensureDailyBackupScheduled(now);
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
  lane?: JobLane,
): Promise<JobResult[]> {
  const results: JobResult[] = [];

  while (results.length < limit) {
    const next = await processNextJob(deps, now, lane);
    if (!next) break;
    results.push(next);
  }

  return results;
}

async function runJob(job: Job, deps: WorkerDeps, now: Date): Promise<JobOutcome> {
  switch (job.type) {
    case JOB_TYPES.notify:
      return runNotify(job, deps);

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

    // שני ג׳ובי הדואר רצים בנתיב `mail` (`jobs/types.ts`), ולכן ג׳וב AI ארוך
    // אינו דוחק אותם מעבר לחמש הדקות שהובטחו (§2.6 שלב 4).
    case JOB_TYPES.emailIntake:
      // `now` של הסבב ולא `new Date()` בפנים: הוא מה שקובע את תקציב
      // החילוץ ואת מועד הדחייה הבאה, ובדיקה שאינה שולטת בו אינה יכולה
      // לבדוק את EM-11.
      return runEmailIntake(job.payload as unknown as EmailIntakeJobPayload, {
        source: deps.mailSource,
        extractor: deps.fieldExtractor,
        now,
      });

    case JOB_TYPES.emailReply:
      return runEmailReply(job, deps, now);

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
 * מריץ שליחת התראה, ומסמן כשל על השיוך **רק כשנגמרו הניסיונות**.
 *
 * מבנה זהה ל-`runAi` שמתחתיו, ומאותו נימוק בדיוק: ניסיון שנכשל יחזור בעוד
 * דקה, ואין סיבה שהמנהל יראה "השליחה נכשלה" על משהו שייפתר לבדו.
 *
 * **מה שהיה חסר עד 1.1** הוא הצד השני של אותה מטבע: כשכן נגמרו הניסיונות,
 * הג׳וב ננעל ל-`FAILED` ואיש לא ידע. השיוך המשיך להיראות "בתור לשליחה"
 * לנצח, מפני שאף שדה על `Assignment` לא תיעד את הכשל — בעוד שלמסלול ה-AI
 * כבר היה `markAiFailed` בדיוק לשם כך.
 */
async function runNotify(job: Job, deps: WorkerDeps): Promise<DeliveryOutcome> {
  const payload = job.payload as unknown as NotifyJobPayload;

  try {
    return await sendNotification(payload, deps.transport ?? selectEmailTransport());
  } catch (error) {
    if (job.attempts >= MAX_ATTEMPTS) await markNotifyFailed(payload);
    throw error;
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

/**
 * שולח את המייל החוזר, ומסמן את השורה היוצאת ככשל **רק כשנגמרו הניסיונות**.
 *
 * מבנה זהה ל-`runNotify` ול-`runAi`, ומאותו נימוק — אבל כאן יש סיבה נוספת
 * שאין להן: לשורה **יוצאת** אין מסלול חזרה לתור. סריקת התקועות של הסבב
 * (`services/email-poll.ts`) מסוננת לנכנס בלבד, ולכן שורה שנשארה PENDING
 * אחרי שהג׳וב מת נספרת ב-invariant `email-intake-not-stuck` בכל ריצת
 * watchdog, לנצח. `markReplyFailed` הוא מה שסוגר אותה — ראו התיעוד שם.
 */
async function runEmailReply(job: Job, deps: WorkerDeps, now: Date): Promise<EmailReplyOutcome> {
  const payload = job.payload as unknown as EmailReplyJobPayload;

  try {
    return await sendEmailReply(payload, {
      transport: deps.transport,
      // התיבה משמשת כאן לחיפוש האידמפוטנטיות בלבד ("האם כבר שלחתי?").
      // `undefined` = תיבה לפי הסביבה; בדיקה מזריקה את שלה.
      mailSource: deps.mailSource,
      now,
    });
  } catch (error) {
    if (job.attempts >= MAX_ATTEMPTS) await markReplyFailed(payload, error);
    throw error;
  }
}

/**
 * מפעיל לולאת סבב אחת, לנתיב אחד.
 *
 * הוצא לפונקציה כשנוספו הנתיבים: מאז יש **שתי** לולאות באותו תהליך, והן
 * חייבות להיות בלתי-תלויות. אחרת ג'וב AI ארוך בנתיב הכללי דוחה תשובת מייל
 * מעבר לחמש הדקות שהובטחו, ותשובה שנתקעה מול Gmail מעכבת התראות — שני
 * כשלים שבהם כל ג'וב לעצמו תקין, ורק הסדר גרם לנזק.
 *
 * חלון ה-throttle של Sentry הוא משתנה **סגור בכל לולאה** ולא משותף. אילו
 * היה משותף, כשל בנתיב אחד היה משתיק את הדיווח על כשל בנתיב השני באותן
 * עשר דקות — כלומר תקלה אמיתית שנבלעת מפני שתקלה אחרת הקדימה אותה.
 */
function startLaneLoop(lane: JobLane): void {
  let lastErrorCaptureAt = 0;

  const tick = async () => {
    try {
      await drainJobs({}, new Date(), MAX_JOBS_PER_TICK, lane);
    } catch (error) {
      // כשל כאן פירושו שהתור עצמו לא נגיש (בסיס נתונים למטה). ממשיכים
      // לנסות: העבודות ממתינות בטבלה ואינן הולכות לאיבוד.
      //
      // `console` ולא `log.ts` **רק כאן**: זו הלולאה עצמה שנפלה, ובפיתוח
      // Sentry מנוטרל — בלי השורה בטרמינל בסיס נתונים שירד היה נראה
      // כמערכת שקטה ותקינה.
      console.error(`[jobs:${lane}] הלולאה נכשלה`, error);
      // לכידה ל-Sentry עם throttle: DB שלמטה שעה היה מייצר 360 אירועים
      // ושורף את המכסה. לוכדים פעם ב-10 דקות — מספיק כדי לדעת, לא כדי להציף.
      const nowMs = Date.now();
      if (nowMs - lastErrorCaptureAt >= LOOP_ERROR_CAPTURE_INTERVAL_MS) {
        lastErrorCaptureAt = nowMs;
        captureError(error, {
          tags: { phase: "poll-loop", lane },
          fingerprint: ["poll-loop-db-down", lane],
        });
      }
      await new Promise((resolve) => setTimeout(resolve, ERROR_BACKOFF_MS));
    } finally {
      setTimeout(tick, POLL_INTERVAL_MS).unref?.();
    }
  };

  setTimeout(tick, POLL_INTERVAL_MS).unref?.();
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

  // אתחול התור בעלייה, **בסדר הזה**:
  // 1. שחזור עבודות יתומות שנתקעו ב-RUNNING מריצה קודמת שנקטעה.
  // 2. תזמון הג'ובים היומיים — אחרי השחזור, כי ג'וב יומי ששוחזר ל-PENDING
  //    כבר קיים, וה-ensure לא ייצור לו כפיל; אם נכשל סופית, ה-ensure יוצר
  //    את המחר. סדר הפוך היה עלול לייצר שני ג'ובים יומיים.
  void (async () => {
    await reclaimOrphanedJobs();
    const now = new Date();
    await ensureDailyEscalationScheduled(now);
    await ensureDailyBackupScheduled(now);
    // זריעת פעימות-לב בעלייה: בהפעלה ראשונה הג'וב היומי עדיין לא רץ,
    // וה-watchdog היה מתריע על "פעימה חסרה" על שווא.
    //
    // ‏`seedHeartbeat` ולא `setHeartbeat` — ההבדל הוא שלא דורסים פעימה
    // קיימת. הגרסה הקודמת החזירה את שעון ההתיישנות ל-`now` בכל פריסה, ולכן
    // השתיקה את ה-watchdog ל-27 שעות אחרי כל push ל-main. ראה `heartbeat.ts`.
    await seedHeartbeat(HEARTBEAT.escalation, now);
    await seedHeartbeat(HEARTBEAT.backup, now);
  })().catch((error) => {
    // אתחול שנכשל פירושו שהגיבוי וההסלמה היומיים אולי לא תוזמנו כלל —
    // כשל שקט של כל מנגנון ההתראות. קריטי, ולכן ל-Sentry.
    captureError(error, {
      tags: { phase: "worker-startup" },
      fingerprint: ["worker-startup-failed"],
    });
  });

  // **שתי לולאות, באותו קצב.** ראו `startLaneLoop`. הן חולקות תהליך אחד
  // ולכן אינן רצות ממש במקביל, אבל כל אחת ממתינה לעבודה של **עצמה** בלבד:
  // `await` בנתיב אחד משחרר את הלולאה השנייה להתקדם.
  startLaneLoop("general");
  startLaneLoop("mail");

  // **הגילוי** — הצלע השלישית, ובלעדיה שתי הלולאות ריקות: אף אחת מהן אינה
  // יוצרת ג׳וב דואר, הן רק מריצות מה שכבר בתור. הסבב הוא הטיימר שקורא את
  // התיבה וכותב שורה וג׳וב לכל מייל חדש (`jobs/email-poller.ts`).
  //
  // אין כאן בדיקת דגל: `startEmailPoller` בודק בעצמו `emailIntakeEnabled()`
  // ומחזיר no-op כשהיכולת כבויה. שכפול התנאי כאן היה יוצר מקום שני שאפשר
  // לשכוח לעדכן, בדיוק בהחלטה שחייבת להישאר בעלת תשובה אחת.
  startEmailPoller();

  // ה-watchdog רץ בטיימר **נפרד** כל 6 שעות, מחוץ ללולאת העבודות (2ש') כדי
  // לא לעכב אותה. `.unref` כמו בלולאה, אחרת התהליך לא נסגר ב-Ctrl-C.
  const watchdogTick = async () => {
    try {
      await runWatchdog();
    } catch (error) {
      captureError(error, {
        tags: { phase: "watchdog-runner" },
        fingerprint: ["watchdog-runner-crash"],
      });
    } finally {
      setTimeout(watchdogTick, WATCHDOG_INTERVAL_MS).unref?.();
    }
  };

  /**
   * **הריצה הראשונה בעלייה, ולא בעוד שש שעות.**
   *
   * קודם הטיימר נקבע ל-6 שעות ותו לא, וכל restart אִפֵּס אותו. בתקופה של
   * פריסות תכופות — או בכל סביבה שבה התהליך עולה מחדש בתדירות גבוהה משש
   * שעות — `runWatchdog` לא היה רץ **אף פעם**, ושלוש בדיקות ה-invariants
   * (פעימת הסלמה, פעימת גיבוי, תור תקוע) לא היו מתבצעות כלל. זה החליש בדיוק
   * את המנגנון שנועד לתפוס כשל שקט.
   *
   * ההשהיה הקצרה נותנת לאתחול שלמעלה לזרוע את הפעימות, כדי שהריצה הראשונה
   * לא תתריע על שווא. ‏`unref` כי גם היא לא אמורה להחזיק את התהליך פתוח.
   */
  setTimeout(watchdogTick, WATCHDOG_STARTUP_DELAY_MS).unref?.();
}
