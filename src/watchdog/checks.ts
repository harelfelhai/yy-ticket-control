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

/**
 * כמה זמן מותר לסבב קליטת המייל לא לרשום פעימה.
 *
 * הטיימר רץ כל 60 שניות, ולכן 15 דקות הן חמישה-עשר סבבים שלא קרו — רחוק
 * מספיק מסבב בודד שנתקע על בקשה איטית, וקרוב מספיק לחמש הדקות שהמערכת
 * מבטיחה למייל החוזר (§2.6 שלב 4) כדי שההפרה תתגלה ולא תימשך לילה שלם.
 */
const EMAIL_POLL_STALE_MS = 15 * 60_000;

/** גיל ההודעה הנכנסת שממנו PENDING אינו "בדרך" אלא "נשכח". */
const MAIL_STUCK_MS = 30 * 60_000;

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
  {
    /**
     * **EM-12 — הצינור של המייל חי.**
     *
     * הטיימר של הקליטה (`jobs/email-poller.ts`) אינו ג׳וב בטבלה: הוא
     * `setTimeout` בתוך התהליך, ולכן טיימר שמת אינו מייצר לא שורה FAILED,
     * לא תור תקוע ואף לא שגיאה אחת. מבחוץ המערכת נראית בדיוק כמו מערכת
     * שאיש לא כתב אליה — וזה בדיוק הכשל השקט שה-watchdog קיים בשבילו.
     *
     * **רק כשהיכולת דלוקה.** עד S9 היא כבויה בכל הסביבות, ופעימה שאינה
     * נרשמת היא המצב התקין. `emailIntakeEnabled()` הוא אותו דגל שמחליט אם
     * הטיימר בכלל עולה, ולכן שתי התשובות אינן יכולות להיפרד.
     */
    name: "email-poll-heartbeat",
    async run(now) {
      if (!env.emailIntakeEnabled()) return;

      const at = await getHeartbeat(HEARTBEAT.emailPoll);
      if (heartbeatStale(at, now, EMAIL_POLL_STALE_MS)) {
        throw new Error(
          `סבב קליטת המייל אינו רץ: ${at ? at.toISOString() : "מעולם לא רץ"}`,
        );
      }
    },
  },
  {
    /**
     * **EM-12 — הודעה שנקלטה ולא הוכרעה.**
     *
     * `queue-not-stuck` מביט בטבלת `Job` בלבד, והוא מפספס את המקרה שבו
     * הג׳וב **נעלם**: קריסה בין `claim` ל-`complete` משאירה שורת
     * `MailboxMessage` ב-PENDING בלי ג׳וב שיטפל בה. בנכנס זו הודעה שלא
     * קיבלה הכרעה, ביוצא זו תשובה שלא נשלחה — ובשני הכיוונים מישהו כתב
     * למערכת ולא קיבל דבר, שקט מוחלט.
     *
     * **30 דקות, ו-`nextAttemptAt` עתידי אינו נספר.** כשל זמני מול Gmail
     * דוחה הודעה ב-backoff שמגיע עד שעה (`services/email-intake.ts`), וזו
     * המתנה מתוכננת ולא תקיעות — בדיוק ההבחנה שכבר קיימת ב-`queue-not-stuck`
     * בין PENDING עתידי ל-PENDING באיחור.
     *
     * **בלי תנאי על הדגל, בשונה מהפעימה.** כשהיכולת כבויה הטבלה ריקה ממילא,
     * אבל אם מישהו כיבה אותה באמצע אירוע — ההודעות שכבר נקלטו ולא נענו הן
     * עובדה שאינה משתנה מכיבוי המתג, ועליה צריך להתריע.
     */
    name: "email-intake-not-stuck",
    async run(now) {
      const cutoff = new Date(now.getTime() - MAIL_STUCK_MS);
      const stuck = await db.mailboxMessage.count({
        where: {
          state: "PENDING",
          createdAt: { lt: cutoff },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
      });

      // אותו פרדיקט של התור: כל פריט אחד באיחור הוא כבר תקלה.
      if (queueStuck(stuck)) {
        throw new Error(`${stuck} הודעות מייל ממתינות מעל 30 דקות ללא הכרעה`);
      }
    },
  },
  {
    /**
     * **invariant של תצורה, כמו `google-login-configured` — ומאותו נימוק.**
     *
     * היכולת דלוקה בפרודקשן אבל חסר לה מה שהיא צריכה. שני המצבים שקטים
     * לחלוטין, וכל אחד מהם נראה מבחוץ כמו "אף אחד לא כותב אלינו":
     *
     * - **בלי טוקן Gmail** אין מה לקרוא ואין דרך לענות. הסבב נעצר בכל דקה
     *   ומדווח, אבל שגיאה שחוזרת כל דקה היא בדיוק מה שממוצע rate-limit
     *   בולע; invariant שנשאל כל שש שעות אינו נבלע.
     * - **בלי `GEMINI_API_KEY`** כל מייל נוחת במסלול "החילוץ אינו זמין"
     *   (EM-11) — נוצרת טיוטה שכל תוכנה הוא גוף המייל, ונשלחת תשובה
     *   שמפנה להשלים ידנית. המערכת "עובדת", ובאופן שאינו שווה דבר. זה אינו
     *   סותר את ההחלטה ש-AI הוא רשות (`.env.example`, "שירותי AI"): שם
     *   ההיעדר עולה קובץ אחד בלי תמלול, כאן הוא הופך את החריג לכלל.
     *
     * `isProduction()` **וגם** `emailIntakeEnabled()`: מכונת פיתוח שהדליקה
     * את היכולת מול `EMAIL_INTAKE_NONPROD` עושה זאת ביודעין ובלי מפתחות,
     * ויכולת כבויה אינה "תצורה חסרה" אלא החלטה.
     */
    name: "email-intake-configured",
    async run() {
      if (!env.isProduction() || !env.emailIntakeEnabled()) return;

      const missing: string[] = [];
      if (!env.gmailUser()) missing.push("GMAIL_USER");
      // כול-או-כלום: `gmailApi()` אינו מגלה מי מהשלושה חסר, ולכן שלושתם
      // נמנים — מי שמתקן בודק ממילא את כולם.
      if (!env.gmailApi()) {
        missing.push("GOOGLE_CLIENT_ID+GOOGLE_CLIENT_SECRET+GMAIL_REFRESH_TOKEN");
      }
      if (!env.geminiApiKey()) missing.push("GEMINI_API_KEY");

      if (missing.length > 0) {
        throw new Error(
          `קליטת פניות במייל דלוקה בפרודקשן בלי תצורה מלאה. חסר: ${missing.join(", ")}`,
        );
      }
    },
  },
];
