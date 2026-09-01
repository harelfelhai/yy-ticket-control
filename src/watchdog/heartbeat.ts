import { db } from "@/lib/db";

/**
 * פעימות-לב של ג'ובים יומיים.
 *
 * ה-writer (ה-handler היומי) וה-reader (ה-watchdog) הם שני מודולים נפרדים
 * שמסכימים על מחרוזת. ריכוז השמות כאן מונע את הכשל השקט שבו אחד כותב
 * `"backup"` והשני בודק `"daily-backup"`, וה-invariant לעולם אינו מזהה
 * רעננות — כלומר מתריע על שווא לנצח, או גרוע מכך, לא מתריע כשצריך.
 */
export const HEARTBEAT = {
  escalation: "escalation",
  backup: "backup",
} as const;

export type HeartbeatName = (typeof HEARTBEAT)[keyof typeof HEARTBEAT];

/**
 * רושם/מעדכן פעימה. נקרא כ**שורה האחרונה** של ג'וב יומי מוצלח — כך "רץ אבל
 * נכשל באמצע" נקרא כפעימה ישנה (stale), לא כרעננה.
 */
export async function setHeartbeat(name: HeartbeatName, at: Date = new Date()): Promise<void> {
  await db.heartbeat.upsert({
    where: { name },
    create: { name, at },
    update: { at },
  });
}

/**
 * זורע פעימה **רק אם אין כזו** — לעולם אינו דורס קיימת.
 *
 * **התיקון של הכשל שהסתיר 32 לילות גיבוי כושלים.** העלייה קראה כאן
 * ל-`setHeartbeat`, שהוא `update` — כלומר כל פריסה, וכל restart, החזירה את
 * שעון ההתיישנות ל-`now`. הכוונה הייתה נכונה (בהפעלה ראשונה הג'וב היומי
 * עדיין לא רץ, ואין להתריע על שווא), אבל המימוש קנה אותה במחיר של השתקת
 * ה-watchdog ל-27 שעות אחרי **כל** פריסה. בפרויקט שנפרס אוטומטית על כל
 * push ל-main, זו השתקה כמעט תמידית: `backup-heartbeat` יכול היה לצעוק רק
 * אחרי שהפריסות פסקו ליותר מיממה.
 *
 * ‏`update: {}` הוא ההבדל כולו: רשומה קיימת אינה נוגעת, ולכן פעימה ישנה
 * **נשארת ישנה** עד שג'וב שהצליח באמת יעדכן אותה.
 */
export async function seedHeartbeat(name: HeartbeatName, at: Date = new Date()): Promise<void> {
  await db.heartbeat.upsert({
    where: { name },
    create: { name, at },
    update: {},
  });
}

/** זמן הפעימה האחרון, או null אם מעולם לא נרשמה. */
export async function getHeartbeat(name: HeartbeatName): Promise<Date | null> {
  const row = await db.heartbeat.findUnique({ where: { name } });
  return row?.at ?? null;
}
