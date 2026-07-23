import { db } from "@/lib/db";
import { STALE_DAYS_THRESHOLD } from "@/lib/ticket-status";
import { enqueue } from "../queue";
import { nextEscalationRun } from "../schedule";
import { JOB_TYPES } from "../types";

/**
 * ההסלמה היומית (אפיון §5.ג): פנייה פעילה שלא הייתה בה **שום תנועה
 * בשרשור** במשך 7 ימים מסומנת `escalated` ועוברת ל"דורש ממך".
 *
 * הסימון עצמו הוא כל מה שהג'וב עושה. התצוגה כבר יודעת לגזור ממנו — הלוח
 * מכניס פנייה מוסלמת ל"דורש ממך" והסיבה נעשית "ללא תנועה N ימים" (ראה
 * `ticket-status.ts`). ניקוי הסימון קורה מעצמו: כל תנועה בפנייה מאפסת גם
 * את `lastActivityAt` וגם את `escalated` (`touchData` ב-tickets.ts).
 *
 * **מה שאין כאן, בכוונה:** אין שיוך מחדש אוטומטי ואין הסלמה לדרג מעל —
 * "מה קורה אחרי ההסלמה הוא שיקול דעת בלבד" (§5.ג). הג'וב מסמן, אדם מחליט.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface EscalationOutcome {
  kind: "escalation";
  escalated: number;
}

/**
 * מסמן כמוסלמות את כל הפניות הפעילות שחצו את סף היעדר התנועה.
 *
 * ‏updateMany אחד ולא לולאה: הסימון תלוי רק ב-`lastActivityAt` ואינו דורש
 * לגזור סטטוס לכל פנייה. `escalated: false` בתנאי הופך אותו לאידמפוטנטי —
 * ריצה חוזרת באותו יום אינה נוגעת במה שכבר מסומן.
 */
export async function runDailyEscalation(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_DAYS_THRESHOLD * DAY_MS);

  const { count } = await db.ticket.updateMany({
    where: {
      closedAt: null,
      isDraft: false,
      escalated: false,
      lastActivityAt: { lte: cutoff },
    },
    data: { escalated: true },
  });

  return count;
}

/**
 * מוודא שיש בדיוק ג'וב הסלמה ממתין אחד, מתוזמן ל-06:00 הבא.
 *
 * נקרא גם בעליית השרת (רשת ביטחון אם התזמון אבד) וגם מתוך הג'וב עצמו אחרי
 * שרץ (כדי לתזמן את המחרת). אין כפילות: כשהג'וב רץ הוא במצב RUNNING ולא
 * PENDING, ולכן הבדיקה כאן אינה רואה אותו ויוצרת את הבא; ובעלייה, אם כבר
 * יש ממתין, אין יצירה נוספת.
 */
export async function ensureDailyEscalationScheduled(now: Date = new Date()): Promise<void> {
  const pending = await db.job.findFirst({
    where: { type: JOB_TYPES.escalate, status: "PENDING" },
    select: { id: true },
  });
  if (pending) return;

  await enqueue(db, JOB_TYPES.escalate, {}, nextEscalationRun(now));
}
