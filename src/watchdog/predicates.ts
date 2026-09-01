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

/**
 * ג'וב שמיצה את שלושת הניסיונות ונחת ב-FAILED — עבודה שהמערכת התחייבה
 * לעשות ולא עשתה.
 *
 * **הבדיקה הזו נולדה מכשל אמיתי בפרודקשן.** 14 ג'ובי `SEND_NOTIFICATION`
 * ו-32 ג'ובי `DAILY_BACKUP` נכשלו סופית לאורך חודש, כל אחד עם הודעה מדויקת
 * ב-`Job.lastError`, ואיש לא ידע. `queue-not-stuck` לא ראה אותם — הוא מביט
 * ב-PENDING בלבד — ולכידת ה-Sentry הפר-job היא **אירוע חד-פעמי** שנקבר
 * ברשימה. ‏invariant חוזר הוא דבר אחר: הוא נשאל מחדש כל שש שעות, ולכן
 * תקלת תצורה מתמשכת אינה יכולה להיקרא כתקלה שטופלה.
 *
 * **חלון ולא ספירה מצטברת**, כדי לא לייצר אזעקה שאי אפשר לכבות: כשל בודד
 * מתיישן מעצמו תוך יממה, וכשל שיטתי חוזר ומתריע כל יום עד שהוא נפתר. אזעקה
 * שאינה יכולה להיסגר נלמדת להתעלם, וזה בדיוק העיקרון שכתוב ב-`checks.ts`.
 */
export function jobsFailing(failedInWindow: number): boolean {
  return failedInWindow > 0;
}
