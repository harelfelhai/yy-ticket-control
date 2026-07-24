import "dotenv/config";
import { readFileSync } from "node:fs";
import { restoreDatabaseDump } from "../src/lib/backup/dump";

/**
 * שחזור חירום מגיבוי — **פעולה הרסנית** שמוחקת את בסיס היעד ובונה אותו
 * מחדש מהגיבוי.
 *
 * שימוש: מורידים תחילה את קובץ ה-dump מה-bucket השני ב-R2 (דרך ה-console
 * או aws CLI), ואז:
 *   npx tsx scripts/restore-backup.ts <קובץ-הגיבוי> --yes
 *
 * היעד וה-pg_restore נלקחים מהסביבה (‏DATABASE_URL, ‏PG_RESTORE_PATH). דורש
 * ‏--yes מפורש כדי שהרצה בשוגג לא תמחק בסיס נתונים חי.
 */
async function main(): Promise<void> {
  const [, , dumpPath, confirm] = process.argv;

  if (!dumpPath || confirm !== "--yes") {
    console.error("שימוש: npx tsx scripts/restore-backup.ts <קובץ-הגיבוי> --yes");
    console.error("אזהרה: הפעולה מוחקת את בסיס היעד ובונה אותו מחדש מהגיבוי.");
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL אינו מוגדר. ראה .env.example");
    process.exit(1);
  }

  const pgRestorePath = process.env.PG_RESTORE_PATH ?? "pg_restore";
  const dump = readFileSync(dumpPath);
  const target = new URL(databaseUrl).pathname.replace(/^\//, "");

  console.log(`משחזר ${dumpPath} (${dump.length} בייט) אל בסיס "${target}"…`);
  await restoreDatabaseDump({ databaseUrl, pgRestorePath, dump });
  console.log("השחזור הושלם בהצלחה.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
