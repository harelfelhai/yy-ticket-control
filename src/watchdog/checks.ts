import { db } from "@/lib/db";
import { HEARTBEAT, getHeartbeat } from "./heartbeat";
import { heartbeatStale, queueStuck } from "./predicates";

/**
 * ה-invariants שה-watchdog בודק. כל בדיקה זורקת כשהיא נכשלת, וה-runner
 * הופך כל זריקה ל-issue נפרד ב-Sentry (fingerprint לפי שם).
 *
 * שני עקרונות:
 * 1. **ספים עם slack.** בדיקה שמתריעה על שווא נלמדת להתעלם, והתראה שמתעלמים
 *    ממנה גרועה מאין התראה. לכן 26 שעות לג'וב יומי ולא 24.
 * 2. **קריאה בלבד.** ה-watchdog לעולם אינו משנה מצב — הוא רק מאמת אותו.
 *
 * הפרדיקטים הטהורים (`heartbeatStale`/`queueStuck`) יושבים ב-`predicates.ts`
 * ונבדקים ב-unit; כאן רק העטיפה שמביאה להם נתונים מה-DB.
 */

const HOUR_MS = 60 * 60_000;

/** כמה זמן PENDING יכול להיות באיחור לפני שזה "תור תקוע". גדול מספיק כדי
 *  לא להיתפס ל-backoff של retry (1/5/15 דק'), קטן מספיק כדי לזהות לולאה מתה. */
const QUEUE_OVERDUE_MS = 20 * 60_000;

export interface WatchdogCheck {
  name: string;
  /** זורק כשה-invariant מופר */
  run(now: Date): Promise<void>;
}

export const checks: WatchdogCheck[] = [
  {
    // הסלמה רצה 06:00; 24ש' מחזור + 2ש' slack. פעימה ישנה מ-26ש' = יום שנדלג.
    name: "escalation-heartbeat",
    async run(now) {
      const at = await getHeartbeat(HEARTBEAT.escalation);
      if (heartbeatStale(at, now, 26 * HOUR_MS)) {
        throw new Error(`פעימת ההסלמה ישנה: ${at ? at.toISOString() : "מעולם לא רצה"}`);
      }
    },
  },
  {
    // גיבוי רץ 03:00; 27ש' slack נדיב יותר — לילה שנדלג עליו הוא התרחיש הגרוע.
    name: "backup-heartbeat",
    async run(now) {
      const at = await getHeartbeat(HEARTBEAT.backup);
      if (heartbeatStale(at, now, 27 * HOUR_MS)) {
        throw new Error(`פעימת הגיבוי ישנה: ${at ? at.toISOString() : "מעולם לא רץ"}`);
      }
    },
  },
  {
    // סיגנל שאף לכידת-כשל-פר-job אינה נותנת: תור תקוע אינו זורק שגיאה.
    name: "queue-not-stuck",
    async run(now) {
      const overdue = await db.job.count({
        where: { status: "PENDING", runAt: { lt: new Date(now.getTime() - QUEUE_OVERDUE_MS) } },
      });
      if (queueStuck(overdue)) {
        throw new Error(`${overdue} עבודות ממתינות באיחור מעל 20 דקות — לולאת התור כנראה מתה`);
      }
    },
  },
];
