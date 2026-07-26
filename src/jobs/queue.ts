import type { Job, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { JobType } from "./types";

/**
 * תור עבודות על גבי טבלה ב-Postgres.
 *
 * **בלי Redis ובלי ספריית תורים.** המערכת רצה על instance יחיד ומטפלת
 * בעשרות עבודות ביום; תשתית תורים נפרדת הייתה מוסיפה שירות לתחזק, מקור
 * כשל נוסף ועלות חודשית — כדי לפתור בעיה שאין.
 *
 * מה כן חשוב כאן: **הג'וב נוצר באותה טרנזאקציה של הפעולה שיצרה אותו.**
 * אם השיוך התגלגל אחורה, גם ההודעה עליו נעלמת. הכיוון ההפוך — שיוך שנשמר
 * בלי ג'וב — הוא בדיוק "הפנייה שאיש לא ידע עליה".
 */

/** נסיונות לפני שהעבודה נחשבת כשלון סופי */
export const MAX_ATTEMPTS = 3;

/**
 * השהיה לפני כל ניסיון חוזר, בדקות.
 *
 * הכשל השכיח בשליחת מייל הוא זמני (שירות למטה, הגבלת קצב), ולכן הניסיון
 * הראשון החוזר קרוב. ההשהיות גדלות כדי לא להטיח בקצב קבוע בשירות שכבר
 * מסרב — וגם כדי שכשל שנמשך ייראה בטבלה כממתין ולא כלולאה.
 */
const RETRY_DELAY_MINUTES = [1, 5, 15];

const MINUTE_MS = 60_000;

/** מי שמכניס לתור אינו חייב להיות בתוך טרנזאקציה — אבל מותר לו */
type Client = Pick<typeof db, "job">;

export async function enqueue(
  client: Client,
  type: JobType,
  payload: Prisma.InputJsonValue,
  /** מתי העבודה תהיה זמינה. ברירת המחדל היא מיד; ג'וב יומי מתזמן קדימה. */
  runAt?: Date,
): Promise<void> {
  await client.job.create({ data: { type, payload, ...(runAt ? { runAt } : {}) } });
}

/**
 * תופס את העבודה הבאה שהגיע זמנה, או null.
 *
 * התפיסה מותנית: העדכון מצליח רק אם הסטטוס עדיין PENDING. אם תהליך אחר
 * הקדים, מספר השורות שעודכנו הוא 0 והקורא ממשיך הלאה. זו הגנה מספיקה
 * לריצה על instance יחיד, והיא נשארת נכונה גם אם יתווסף שני — במחיר
 * ניסיון מבוזבז ולא במחיר עבודה שרצה פעמיים.
 */
export async function claimNextJob(now: Date = new Date()): Promise<Job | null> {
  const candidate = await db.job.findFirst({
    where: { status: "PENDING", runAt: { lte: now } },
    orderBy: { runAt: "asc" },
  });
  if (!candidate) return null;

  const { count } = await db.job.updateMany({
    where: { id: candidate.id, status: "PENDING" },
    data: { status: "RUNNING", attempts: { increment: 1 } },
  });
  if (count === 0) return null;

  return { ...candidate, status: "RUNNING", attempts: candidate.attempts + 1 };
}

export async function completeJob(jobId: string): Promise<void> {
  await db.job.update({
    where: { id: jobId },
    data: { status: "DONE", lastError: null },
  });
}

/**
 * משחזר עבודות שנתקעו ב-RUNNING — נקרא פעם אחת בעליית השרת.
 *
 * עבודה עוברת ל-RUNNING בזמן שהיא רצה. אם התהליך נקטע באמצע (redeploy,
 * קריסה), היא נשארת RUNNING לנצח: לעולם לא תיתפס שוב ולעולם לא תסומן
 * FAILED — כלומר נופלת בשקט מבעד להבטחת "כשל נשאר גלוי". תחת הנחת ה-instance
 * היחיד, כל עבודה ב-RUNNING בזמן עליית השרת היא בהכרח יתומה (אין עובד אחר
 * שמריץ אותה כרגע).
 *
 * מי שעוד נותרו לו ניסיונות חוזר ל-PENDING (עם runAt בעבר → נלקח מיד); מי
 * שמיצה אותם מסומן FAILED וגלוי, כמו כל כשל סופי.
 */
export async function reclaimOrphanedJobs(): Promise<{ requeued: number; failed: number }> {
  const requeued = await db.job.updateMany({
    where: { status: "RUNNING", attempts: { lt: MAX_ATTEMPTS } },
    data: { status: "PENDING" },
  });
  const failed = await db.job.updateMany({
    where: { status: "RUNNING", attempts: { gte: MAX_ATTEMPTS } },
    data: { status: "FAILED", lastError: "הריצה נקטעה באמצע (השרת הופסק)" },
  });

  return { requeued: requeued.count, failed: failed.count };
}

/**
 * מסמן כישלון: מחזיר לתור עם השהיה, או נועל כ-FAILED אחרי המכסה.
 *
 * עבודה שנכשלה סופית **נשארת בטבלה** ואינה נמחקת. היא הראיה היחידה לכך
 * שקבלן מסוים לא קיבל הודעה, וזו בדיוק השאלה שנשאלת שבוע אחר כך.
 */
export async function failJob(
  jobId: string,
  attempts: number,
  error: unknown,
  now: Date = new Date(),
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = attempts >= MAX_ATTEMPTS;

  const delayMinutes = RETRY_DELAY_MINUTES[attempts - 1] ?? RETRY_DELAY_MINUTES.at(-1) ?? 1;

  await db.job.update({
    where: { id: jobId },
    data: {
      status: exhausted ? "FAILED" : "PENDING",
      lastError: message.slice(0, 1000),
      ...(exhausted ? {} : { runAt: new Date(now.getTime() + delayMinutes * MINUTE_MS) }),
    },
  });
}
