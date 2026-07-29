import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runDailyEscalation } from "@/jobs/handlers/escalation";
import { db } from "@/lib/db";
import { HEARTBEAT, getHeartbeat, setHeartbeat } from "@/watchdog/heartbeat";
import { resetDb } from "../helpers/reset-db";

/**
 * פעימות-הלב הן הבסיס ל-watchdog: הן הסימן ש"ג'וב יומי רץ". אם הכתיבה
 * שלהן שבורה, ה-watchdog מתריע על שווא (או שותק כשצריך).
 */

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("setHeartbeat / getHeartbeat", () => {
  it("מחזיר null כשמעולם לא נרשמה פעימה", async () => {
    expect(await getHeartbeat(HEARTBEAT.escalation)).toBeNull();
  });

  it("כותב פעימה, ומעדכן אותה (upsert) ולא יוצר כפילה", async () => {
    const first = new Date("2026-07-01T03:00:00.000Z");
    await setHeartbeat(HEARTBEAT.backup, first);
    expect((await getHeartbeat(HEARTBEAT.backup))?.toISOString()).toBe(first.toISOString());

    const second = new Date("2026-07-02T03:00:00.000Z");
    await setHeartbeat(HEARTBEAT.backup, second);
    expect((await getHeartbeat(HEARTBEAT.backup))?.toISOString()).toBe(second.toISOString());
    expect(await db.heartbeat.count()).toBe(1);
  });
});

describe("ריצה יומית מקדמת את הפעימה", () => {
  it("הסלמה מוצלחת רושמת פעימה טרייה", async () => {
    const now = new Date("2026-07-15T06:00:00.000Z");
    // אין מה להסלים — אבל הריצה עדיין מצליחה וחייבת לרשום פעימה.
    await runDailyEscalation(now);

    expect((await getHeartbeat(HEARTBEAT.escalation))?.toISOString()).toBe(now.toISOString());
  });
});
