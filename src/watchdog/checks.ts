import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HEARTBEAT, getHeartbeat } from "./heartbeat";
import { heartbeatStale, jobsFailing, queueStuck } from "./predicates";

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

/** חלון ההסתכלות על ג'ובים שנכשלו סופית. ראה `jobsFailing` ב-`predicates.ts`. */
const FAILED_WINDOW_MS = 24 * HOUR_MS;

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
  {
    // עבודה שהמערכת התחייבה לעשות, מיצתה שלושה ניסיונות, ולא נעשתה.
    // הסיגנל היחיד שתופס תקלת **תצורה** מתמשכת — מפתח חסר, כלי בגרסה
    // שגויה — שאינה מייצרת לא תור תקוע ולא פעימה ישנה.
    name: "jobs-not-failing",
    async run(now) {
      const since = new Date(now.getTime() - FAILED_WINDOW_MS);
      // ‏`runAt` ולא חותמת עדכון: ל-`Job` אין `updatedAt`, ובכשל **סופי**
      // ‏`failJob` אינו נוגע ב-`runAt` — כלומר הוא נשאר על מועד הניסיון
      // האחרון, לכל היותר 15 דקות לפני הכשל. בחלון של 24 שעות זהו קירוב
      // מדויק דיו, והשאילתה נופלת בדיוק על `@@index([status, runAt])`.
      const failed = await db.job.groupBy({
        by: ["type"],
        where: { status: "FAILED", runAt: { gte: since } },
        _count: true,
      });

      const total = failed.reduce((sum, row) => sum + row._count, 0);
      if (jobsFailing(total)) {
        // פירוט לפי סוג ולא מספר יחיד: "SEND_NOTIFICATION×3" אומר מה לתקן,
        // ו-"3 עבודות נכשלו" מחייב לפתוח את בסיס הנתונים כדי לדעת זאת.
        const detail = failed.map((row) => `${row.type}×${row._count}`).join(", ");
        throw new Error(`${total} עבודות נכשלו סופית ב-24 השעות האחרונות: ${detail}`);
      }
    },
  },
  {
    /**
     * **‏invariant של תצורה, ולא של מצב — וזה הבית הנכון לו.**
     *
     * ההערה על `jobs-not-failing` מעליי כבר קובעת שה-watchdog הוא "הסיגנל
     * היחיד שתופס תקלת **תצורה** מתמשכת". ההתחברות בגוגל (1.2) היא המקרה
     * שאותו סיגנל אינו מכסה: היא אינה ג׳וב, ולכן היעדר תצורה שלה אינו
     * מייצר כשל, לא פעימה ישנה ולא תור תקוע. הוא פשוט **אינו קורה** —
     * הכפתור אינו מוצג, ואיש אינו מדווח על כפתור שלא היה.
     *
     * זה הכשל השקט שהתגלה בפועל בפרודקשן הזה: מייל, גיבוי ו-AI לא עבדו
     * חודש שלם מפני שאין מסך שאומר "לא מוגדר".
     *
     * **למה כאן ולא כשל באתחול השרת.** כשל באתחול היה מפיל את ה-healthcheck
     * (`railway.toml` → `/login`) ומגלגל אחורה כל פריסה שקדמה להזנת
     * המשתנים ב-Railway. ההודעה כאן רועשת בדיוק באותה מידה — issue נפרד
     * ב-Sentry, כל שש שעות — בלי להחזיק את הפריסה כבן ערובה.
     *
     * ‏`isProduction()` בלבד: בפיתוח ובבדיקות היעדר התצורה הוא המצב הרגיל,
     * וההתחברות בסיסמה מכסה את הכול.
     */
    name: "google-login-configured",
    async run() {
      if (env.isProduction() && !env.googleOauth()) {
        throw new Error(
          "התחברות עם Google אינה מוגדרת: חסרים GOOGLE_CLIENT_ID או GOOGLE_CLIENT_SECRET",
        );
      }
    },
  },
];
