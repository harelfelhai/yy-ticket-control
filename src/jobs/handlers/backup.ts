import { runBackup } from "@/lib/backup";
import { db } from "@/lib/db";
import { enqueue } from "../queue";
import { nextBackupRun } from "../schedule";
import { JOB_TYPES } from "../types";

/**
 * הג'וב היומי של הגיבוי — עוטף את `runBackup` ומתזמן את המחרת, בדיוק
 * כמו ההסלמה: הלוגיקה בשירות, הג'וב רק מריץ ומתזמן.
 */

export interface BackupOutcome {
  kind: "backup";
  key: string;
  bytes: number;
  pruned: number;
}

export async function runDailyBackup(now: Date = new Date()): Promise<BackupOutcome> {
  const result = await runBackup(now);
  return { kind: "backup", ...result };
}

/**
 * מוודא שיש בדיוק ג'וב גיבוי ממתין אחד, מתוזמן ל-03:00 הבא. אותו דפוס
 * כמו ההסלמה: נקרא בעליית השרת (רשת ביטחון) ואחרי כל ריצה (לתזמן את המחרת).
 */
export async function ensureDailyBackupScheduled(now: Date = new Date()): Promise<void> {
  const pending = await db.job.findFirst({
    where: { type: JOB_TYPES.backup, status: "PENDING" },
    select: { id: true },
  });
  if (pending) return;

  await enqueue(db, JOB_TYPES.backup, {}, nextBackupRun(now));
}
