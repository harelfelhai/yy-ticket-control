import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JOB_TYPES } from "@/jobs/types";
import { db } from "@/lib/db";
import { handleWaIntake } from "@/lib/services/wa-intake";
import { BURST_CEILING_MS, BURST_QUIET_MS } from "@/lib/whatsapp/burst";
import { resetDb } from "../helpers/reset-db";

/**
 * ההכרעה על דיווחים בוואטסאפ, **במצב shadow** (אפיון §2.7, §5.ה5): הקיבוץ
 * לדיווחים (WA-02), סדר ההכרעה, והכלל שבמצב הזה דבר אינו מבוצע — אין טיוטה
 * ואין הודעה, רק ההכרעה על השורות ו-`shadow: true`.
 *
 * ההודעות נוצרות ישירות ביומן, כפי ש-`wa-webhook.ts` משאיר אותן; הרישום עצמו
 * נבדק ב-`wa-webhook.test.ts`.
 */

const T0 = new Date("2026-10-04T10:00:00Z").getTime();
const at = (ms: number) => new Date(T0 + ms);
const SEC = 1000;

let numberId: string;
let seq = 0;

beforeEach(async () => {
  await resetDb();
  seq = 0;
  vi.stubEnv("WHATSAPP_INTAKE_PILOT_PHONES", "");
  numberId = (
    await db.waNumber.create({
      data: { phoneNumberId: "300000000000002", wabaId: "1", displayPhone: "1", tokenCipher: "x", activatedAt: at(-3600 * SEC) },
    })
  ).id;
});

afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await db.$disconnect();
});

async function makeUser(overrides: { role?: "ADMIN" | "SITE_MANAGER"; siteId?: string | null; active?: boolean } = {}) {
  return db.user.create({
    data: { role: "ADMIN", name: "בודק", phone: `05000000${10 + seq++}`, passwordHash: "x", ...overrides },
  });
}

async function pending(authorUserId: string, offsetMs: number, text: string | null, extra: { contextWamid?: string } = {}) {
  return db.waMessage.create({
    data: {
      direction: "INBOUND",
      state: "PENDING",
      numberId,
      authorUserId,
      type: text === null ? "image" : "text",
      text,
      receivedAt: at(offsetMs),
      wamid: `wamid.in-${seq++}`,
      ...extra,
    },
  });
}

describe("WA-02 — דיווח אחד מהודעות רצופות, ומתי מכריעים", () => {
  it("\"תקלה\" — אחרי 90 שניות שקט: DRAFT_CREATED, shadow, והטקסט נשאר", async () => {
    const user = await makeUser();
    const row = await pending(user.id, 0, "תקלה בדירה 12");

    const result = await handleWaIntake({ waMessageId: row.id }, { now: at(BURST_QUIET_MS) });
    expect(result).toMatchObject({ status: "decided", units: [{ size: 1, outcome: "DRAFT_CREATED" }], waitUntil: null });
    expect(await db.waMessage.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      state: "DONE",
      outcome: "DRAFT_CREATED",
      shadow: true,
      text: "תקלה בדירה 12",
      nextAttemptAt: null,
    });
    // shadow: שום דבר אינו מבוצע
    expect(await db.ticket.count()).toBe(0);
    expect(await db.waMessage.count({ where: { direction: "OUTBOUND" } })).toBe(0);
  });

  it("לפני השקט: אין הכרעה, והג׳וב מתוזמן מחדש למועד שבו הדיווח ייסגר", async () => {
    const user = await makeUser();
    const row = await pending(user.id, 0, "תקלה");

    const result = await handleWaIntake({ waMessageId: row.id }, { now: at(30 * SEC) });
    expect(result).toMatchObject({ status: "decided", units: [], waitUntil: at(BURST_QUIET_MS) });
    expect(await db.waMessage.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      state: "PENDING",
      nextAttemptAt: at(BURST_QUIET_MS),
    });
    const jobs = await db.job.findMany({ where: { type: JOB_TYPES.waIntake } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.runAt).toEqual(at(BURST_QUIET_MS));
  });

  it("תמונות ואחריהן \"תקלה\" כעבור שלוש דקות: דיווח אחד שכולל את התמונות", async () => {
    const user = await makeUser();
    await pending(user.id, 0, null);
    await pending(user.id, 20 * SEC, null);
    const last = await pending(user.id, 180 * SEC, "תקלה בדירה 12");

    const result = await handleWaIntake({ waMessageId: last.id }, { now: at(180 * SEC + BURST_QUIET_MS) });
    expect(result).toMatchObject({ units: [{ size: 3, outcome: "DRAFT_CREATED" }] });
    expect(await db.waMessage.count({ where: { outcome: "DRAFT_CREATED" } })).toBe(3);
  });

  it("בלי המילה: מחכים לתקרה, ואז IGNORED_NO_KEYWORD — והתוכן נמחק", async () => {
    const user = await makeUser();
    const row = await pending(user.id, 0, "מתי אתה מגיע?");

    expect(await handleWaIntake({ waMessageId: row.id }, { now: at(5 * 60 * SEC) })).toMatchObject({
      units: [],
      waitUntil: at(BURST_CEILING_MS),
    });
    await handleWaIntake({ waMessageId: row.id }, { now: at(BURST_CEILING_MS) });
    expect(await db.waMessage.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      state: "DONE",
      outcome: "IGNORED_NO_KEYWORD",
      text: null,
      profileName: null,
    });
  });

  it("ג׳וב כפול אחרי ההכרעה אינו מוצא מה להכריע", async () => {
    const user = await makeUser();
    const row = await pending(user.id, 0, "תקלה");
    await handleWaIntake({ waMessageId: row.id }, { now: at(BURST_QUIET_MS) });
    expect(await handleWaIntake({ waMessageId: row.id }, { now: at(BURST_QUIET_MS) })).toMatchObject({
      status: "nothing-pending",
    });
  });

  it("הודעות של שולח אחר אינן נכנסות לדיווח", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const mine = await pending(a.id, 0, "תקלה");
    await pending(b.id, 10 * SEC, "מה נשמע");

    await handleWaIntake({ waMessageId: mine.id }, { now: at(BURST_QUIET_MS + 10 * SEC) });
    expect(await db.waMessage.count({ where: { authorUserId: b.id, state: "PENDING" } })).toBe(1);
  });
});

describe("ההכרעה על דיווח", () => {
  it("מנהל עבודה שאינו משויך לאתר: NO_SITE", async () => {
    const user = await makeUser({ role: "SITE_MANAGER", siteId: null });
    const row = await pending(user.id, 0, "תקלה");
    await handleWaIntake({ waMessageId: row.id }, { now: at(BURST_QUIET_MS) });
    expect((await db.waMessage.findUniqueOrThrow({ where: { id: row.id } })).outcome).toBe("NO_SITE");
  });

  it("WA-10 — השולח נבדק בזמן ההכרעה: הושבת בינתיים — IGNORED_UNAUTHORIZED", async () => {
    const user = await makeUser();
    const row = await pending(user.id, 0, "תקלה");
    await db.user.update({ where: { id: user.id }, data: { active: false } });
    await handleWaIntake({ waMessageId: row.id }, { now: at(BURST_QUIET_MS) });
    expect(await db.waMessage.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      outcome: "IGNORED_UNAUTHORIZED",
      text: null,
    });
  });

  it("יצא מהפיילוט בינתיים — IGNORED_UNAUTHORIZED", async () => {
    const user = await makeUser();
    const row = await pending(user.id, 0, "תקלה");
    vi.stubEnv("WHATSAPP_INTAKE_PILOT_PHONES", "0509999999");
    await handleWaIntake({ waMessageId: row.id }, { now: at(BURST_QUIET_MS) });
    expect((await db.waMessage.findUniqueOrThrow({ where: { id: row.id } })).outcome).toBe("IGNORED_UNAUTHORIZED");
  });
});

describe("WA-09/WA-11 — תגובה (Reply) להודעה בשיחה של טיוטה", () => {
  /** טיוטה מוואטסאפ, עם הודעת אישור שלנו בשיחה שלה */
  async function draftWithAck(owner: { id: string }, ticket: { isDraft?: boolean; siteId?: string | null } = {}) {
    const site = ticket.isDraft === false ? await db.site.create({ data: { name: "אתר" } }) : null;
    const draft = await db.ticket.create({
      data: {
        createdById: owner.id,
        channel: "WHATSAPP",
        isDraft: ticket.isDraft ?? true,
        siteId: ticket.siteId ?? site?.id ?? null,
        description: "נזילה",
      },
    });
    const thread = await db.waThread.create({ data: { ticketId: draft.id } });
    await db.waMessage.create({
      data: { direction: "OUTBOUND", state: "SENT", numberId, type: "text", wamid: "wamid.ACK", threadId: thread.id },
    });
    return { draft, thread };
  }

  it("תגובה לאישור של טיוטה פתוחה: REPLY_APPLIED, גם בלי המילה", async () => {
    const user = await makeUser();
    await draftWithAck(user);
    const reply = await pending(user.id, 0, "דירה 14", { contextWamid: "wamid.ACK" });
    await handleWaIntake({ waMessageId: reply.id }, { now: at(BURST_QUIET_MS) });
    expect((await db.waMessage.findUniqueOrThrow({ where: { id: reply.id } })).outcome).toBe("REPLY_APPLIED");
  });

  it("תגובה עם \"תקלה\" היא השלמה ולא טיוטה חדשה (§5.ה5 כלל 2)", async () => {
    const user = await makeUser();
    await draftWithAck(user);
    const reply = await pending(user.id, 0, "עוד תקלה באותה דירה", { contextWamid: "wamid.ACK" });
    await handleWaIntake({ waMessageId: reply.id }, { now: at(BURST_QUIET_MS) });
    expect((await db.waMessage.findUniqueOrThrow({ where: { id: reply.id } })).outcome).toBe("REPLY_APPLIED");
  });

  it("הטיוטה נמחקה: REPLY_AFTER_DELETION", async () => {
    const user = await makeUser();
    const { draft } = await draftWithAck(user);
    await db.ticket.delete({ where: { id: draft.id } });
    const reply = await pending(user.id, 0, "דירה 14", { contextWamid: "wamid.ACK" });
    await handleWaIntake({ waMessageId: reply.id }, { now: at(BURST_QUIET_MS) });
    expect((await db.waMessage.findUniqueOrThrow({ where: { id: reply.id } })).outcome).toBe("REPLY_AFTER_DELETION");
  });

  it("הטיוטה שוגרה: REPLY_AFTER_DISPATCH", async () => {
    const user = await makeUser();
    await draftWithAck(user, { isDraft: false });
    const reply = await pending(user.id, 0, "דירה 14", { contextWamid: "wamid.ACK" });
    await handleWaIntake({ waMessageId: reply.id }, { now: at(BURST_QUIET_MS) });
    expect((await db.waMessage.findUniqueOrThrow({ where: { id: reply.id } })).outcome).toBe("REPLY_AFTER_DISPATCH");
  });

  it("תגובה להודעה שאינה בשיחה של טיוטה: נבחנת כמו כל הודעה", async () => {
    const user = await makeUser();
    await db.waMessage.create({ data: { direction: "INBOUND", state: "DONE", numberId, type: "text", wamid: "wamid.CHAT" } });
    const reply = await pending(user.id, 0, "בסדר", { contextWamid: "wamid.CHAT" });
    await handleWaIntake({ waMessageId: reply.id }, { now: at(BURST_QUIET_MS) });
    expect((await db.waMessage.findUniqueOrThrow({ where: { id: reply.id } })).outcome).toBe("IGNORED_NO_KEYWORD");
  });
});
