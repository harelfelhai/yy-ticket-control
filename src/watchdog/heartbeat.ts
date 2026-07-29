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

/** זמן הפעימה האחרון, או null אם מעולם לא נרשמה. */
export async function getHeartbeat(name: HeartbeatName): Promise<Date | null> {
  const row = await db.heartbeat.findUnique({ where: { name } });
  return row?.at ?? null;
}
