import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { JOB_TYPES } from "@/jobs/types";
import { db } from "@/lib/db";
import { checks } from "@/watchdog/checks";
import { HEARTBEAT, setHeartbeat } from "@/watchdog/heartbeat";
import { resetDb } from "../helpers/reset-db";

/**
 * ה-checks של ה-watchdog מול DB אמיתי: הם הרשת שתופסת כשל שקט, ולכן חייבים
 * לעבור כשהמצב תקין ולזרוק כשהוא לא — שני המסלולים.
 */

const now = new Date("2026-07-15T12:00:00.000Z");
const HOUR = 60 * 60_000;

function check(name: string) {
  const found = checks.find((c) => c.name === name);
  if (!found) throw new Error(`אין check בשם ${name}`);
  return found;
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("escalation-heartbeat", () => {
  it("פעימה טרייה עוברת", async () => {
    await setHeartbeat(HEARTBEAT.escalation, new Date(now.getTime() - HOUR));
    await expect(check("escalation-heartbeat").run(now)).resolves.toBeUndefined();
  });

  it("פעימה חסרה זורקת", async () => {
    await expect(check("escalation-heartbeat").run(now)).rejects.toThrow();
  });

  it("פעימה ישנה מ-26 שעות זורקת", async () => {
    await setHeartbeat(HEARTBEAT.escalation, new Date(now.getTime() - 30 * HOUR));
    await expect(check("escalation-heartbeat").run(now)).rejects.toThrow();
  });
});

describe("backup-heartbeat", () => {
  it("פעימה טרייה עוברת", async () => {
    await setHeartbeat(HEARTBEAT.backup, new Date(now.getTime() - HOUR));
    await expect(check("backup-heartbeat").run(now)).resolves.toBeUndefined();
  });

  it("פעימה ישנה מ-27 שעות זורקת", async () => {
    await setHeartbeat(HEARTBEAT.backup, new Date(now.getTime() - 30 * HOUR));
    await expect(check("backup-heartbeat").run(now)).rejects.toThrow();
  });
});

describe("queue-not-stuck", () => {
  it("תור נקי עובר", async () => {
    await expect(check("queue-not-stuck").run(now)).resolves.toBeUndefined();
  });

  it("PENDING באיחור מעל הסף זורק — לולאת ה-poll כנראה מתה", async () => {
    await db.job.create({
      data: {
        type: JOB_TYPES.notify,
        payload: {},
        status: "PENDING",
        runAt: new Date(now.getTime() - HOUR),
      },
    });
    await expect(check("queue-not-stuck").run(now)).rejects.toThrow();
  });

  it("PENDING עתידי (backoff של retry) אינו נחשב תקוע", async () => {
    await db.job.create({
      data: {
        type: JOB_TYPES.notify,
        payload: {},
        status: "PENDING",
        runAt: new Date(now.getTime() + 5 * 60_000),
      },
    });
    await expect(check("queue-not-stuck").run(now)).resolves.toBeUndefined();
  });
});
