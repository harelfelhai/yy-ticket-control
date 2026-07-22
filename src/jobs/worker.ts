import type { Job } from "@/generated/prisma/client";
import { selectEmailTransport } from "@/lib/notifier/email";
import { type DeliveryOutcome, sendNotification } from "@/lib/notifier";
import type { EmailTransport } from "@/lib/notifier/types";
import { claimNextJob, completeJob, failJob } from "./queue";
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

export type JobResult =
  | { job: Job; status: "done"; outcome?: DeliveryOutcome }
  | { job: Job; status: "failed"; error: string };

/**
 * מריץ עבודה אחת מהתור, אם יש כזו. מחזיר null כשהתור ריק.
 * הערוץ מוזרק כדי שבדיקות יריצו את המסלול המלא מול ערוץ מדומה.
 */
export async function processNextJob(
  transport?: EmailTransport,
  now: Date = new Date(),
): Promise<JobResult | null> {
  const job = await claimNextJob(now);
  if (!job) return null;

  try {
    // בחירת הערוץ נעשית **בתוך ה-try ולכל עבודה בנפרד**, ולא כברירת מחדל
    // של הפרמטר. בפרודקשן בלי מפתח Resend הבחירה זורקת — ואם היא הייתה
    // מחוץ ל-try, השגיאה הייתה נבלעת בלולאה, העבודות היו נשארות PENDING
    // לנצח, ואיש לא היה יודע למה ההודעות לא יוצאות. כך היא נרשמת על
    // העבודה עצמה, ב-`lastError`, וניתן לראות אותה.
    const outcome = await runJob(job, transport ?? selectEmailTransport());
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
  transport?: EmailTransport,
  now: Date = new Date(),
  limit: number = MAX_JOBS_PER_TICK,
): Promise<JobResult[]> {
  const results: JobResult[] = [];

  while (results.length < limit) {
    const next = await processNextJob(transport, now);
    if (!next) break;
    results.push(next);
  }

  return results;
}

async function runJob(job: Job, transport: EmailTransport): Promise<DeliveryOutcome | undefined> {
  switch (job.type) {
    case JOB_TYPES.notify: {
      const payload = job.payload as unknown as NotifyJobPayload;
      return sendNotification(payload, transport);
    }
    default:
      // סוג לא מוכר אינו קורס בשקט: הוא נכשל, נשאר בטבלה, ומופיע כ-FAILED
      // עם הסיבה. זה קורה רק אם קוד ישן קרא לשורה שנוצרה בגרסה חדשה.
      throw new Error(`סוג עבודה לא מוכר: ${job.type}`);
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
