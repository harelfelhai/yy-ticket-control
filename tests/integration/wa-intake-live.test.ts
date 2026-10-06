import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JOB_TYPES } from "@/jobs/types";
import { db } from "@/lib/db";
import { MAX_DEFER_ATTEMPTS } from "@/lib/intake/defer-policy";
import { handleWaIntake } from "@/lib/services/wa-intake";
import { BURST_CEILING_MS, BURST_QUIET_MS } from "@/lib/whatsapp/burst";
import { WaApiError } from "@/lib/whatsapp/errors";
import { aiError, fakeFieldExtractor } from "../helpers/fake-field-extractor";
import { fakeWaApi } from "../helpers/fake-wa-api";
import { resetDb } from "../helpers/reset-db";
import {
  AFTER_QUIET,
  DOCX,
  DOMAIN,
  FULL_REPORT,
  type InboundSpec,
  JPEG,
  PRO,
  SEC,
  type WaUser,
  type WaWorld,
  at,
  fakeTranscriber,
  inbound as inboundRow,
  liveDeps,
  makeWaUser,
  rowOf,
  seedWaWorld,
  voice,
} from "../helpers/wa-live";

/**
 * קליטת וואטסאפ **במצב live** (W6, אפיון §2.7 שלבים 1–4): טיוטה מדיווח, מדיה,
 * תמלול לבדיקת המילה, חילוץ, וההודעה לשולח שנכנסת לתור.
 *
 * ההודעות נוצרות ישירות ביומן, כפי ש-`wa-webhook.ts` משאיר אותן; וואטסאפ, מנוע
 * התמלול והמחלץ מזויפים. ההודעה לשולח עצמה נבדקת ב-`wa-reply.test.ts` — כאן רק
 * שהשורה היוצאת והג׳וב נוצרו, באותה טרנזאקציה של ההכרעה.
 */

let world: WaWorld;
let numberId: string;
let siteId: string;
let buildingId: string;
let apartmentId: string;
let domainId: string;
let professionalId: string;

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("WHATSAPP_INTAKE_PILOT_PHONES", "");
  world = await seedWaWorld();
  ({ numberId, siteId, buildingId, apartmentId, domainId, professionalId } = world);
});

afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await db.$disconnect();
});

const makeUser = makeWaUser;
const inbound = (user: WaUser, offsetMs: number, spec: InboundSpec) => inboundRow(world, user, offsetMs, spec);

// ─────────────────────────────── טיוטה חדשה ───────────────────────────────

describe("WA-05 — דיווח עם \"תקלה\" פותח טיוטה, והאישור נכנס לתור", () => {
  it("טקסט ותמונה: טיוטה בערוץ וואטסאפ שבעליה השולח, עם הפרטים, המדיה והשיחה", async () => {
    const user = await makeUser();
    await inbound(user, 0, { media: { id: "m-img", mimeType: "image/jpeg" } });
    const last = await inbound(user, 10 * SEC, { text: FULL_REPORT });
    const { deps, extractor } = liveDeps({ media: { "m-img": { bytes: JPEG, mimeType: "image/jpeg" } } });

    const result = await handleWaIntake({ waMessageId: last.id }, { ...deps, now: at(10 * SEC + BURST_QUIET_MS) });
    expect(result).toMatchObject({ status: "decided", units: [{ size: 2, outcome: "DRAFT_CREATED" }] });

    const ticket = await db.ticket.findFirstOrThrow({ include: { draftFields: true, waThread: true } });
    expect(ticket).toMatchObject({
      channel: "WHATSAPP",
      isDraft: true,
      createdById: user.id,
      siteId,
      buildingId,
      apartmentId,
      domainId,
      description: "נזילה מהתקרה",
    });
    expect(ticket.draftRecipients).toEqual([
      { kind: "professional", id: professionalId, origin: "CHANNEL", removedBySystemAt: null },
    ]);
    expect(ticket.draftFields.map((field) => field.field).sort()).toEqual(
      ["APARTMENT", "BUILDING", "DESCRIPTION", "DOMAIN", "RECIPIENTS", "SITE"].sort(),
    );
    expect(ticket.draftFields.every((field) => field.fromChannel)).toBe(true);

    // שתי ההודעות בשיחה של הטיוטה, הוכרעו, והתוכן נשאר
    const rows = await db.waMessage.findMany({ where: { direction: "INBOUND" }, orderBy: { receivedAt: "asc" } });
    expect(rows.map((row) => [row.state, row.outcome, row.shadow, row.threadId])).toEqual([
      ["DONE", "DRAFT_CREATED", false, ticket.waThread?.id],
      ["DONE", "DRAFT_CREATED", false, ticket.waThread?.id],
    ]);
    expect(rows[1]?.text).toBe(FULL_REPORT);
    expect(rows[1]?.report).toMatchObject({ notFound: [], ambiguous: [] });

    // התמונה: קובץ בטיוטה, עם חילוץ טקסט בתור, והשורה של וואטסאפ מצביעה עליו
    const files = await db.mediaFile.findMany({ include: { message: true } });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ mimeType: "image/jpeg", uploaded: true, uploaderUserId: user.id });
    expect(files[0]?.message?.ticketId).toBe(ticket.id);
    const image = (await rowOf(rows[0]!.id)).media[0];
    expect(image).toMatchObject({ isMedia: true, skippedReason: null, mediaFileId: files[0]?.id });
    expect(image?.storageKey).toMatch(/^media\/wa\//);
    expect(await db.job.count({ where: { type: JOB_TYPES.extract } })).toBe(1);

    // המחלץ קרא את הדיווח כוואטסאפ: בלי כותרת, וההודעות לפי הסדר, עם התמונה
    expect(extractor.lastCall).toMatchObject({ channel: "whatsapp", subject: "", text: FULL_REPORT, isReply: false });
    expect(extractor.lastCall?.attachments).toHaveLength(1);

    // WA-08: אישור אחד, שעונה להודעה האחרונה בדיווח, בשיחה של הטיוטה
    const outbound = await db.waMessage.findFirstOrThrow({ where: { direction: "OUTBOUND" } });
    expect(outbound).toMatchObject({
      state: "PENDING",
      repliesToId: last.id,
      threadId: ticket.waThread?.id,
      authorUserId: user.id,
      numberId,
    });
    const replyJobs = await db.job.findMany({ where: { type: JOB_TYPES.waReply } });
    expect(replyJobs.map((job) => job.payload)).toEqual([{ waMessageId: outbound.id }]);
  });

  it("WA-02 — תמונה, ורק אחריה \"תקלה\" כעבור שלוש דקות: טיוטה אחת שכוללת את התמונה", async () => {
    const user = await makeUser();
    await inbound(user, 0, { media: { id: "m-img", mimeType: "image/jpeg" } });
    const last = await inbound(user, 180 * SEC, { text: "תקלה בדירה 12" });
    const { deps } = liveDeps({ media: { "m-img": { bytes: JPEG, mimeType: "image/jpeg" } } });

    const result = await handleWaIntake({ waMessageId: last.id }, { ...deps, now: at(180 * SEC + BURST_QUIET_MS) });
    expect(result).toMatchObject({ units: [{ size: 2, outcome: "DRAFT_CREATED" }] });
    expect(await db.ticket.count()).toBe(1);
    expect(await db.mediaFile.count()).toBe(1);
  });

  it("WA-17 — הקלטה בלבד שבה נאמרה \"תקלה\": מתומללת לפני הקיבוץ, והאישור אחרי 90 שניות ולא אחרי 10 דקות", async () => {
    const user = await makeUser();
    const row = await inbound(user, 0, { media: { id: "m-voice", mimeType: "audio/ogg; codecs=opus", voice: true } });
    const { deps, transcriber, extractor } = liveDeps({ media: { "m-voice": voice("יש תקלה בדירה 12, נזילה מהתקרה") } });

    const result = await handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET });
    expect(result).toMatchObject({ status: "decided", units: [{ size: 1, outcome: "DRAFT_CREATED" }] });
    expect(transcriber.calls).toBe(1);

    // התמלול הוא הטקסט שהמחלץ קורא — וההקלטה עצמה אינה נשלחת אליו שוב
    expect(extractor.lastCall?.text).toBe("יש תקלה בדירה 12, נזילה מהתקרה");
    expect(extractor.lastCall?.attachments).toHaveLength(0);

    // ההקלטה בטיוטה, עם התמלול שכבר נעשה — בלי ג׳וב TRANSCRIBE שני
    const file = await db.mediaFile.findFirstOrThrow();
    expect(file).toMatchObject({ mimeType: "audio/ogg", transcription: "יש תקלה בדירה 12, נזילה מהתקרה", aiStatus: "DONE" });
    expect(await db.job.count({ where: { type: JOB_TYPES.transcribe } })).toBe(0);
    expect((await rowOf(row.id)).media[0]?.transcript).toBe("יש תקלה בדירה 12, נזילה מהתקרה");
  });

  it("WA-07 — הודעה מועברת היא דיווח של מי שהעביר", async () => {
    const user = await makeUser({ name: "מנהל שמעביר" });
    const row = await inbound(user, 0, { text: "תקלה — הדייר שלח לי את זה", forwarded: true });
    const { deps } = liveDeps({ extractor: fakeFieldExtractor({ result: { description: "הדייר שלח" } }) });

    await handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET });
    expect(await db.ticket.findFirstOrThrow()).toMatchObject({ createdById: user.id, channel: "WHATSAPP" });
  });

  it("מנהל עבודה: האתר נגזר ממנו, גם כשהדיווח לא הזכיר אתר", async () => {
    const manager = await makeUser({ role: "SITE_MANAGER", siteId });
    const row = await inbound(manager, 0, { text: "תקלה בדירה 12" });
    const { deps } = liveDeps({ extractor: fakeFieldExtractor({ result: { apartment: "12", building: "" } }) });

    await handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET });
    expect(await db.ticket.findFirstOrThrow()).toMatchObject({ siteId, createdById: manager.id });
  });

  it("EM-07 במקביל — ערך שאינו ברשימה אינו נוצר: השדה ריק, ונרשם לשולח עם האפשרויות", async () => {
    const user = await makeUser();
    const row = await inbound(user, 0, { text: "תקלה, התחום מיזוג" });
    const { deps } = liveDeps({ extractor: fakeFieldExtractor({ result: { domain: "מיזוג" } }) });

    await handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET });
    expect((await db.ticket.findFirstOrThrow()).domainId).toBeNull();
    expect(await db.domain.count()).toBe(1);
    expect((await rowOf(row.id)).report).toMatchObject({
      notFound: [{ field: "DOMAIN", written: "מיזוג", options: [DOMAIN] }],
    });
  });

  it("EM-08 במקביל — שם שמתאים ליותר מרשומה אחת: אף אחת אינה נבחרת, וההתאמות נרשמות", async () => {
    await db.professional.create({ data: { name: "יוסי לוי", phone: "0501110001" } });
    const user = await makeUser();
    const row = await inbound(user, 0, { text: "תקלה, לשלוח את יוסי" });
    const { deps } = liveDeps({ extractor: fakeFieldExtractor({ result: { recipientsAdd: ["יוסי"] } }) });

    await handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET });
    expect((await db.ticket.findFirstOrThrow()).draftRecipients).toEqual([]);
    const report = (await rowOf(row.id)).report as { ambiguous: { matches: string[] }[] };
    expect(report.ambiguous[0]?.matches.sort()).toEqual([PRO, "יוסי לוי"].sort());
  });

  it("EM-10 במקביל — מנהל מערכת שלא זוהה אתר בדיווח שלו: טיוטה בלי אתר", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const row = await inbound(admin, 0, { text: "תקלה בדירה 12" });
    const { deps } = liveDeps({ extractor: fakeFieldExtractor({ result: { apartment: "12" } }) });

    await handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET });
    expect(await db.ticket.findFirstOrThrow()).toMatchObject({ siteId: null, apartmentId: null, isDraft: true });
  });

  it("EM-11 במקביל — אין מחלץ: DRAFT_CREATED_UNPROCESSED, וכל ההודעות הן התיאור", async () => {
    const user = await makeUser();
    await inbound(user, 0, { text: "תקלה בדירה 12" });
    const last = await inbound(user, 5 * SEC, { text: "המים יורדים מהתקרה" });
    const { deps } = liveDeps({ extractor: null });

    const result = await handleWaIntake({ waMessageId: last.id }, { ...deps, now: at(5 * SEC + BURST_QUIET_MS) });
    expect(result).toMatchObject({ units: [{ size: 2, outcome: "DRAFT_CREATED_UNPROCESSED" }] });
    expect((await db.ticket.findFirstOrThrow()).description).toBe("תקלה בדירה 12\nהמים יורדים מהתקרה");
    expect(await db.waMessage.count({ where: { direction: "OUTBOUND" } })).toBe(1);
  });

  it("WA-06 — Word נשמר בשיחה בלבד ואינו נכנס לטיוטה; תמונה כן", async () => {
    const user = await makeUser();
    const doc = await inbound(user, 0, {
      text: "תקלה — מצורף דוח",
      media: {
        id: "m-doc",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename: "דוח.docx",
      },
    });
    const { deps } = liveDeps({
      media: {
        "m-doc": { bytes: DOCX, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      },
      extractor: fakeFieldExtractor({ result: { description: "מצורף דוח" } }),
    });

    await handleWaIntake({ waMessageId: doc.id }, { ...deps, now: AFTER_QUIET });
    const media = (await rowOf(doc.id)).media[0];
    expect(media).toMatchObject({ isMedia: false, skippedReason: "not-media", mediaFileId: null });
    expect(media?.storageKey).toMatch(/\.docx$/);
    expect(await db.mediaFile.count()).toBe(0);
    expect(await db.ticket.count()).toBe(1);
  });
});

// ─────────────────────────────── מה שאינו טיוטה ───────────────────────────────

describe("WA-L11 / WA-L09 — מה נענה ומה לא", () => {
  it("בלי המילה: IGNORED_NO_KEYWORD אחרי התקרה, התוכן והתמלול נמחקים, ואין הודעה", async () => {
    const user = await makeUser();
    const row = await inbound(user, 0, { media: { id: "m-voice", mimeType: "audio/ogg", voice: true } });
    const { deps } = liveDeps({ media: { "m-voice": voice("מתי אתה מגיע?") } });

    // ההקלטה תומללה, ואין בה המילה — ולכן ממתינים לתקרה, כמו לכל הודעה בלי מילה
    expect(await handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET })).toMatchObject({
      units: [],
      waitUntil: at(BURST_CEILING_MS),
    });
    await handleWaIntake({ waMessageId: row.id }, { ...deps, now: at(BURST_CEILING_MS) });

    const decided = await rowOf(row.id);
    expect(decided).toMatchObject({ state: "DONE", outcome: "IGNORED_NO_KEYWORD", shadow: false, text: null });
    expect(decided.media[0]?.transcript).toBeNull();
    expect(await db.waMessage.count({ where: { direction: "OUTBOUND" } })).toBe(0);
    expect(await db.ticket.count()).toBe(0);
  });

  it("WA-L09 — מנהל עבודה שאינו משויך לאתר: NO_SITE, בלי טיוטה ובלי התוכן, ועם הודעה שמסבירה", async () => {
    const manager = await makeUser({ role: "SITE_MANAGER", siteId: null });
    const row = await inbound(manager, 0, { text: "תקלה בדירה 12" });
    const { deps, extractor } = liveDeps();

    await handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET });
    expect(await rowOf(row.id)).toMatchObject({ outcome: "NO_SITE", text: null, threadId: null });
    expect(await db.ticket.count()).toBe(0);
    expect(extractor.calls).toHaveLength(0);
    expect(await db.waMessage.findFirstOrThrow({ where: { direction: "OUTBOUND" } })).toMatchObject({
      repliesToId: row.id,
      threadId: null,
    });
    expect(await db.job.count({ where: { type: JOB_TYPES.waReply } })).toBe(1);
  });

  it("shadow — אותה הכרעה, ושום דבר אינו מבוצע (גם כשההקלטה תומללה)", async () => {
    const user = await makeUser();
    const row = await inbound(user, 0, { media: { id: "m-voice", mimeType: "audio/ogg", voice: true } });
    const { deps } = liveDeps({ media: { "m-voice": voice("תקלה בדירה 12") } });

    await handleWaIntake({ waMessageId: row.id }, { ...deps, mode: "shadow", now: AFTER_QUIET });
    expect(await rowOf(row.id)).toMatchObject({ outcome: "DRAFT_CREATED", shadow: true });
    expect(await db.ticket.count()).toBe(0);
    expect(await db.mediaFile.count()).toBe(0);
    expect(await db.waMessage.count({ where: { direction: "OUTBOUND" } })).toBe(0);
  });

  it("המספר נותק בינתיים: מה שממתין אינו נקלט (§7 שורה 103)", async () => {
    const user = await makeUser();
    const row = await inbound(user, 0, { text: "תקלה" });
    await db.waNumber.update({ where: { id: numberId }, data: { status: "DISCONNECTED", tokenCipher: null } });
    const { deps } = liveDeps();

    await handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET });
    expect(await rowOf(row.id)).toMatchObject({ outcome: "IGNORED_DISABLED", text: null });
    expect(await db.ticket.count()).toBe(0);
  });
});

// ─────────────────────────────── כשלים ───────────────────────────────

describe("WA-17 — כשל זמני דוחה, ואינו הופך ל\"לא נקלט\"", () => {
  it("תמלול שנכשל: השולח נדחה, ג׳וב בתור, וג׳וב שמגיע מוקדם אינו שורף ניסיון", async () => {
    const user = await makeUser();
    const row = await inbound(user, 0, { media: { id: "m-voice", mimeType: "audio/ogg", voice: true } });
    const media = { "m-voice": voice("תקלה בדירה 12") };
    const failing = fakeTranscriber({ fail: "transient" });
    const { deps } = liveDeps({ media, transcriber: failing });

    const first = await handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET });
    expect(first).toMatchObject({ status: "deferred", reason: "transcription" });
    const deferred = await rowOf(row.id);
    expect(deferred).toMatchObject({ state: "PENDING", attempts: 1, outcome: null });
    expect(deferred.detail).toMatch(/^\[transcription 1\]/);
    expect(deferred.media[0]?.transcript).toBeNull();
    const retryAt = deferred.nextAttemptAt!;
    expect(await db.job.count({ where: { type: JOB_TYPES.waIntake, runAt: retryAt } })).toBe(1);

    // הודעה חדשה של אותו שולח מעירה ג׳וב לפני הזמן — השולח עדיין בהשהיה
    const later = await inbound(user, 5 * SEC, { text: "עוד משהו" });
    expect(retryAt.getTime()).toBeGreaterThan(at(100 * SEC).getTime());
    expect(await handleWaIntake({ waMessageId: later.id }, { ...deps, now: at(100 * SEC) })).toMatchObject({
      status: "deferred",
      reason: "backoff",
      nextAttemptAt: retryAt,
    });
    expect(failing.calls).toBe(1);
    // ההודעה החדשה ממתינה לאותו מועד — ה-watchdog אינו רואה בה הודעה שנשכחה
    expect((await rowOf(later.id)).nextAttemptAt).toEqual(retryAt);

    // במועד, המנוע חזר: ההקלטה תומללה, ותג הדחייה ירד
    const recovered = await handleWaIntake({ waMessageId: row.id }, { ...deps, transcriber: fakeTranscriber(), now: retryAt });
    expect(recovered).toMatchObject({ status: "decided" });
    expect((await rowOf(row.id)).outcome).toBe("DRAFT_CREATED");
  });

  it("השולח הושבת אחרי שההודעה נרשמה: ההקלטה שלו אינה מתומללת, ושום דבר שלו אינו ממתין", async () => {
    const user = await makeUser();
    const voiceRow = await inbound(user, 0, { media: { id: "m-voice", mimeType: "audio/ogg", voice: true } });
    const textRow = await inbound(user, 5 * SEC, { text: "מה המצב?" });
    await db.user.update({ where: { id: user.id }, data: { whatsappIntakeEnabled: false } });
    const { deps, transcriber } = liveDeps({ media: { "m-voice": voice("תקלה בדירה 12") } });

    // עוד לפני השקט ולפני התקרה — אין סיבה להמתין למי שאינו מורשה
    await handleWaIntake({ waMessageId: voiceRow.id }, { ...deps, now: at(10 * SEC) });
    expect(transcriber.calls).toBe(0);
    for (const id of [voiceRow.id, textRow.id]) {
      expect(await rowOf(id)).toMatchObject({ state: "DONE", outcome: "IGNORED_UNAUTHORIZED", text: null });
    }
    expect(await db.waMessage.count({ where: { direction: "OUTBOUND" } })).toBe(0);
  });

  it("אין מנוע תמלול בסביבה: נדחה, לא \"לא נקלט\"", async () => {
    const user = await makeUser();
    const row = await inbound(user, 0, { media: { id: "m-voice", mimeType: "audio/ogg", voice: true } });
    const { deps } = liveDeps({ media: { "m-voice": voice("תקלה") }, transcriber: null });

    expect(await handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET })).toMatchObject({
      status: "deferred",
      reason: "transcription",
    });
    expect(await rowOf(row.id)).toMatchObject({ state: "PENDING", outcome: null });
  });

  it("הורדת מדיה נכשלה זמנית: הדיווח נדחה כולו, ושום טיוטה לא נוצרה", async () => {
    const user = await makeUser();
    const row = await inbound(user, 0, { text: "תקלה", media: { id: "m-img", mimeType: "image/jpeg" } });
    const api = fakeWaApi({ failMedia: () => new WaApiError("Graph 503", "transient") });
    const { deps } = liveDeps({ api });

    expect(await handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET })).toMatchObject({
      status: "deferred",
      reason: "media",
    });
    expect(await db.ticket.count()).toBe(0);
    expect((await rowOf(row.id)).detail).toMatch(/^\[media 1\]/);
  });

  it("מדיה שפגה (7 ימים): הטיוטה נפתחת בלעדיה, והסיבה על הקובץ", async () => {
    const user = await makeUser();
    const row = await inbound(user, 0, { text: "תקלה", media: { id: "m-img", mimeType: "image/jpeg" } });
    const api = fakeWaApi({ failMedia: () => new WaApiError("Graph 404", "not_found") });
    const { deps } = liveDeps({ api, extractor: fakeFieldExtractor({ result: { description: "תקלה" } }) });

    await handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET });
    expect(await db.ticket.count()).toBe(1);
    expect((await rowOf(row.id)).media[0]).toMatchObject({ skippedReason: "download-failed", storageKey: null });
  });

  it("טוקן שבוטל: המספר עובר ל\"תקלה\", והג׳וב נכשל ברעש", async () => {
    const user = await makeUser();
    const row = await inbound(user, 0, { text: "תקלה", media: { id: "m-img", mimeType: "image/jpeg" } });
    const api = fakeWaApi({ failMedia: () => new WaApiError("Graph 401 (190)", "auth") });
    const { deps } = liveDeps({ api });

    await expect(handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET })).rejects.toMatchObject({
      kind: "auth",
    });
    expect(await db.waNumber.findUniqueOrThrow({ where: { id: numberId } })).toMatchObject({
      status: "ERROR",
      lastError: "token_revoked",
    });
    expect(await rowOf(row.id)).toMatchObject({ state: "PENDING" });
  });

  it("EM-11 במקביל — חילוץ שנכשל זמנית בתוך התקציב: נדחה ל-30 שניות; אחרי התקציב: טיוטה בלי פרטים", async () => {
    const user = await makeUser();
    const row = await inbound(user, 0, { text: "תקלה בדירה 12" });
    const extractor = fakeFieldExtractor({ error: aiError("transient") });
    const { deps } = liveDeps({ extractor });

    const first = await handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET });
    expect(first).toMatchObject({ status: "deferred", reason: "extraction", nextAttemptAt: at(BURST_QUIET_MS + 30 * SEC) });

    // שני ניסיונות לפחות נעשו, והתקציב (4 דקות מההודעה) עבר — הכרעה
    const late = at(5 * 60 * SEC);
    const second = await handleWaIntake({ waMessageId: row.id }, { ...deps, now: late });
    expect(second).toMatchObject({ units: [{ outcome: "DRAFT_CREATED_UNPROCESSED" }] });
    expect(extractor.calls).toHaveLength(2);
  });

  it("§7 שורה 114 — תשובה פגומה פעם אחת: ניסיון אחד נוסף, ואז טיוטה עם הפרטים", async () => {
    const user = await makeUser();
    const row = await inbound(user, 0, { text: FULL_REPORT });
    const extractor = fakeFieldExtractor({ result: { description: "נזילה", domain: DOMAIN } });
    extractor.failNext(aiError("malformed"));
    const { deps } = liveDeps({ extractor });

    expect(await handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET })).toMatchObject({
      status: "deferred",
      reason: "extraction",
    });
    const retryAt = (await rowOf(row.id)).nextAttemptAt!;
    expect(await handleWaIntake({ waMessageId: row.id }, { ...deps, now: retryAt })).toMatchObject({
      units: [{ outcome: "DRAFT_CREATED" }],
    });
    expect((await db.ticket.findFirstOrThrow()).domainId).toBe(domainId);
    expect((await rowOf(row.id)).detail).toBeNull();
  });

  it("§7 שורה 114 — תשובה פגומה פעמיים: החילוץ אינו זמין, והסיבה על ההודעה שהאישור עונה לה", async () => {
    const user = await makeUser();
    const row = await inbound(user, 0, { text: FULL_REPORT });
    const extractor = fakeFieldExtractor({ error: aiError("malformed", "תשובת החילוץ אינה עומדת בסכימה: room") });
    const { deps } = liveDeps({ extractor });

    await handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET });
    const retryAt = (await rowOf(row.id)).nextAttemptAt!;
    expect(await handleWaIntake({ waMessageId: row.id }, { ...deps, now: retryAt })).toMatchObject({
      units: [{ outcome: "DRAFT_CREATED_UNPROCESSED" }],
    });
    expect(extractor.calls).toHaveLength(2);
    expect((await rowOf(row.id)).detail).toBe("החילוץ אינו זמין — malformed: תשובת החילוץ אינה עומדת בסכימה: room");
  });

  it("מיצוי הניסיונות: ההודעה נעצרת בלי הכרעה, וג׳וב מיידי ממשיך עם השאר", async () => {
    const user = await makeUser();
    const row = await inbound(user, 0, { media: { id: "m-voice", mimeType: "audio/ogg", voice: true } });
    await db.waMessage.update({ where: { id: row.id }, data: { attempts: MAX_DEFER_ATTEMPTS - 1 } });
    const { deps } = liveDeps({ media: { "m-voice": voice("תקלה") }, transcriber: fakeTranscriber({ fail: "transient" }) });

    expect(await handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET })).toMatchObject({
      status: "decided",
      units: [{ size: 1, outcome: null }],
    });
    expect(await rowOf(row.id)).toMatchObject({ state: "FAILED", outcome: null });
    expect(await db.job.count({ where: { type: JOB_TYPES.waIntake, runAt: AFTER_QUIET } })).toBe(1);
  });
});

describe("הדיווח נבדק שוב בתוך הנעילה", () => {
  it("הודעה שהגיעה באיחור בזמן החילוץ ושייכת לדיווח: דבר אינו נכתב, וג׳וב מיידי מקבץ מחדש", async () => {
    const user = await makeUser();
    const first = await inbound(user, 0, { text: "תקלה בדירה 12" });
    // המחלץ "איטי": בזמן שהוא רץ, Meta מוסרת באיחור הודעה שנכתבה בתוך הדיווח
    const extractor = fakeFieldExtractor({ result: { description: "נזילה" } });
    const slow = {
      ...extractor,
      async extract(input: Parameters<typeof extractor.extract>[0]) {
        if (extractor.calls.length === 0) await inbound(user, 30 * SEC, { text: "וגם בתקרה" });
        return extractor.extract(input);
      },
    };
    const { deps } = liveDeps({ extractor: slow });

    const now = at(BURST_QUIET_MS + 40 * SEC);
    const result = await handleWaIntake({ waMessageId: first.id }, { ...deps, now });
    expect(result).toMatchObject({ status: "decided", units: [] });
    expect(await db.ticket.count()).toBe(0);
    expect(await rowOf(first.id)).toMatchObject({ state: "PENDING" });
    expect(await db.job.count({ where: { type: JOB_TYPES.waIntake, runAt: now } })).toBe(1);

    // הקיבוץ מחדש: דיווח אחד ששתי ההודעות בו
    const again = await handleWaIntake({ waMessageId: first.id }, { ...deps, now: at(30 * SEC + BURST_QUIET_MS) });
    expect(again).toMatchObject({ units: [{ size: 2, outcome: "DRAFT_CREATED" }] });
    expect(await db.ticket.count()).toBe(1);
  });

  /** מחלץ "איטי": בזמן שהוא רץ, מנהל המערכת משנה את השולח */
  function slowExtractor(meanwhile: () => Promise<unknown>) {
    const extractor = fakeFieldExtractor({ result: { description: "נזילה", apartment: "12", building: "בניין א" } });
    return {
      extractor,
      slow: {
        ...extractor,
        async extract(input: Parameters<typeof extractor.extract>[0]) {
          if (extractor.calls.length === 0) await meanwhile();
          return extractor.extract(input);
        },
      },
    };
  }

  it("§5.ה5 כלל 9 — השולח הושבת בזמן החילוץ: אין טיוטה ואין הודעה, וההכרעה מחדש היא IGNORED_UNAUTHORIZED", async () => {
    const user = await makeUser();
    const row = await inbound(user, 0, { text: "תקלה בדירה 12" });
    const { slow } = slowExtractor(() => db.user.update({ where: { id: user.id }, data: { active: false } }));
    const { deps } = liveDeps({ extractor: slow });

    expect(await handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET })).toMatchObject({ units: [] });
    expect(await db.ticket.count()).toBe(0);
    expect(await db.job.count({ where: { type: JOB_TYPES.waIntake, runAt: AFTER_QUIET } })).toBe(1);

    await handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET });
    expect(await rowOf(row.id)).toMatchObject({ outcome: "IGNORED_UNAUTHORIZED", text: null });
    expect(await db.ticket.count()).toBe(0);
    expect(await db.waMessage.count({ where: { direction: "OUTBOUND" } })).toBe(0);
  });

  it("מנהל עבודה שעבר לאתר אחר בזמן החילוץ: הטיוטה נפתחת באתר החדש, ולא באתר שהיה", async () => {
    const otherSite = await db.site.create({ data: { name: "רמת אביב" } });
    const manager = await makeUser({ role: "SITE_MANAGER", siteId });
    const row = await inbound(manager, 0, { text: "תקלה בדירה 12" });
    const { slow, extractor } = slowExtractor(() =>
      db.user.update({ where: { id: manager.id }, data: { siteId: otherSite.id } }),
    );
    const { deps } = liveDeps({ extractor: slow });

    await handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET });
    expect(await db.ticket.count()).toBe(0);
    await handleWaIntake({ waMessageId: row.id }, { ...deps, now: AFTER_QUIET });

    expect(await db.ticket.findFirstOrThrow()).toMatchObject({ siteId: otherSite.id, createdById: manager.id });
    // החילוץ רץ שוב, מול הרשימות של האתר החדש
    expect(extractor.calls).toHaveLength(2);
  });
});
