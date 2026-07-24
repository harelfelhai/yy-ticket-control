import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ensureDailyBackupScheduled } from "@/jobs/handlers/backup";
import { enqueue } from "@/jobs/queue";
import { JOB_TYPES } from "@/jobs/types";
import { processNextJob } from "@/jobs/worker";
import { BACKUP_RETENTION, restoreBackup, runBackup } from "@/lib/backup";
import { createDatabaseDump } from "@/lib/backup/dump";
import type { BackupStore } from "@/lib/backup/store";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { resetDb } from "../helpers/reset-db";

/**
 * הגיבוי נבדק מול pg_dump / pg_restore אמיתיים ומול Postgres אמיתי — לא מול
 * mock. הבדיקה החשובה כאן היא **סבב מלא**: גיבוי → שינוי → שחזור → אימות
 * שהנתונים חזרו. גיבוי שלא נבדק שהוא בר-שחזור אינו גיבוי, וזו הדרך היחידה
 * לדעת שהוא כזה.
 */

/** חנות בזיכרון לבדיקת הלוגיקה של runBackup + retention, בלי דיסק */
function memoryStore(): BackupStore & { keys: () => string[] } {
  const map = new Map<string, Buffer>();
  return {
    name: "memory",
    keys: () => [...map.keys()],
    async put(key, body) {
      map.set(key, body);
    },
    async list(prefix) {
      return [...map.keys()].filter((key) => key.startsWith(prefix));
    },
    async remove(key) {
      map.delete(key);
    },
  };
}

const dumpOptions = () => ({
  databaseUrl: env.databaseUrl(),
  pgDumpPath: env.pgDumpPath(),
});

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("createDatabaseDump", () => {
  it("מייצר גיבוי לא-ריק בפורמט custom של pg_dump", async () => {
    const dump = await createDatabaseDump(dumpOptions());
    expect(dump.length).toBeGreaterThan(0);
    // חתימת פורמט ה-custom של pg_dump
    expect(dump.subarray(0, 5).toString("latin1")).toBe("PGDMP");
  });
});

describe("runBackup", () => {
  it("כותב גיבוי ליעד ומחזיר מפתח וגודל", async () => {
    const store = memoryStore();
    const result = await runBackup(new Date("2026-07-24T03:00:00.000Z"), { store });

    expect(result.key).toMatch(/^db\/.*\.dump$/);
    expect(result.bytes).toBeGreaterThan(0);
    expect(store.keys()).toContain(result.key);
  });

  it("שומר רק את BACKUP_RETENTION הגיבויים האחרונים", async () => {
    const store = memoryStore();
    for (let i = 1; i <= BACKUP_RETENTION; i++) {
      const day = String(i).padStart(2, "0");
      await store.put(`db/2026-07-${day}T03-00-00-000Z.dump`, Buffer.from("ישן"));
    }

    // גיבוי חדש עם חותמת מאוחרת יותר — מפנה את הישן ביותר
    const result = await runBackup(new Date("2026-08-01T03:00:00.000Z"), { store });

    expect(result.pruned).toBe(1);
    expect(store.keys()).toHaveLength(BACKUP_RETENTION);
    expect(store.keys()).not.toContain("db/2026-07-01T03-00-00-000Z.dump");
    expect(store.keys()).toContain(result.key);
  });
});

describe("סבב מלא: גיבוי → שינוי → שחזור", () => {
  it("השחזור מחזיר בדיוק את מצב הנתונים שבזמן הגיבוי", async () => {
    const site = await db.site.create({ data: { name: "אתר גיבוי" } });
    await db.building.create({ data: { siteId: site.id, name: "בניין שנשמר" } });
    await db.domain.create({ data: { name: "חשמל" } });

    const dump = await createDatabaseDump(dumpOptions());

    // משנים את המצב אחרי הגיבוי: הוספה ומחיקה
    await db.site.create({ data: { name: "אתר שנוצר אחרי הגיבוי" } });
    await db.building.deleteMany({});

    await restoreBackup(dump, {
      databaseUrl: env.databaseUrl(),
      pgRestorePath: env.pgRestorePath(),
    });

    // אחרי השחזור: המצב חוזר בדיוק לרגע הגיבוי
    const sites = await db.site.findMany({ orderBy: { name: "asc" } });
    expect(sites.map((s) => s.name)).toEqual(["אתר גיבוי"]);

    const buildings = await db.building.findMany();
    expect(buildings.map((b) => b.name)).toEqual(["בניין שנשמר"]);
  });
});

describe("ensureDailyBackupScheduled", () => {
  it("יוצר ג'וב גיבוי ממתין אחד, ואינו משכפל", async () => {
    const now = new Date("2026-07-24T09:00:00Z");
    await ensureDailyBackupScheduled(now);
    await ensureDailyBackupScheduled(now); // שנייה — לא אמורה ליצור עוד

    const pending = await db.job.findMany({
      where: { type: JOB_TYPES.backup, status: "PENDING" },
    });
    expect(pending).toHaveLength(1);
    // מתוזמן קדימה, ל-03:00 הבא
    expect(pending[0].runAt.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("worker: ג'וב הגיבוי", () => {
  it("מריץ את הגיבוי ומתזמן את המחרת", async () => {
    const now = new Date("2026-07-24T03:00:00Z");
    await enqueue(db, JOB_TYPES.backup, {}, now);

    const result = await processNextJob({}, now);
    if (result?.status !== "done") throw new Error("ג'וב הגיבוי לא הושלם");
    expect(result.outcome).toMatchObject({ kind: "backup" });

    // אחרי הריצה — יש ג'וב גיבוי חדש ממתין (המחרת)
    const pending = await db.job.findFirst({
      where: { type: JOB_TYPES.backup, status: "PENDING" },
    });
    expect(pending).not.toBeNull();
  });
});
