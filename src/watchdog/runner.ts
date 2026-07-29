import * as Sentry from "@sentry/nextjs";
import { captureError } from "@/lib/observability/log";
import { checks } from "./checks";

/**
 * ה-watchdog: מריץ את כל ה-invariants ומדווח check-in יחיד ל-Sentry.
 *
 * זו התשובה לכשל שקט — כשל שאינו זורק שום חריגה, ולכן שום SDK לא יראה אותו.
 * הדרך היחידה לתפוס אותו היא לאמת מצב-צפוי על פי לוח זמנים.
 *
 * **‏cron monitor יחיד** (מגבלת ה-free-tier): במקום monitor לכל ג'וב, ה-
 * watchdog מאמת את כולם דרך פעימות-הלב, ומדווח ל-monitor אחד. אם ה-watchdog
 * עצמו מת (התהליך נפל) — ה-check-in לא מגיע ו-Sentry מתריע על "missed".
 * אין שומר בלי שומר.
 *
 * **‏schedule מסוג interval ולא crontab**: ה-watchdog רץ בטיימר in-process,
 * שנסחף מזמני שעון-קיר (00/06/12/18). interval מאמת רק שה-check-in מגיע כל
 * ~6 שעות, בלי לצפות ליישור לשעה עגולה — ולכן לא מסמן "missed" מדומים.
 */
const MONITOR_SLUG = "watchdog";

const MONITOR_CONFIG = {
  schedule: { type: "interval", value: 6, unit: "hour" },
  checkinMargin: 30,
  maxRuntime: 5,
  timezone: "Asia/Jerusalem",
} as const;

export async function runWatchdog(
  now: Date = new Date(),
): Promise<{ total: number; failed: number }> {
  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: MONITOR_SLUG, status: "in_progress" },
    MONITOR_CONFIG,
  );

  let failed = 0;
  for (const check of checks) {
    try {
      await check.run(now);
    } catch (error) {
      failed += 1;
      // issue נפרד ויציב לכל invariant — כך "הגיבוי תקוע" ו"התור תקוע" הם
      // שתי בעיות נפרדות שאפשר לעקוב אחריהן, ולא ערבוב אחד.
      captureError(error, {
        tags: { watchdog_check: check.name },
        fingerprint: ["watchdog", check.name],
      });
    }
  }

  Sentry.captureCheckIn({
    checkInId,
    monitorSlug: MONITOR_SLUG,
    status: failed === 0 ? "ok" : "error",
  });

  return { total: checks.length, failed };
}
