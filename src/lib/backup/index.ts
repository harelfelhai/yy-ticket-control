import { env } from "@/lib/env";
import { createDatabaseDump, restoreDatabaseDump } from "./dump";
import { type BackupStore, selectBackupStore } from "./store";

export type { BackupStore } from "./store";
export { selectBackupStore } from "./store";

/**
 * הגיבוי הלילי: ‏pg_dump → יעד אחסון → ניקוי גיבויים ישנים.
 *
 * מה שאינו כאן, בכוונה: **גיבוי בתי המדיה עצמם.** המדיה יושבת ב-R2 שעמיד
 * בפני עצמו, וה-MediaFile (השורות שמצביעות עליה) נכללות ב-dump. נקודת הכשל
 * היחידה היא בסיס הנתונים, וזה מה שהגיבוי היומי מכסה. העתקת בתי המדיה
 * ל-bucket השני היא צעד תפעולי תקופתי, לא ליבת הגיבוי היומי.
 */

export interface BackupResult {
  key: string;
  bytes: number;
  /** כמה גיבויים ישנים נמחקו בניקוי */
  pruned: number;
}

/** כמה גיבויים יומיים לשמור — שבועיים, חלון התאוששות סביר בלי שהיעד יתפח. */
export const BACKUP_RETENTION = 14;

const KEY_PREFIX = "db/";

/** חותמת זמן בטוחה כשם קובץ ב-Windows (בלי נקודתיים) וכמפתח ב-R2 */
function backupKey(now: Date): string {
  return `${KEY_PREFIX}${now.toISOString().replace(/[:.]/g, "-")}.dump`;
}

export interface BackupDeps {
  store?: BackupStore;
  pgDumpPath?: string;
  databaseUrl?: string;
}

export async function runBackup(now: Date, deps: BackupDeps = {}): Promise<BackupResult> {
  const dump = await createDatabaseDump({
    databaseUrl: deps.databaseUrl ?? env.databaseUrl(),
    pgDumpPath: deps.pgDumpPath ?? env.pgDumpPath(),
  });

  const store = deps.store ?? selectBackupStore();
  const key = backupKey(now);
  await store.put(key, dump);

  const pruned = await pruneOldBackups(store);
  return { key, bytes: dump.length, pruned };
}

/**
 * מוחק גיבויים מעבר ל-BACKUP_RETENTION האחרונים. המפתחות נושאים חותמת ISO
 * ולכן מיון לקסיקוגרפי שקול למיון כרונולוגי — הישנים בתחילת הרשימה.
 */
async function pruneOldBackups(store: BackupStore): Promise<number> {
  const keys = (await store.list(KEY_PREFIX)).sort();
  const excess = keys.slice(0, Math.max(0, keys.length - BACKUP_RETENTION));
  for (const key of excess) await store.remove(key);
  return excess.length;
}

export interface RestoreDeps {
  databaseUrl?: string;
  pgRestorePath?: string;
}

/**
 * שחזור מלא מגיבוי — **פעולה הרסנית** שמוחקת את היעד ובונה אותו מחדש.
 * משמש את בדיקת הסבב המלא ואת scripts/restore-backup.mjs. אינו נקרא מהג'וב.
 */
export async function restoreBackup(dump: Buffer, deps: RestoreDeps = {}): Promise<void> {
  await restoreDatabaseDump({
    databaseUrl: deps.databaseUrl ?? env.databaseUrl(),
    pgRestorePath: deps.pgRestorePath ?? env.pgRestorePath(),
    dump,
  });
}
