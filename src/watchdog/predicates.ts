/**
 * הפרדיקטים הטהורים של ה-watchdog — בלי DB ובלי Sentry.
 *
 * מופרדים מ-`checks.ts` (שנוגע ב-DB) כדי שיהיו ניתנים לבדיקת unit מהירה עם
 * שעון וערכים מוזרקים, בלי לגרור את מופע ה-Prisma לסביבת ה-jsdom.
 */

/** פעימה ישנה מדי (או שאין) פירושה שהג'וב היומי הפסיק לרוץ בשקט. */
export function heartbeatStale(at: Date | null, now: Date, maxAgeMs: number): boolean {
  return !at || now.getTime() - at.getTime() > maxAgeMs;
}

/** ‏PENDING שהיה אמור לרוץ מזמן פירושו שלולאת ה-poll (כל 2ש') כנראה מתה. */
export function queueStuck(overdueCount: number): boolean {
  return overdueCount > 0;
}
