import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/wa-media/[id]/route";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import type { Viewer } from "@/lib/permissions";
import { SKIPPED_AFTER_CLOSE } from "@/lib/services/intake-reply";
import * as viewerService from "@/lib/services/viewer";
import { getTicketWaConversation } from "@/lib/services/wa-correspondence";
import { handleWaIntake } from "@/lib/services/wa-intake";
import { whatsappNeedsAttention } from "@/lib/services/wa-number";
import { sendWaReply } from "@/lib/services/wa-reply";
import { writeLocalObject } from "@/lib/storage/local";
import { fakeFieldExtractor } from "../helpers/fake-field-extractor";
import { fakeWaApi } from "../helpers/fake-wa-api";
import { resetDb } from "../helpers/reset-db";
import {
  AFTER_QUIET,
  DOCX,
  FULL_EXTRACTION,
  FULL_REPORT,
  JPEG,
  SEC,
  type WaUser,
  type WaWorld,
  at,
  inbound,
  liveDeps,
  makeWaUser,
  seedWaWorld,
} from "../helpers/wa-live";

/**
 * שיחת הוואטסאפ במסך 7 ובחלון "פרטים" (W8): מה השיחה כוללת (WA-M01), מצב המסירה
 * של הודעות המערכת (WA-S7-01), מה שקדם לשיגור (WA-S2-01), הקבצים שבה ומי רשאי
 * להוריד אותם (WA-S7-03), והבאנר בראש הלוח כשהחיבור נפל (WA-S1-02).
 */

let world: WaWorld;

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("APP_BASE_URL", "http://localhost:3100");
  vi.stubEnv("WHATSAPP_INTAKE_PILOT_PHONES", "");
  world = await seedWaWorld();
});

afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await db.$disconnect();
});

function adminViewer(user: { id: string }): Viewer {
  return { kind: "user", id: user.id, role: "ADMIN", siteId: null };
}

/** טיוטה מוואטסאפ ושיחה משלה — בלי הצינור, כשהבדיקה צריכה שורות מדויקות */
async function waDraft(user: WaUser, fields: { isDraft?: boolean } = {}) {
  const ticket = await db.ticket.create({
    data: {
      channel: "WHATSAPP",
      isDraft: fields.isDraft ?? true,
      siteId: world.siteId,
      createdById: user.id,
      description: "נזילה",
      draftRecipients: [],
    },
  });
  const thread = await db.waThread.create({ data: { ticketId: ticket.id } });
  return { ticket, thread };
}

type RowData = Parameters<typeof db.waMessage.create>[0]["data"];

/** שורה ביומן — כברירת מחדל הודעה נכנסת שהוכרעה */
function row(threadId: string | null, data: Partial<RowData> = {}) {
  return db.waMessage.create({
    data: { numberId: world.numberId, direction: "INBOUND", state: "DONE", type: "text", threadId, ...data } as RowData,
  });
}

/** קובץ על הודעה, עם בתים באחסון המקומי — או בלעדיהם */
async function file(
  messageId: string,
  overrides: { bytes?: Buffer | null; mimeType?: string; filename?: string; isMedia?: boolean; skippedReason?: string; partIndex?: number } = {},
) {
  const partIndex = overrides.partIndex ?? 0;
  const bytes = overrides.bytes === undefined ? JPEG : overrides.bytes;
  const storageKey = bytes ? `media/wa/${messageId}/${partIndex}` : null;
  if (storageKey && bytes) await writeLocalObject(storageKey, bytes);
  return db.waMedia.create({
    data: {
      messageId,
      partIndex,
      waMediaId: `wa-media-${messageId}-${partIndex}`,
      mimeType: overrides.mimeType ?? "image/jpeg",
      filename: overrides.filename ?? null,
      storageKey,
      isMedia: overrides.isMedia ?? true,
      skippedReason: overrides.skippedReason ?? null,
    },
  });
}

function request(mediaId: string, viewer: Viewer) {
  const spy = vi.spyOn(viewerService, "resolveViewer").mockResolvedValueOnce(viewer);
  const url = new URL(`http://localhost:3100/api/wa-media/${mediaId}`);
  return GET(new Request(url), { params: Promise.resolve({ id: mediaId }) }).finally(() => spy.mockRestore());
}

// ─────────────────────────────── מה בשיחה ───────────────────────────────

describe("getTicketWaConversation — WA-M01", () => {
  it("מקצה לקצה: הדיווח עם התמונה והאישור שיצא, לפי הסדר, והתמונה ניתנת להורדה", async () => {
    const user = await makeWaUser();
    const report = await inbound(world, user, 0, { text: FULL_REPORT, media: { id: "m-1", mimeType: "image/jpeg" } });
    const { deps } = liveDeps({
      extractor: fakeFieldExtractor({ result: FULL_EXTRACTION }),
      media: { "m-1": { bytes: JPEG, mimeType: "image/jpeg" } },
    });
    await handleWaIntake({ waMessageId: report.id }, { ...deps, now: AFTER_QUIET });
    const ack = await db.waMessage.findFirstOrThrow({ where: { direction: "OUTBOUND", repliesToId: report.id } });
    await sendWaReply({ waMessageId: ack.id }, { api: fakeWaApi(), now: at(100 * SEC) });

    const thread = await db.waThread.findFirstOrThrow({ where: { messages: { some: { id: report.id } } } });
    const conversation = await getTicketWaConversation(adminViewer(user), thread.ticketId!);

    expect(conversation).toHaveLength(2);
    const [first, second] = conversation!;
    expect(first).toMatchObject({
      direction: "INBOUND",
      authorName: user.name,
      text: FULL_REPORT,
      outcome: "DRAFT_CREATED",
      delivery: null,
    });
    expect(first.files).toEqual([
      expect.objectContaining({ mimeType: "image/jpeg", downloadable: true, skippedReason: null, transcript: null }),
    ]);
    // האישור כפי שיצא בפועל — הנוסח שהורכב בזמן השליחה, ומצב המסירה שלו
    expect(second).toMatchObject({ direction: "OUTBOUND", authorName: null, delivery: "sent", skippedAfterClose: false });
    expect(second.text).toContain(he.whatsappIntake.received);

    const response = await request(first.files[0].id, adminViewer(user));
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(JPEG);
  });

  it("רק השיחה: הודעה של אותו שולח שלא נקלטה, ואישור שעוד לא יצא — אינם מוצגים", async () => {
    const user = await makeWaUser();
    const { ticket, thread } = await waDraft(user);
    await row(thread.id, { outcome: "DRAFT_CREATED", text: "תקלה", authorUserId: user.id, createdAt: at(0), receivedAt: at(0) });
    // "מתי אתה מגיע?" — בלי "תקלה" ובלי תגובה: אינה חלק מהטיוטה, ולכן גם לא מהשיחה
    await row(null, { outcome: "IGNORED_NO_KEYWORD", authorUserId: user.id, createdAt: at(SEC), receivedAt: at(SEC) });
    // אישור שעוד לא יצא — "עדיין לא", בלי תוכן
    await row(thread.id, { direction: "OUTBOUND", state: "PENDING", createdAt: at(2 * SEC) });

    const conversation = await getTicketWaConversation(adminViewer(user), ticket.id);
    expect(conversation?.map((message) => message.text)).toEqual(["תקלה"]);
  });

  it("WA-S7-01 — מצב המסירה: נשלחה, נמסרה, נקראה, לא נשלחה; ודילוג אחרי שיגור מסומן כצפוי", async () => {
    const user = await makeWaUser();
    const { ticket, thread } = await waDraft(user);
    const base = { direction: "OUTBOUND" as const, state: "SENT" as const, text: "אישור" };
    await row(thread.id, { ...base, createdAt: at(1), sentAt: at(1) });
    await row(thread.id, { ...base, createdAt: at(2), sentAt: at(2), deliveredAt: at(3) });
    // "נקראה" גובר על "נמסרה" — Meta שולחת את שניהם
    await row(thread.id, { ...base, createdAt: at(3), sentAt: at(3), deliveredAt: at(4), readAt: at(5) });
    await row(thread.id, { ...base, state: "FAILED", errorCode: 131047, createdAt: at(4) });
    await row(thread.id, {
      ...base,
      state: "SKIPPED",
      text: null,
      detail: `הטיוטה שוגרה בין ההכרעה לשליחה ${SKIPPED_AFTER_CLOSE}`,
      createdAt: at(5),
    });
    await row(thread.id, { ...base, state: "SKIPPED", text: null, detail: "אין הודעה נכנסת", createdAt: at(6) });

    const conversation = await getTicketWaConversation(adminViewer(user), ticket.id);
    expect(conversation?.map((message) => [message.delivery, message.skippedAfterClose])).toEqual([
      ["sent", false],
      ["delivered", false],
      ["read", false],
      ["failed", false],
      ["failed", true],
      ["failed", false],
    ]);
    // השעה של הודעת מערכת היא מתי יצאה; שלא יצאה — מתי נרשמה
    expect(conversation?.[1].at).toEqual(at(2));
    expect(conversation?.[3].at).toEqual(at(4));
  });

  it("תגובה שלא נקלטה — בשיחה, בלי התוכן, עם ההכרעה; והשעה היא מתי השולח שלח", async () => {
    const user = await makeWaUser();
    const other = await makeWaUser({ name: "רון לוי" });
    const { ticket, thread } = await waDraft(user);
    await row(thread.id, {
      outcome: "REPLY_NOT_PERMITTED",
      text: null,
      authorUserId: other.id,
      receivedAt: at(-5 * SEC),
      createdAt: at(0),
    });

    const [reply] = (await getTicketWaConversation(adminViewer(user), ticket.id))!;
    expect(reply).toMatchObject({ authorName: "רון לוי", text: null, outcome: "REPLY_NOT_PERMITTED", files: [] });
    expect(reply.at).toEqual(at(-5 * SEC));
  });

  it("WA-S2-01 — before: רק מה שנרשם עד השיגור", async () => {
    const user = await makeWaUser();
    const { ticket, thread } = await waDraft(user, { isDraft: false });
    await row(thread.id, { outcome: "DRAFT_CREATED", text: "תקלה", authorUserId: user.id, createdAt: at(0) });
    await row(thread.id, { direction: "OUTBOUND", state: "SENT", text: "אישור", createdAt: at(SEC) });
    await row(thread.id, { outcome: "REPLY_AFTER_DISPATCH", authorUserId: user.id, createdAt: at(10 * SEC) });
    await row(thread.id, { direction: "OUTBOUND", state: "SENT", text: "כבר נשלחה", createdAt: at(11 * SEC) });

    const conversation = await getTicketWaConversation(adminViewer(user), ticket.id, { before: at(5 * SEC) });
    expect(conversation?.map((message) => message.text)).toEqual(["תקלה", "אישור"]);
  });

  it("קבצים: הקלטה עם התמלול, קובץ שלא נשמר, ומסמך Word שנשמר בשיחה בלבד", async () => {
    const user = await makeWaUser();
    const { ticket, thread } = await waDraft(user);
    const message = await row(thread.id, { outcome: "DRAFT_CREATED", authorUserId: user.id, createdAt: at(0) });
    const recording = await file(message.id, { partIndex: 0, mimeType: "audio/ogg", bytes: Buffer.from("ogg") });
    await db.waMedia.update({ where: { id: recording.id }, data: { voice: true, transcript: "יש תקלה בחשמל" } });
    await file(message.id, { partIndex: 1, bytes: null, skippedReason: "too-large", filename: "video.mp4", mimeType: "video/mp4" });
    await file(message.id, {
      partIndex: 2,
      bytes: DOCX,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: "quote.docx",
      isMedia: false,
      skippedReason: "not-media",
    });

    const [only] = (await getTicketWaConversation(adminViewer(user), ticket.id))!;
    expect(only.files).toEqual([
      expect.objectContaining({ transcript: "יש תקלה בחשמל", downloadable: true, skippedReason: null }),
      expect.objectContaining({ filename: "video.mp4", downloadable: false, skippedReason: "too-large" }),
      expect.objectContaining({ filename: "quote.docx", downloadable: true, skippedReason: "not-media" }),
    ]);
  });

  it("הרשאה: מנהל עבודה מאתר אחר וקבלן — null; פנייה בלי שיחה — רשימה ריקה", async () => {
    const user = await makeWaUser();
    const { ticket } = await waDraft(user);
    const otherSite = await db.site.create({ data: { name: "אתר אחר" } });
    const outsider = await db.user.create({
      data: { role: "SITE_MANAGER", name: "זר", phone: "0509999999", passwordHash: "x", siteId: otherSite.id },
    });

    expect(await getTicketWaConversation({ kind: "user", id: outsider.id, role: "SITE_MANAGER", siteId: otherSite.id }, ticket.id)).toBeNull();
    expect(await getTicketWaConversation({ kind: "professional", id: world.professionalId }, ticket.id)).toBeNull();

    const bare = await db.ticket.create({
      data: { channel: "WHATSAPP", isDraft: true, siteId: world.siteId, createdById: user.id, description: "x", draftRecipients: [] },
    });
    expect(await getTicketWaConversation(adminViewer(user), bare.id)).toEqual([]);
  });
});

// ─────────────────────────────── הורדת קובץ ───────────────────────────────

describe("api/wa-media/[id] — הקבצים שבשיחה (WA-S7-03)", () => {
  it("מדיה נפתחת בדפדפן, ומסמך Word יורד בשמו", async () => {
    const user = await makeWaUser();
    const { thread } = await waDraft(user);
    const message = await row(thread.id, { outcome: "DRAFT_CREATED", authorUserId: user.id });
    const image = await file(message.id, { partIndex: 0 });
    const doc = await file(message.id, {
      partIndex: 1,
      bytes: DOCX,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: "הצעת מחיר.docx",
      isMedia: false,
      skippedReason: "not-media",
    });

    const shown = await request(image.id, adminViewer(user));
    expect(shown.status).toBe(200);
    expect(shown.headers.get("Content-Disposition")).toMatch(/^inline/);
    expect(shown.headers.get("Cache-Control")).toBe("private, max-age=300");

    const downloaded = await request(doc.id, adminViewer(user));
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("Content-Disposition")).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent("הצעת מחיר.docx")}`,
    );
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(DOCX);
  });

  it("קובץ שהוסר מהטיוטה נשאר נגיש מהשיחה", async () => {
    const user = await makeWaUser();
    const { thread } = await waDraft(user);
    const message = await row(thread.id, { outcome: "DRAFT_CREATED", authorUserId: user.id });
    const image = await file(message.id);
    await db.waMedia.update({ where: { id: image.id }, data: { removedFromDraftAt: at(0), mediaFileId: null } });

    expect((await request(image.id, adminViewer(user))).status).toBe(200);
  });

  it("404: קובץ בלי בתים, צופה שאינו רשאי, קבלן, ושיחה של טיוטה שנמחקה", async () => {
    const user = await makeWaUser();
    const { ticket, thread } = await waDraft(user);
    const message = await row(thread.id, { outcome: "DRAFT_CREATED", authorUserId: user.id });
    const missing = await file(message.id, { partIndex: 0, bytes: null, skippedReason: "too-large" });
    const image = await file(message.id, { partIndex: 1 });
    const otherSite = await db.site.create({ data: { name: "אתר אחר" } });
    const outsider: Viewer = { kind: "user", id: (await makeWaUser()).id, role: "SITE_MANAGER", siteId: otherSite.id };

    expect((await request(missing.id, adminViewer(user))).status).toBe(404);
    expect((await request(image.id, outsider)).status).toBe(404);
    expect((await request(image.id, { kind: "professional", id: world.professionalId })).status).toBe(404);
    expect((await request("no-such-file", adminViewer(user))).status).toBe(404);

    // הטיוטה נמחקה: השיחה נשארת, אבל כבר אינה שייכת לשום פנייה
    await db.ticket.delete({ where: { id: ticket.id } });
    expect((await request(image.id, adminViewer(user))).status).toBe(404);
  });
});

// ─────────────────────────────── הבאנר בלוח ───────────────────────────────

describe("whatsappNeedsAttention — הבאנר בראש הלוח (WA-S1-02)", () => {
  const session = (user: { id: string; name: string }, role: "ADMIN" | "OWNER" | "SITE_MANAGER") => ({
    id: user.id,
    name: user.name,
    role,
    siteId: role === "SITE_MANAGER" ? world.siteId : null,
  });

  it("למנהל המערכת בלבד, ורק כשמספר שחובר מנותק או בתקלה", async () => {
    const admin = await makeWaUser();
    // מחובר — אין באנר
    expect(await whatsappNeedsAttention(session(admin, "ADMIN"))).toBe(false);

    for (const status of ["DISCONNECTED", "ERROR"] as const) {
      await db.waNumber.update({ where: { id: world.numberId }, data: { status } });
      expect(await whatsappNeedsAttention(session(admin, "ADMIN"))).toBe(true);
      // בעלים ומנהל עבודה — אף פעם
      expect(await whatsappNeedsAttention(session(admin, "OWNER"))).toBe(false);
      expect(await whatsappNeedsAttention(session(admin, "SITE_MANAGER"))).toBe(false);
    }
  });

  it("מספר שמעולם לא חובר — אין מה לנתק, ואין באנר", async () => {
    const admin = await makeWaUser();
    await db.waNumber.deleteMany({});
    expect(await whatsappNeedsAttention(session(admin, "ADMIN"))).toBe(false);
  });
});
