import * as Sentry from "@sentry/nextjs";

/**
 * מקור אמת יחיד ללוגים ולתפיסת שגיאות — עטיפה דקה מעל Sentry.
 *
 * למה קיים: בלי נקודת כניסה אחת, כל קורא היה בוחר לבד בין `console.error`
 * (נבלע), זריקה (רק במסלול בקשה נתפסת), ו-`Sentry.captureException` הישיר.
 * ריכוז כאן נותן חתימה אחת שאפשר לקרוא לה **גם ממסלול הבקשה וגם מה-worker**
 * (ה-worker אינו בקשה, ולכן `onRequestError` אינו מכסה אותו — שם צריך
 * לכידה מפורשת).
 *
 * הקובץ מייבא **רק** את `@sentry/nextjs` (איזומורפי — בטוח בשרת, ב-Edge
 * וב-worker). אין לייבא כאן `db` או מודולים של Node, כדי שיישאר נטול-תלות
 * וניתן לקריאה מכל מקום.
 *
 * כשאין DSN (בדיקות, E2E) כל הפונקציות הן no-op שקט — Sentry פשוט מושבת.
 */

/**
 * ערכי לוג חייבים להיות פרימיטיביים. Sentry Logs שומר attributes כשדות
 * חיפושיים, ואובייקט מקונן אינו נשמר כך. מזהים ומספרים — כן; ה-Error עצמו
 * הולך ל-`captureError`, לא ל-attributes.
 */
export type LogAttributes = Record<string, string | number | boolean | null | undefined>;

export interface CaptureContext {
  tags?: Record<string, string>;
  /** מקבץ אירועים ל-issue יחיד ויציב בין ריצות — למשל ["job-failed", jobType] */
  fingerprint?: string[];
  level?: Sentry.SeverityLevel;
}

/**
 * אירוע עסקי חיפושי. ה-`event` הוא שם יציב מנוקד (`"notify.sent"`,
 * `"ticket.created"`) — **לא** מחרוזת מ-`he.ts`, שהיא למשתמש בלבד. המזהים
 * עוברים ב-attributes כדי שיהיו ניתנים לסינון ב-Logs.
 */
export function logInfo(event: string, attributes?: LogAttributes): void {
  Sentry.logger.info(event, attributes);
}

export function logWarn(event: string, attributes?: LogAttributes): void {
  Sentry.logger.warn(event, attributes);
}

export function logError(event: string, attributes?: LogAttributes): void {
  Sentry.logger.error(event, attributes);
}

/**
 * שולח שגיאה ל-Sentry. מנרמל כל דבר שאינו Error ל-Error, כדי שתמיד יהיה
 * stack ו-issue קריא. ה-`fingerprint` קובע איזה כשלים מתמזגים ל-issue אחד.
 */
export function captureError(error: unknown, context?: CaptureContext): void {
  const normalized = error instanceof Error ? error : new Error(String(error));
  Sentry.captureException(normalized, {
    tags: context?.tags,
    fingerprint: context?.fingerprint,
    level: context?.level,
  });
}
