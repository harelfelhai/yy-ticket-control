import { env } from "@/lib/env";
import { captureError, logError, logInfo, logWarn } from "@/lib/observability/log";
import { runEmailPoll, type EmailPollDeps, type EmailPollResult } from "@/lib/services/email-poll";
import { HEARTBEAT, seedHeartbeat } from "@/watchdog/heartbeat";

/**
 * הטיימר שמריץ את סבב קליטת המייל.
 *
 * **טיימר ולא ג׳וב בתור, וזו החלטה ולא נוחות.** סבב שהיה ג׳וב היה מייצר
 * שורת `Job` בכל דקה — כ-1,440 ביום, מיליון בשנתיים — בטבלה שכל שאילתת
 * תפיסה סורקת, וכל אחת מהן היא "עבודה שהצליחה ולא עשתה דבר". הסבב גם אינו
 * זקוק לשום דבר שהתור נותן: אין לו מטען, אין לו ניסיונות חוזרים (הסבב הבא
 * **הוא** הניסיון החוזר), ואין לו מצב שצריך לשרוד את התהליך — מה שצריך
 * לשרוד יושב ב-`MailChannelState`.
 *
 * מה שהתור כן נותן, ומה שהטיימר חייב להחזיר: **גילוי של כשל**. לכן סבב
 * מוצלח כותב פעימה (`HEARTBEAT.emailPoll`), וטיימר שמת או סבב שנכשל שוב
 * ושוב נראים כפעימה מתיישנת — `email-poll-heartbeat` ב-watchdog מתריע
 * אחרי רבע שעה.
 */

/**
 * כל כמה זמן נבדקת התיבה.
 *
 * ההבטחה היא מייל חוזר תוך חמש דקות (§2.6 שלב 4), והסבב הוא רק השלב
 * הראשון מתוך שלושה (גילוי → הכרעה → תשובה). דקה משאירה ארבע לשני
 * השלבים שאחריה, ומול Gmail היא זולה: רשימת מזהים לשאילתה אחת.
 */
export const EMAIL_POLL_INTERVAL_MS = 60_000;

/** חלון ההשתקה ללכידות חוזרות — זהה לזה של לולאת העובד */
const ERROR_CAPTURE_INTERVAL_MS = 10 * 60_000;

export interface EmailPollerDeps {
  /** מה שהטיימר מריץ. מוזרק בבדיקה בלבד. */
  run?: (deps?: EmailPollDeps) => Promise<EmailPollResult>;
  intervalMs?: number;
}

const NOOP = () => {};

/**
 * זורע את הפעימה ברגע שהטיימר עולה — **לפני** שהסבב הראשון רץ.
 *
 * הפער שזה סוגר הוא פער של 30 שניות: ה-watchdog רץ לראשונה
 * ב-`WATCHDOG_STARTUP_DELAY_MS` אחרי העלייה, והסבב הראשון רק אחרי דקה. בלי
 * שורה בטבלה `getHeartbeat` מחזיר `null`, `heartbeatStale(null)` אמיתי,
 * ו-`email-poll-heartbeat` פותח issue "מעולם לא רץ" בכל פריסה שבה היכולת
 * דלוקה — כלומר התראה שמפסיקה להבדיל בין טיימר מת לטיימר שעוד לא הספיק.
 *
 * **הזריעה כאן ולא בעליית ה-worker**, בשונה מפעימות ההסלמה והגיבוי: הכותב
 * היחיד של הפעימה הזו הוא הסבב, והתנאי שלה זהה לתנאי של הטיימר — רק כשהדגל
 * דלוק. זריעה בעלייה ללא תנאי הייתה מייצרת שורה שאיש אינו מעדכן במערכת
 * שהיכולת בה כבויה. מכיוון ש-`startWorker` הוא מי שקורא לכאן, הזריעה עדיין
 * קורית בעליית התהליך.
 *
 * `seedHeartbeat` ולא `setHeartbeat`: פעימה קיימת אינה נדרסת, ולכן פריסה
 * חוזרת אינה מאפסת את שעון ההתיישנות ומשתיקה את ה-watchdog (`heartbeat.ts`).
 */
function seedPollHeartbeat(): void {
  // fire-and-forget: `startEmailPoller` נקרא מ-`startWorker` הסינכרוני,
  // והתהליך אינו אמור להמתין ל-DB כדי להתחיל להגיש בקשות.
  void seedHeartbeat(HEARTBEAT.emailPoll).catch((error: unknown) => {
    logError("email.poll.seed_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    captureError(error, {
      tags: { phase: "email-poll-seed" },
      fingerprint: ["email-poll-seed-failed"],
    });
  });
}

/** הטיימר הפעיל בתהליך. אחד לכל היותר — ראה `startEmailPoller`. */
let active: { stop: () => void } | null = null;

/**
 * מפעיל את הטיימר. מחזיר פונקציית עצירה.
 *
 * שלושה כללים, ולכל אחד תרחיש שהוא מונע:
 * 1. **רק כשהיכולת דלוקה** (`emailIntakeEnabled`). כל עוד הדגל כבוי לא
 *    נוצר טיימר כלל — לא "נוצר ומדלג", כדי שמכונה בלי הגדרות לא תחזיק
 *    שעון על כלום.
 * 2. **אידמפוטנטי.** קריאה שנייה מחזירה את אותה עצירה ואינה יוצרת טיימר
 *    שני; שני טיימרים היו קוראים את התיבה פעמיים בדקה ומתחרים על אותם
 *    מזהים.
 * 3. **לעולם לא חופף לעצמו.** סבב שעדיין רץ (20 עמודים מול תיבה איטית
 *    יכולים לחרוג מדקה) גורם לפעימה הבאה לוותר. שני סבבים במקביל אינם
 *    מסוכנים — האינדקס הייחודי מכריע — אבל הם עבודה כפולה מול Gmail
 *    ובבסיס הנתונים, בדיוק כשהמערכת כבר איטית.
 * 4. **זורע את הפעימה בעלייה**, לפני שהסבב הראשון רץ. ראו `seedPollHeartbeat`.
 *
 * `unref` כמו בלולאת העובד: בלעדיו התהליך מסרב להיסגר עד שהפעימה הבאה פגה.
 */
export function startEmailPoller(deps: EmailPollerDeps = {}): () => void {
  if (!env.emailIntakeEnabled()) return NOOP;
  if (active) return active.stop;

  const run = deps.run ?? runEmailPoll;
  const intervalMs = deps.intervalMs ?? EMAIL_POLL_INTERVAL_MS;

  seedPollHeartbeat();

  let busy = false;
  let lastCaptureAt = 0;
  let lastOverlapLogAt = 0;

  const tick = async (): Promise<void> => {
    if (busy) {
      const nowMs = Date.now();
      if (nowMs - lastOverlapLogAt >= ERROR_CAPTURE_INTERVAL_MS) {
        lastOverlapLogAt = nowMs;
        logWarn("email.poll.overlap", { intervalMs });
      }
      return;
    }

    busy = true;
    try {
      await run();
    } catch (error) {
      // `runEmailPoll` מחזיר כשל של הערוץ כ**ערך** (`status: "halted"`),
      // ולכן חריגה כאן היא משהו אחר: בסיס נתונים למטה, או תצורה חסרה
      // (`selectMailSource`). זה נשאר גלוי — אחרת הטיימר היה ממשיך לפעום
      // בשקט על מערכת שאינה קולטת דבר.
      logError("email.poll.tick_failed", { message: error instanceof Error ? error.message : String(error) });

      const nowMs = Date.now();
      if (nowMs - lastCaptureAt >= ERROR_CAPTURE_INTERVAL_MS) {
        lastCaptureAt = nowMs;
        captureError(error, { tags: { phase: "email-poll-tick" }, fingerprint: ["email-poll-tick-failed"] });
      }
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();

  const stop = () => {
    clearInterval(timer);
    if (active?.stop === stop) active = null;
  };

  active = { stop };
  logInfo("email.poll.started", { intervalMs });
  return stop;
}
