import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WaOutcome } from "@/generated/prisma/enums";
import { enqueue } from "@/jobs/queue";
import { JOB_TYPES } from "@/jobs/types";
import { processNextJob } from "@/jobs/worker";
import { db } from "@/lib/db";
import * as log from "@/lib/observability/log";
import { SERVICE_WINDOW_MS, markWaReplyFailed, sendWaReply } from "@/lib/services/wa-reply";
import { BURST_QUIET_MS } from "@/lib/whatsapp/burst";
import { WINDOW_CLOSED_CODE, WaApiError } from "@/lib/whatsapp/errors";
import { WHATSAPP_REPLY_SPEC as SPEC } from "../../conformance/fixtures/spec-text";
import { fakeFieldExtractor } from "../helpers/fake-field-extractor";
import { fakeWaApi } from "../helpers/fake-wa-api";
import { resetDb } from "../helpers/reset-db";

/**
 * הודעת האישור בוואטסאפ (W6, אפיון §2.7 שלב 4, "ההודעות היוצאות בוואטסאפ"):
 * מה נשלח, למי, כתגובה לאיזו הודעה — ומה **אינו** נשלח: אחרי 24 שעות (§7 שורה 102),
 * על טיוטה ששוגרה או נמחקה בינתיים (§7 שורה 77), וממספר שנותק.
 *
 * הנוסח עצמו נבדק מול האפיון ב-`whatsapp-templates.test.ts`; כאן מספיק שהמשפט
 * הפותח והקישור הנכון יצאו, ושהשורה במסד מתעדת מה קרה.
 */

const NOW = new Date("2026-10-05T10:05:00Z");
const SENT_AT = new Date(NOW.getTime() - 2 * 60_000);
const BASE_URL = "https://yy.example";

let numberId: string;
let userId: string;

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("APP_BASE_URL", BASE_URL);
  vi.stubEnv("WHATSAPP_INTAKE_PILOT_PHONES", "");
  numberId = (
    await db.waNumber.create({
      data: {
        phoneNumberId: "300000000000002",
        wabaId: "1",
        displayPhone: "1",
        tokenCipher: "x",
        activatedAt: new Date(NOW.getTime() - 86_400_000),
      },
    })
  ).id;
  userId = (await db.user.create({ data: { role: "ADMIN", name: "דנה כהן", phone: "0500000077", passwordHash: "x" } })).id;
});

afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await db.$disconnect();
});

/**
 * המצב שהקליטה משאירה: הודעה נכנסת שהוכרעה, בשיחה של טיוטה כשיש כזו, ושורה יוצאת
 * שממתינה לשליחה.
 */
async function decided(
  options: {
    outcome?: WaOutcome;
    draft?: boolean;
    waId?: string | null;
    bsuid?: string | null;
    receivedAt?: Date;
  } = {},
) {
  const outcome = options.outcome ?? "DRAFT_CREATED";
  let threadId: string | null = null;
  let ticketId: string | null = null;
  if (options.draft ?? outcome.startsWith("DRAFT_")) {
    const site = await db.site.create({ data: { name: "נווה שאנן" } });
    const ticket = await db.ticket.create({
      data: { createdById: userId, channel: "WHATSAPP", isDraft: true, siteId: site.id, description: "נזילה מהתקרה" },
    });
    ticketId = ticket.id;
    threadId = (await db.waThread.create({ data: { ticketId: ticket.id } })).id;
  }
  const inbound = await db.waMessage.create({
    data: {
      direction: "INBOUND",
      state: "DONE",
      outcome,
      numberId,
      authorUserId: userId,
      type: "text",
      text: "תקלה בדירה 12",
      wamid: "wamid.LAST",
      waId: options.waId === undefined ? "972500000077" : options.waId,
      bsuid: options.bsuid ?? null,
      receivedAt: options.receivedAt ?? SENT_AT,
      threadId,
      report: { updated: [], notFound: [], ambiguous: [] },
    },
  });
  const outbound = await db.waMessage.create({
    data: { direction: "OUTBOUND", state: "PENDING", numberId, type: "text", repliesToId: inbound.id, threadId, authorUserId: userId },
  });
  return { inbound, outbound, ticketId };
}

const plain = (text: string) => text.replaceAll("*", "");

describe("WA-08 — הודעת אישור: באותו צ'אט, כתגובה להודעה האחרונה בדיווח", () => {
  it("טיוטה חדשה: הנוסח הכללי, לטלפון של השולח, עם ציטוט ההודעה — וה-wamid נשמר", async () => {
    const { outbound, ticketId } = await decided();
    const api = fakeWaApi();

    const result = await sendWaReply({ waMessageId: outbound.id }, { api, now: NOW });
    expect(result).toMatchObject({ status: "sent", template: "L01", latencySec: 120 });

    expect(api.sent).toHaveLength(1);
    const [message] = api.sent;
    expect(message).toMatchObject({ phoneNumberId: "300000000000002", to: { phone: "972500000077" }, contextWamid: "wamid.LAST" });
    expect(plain(message!.body).startsWith(SPEC.opening("דנה כהן"))).toBe(true);
    expect(message!.body).toContain(`${BASE_URL}/tickets/${ticketId}`);

    expect(await db.waMessage.findUniqueOrThrow({ where: { id: outbound.id } })).toMatchObject({
      state: "SENT",
      wamid: message!.wamid,
      text: message!.body,
      sentAt: NOW,
      waId: "972500000077",
      attempts: 1,
      detail: null,
    });
  });

  it("שולח שהסתיר את הטלפון: ההודעה יוצאת למזהה שוואטסאפ מצמידה לו", async () => {
    const { outbound } = await decided({ waId: null, bsuid: "IL.1234567890" });
    const api = fakeWaApi();
    await sendWaReply({ waMessageId: outbound.id }, { api, now: NOW });
    expect(api.sent[0]?.to).toEqual({ bsuid: "IL.1234567890" });
  });

  it("WA-L09 — מנהל עבודה בלי אתר: ההודעה שמסבירה, בלי טיוטה", async () => {
    const { outbound } = await decided({ outcome: "NO_SITE", draft: false });
    const api = fakeWaApi();
    expect(await sendWaReply({ waMessageId: outbound.id }, { api, now: NOW })).toMatchObject({ status: "sent", template: "L09" });
    expect(plain(api.sent[0]!.body)).toBe(`שלום דנה כהן, ${SPEC.noSite}`);
  });

  it("WA-L07 — החילוץ לא היה זמין: ההודעה אומרת זאת ומפנה להשלמה במערכת", async () => {
    const { outbound, ticketId } = await decided({ outcome: "DRAFT_CREATED_UNPROCESSED" });
    const api = fakeWaApi();
    await sendWaReply({ waMessageId: outbound.id }, { api, now: NOW });
    expect(plain(api.sent[0]!.body)).toBe(
      `שלום דנה כהן, ${SPEC.extractionUnavailable(`${BASE_URL}/tickets/${ticketId}`)}`,
    );
  });

  it("ג׳וב כפול: השורה כבר נשלחה, ושום דבר אינו נשלח שוב", async () => {
    const { outbound } = await decided();
    const api = fakeWaApi();
    await sendWaReply({ waMessageId: outbound.id }, { api, now: NOW });
    expect(await sendWaReply({ waMessageId: outbound.id }, { api, now: NOW })).toMatchObject({
      status: "noop",
      reason: "not-pending",
    });
    expect(api.sent).toHaveLength(1);
  });
});

describe("W7 — ההודעות על תגובה, וההסבר החד-פעמי", () => {
  it("תגובה שמוזגה: הנוסח הכללי עם 'עודכן מהתגובה שלך', כתגובה לתגובה", async () => {
    const { outbound, inbound } = await decided({ outcome: "REPLY_APPLIED", draft: true });
    await db.waMessage.update({
      where: { id: inbound.id },
      data: { report: { updated: [{ field: "ROOM", before: "מטבח", after: "חדר רחצה" }], notFound: [], ambiguous: [] } },
    });
    const api = fakeWaApi();
    expect(await sendWaReply({ waMessageId: outbound.id }, { api, now: NOW })).toMatchObject({ status: "sent", template: "L01" });
    expect(plain(api.sent[0]!.body)).toContain(SPEC.updatedExample);
    expect(api.sent[0]).toMatchObject({ contextWamid: "wamid.LAST" });
  });

  it("WA-L05 — אחרי השיגור: מספר הפנייה וקישור אליה", async () => {
    const { outbound, ticketId } = await decided({ outcome: "REPLY_AFTER_DISPATCH", draft: true });
    const ticket = await db.ticket.update({ where: { id: ticketId! }, data: { isDraft: false } });
    const api = fakeWaApi();
    expect(await sendWaReply({ waMessageId: outbound.id }, { api, now: NOW })).toMatchObject({ status: "sent", template: "L05" });
    expect(plain(api.sent[0]!.body)).toBe(`שלום דנה כהן, ${SPEC.afterDispatch(ticket.seq, `${BASE_URL}/tickets/${ticket.id}`)}`);
  });

  it("WA-L06 — הטיוטה נמחקה: ההודעה נשלחת גם כשאין עוד פנייה", async () => {
    const { outbound, ticketId } = await decided({ outcome: "REPLY_AFTER_DELETION", draft: true });
    await db.ticket.delete({ where: { id: ticketId! } });
    const api = fakeWaApi();
    expect(await sendWaReply({ waMessageId: outbound.id }, { api, now: NOW })).toMatchObject({ status: "sent", template: "L06" });
    expect(plain(api.sent[0]!.body)).toBe(`שלום דנה כהן, ${SPEC.afterDeletion}`);
  });

  it("WA-L08 — אין הרשאה: מפנה למנהל המערכת, גם כשהטיוטה נמחקה מאז (הנוסח אינו מזכיר את השולח)", async () => {
    const { outbound, ticketId } = await decided({ outcome: "REPLY_NOT_PERMITTED", draft: true });
    await db.ticket.delete({ where: { id: ticketId! } });
    const api = fakeWaApi();
    expect(await sendWaReply({ waMessageId: outbound.id }, { api, now: NOW })).toMatchObject({ status: "sent", template: "L08" });
    expect(plain(api.sent[0]!.body)).toBe(`שלום דנה כהן, ${SPEC.notPermitted}`);
  });

  it("WA-L10 — ההסבר החד-פעמי, כתגובה להודעה שלא נקלטה", async () => {
    const { outbound } = await decided({ outcome: "IGNORED_NO_KEYWORD", draft: false });
    const api = fakeWaApi();
    expect(await sendWaReply({ waMessageId: outbound.id }, { api, now: NOW })).toMatchObject({ status: "sent", template: "L10" });
    expect(plain(api.sent[0]!.body)).toBe(`שלום דנה כהן, ${SPEC.hint}`);
    expect(api.sent[0]).toMatchObject({ contextWamid: "wamid.LAST" });
  });

  it("§7 שורה 113 — אישור של דיווח אחרי יותר מחמש דקות נרשם כאיחור; ההסבר, שיוצא בתקרה של 10 דקות בכוונה, לא", async () => {
    const warn = vi.spyOn(log, "logWarn");
    try {
      const late = await decided({ outcome: "DRAFT_CREATED", receivedAt: new Date(NOW.getTime() - 400_000) });
      await sendWaReply({ waMessageId: late.outbound.id }, { api: fakeWaApi(), now: NOW });
      expect(warn).toHaveBeenCalledWith("wa.reply.late", expect.objectContaining({ latencySec: 400 }));

      warn.mockClear();
      await db.waMessage.deleteMany({});
      const hint = await decided({ outcome: "IGNORED_NO_KEYWORD", draft: false, receivedAt: new Date(NOW.getTime() - 614_000) });
      expect(await sendWaReply({ waMessageId: hint.outbound.id }, { api: fakeWaApi(), now: NOW })).toMatchObject({
        status: "sent",
        template: "L10",
        latencySec: 614,
      });
      expect(warn).not.toHaveBeenCalledWith("wa.reply.late", expect.anything());
    } finally {
      warn.mockRestore();
    }
  });

  it("WA-L11 — שורה יוצאת על הכרעה אחרת של 'לא נקלט' אינה נשלחת: באג, לא הסבר", async () => {
    const { outbound } = await decided({ outcome: "IGNORED_UNSUPPORTED", draft: false });
    const api = fakeWaApi();
    expect(await sendWaReply({ waMessageId: outbound.id }, { api, now: NOW })).toMatchObject({ status: "skipped", reason: "outcome" });
    expect(api.sent).toHaveLength(0);
  });
});

describe("מה אינו נשלח", () => {
  it("WA-18 — עברו 24 שעות מההודעה של השולח: לא נשלחת, ומסומנת FAILED עם 131047", async () => {
    const { outbound } = await decided({ receivedAt: new Date(NOW.getTime() - SERVICE_WINDOW_MS - 1000) });
    const api = fakeWaApi();
    expect(await sendWaReply({ waMessageId: outbound.id }, { api, now: NOW })).toMatchObject({
      status: "failed",
      code: WINDOW_CLOSED_CODE,
    });
    expect(api.sent).toHaveLength(0);
    expect(await db.waMessage.findUniqueOrThrow({ where: { id: outbound.id } })).toMatchObject({
      state: "FAILED",
      errorCode: WINDOW_CLOSED_CODE,
    });
  });

  it("§7 שורה 77 — הטיוטה נמחקה בין ההכרעה לשליחה: אין הודעה שמתארת טיוטה שאינה", async () => {
    const { outbound, ticketId } = await decided();
    await db.ticket.delete({ where: { id: ticketId! } });
    const api = fakeWaApi();
    expect(await sendWaReply({ waMessageId: outbound.id }, { api, now: NOW })).toMatchObject({
      status: "skipped",
      reason: "deleted",
    });
    expect(api.sent).toHaveLength(0);
    expect((await db.waMessage.findUniqueOrThrow({ where: { id: outbound.id } })).detail).toContain("(§7 שורה 77)");
  });

  it("§7 שורה 77 — הטיוטה שוגרה בינתיים", async () => {
    const { outbound, ticketId } = await decided();
    await db.ticket.update({ where: { id: ticketId! }, data: { isDraft: false } });
    const api = fakeWaApi();
    expect(await sendWaReply({ waMessageId: outbound.id }, { api, now: NOW })).toMatchObject({ reason: "dispatched" });
    expect(api.sent).toHaveLength(0);
  });

  it("המספר נותק לפני השליחה: FAILED, בלי ניסיון", async () => {
    const { outbound } = await decided();
    await db.waNumber.update({ where: { id: numberId }, data: { status: "DISCONNECTED", tokenCipher: null } });
    const api = fakeWaApi();
    expect(await sendWaReply({ waMessageId: outbound.id }, { api, now: NOW })).toMatchObject({ status: "failed" });
    expect(api.sent).toHaveLength(0);
  });
});

describe("כשלי שליחה", () => {
  it("כשל זמני: נזרק, השורה ממתינה עם הסיבה — ורק אחרי שהניסיונות נגמרו היא FAILED", async () => {
    const { outbound } = await decided();
    const api = fakeWaApi({ failSend: () => new WaApiError("Graph 503", "transient") });

    await expect(sendWaReply({ waMessageId: outbound.id }, { api, now: NOW })).rejects.toMatchObject({ kind: "transient" });
    const pending = await db.waMessage.findUniqueOrThrow({ where: { id: outbound.id } });
    expect(pending).toMatchObject({ state: "PENDING", attempts: 1 });
    expect(pending.detail).toContain("Graph 503");

    await markWaReplyFailed({ waMessageId: outbound.id }, new Error("Graph 503"));
    expect((await db.waMessage.findUniqueOrThrow({ where: { id: outbound.id } })).state).toBe("FAILED");
  });

  it("Meta דחתה בגלל החלון (131047): הכרעה ולא ניסיון חוזר", async () => {
    const { outbound } = await decided();
    const api = fakeWaApi({
      failSend: () => new WaApiError("Graph 400 (131047)", "permanent", { status: 400, code: WINDOW_CLOSED_CODE }),
    });
    expect(await sendWaReply({ waMessageId: outbound.id }, { api, now: NOW })).toMatchObject({
      status: "failed",
      code: WINDOW_CLOSED_CODE,
    });
  });

  it("טוקן שבוטל: המספר עובר ל\"תקלה\", והג׳וב נכשל ברעש", async () => {
    const { outbound } = await decided();
    const api = fakeWaApi({ failSend: () => new WaApiError("Graph 401 (190)", "auth") });
    await expect(sendWaReply({ waMessageId: outbound.id }, { api, now: NOW })).rejects.toMatchObject({ kind: "auth" });
    expect(await db.waNumber.findUniqueOrThrow({ where: { id: numberId } })).toMatchObject({
      status: "ERROR",
      lastError: "token_revoked",
    });
  });
});

describe("מקצה לקצה דרך התור", () => {
  it("WA_INTAKE ואחריו WA_REPLY, בנתיב mail: דיווח הופך לטיוטה ולהודעת אישור", async () => {
    vi.stubEnv("WHATSAPP_INTAKE_MODE", "live");
    // שעון אמיתי: ג׳וב האישור נוצר בלי מועד, כלומר "עכשיו" של בסיס הנתונים
    const sentAt = new Date(Date.now() - 2 * 60_000);
    const later = () => new Date(Date.now() + 1000);
    const report = await db.waMessage.create({
      data: {
        direction: "INBOUND",
        state: "PENDING",
        numberId,
        authorUserId: userId,
        waId: "972500000077",
        type: "text",
        text: "תקלה בדירה 12",
        wamid: "wamid.REPORT",
        receivedAt: sentAt,
        nextAttemptAt: new Date(sentAt.getTime() + BURST_QUIET_MS),
      },
    });
    await enqueue(db, JOB_TYPES.waIntake, { waMessageId: report.id }, new Date(sentAt.getTime() + BURST_QUIET_MS));

    const api = fakeWaApi();
    const deps = {
      waApi: api,
      transcriber: null,
      fieldExtractor: fakeFieldExtractor({ result: { description: "נזילה" } }),
    };
    const intake = await processNextJob(deps, later(), "mail");
    expect(intake).toMatchObject({ status: "done", outcome: { kind: "wa-intake", status: "decided" } });
    const reply = await processNextJob(deps, later(), "mail");
    expect(reply).toMatchObject({ status: "done", outcome: { kind: "wa-reply", status: "sent" } });

    expect(api.sent).toHaveLength(1);
    expect(api.sent[0]?.contextWamid).toBe("wamid.REPORT");
    expect(await db.ticket.count({ where: { channel: "WHATSAPP", isDraft: true } })).toBe(1);
  });
});
