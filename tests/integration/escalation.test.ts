import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { enqueue } from "@/jobs/queue";
import {
  ensureDailyEscalationScheduled,
  runDailyEscalation,
} from "@/jobs/handlers/escalation";
import { JOB_TYPES } from "@/jobs/types";
import { processNextJob } from "@/jobs/worker";
import { db } from "@/lib/db";
import { STALE_DAYS_THRESHOLD } from "@/lib/ticket-status";
import { resetDb } from "../helpers/reset-db";

const NOW = new Date("2026-05-20T09:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

let siteId: string;
let createdById: string;

/** יוצר פנייה עם תנועה אחרונה לפני `daysAgo` ימים */
async function ticketLastActive(daysAgo: number, extra: Record<string, unknown> = {}) {
  return db.ticket.create({
    data: {
      siteId,
      createdById,
      channel: "SELF",
      description: "תקלה",
      lastActivityAt: new Date(NOW.getTime() - daysAgo * DAY_MS),
      ...extra,
    },
  });
}

beforeEach(async () => {
  await resetDb();
  siteId = (await db.site.create({ data: { name: "אתר" } })).id;
  createdById = (
    await db.user.create({
      data: { role: "SITE_MANAGER", name: "מנהל", phone: "0500000001", passwordHash: "x", siteId },
    })
  ).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("runDailyEscalation", () => {
  it("מסמן פנייה פעילה שחצתה את סף היעדר התנועה", async () => {
    const stale = await ticketLastActive(STALE_DAYS_THRESHOLD + 1);
    const escalated = await runDailyEscalation(NOW);

    expect(escalated).toBe(1);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: stale.id } })).escalated).toBe(true);
  });

  it("אינו נוגע בפנייה שהייתה בה תנועה לאחרונה", async () => {
    const fresh = await ticketLastActive(STALE_DAYS_THRESHOLD - 1);
    await runDailyEscalation(NOW);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: fresh.id } })).escalated).toBe(false);
  });

  it("אינו מסלים פנייה סגורה או טיוטה — הן אינן פעילות", async () => {
    const closed = await ticketLastActive(30, { closedAt: NOW });
    const draft = await ticketLastActive(30, { isDraft: true });

    const escalated = await runDailyEscalation(NOW);
    expect(escalated).toBe(0);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: closed.id } })).escalated).toBe(false);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: draft.id } })).escalated).toBe(false);
  });

  it("אידמפוטנטי — ריצה חוזרת אינה סופרת שוב את מה שכבר מוסלם", async () => {
    await ticketLastActive(30);
    expect(await runDailyEscalation(NOW)).toBe(1);
    // ריצה שנייה: הפנייה כבר escalated, ולכן אינה נספרת שוב.
    expect(await runDailyEscalation(NOW)).toBe(0);
  });
});

describe("ensureDailyEscalationScheduled", () => {
  it("יוצר ג'וב הסלמה ממתין, מתוזמן לעתיד", async () => {
    await ensureDailyEscalationScheduled(NOW);

    const job = await db.job.findFirstOrThrow({
      where: { type: JOB_TYPES.escalate, status: "PENDING" },
    });
    expect(job.runAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("אינו יוצר כפילות אם כבר יש ממתין", async () => {
    await ensureDailyEscalationScheduled(NOW);
    await ensureDailyEscalationScheduled(NOW);
    expect(await db.job.count({ where: { type: JOB_TYPES.escalate, status: "PENDING" } })).toBe(1);
  });
});

describe("הג'וב מקצה לקצה דרך ה-worker", () => {
  it("מריץ את ההסלמה ומתזמן את המחרת", async () => {
    const stale = await ticketLastActive(30);
    // ‏runAt=NOW כדי שהג'וב "יגיע זמנו" מול ה-NOW המדומה שמועבר לעובד.
    await enqueue(db, JOB_TYPES.escalate, {}, NOW);

    const result = await processNextJob({}, NOW);

    if (result?.status !== "done") throw new Error(`ציפינו ל-done, קיבלנו ${result?.status}`);
    expect(result.outcome).toMatchObject({ kind: "escalation", escalated: 1 });
    expect((await db.ticket.findUniqueOrThrow({ where: { id: stale.id } })).escalated).toBe(true);

    // הג'וב שרץ הסתיים, ובמקומו תוזמן ג'וב חדש לעתיד.
    expect(await db.job.count({ where: { type: JOB_TYPES.escalate, status: "DONE" } })).toBe(1);
    const next = await db.job.findFirstOrThrow({
      where: { type: JOB_TYPES.escalate, status: "PENDING" },
    });
    expect(next.runAt.getTime()).toBeGreaterThan(NOW.getTime());
  });
});
