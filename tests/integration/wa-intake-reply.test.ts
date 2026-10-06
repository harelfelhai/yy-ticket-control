import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JOB_TYPES } from "@/jobs/types";
import { db } from "@/lib/db";
import { conflictsVersion } from "@/lib/draft/state";
import type { Viewer } from "@/lib/permissions";
import {
  channelMediaIds,
  loadDraftState,
  removeDraftMedia,
  resolveDraftConflicts,
  updateDraftFields,
} from "@/lib/services/draft-fields";
import { handleWaIntake } from "@/lib/services/wa-intake";
import { BURST_CEILING_MS, BURST_QUIET_MS } from "@/lib/whatsapp/burst";
import { type ExtractionSpec, aiError, fakeFieldExtractor } from "../helpers/fake-field-extractor";
import { resetDb } from "../helpers/reset-db";
import {
  APARTMENT,
  BUILDING,
  DOMAIN,
  FULL_EXTRACTION,
  FULL_REPORT,
  type InboundSpec,
  JPEG,
  PRO,
  SEC,
  SITE,
  type WaUser,
  type WaWorld,
  at,
  inbound as inboundRow,
  liveDeps,
  makeWaUser,
  rowOf,
  seedWaWorld,
  voice,
} from "../helpers/wa-live";

/**
 * השלמה בוואטסאפ (W7, אפיון §2.7 שלבים 5–6, §5.ה5 כללים 2 ו-9, §5.ה4): תגובה
 * (Reply) בשיחה של טיוטה ממוזגת לטיוטה, או נענית ב"נשלחה", "נמחקה" או "אין הרשאה";
 * הודעה בלי ציטוט ובלי "תקלה" מקבלת לכל היותר את ההסבר החד-פעמי (§7 שורה 98).
 *
 * כל טיוטה כאן נפתחת **בצינור עצמו** (W6), והאישור עליה מסומן כנשלח — כך התגובה
 * פוגשת טיוטה בדיוק כפי שהיא נראית בפרודקשן: שדות עם תג מוואטסאפ, שיחה, וה-wamid
 * של האישור שהשולח מצטט.
 */

let world: WaWorld;

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("WHATSAPP_INTAKE_PILOT_PHONES", "");
  world = await seedWaWorld();
});

afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await db.$disconnect();
});

const inbound = (user: WaUser, offsetMs: number, spec: InboundSpec) => inboundRow(world, user, offsetMs, spec);

/** הצופה של מסך 7 — לעריכה ולהכרעה במערכת */
function viewerOf(user: { id: string }, role: "ADMIN" | "SITE_MANAGER" = "ADMIN", siteId: string | null = null): Viewer {
  return { kind: "user", id: user.id, role, siteId };
}

/** מתי מגיעה התגובה בבדיקות: חמש דקות אחרי הדיווח, ואחרי שהאישור יצא */
const REPLY_AT = 300 * SEC;
const DECIDE_REPLY = at(REPLY_AT + BURST_QUIET_MS);

let ackSeq = 0;

/**
 * טיוטה שנפתחה בדיווח, והאישור עליה נשלח — המצב שאחרי W6. מחזירה את הפנייה, את
 * השיחה ואת ה-wamid של האישור, שהתגובה מצטטת.
 */
async function openDraft(
  user: WaUser,
  options: { extraction?: ExtractionSpec; text?: string; image?: boolean; offsetMs?: number } = {},
) {
  const offset = options.offsetMs ?? 0;
  const report = await inbound(user, offset, {
    text: options.text ?? FULL_REPORT,
    ...(options.image ? { media: { id: `m-draft-${ackSeq}`, mimeType: "image/jpeg" } } : {}),
  });
  const { deps } = liveDeps({
    extractor: fakeFieldExtractor({ result: options.extraction ?? FULL_EXTRACTION }),
    media: options.image ? { [`m-draft-${ackSeq}`]: { bytes: JPEG, mimeType: "image/jpeg" } } : {},
  });
  await handleWaIntake({ waMessageId: report.id }, { ...deps, now: at(offset + BURST_QUIET_MS) });

  const ack = await db.waMessage.findFirstOrThrow({ where: { direction: "OUTBOUND", repliesToId: report.id } });
  const ackWamid = `wamid.ack-${ackSeq++}`;
  await db.waMessage.update({
    where: { id: ack.id },
    data: { state: "SENT", wamid: ackWamid, sentAt: at(offset + BURST_QUIET_MS + 10 * SEC) },
  });
  const thread = await db.waThread.findFirstOrThrow({ where: { messages: { some: { id: report.id } } } });
  const ticket = await db.ticket.findUniqueOrThrow({ where: { id: thread.ticketId! } });
  return { ticket, threadId: thread.id, ackWamid, report };
}

async function draftFieldOf(ticketId: string, field: "SITE" | "APARTMENT" | "DOMAIN" | "RECIPIENTS" | "DESCRIPTION") {
  return db.draftField.findUnique({ where: { ticketId_field: { ticketId, field } } });
}

async function outboundFor(inboundId: string) {
  return db.waMessage.findFirst({ where: { direction: "OUTBOUND", repliesToId: inboundId } });
}

// ─────────────────────────────── השלמה ───────────────────────────────

describe("WA-09 — השלמה בתגובה (Reply) להודעה בשיחה של הטיוטה", () => {
  it("EM-C03 במקביל — שדה ריק מתמלא בשקט, עם תג מוואטסאפ, וב'עודכן מהתגובה שלך'; ואישור חדש", async () => {
    const user = await makeWaUser();
    const { ticket, threadId, ackWamid } = await openDraft(user, {
      extraction: { site: SITE, building: BUILDING, apartment: APARTMENT, description: "נזילה מהתקרה" },
    });
    expect(ticket.domainId).toBeNull();

    const reply = await inbound(user, REPLY_AT, { text: `התחום ${DOMAIN}`, contextWamid: ackWamid });
    const extractor = fakeFieldExtractor({ result: { domain: DOMAIN } });
    const { deps } = liveDeps({ extractor });
    const result = await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY });

    expect(result).toMatchObject({ status: "decided", units: [{ size: 1, outcome: "REPLY_APPLIED", ticketId: ticket.id }] });
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).domainId).toBe(world.domainId);

    // המזהה של ההודעה נכתב לעמודה של וואטסאפ — לא לזו של המייל, שהייתה נדחית במסד
    expect(await draftFieldOf(ticket.id, "DOMAIN")).toMatchObject({ fromChannel: true, conflict: false });

    // התגובה נקלטה: בשיחה, עם התוכן והדוח
    const decided = await rowOf(reply.id);
    expect(decided).toMatchObject({ state: "DONE", outcome: "REPLY_APPLIED", shadow: false, threadId, text: `התחום ${DOMAIN}` });
    expect(decided.report).toMatchObject({ updated: [{ field: "DOMAIN", before: null, after: DOMAIN }] });

    // המחלץ קרא אותה כתגובה בוואטסאפ
    expect(extractor.lastCall).toMatchObject({ channel: "whatsapp", isReply: true, text: `התחום ${DOMAIN}` });

    // §2.7 שלב 5: "אחרי כל תגובה נשלחת שוב הודעת אישור" — כתגובה לתגובה, בשיחה
    expect(await outboundFor(reply.id)).toMatchObject({ state: "PENDING", threadId, authorUserId: user.id });
    expect(await db.job.count({ where: { type: JOB_TYPES.waReply } })).toBe(2);
    expect(await db.ticket.count()).toBe(1);
  });

  it("§5.ה5 כלל 2 — תגובה עם \"תקלה\" היא השלמה, ואינה פותחת טיוטה חדשה", async () => {
    const user = await makeWaUser();
    const { ackWamid } = await openDraft(user);
    const reply = await inbound(user, REPLY_AT, { text: "עוד תקלה באותה דירה, גם בקיר", contextWamid: ackWamid });
    const { deps } = liveDeps({ extractor: fakeFieldExtractor({ result: { description: { op: "append", text: "גם בקיר" } } }) });

    await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY });
    expect((await rowOf(reply.id)).outcome).toBe("REPLY_APPLIED");
    expect(await db.ticket.count()).toBe(1);
  });

  it("תגובה להודעה של השולח עצמו בשיחה — לא רק לאישור — גם היא השלמה", async () => {
    const user = await makeWaUser();
    const { ticket, report } = await openDraft(user);
    const reply = await inbound(user, REPLY_AT, { text: "דירה 12", contextWamid: report.wamid! });
    const { deps } = liveDeps({ extractor: fakeFieldExtractor({ result: { apartment: "12" } }) });

    expect(await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY })).toMatchObject({
      units: [{ outcome: "REPLY_APPLIED", ticketId: ticket.id }],
    });
  });

  it("§5.ה5 כלל 6 — הודעות שמגיעות מיד אחרי התגובה, בלי ציטוט, מצטרפות אליה — כולל תמונה, שנכנסת לטיוטה", async () => {
    const user = await makeWaUser();
    const { ticket, threadId, ackWamid } = await openDraft(user);
    const reply = await inbound(user, REPLY_AT, { text: "מצרף תמונה", contextWamid: ackWamid });
    const image = await inbound(user, REPLY_AT + 10 * SEC, { media: { id: "m-reply", mimeType: "image/jpeg" } });
    const { deps } = liveDeps({
      media: { "m-reply": { bytes: JPEG, mimeType: "image/jpeg" } },
      extractor: fakeFieldExtractor({ result: {} }),
    });

    const result = await handleWaIntake({ waMessageId: image.id }, { ...deps, now: at(REPLY_AT + 10 * SEC + BURST_QUIET_MS) });
    expect(result).toMatchObject({ units: [{ size: 2, outcome: "REPLY_APPLIED" }] });

    const files = await db.mediaFile.findMany({ include: { message: true } });
    expect(files).toHaveLength(1);
    expect(files[0]?.message?.ticketId).toBe(ticket.id);
    expect((await rowOf(image.id)).threadId).toBe(threadId);
    // האישור עונה להודעה האחרונה בדיווח
    expect(await outboundFor(image.id)).not.toBeNull();
    expect(await outboundFor(reply.id)).toBeNull();
  });

  it("הקלטה בתגובה: מתומללת, והתמלול הוא הטקסט שהמחלץ קורא — בלי ג׳וב תמלול שני", async () => {
    const user = await makeWaUser();
    const { ackWamid } = await openDraft(user);
    const reply = await inbound(user, REPLY_AT, {
      media: { id: "m-voice", mimeType: "audio/ogg; codecs=opus", voice: true },
      contextWamid: ackWamid,
    });
    const extractor = fakeFieldExtractor({ result: { apartment: "12" } });
    const { deps } = liveDeps({ media: { "m-voice": voice("דירה 12, זה בחדר הרחצה") }, extractor });

    await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY });
    expect(extractor.lastCall).toMatchObject({ isReply: true, text: "דירה 12, זה בחדר הרחצה", attachments: [] });
    expect(await db.mediaFile.findFirstOrThrow({ where: { mimeType: "audio/ogg" } })).toMatchObject({
      transcription: "דירה 12, זה בחדר הרחצה",
      aiStatus: "DONE",
    });
    expect(await db.job.count({ where: { type: JOB_TYPES.transcribe } })).toBe(0);
  });

  it("EM-11 במקביל — החילוץ אינו זמין: REPLY_STORED_UNPROCESSED, הטיוטה לא משתנה, הקבצים כן נכנסים (§7 שורה 75)", async () => {
    const user = await makeWaUser();
    const { ticket, ackWamid } = await openDraft(user);
    const reply = await inbound(user, REPLY_AT, {
      text: "דירה 14",
      media: { id: "m-reply", mimeType: "image/jpeg" },
      contextWamid: ackWamid,
    });
    const { deps } = liveDeps({ extractor: null, media: { "m-reply": { bytes: JPEG, mimeType: "image/jpeg" } } });

    await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY });
    const after = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after).toMatchObject({ apartmentId: ticket.apartmentId, description: ticket.description });
    expect(await rowOf(reply.id)).toMatchObject({ outcome: "REPLY_STORED_UNPROCESSED", text: "דירה 14" });
    expect(await db.mediaFile.count()).toBe(1);
    expect(await outboundFor(reply.id)).not.toBeNull();
  });

  it("EM-11 במקביל — חילוץ שנכשל זמנית בתגובה: נדחה ואינו הכרעה; בניסיון הבא — מוזג", async () => {
    const user = await makeWaUser();
    const { ticket, ackWamid } = await openDraft(user, {
      extraction: { site: SITE, building: BUILDING, apartment: APARTMENT, description: "נזילה" },
    });
    const reply = await inbound(user, REPLY_AT, { text: `התחום ${DOMAIN}`, contextWamid: ackWamid });
    const extractor = fakeFieldExtractor({ result: { domain: DOMAIN } });
    extractor.failNext(aiError("transient"));
    const { deps } = liveDeps({ extractor });

    const first = await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY });
    expect(first).toMatchObject({ status: "deferred", reason: "extraction" });
    expect(await rowOf(reply.id)).toMatchObject({ state: "PENDING", outcome: null, threadId: null });
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).domainId).toBeNull();
    expect(await outboundFor(reply.id)).toBeNull();

    await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: at(REPLY_AT + BURST_QUIET_MS + 30 * SEC) });
    expect((await rowOf(reply.id)).outcome).toBe("REPLY_APPLIED");
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).domainId).toBe(world.domainId);
    expect(await outboundFor(reply.id)).not.toBeNull();
  });

  it("shadow — התגובה מוכרעת ונרשמת, ושום דבר אינו מבוצע", async () => {
    const user = await makeWaUser();
    const { ticket, ackWamid } = await openDraft(user, {
      extraction: { site: SITE, building: BUILDING, apartment: APARTMENT, description: "נזילה" },
    });
    const reply = await inbound(user, REPLY_AT, { text: `התחום ${DOMAIN}`, contextWamid: ackWamid });
    const { deps } = liveDeps({ extractor: fakeFieldExtractor({ result: { domain: DOMAIN } }) });

    await handleWaIntake({ waMessageId: reply.id }, { ...deps, mode: "shadow", now: DECIDE_REPLY });
    expect(await rowOf(reply.id)).toMatchObject({ outcome: "REPLY_APPLIED", shadow: true, threadId: null });
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).domainId).toBeNull();
    expect(await outboundFor(reply.id)).toBeNull();
  });
});

// ─────────────────────────────── §5.ה4 ───────────────────────────────

describe("WA-C01 — §5.ה4 חל כלשונו על תגובה בוואטסאפ", () => {
  /** דירה נוספת באותו בניין, כדי שיהיה מה לסתור */
  async function secondApartment(number = "14") {
    return db.apartment.create({ data: { buildingId: world.buildingId, number } });
  }

  it("EM-C04 — שדה שנערך במערכת לפני התגובה, וערך שונה: סתירה; שני הערכים נשמרים, והמזהה בעמודה של וואטסאפ", async () => {
    const user = await makeWaUser();
    const { ticket, ackWamid } = await openDraft(user);
    const other = await secondApartment();
    await updateDraftFields(viewerOf(user), ticket.id, { apartmentId: other.id }, at(200 * SEC));

    const reply = await inbound(user, REPLY_AT, { text: "דירה 12", contextWamid: ackWamid });
    const { deps } = liveDeps({ extractor: fakeFieldExtractor({ result: { apartment: "12" } }) });
    await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY });

    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).apartmentId).toBe(other.id);
    expect(await draftFieldOf(ticket.id, "APARTMENT")).toMatchObject({
      conflict: true,
      channelValue: { field: "APARTMENT", apartmentId: world.apartmentId },
      waMessageId: reply.id,
      emailMessageId: null,
    });
    // הסתירה גלויה גם לחלון 7א, שמזהה את ההודעה דרך המטא
    expect((await loadDraftState(ticket.id)).meta.APARTMENT.channelMessageId).toBe(reply.id);
  });

  it("EM-C04 — אותו ערך שנקבע במערכת: אין סתירה ואין שינוי", async () => {
    const user = await makeWaUser();
    const { ticket, ackWamid } = await openDraft(user);
    const other = await secondApartment();
    await updateDraftFields(viewerOf(user), ticket.id, { apartmentId: other.id }, at(200 * SEC));

    const reply = await inbound(user, REPLY_AT, { text: "דירה 14", contextWamid: ackWamid });
    const { deps } = liveDeps({ extractor: fakeFieldExtractor({ result: { apartment: "14" } }) });
    await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY });

    expect(await draftFieldOf(ticket.id, "APARTMENT")).toMatchObject({ conflict: false });
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).apartmentId).toBe(other.id);
  });

  it("EM-C05 — עריכה במערכת אחרי שהתגובה נכתבה (ולפני שעובדה): המערכת מכריעה, בלי סתירה", async () => {
    const user = await makeWaUser();
    const { ticket, ackWamid } = await openDraft(user);
    const other = await secondApartment();
    const reply = await inbound(user, REPLY_AT, { text: "דירה 12", contextWamid: ackWamid });
    await updateDraftFields(viewerOf(user), ticket.id, { apartmentId: other.id }, at(REPLY_AT + 30 * SEC));

    const { deps } = liveDeps({ extractor: fakeFieldExtractor({ result: { apartment: "12" } }) });
    await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY });

    expect(await draftFieldOf(ticket.id, "APARTMENT")).toMatchObject({ conflict: false });
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).apartmentId).toBe(other.id);
  });

  it("T הוא ההודעה האחרונה בדיווח: עריכה במערכת באמצע התגובה פותחת סתירה, ואינה דורסת את מה שנכתב אחריה", async () => {
    const user = await makeWaUser();
    const { ticket, ackWamid } = await openDraft(user);
    const other = await secondApartment();
    await inbound(user, REPLY_AT, { text: "תיקון לדיווח:", contextWamid: ackWamid });
    // העריכה במערכת — בין שתי ההודעות של אותה תגובה
    await updateDraftFields(viewerOf(user), ticket.id, { apartmentId: other.id }, at(REPLY_AT + 20 * SEC));
    const last = await inbound(user, REPLY_AT + 40 * SEC, { text: "דירה 12" });

    const { deps } = liveDeps({ extractor: fakeFieldExtractor({ result: { apartment: "12" } }) });
    await handleWaIntake({ waMessageId: last.id }, { ...deps, now: at(REPLY_AT + 40 * SEC + BURST_QUIET_MS) });

    expect(await draftFieldOf(ticket.id, "APARTMENT")).toMatchObject({ conflict: true, waMessageId: last.id });
  });

  it("EM-C06 — תגובה שנייה מחליפה את הערך הממתין בסתירה: שתי אפשרויות, לא שלוש", async () => {
    const user = await makeWaUser();
    const { ticket, ackWamid } = await openDraft(user);
    const fourteen = await secondApartment("14");
    const sixteen = await secondApartment("16");
    await updateDraftFields(viewerOf(user), ticket.id, { apartmentId: fourteen.id }, at(200 * SEC));

    const first = await inbound(user, REPLY_AT, { text: "דירה 12", contextWamid: ackWamid });
    await handleWaIntake(
      { waMessageId: first.id },
      { ...liveDeps({ extractor: fakeFieldExtractor({ result: { apartment: "12" } }) }).deps, now: DECIDE_REPLY },
    );
    const second = await inbound(user, REPLY_AT + 600 * SEC, { text: "לא, דירה 16", contextWamid: ackWamid });
    await handleWaIntake(
      { waMessageId: second.id },
      {
        ...liveDeps({ extractor: fakeFieldExtractor({ result: { apartment: "16" } }) }).deps,
        now: at(REPLY_AT + 600 * SEC + BURST_QUIET_MS),
      },
    );

    expect(await draftFieldOf(ticket.id, "APARTMENT")).toMatchObject({
      conflict: true,
      channelValue: { field: "APARTMENT", apartmentId: sixteen.id },
      waMessageId: second.id,
    });
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).apartmentId).toBe(fourteen.id);
  });

  it("EM-C07 — תוספת לתיאור מצורפת, ואינה סתירה", async () => {
    const user = await makeWaUser();
    const { ticket, ackWamid } = await openDraft(user);
    const reply = await inbound(user, REPLY_AT, { text: "וגם רטיבות בקיר", contextWamid: ackWamid });
    const { deps } = liveDeps({
      extractor: fakeFieldExtractor({ result: { description: { op: "append", text: "וגם רטיבות בקיר" } } }),
    });
    await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY });

    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).description).toBe(
      "נזילה מהתקרה\n\nוגם רטיבות בקיר",
    );
    expect(await draftFieldOf(ticket.id, "DESCRIPTION")).toMatchObject({ conflict: false, fromChannel: true });
  });

  it("EM-C08 — הוספה של נמען שהוסר במערכת: סתירה, והנמען אינו חוזר בשקט", async () => {
    const user = await makeWaUser();
    const { ticket, ackWamid } = await openDraft(user);
    await updateDraftFields(viewerOf(user), ticket.id, { recipients: [] }, at(200 * SEC));

    const reply = await inbound(user, REPLY_AT, { text: `לשלוח את ${PRO}`, contextWamid: ackWamid });
    const { deps } = liveDeps({ extractor: fakeFieldExtractor({ result: { recipientsAdd: [PRO] } }) });
    await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY });

    expect(await draftFieldOf(ticket.id, "RECIPIENTS")).toMatchObject({ conflict: true, waMessageId: reply.id });
  });

  it("EM-C09 — הכרעה במסך 7א היא עריכה במערכת: תגובה מאוחרת שונה פותחת סתירה חדשה", async () => {
    const user = await makeWaUser();
    const { ticket, ackWamid } = await openDraft(user);
    const other = await secondApartment();
    await updateDraftFields(viewerOf(user), ticket.id, { apartmentId: other.id }, at(200 * SEC));
    const first = await inbound(user, REPLY_AT, { text: "דירה 12", contextWamid: ackWamid });
    await handleWaIntake(
      { waMessageId: first.id },
      { ...liveDeps({ extractor: fakeFieldExtractor({ result: { apartment: "12" } }) }).deps, now: DECIDE_REPLY },
    );

    // ההכרעה במסך 7א — בעד הערך מוואטסאפ
    const version = conflictsVersion(await loadDraftState(ticket.id));
    await resolveDraftConflicts(viewerOf(user), ticket.id, { APARTMENT: "channel" }, version, at(500 * SEC));
    expect(await draftFieldOf(ticket.id, "APARTMENT")).toMatchObject({ conflict: false, waMessageId: null });

    const second = await inbound(user, 900 * SEC, { text: "דירה 14", contextWamid: ackWamid });
    await handleWaIntake(
      { waMessageId: second.id },
      { ...liveDeps({ extractor: fakeFieldExtractor({ result: { apartment: "14" } }) }).deps, now: at(900 * SEC + BURST_QUIET_MS) },
    );
    expect(await draftFieldOf(ticket.id, "APARTMENT")).toMatchObject({ conflict: true, waMessageId: second.id });
  });

  it("EM-C10 — שינוי אתר מהתגובה מאפס את הבניין והדירה, והנמענים נשארים", async () => {
    await db.site.create({ data: { name: "רמת אביב" } });
    const user = await makeWaUser();
    const { ticket, ackWamid } = await openDraft(user);
    const reply = await inbound(user, REPLY_AT, { text: "טעות, זה ברמת אביב", contextWamid: ackWamid });
    const { deps } = liveDeps({ extractor: fakeFieldExtractor({ result: { site: "רמת אביב" } }) });
    await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY });

    const after = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after).toMatchObject({ buildingId: null, apartmentId: null });
    expect(after.siteId).not.toBe(world.siteId);
    expect(after.draftRecipients).toEqual(ticket.draftRecipients);
    expect((await rowOf(reply.id)).report).toMatchObject({
      updated: expect.arrayContaining([expect.objectContaining({ field: "SITE", before: SITE, after: "רמת אביב" })]),
    });
  });
});

// ─────────────────────────────── תגובה שלא מוזגה ───────────────────────────────

describe("WA-10 / WA-11 — תגובה שאינה ממוזגת", () => {
  it("WA-11 — אחרי השיגור: REPLY_AFTER_DISPATCH, הפנייה לא משתנה, התוכן לא נשמר — והודעה \"כבר נשלחה\"", async () => {
    const user = await makeWaUser();
    const { ticket, threadId, ackWamid } = await openDraft(user);
    await db.ticket.update({ where: { id: ticket.id }, data: { isDraft: false } });

    const reply = await inbound(user, REPLY_AT, { text: "דירה 14", contextWamid: ackWamid });
    const { deps, extractor } = liveDeps();
    await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY });

    expect(await rowOf(reply.id)).toMatchObject({ outcome: "REPLY_AFTER_DISPATCH", text: null, threadId });
    expect(await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).toMatchObject({
      apartmentId: ticket.apartmentId,
      description: ticket.description,
    });
    expect(extractor.calls).toHaveLength(0);
    expect(await outboundFor(reply.id)).toMatchObject({ threadId, state: "PENDING" });
  });

  it("WA-11 — אחרי מחיקה: REPLY_AFTER_DELETION, לא נקלטת — והודעה \"נמחקה\"", async () => {
    const user = await makeWaUser();
    const { ticket, threadId, ackWamid } = await openDraft(user);
    await db.ticket.delete({ where: { id: ticket.id } });

    const reply = await inbound(user, REPLY_AT, { text: "דירה 14", contextWamid: ackWamid });
    const { deps } = liveDeps();
    await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY });

    expect(await rowOf(reply.id)).toMatchObject({ outcome: "REPLY_AFTER_DELETION", text: null, threadId });
    expect(await db.ticket.count()).toBe(0);
    expect(await outboundFor(reply.id)).toMatchObject({ threadId });
  });

  it("WA-10 — מנהל עבודה שעבר לאתר אחר ואינו רשאי עוד לערוך: REPLY_NOT_PERMITTED, והודעה שמסבירה", async () => {
    const otherSite = await db.site.create({ data: { name: "רמת אביב" } });
    const manager = await makeWaUser({ role: "SITE_MANAGER", siteId: world.siteId });
    const { ticket, ackWamid } = await openDraft(manager, {
      extraction: { building: BUILDING, apartment: APARTMENT, description: "נזילה" },
    });
    expect(ticket.siteId).toBe(world.siteId);
    await db.user.update({ where: { id: manager.id }, data: { siteId: otherSite.id } });

    const reply = await inbound(manager, REPLY_AT, { text: "דירה 14", contextWamid: ackWamid });
    const { deps } = liveDeps();
    await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY });

    expect(await rowOf(reply.id)).toMatchObject({ outcome: "REPLY_NOT_PERMITTED", text: null });
    expect(await outboundFor(reply.id)).not.toBeNull();
  });

  it("WA-10 — משתמש שהושבת: התגובה אינה נקלטת ואינה נענית", async () => {
    const user = await makeWaUser();
    const { ackWamid } = await openDraft(user);
    await db.user.update({ where: { id: user.id }, data: { whatsappIntakeEnabled: false } });

    const reply = await inbound(user, REPLY_AT, { text: "דירה 14", contextWamid: ackWamid });
    const { deps } = liveDeps();
    await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY });

    expect(await rowOf(reply.id)).toMatchObject({ outcome: "IGNORED_UNAUTHORIZED", text: null });
    expect(await outboundFor(reply.id)).toBeNull();
  });

  describe("המצב נקרא שוב בתוך הנעילה, אחרי ההורדה והחילוץ", () => {
    /** מחלץ "איטי": בזמן שהוא רץ, מישהו משנה את העולם */
    function slowExtractor(meanwhile: () => Promise<unknown>, result: ExtractionSpec = { apartment: "14" }) {
      const extractor = fakeFieldExtractor({ result });
      return {
        ...extractor,
        async extract(input: Parameters<typeof extractor.extract>[0]) {
          await meanwhile();
          return extractor.extract(input);
        },
      };
    }

    it("הטיוטה שוגרה בזמן החילוץ: REPLY_AFTER_DISPATCH, ושום ערך לא נכתב לפנייה החיה", async () => {
      const user = await makeWaUser();
      const { ticket, ackWamid } = await openDraft(user);
      await db.apartment.create({ data: { buildingId: world.buildingId, number: "14" } });
      const reply = await inbound(user, REPLY_AT, { text: "דירה 14", contextWamid: ackWamid });
      const extractor = slowExtractor(() => db.ticket.update({ where: { id: ticket.id }, data: { isDraft: false } }));
      const { deps } = liveDeps({ extractor });

      await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY });
      expect(await rowOf(reply.id)).toMatchObject({ outcome: "REPLY_AFTER_DISPATCH", text: null });
      expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).apartmentId).toBe(world.apartmentId);
      expect(await outboundFor(reply.id)).not.toBeNull();
    });

    it("השולח הושבת בזמן החילוץ: דבר אינו נכתב, וההכרעה מחדש — כמו למושבת מההתחלה, בלי מיזוג ובלי הודעה", async () => {
      const user = await makeWaUser();
      const { ticket, ackWamid } = await openDraft(user);
      const reply = await inbound(user, REPLY_AT, { text: "דירה 14", contextWamid: ackWamid });
      const extractor = slowExtractor(() => db.user.update({ where: { id: user.id }, data: { active: false } }));
      const { deps } = liveDeps({ extractor });

      expect(await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY })).toMatchObject({ units: [] });
      expect(await rowOf(reply.id)).toMatchObject({ state: "PENDING", outcome: null });
      expect(await db.job.count({ where: { type: JOB_TYPES.waIntake, runAt: DECIDE_REPLY } })).toBe(1);

      await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY });
      expect(await rowOf(reply.id)).toMatchObject({ outcome: "IGNORED_UNAUTHORIZED", text: null, threadId: null });
      expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).apartmentId).toBe(world.apartmentId);
      expect(await outboundFor(reply.id)).toBeNull();
    });

    it("השולח הושבת בזמן התמלול: אין לו הסבר, גם כשיש לו טיוטה שאושרה", async () => {
      const user = await makeWaUser();
      await openDraft(user);
      const row = await inbound(user, REPLY_AT, { media: { id: "m-chat", mimeType: "audio/ogg", voice: true } });
      const slow = {
        name: "slow",
        async transcribe() {
          await db.user.update({ where: { id: user.id }, data: { whatsappIntakeEnabled: false } });
          return "מתי מגיעים?";
        },
      };
      const { deps } = liveDeps({ media: { "m-chat": voice("מתי מגיעים?") }, transcriber: slow });
      const now = at(REPLY_AT + BURST_CEILING_MS);

      await handleWaIntake({ waMessageId: row.id }, { ...deps, now });
      await handleWaIntake({ waMessageId: row.id }, { ...deps, now });
      expect(await rowOf(row.id)).toMatchObject({ outcome: "IGNORED_UNAUTHORIZED", text: null });
      expect(await outboundFor(row.id)).toBeNull();
    });

    it("הטיוטה נמחקה בזמן החילוץ: REPLY_AFTER_DELETION", async () => {
      const user = await makeWaUser();
      const { ticket, ackWamid } = await openDraft(user);
      const reply = await inbound(user, REPLY_AT, { text: "דירה 14", contextWamid: ackWamid });
      const extractor = slowExtractor(() => db.ticket.delete({ where: { id: ticket.id } }));
      const { deps } = liveDeps({ extractor });

      await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY });
      expect(await rowOf(reply.id)).toMatchObject({ outcome: "REPLY_AFTER_DELETION" });
    });
  });
});

// ─────────────────────────────── קבצים ───────────────────────────────

describe("WA-S7-03 / EM-25 במקביל — קבצים בתגובה", () => {
  it("WA-S7-03 — \"הסר קובץ\" חל על קובץ שהגיע בוואטסאפ: נשאר בשיחה, יוצא מהטיוטה", async () => {
    const user = await makeWaUser();
    const { ticket } = await openDraft(user, { image: true });
    const file = await db.mediaFile.findFirstOrThrow();
    expect(await channelMediaIds(ticket.id)).toEqual(new Set([file.id]));

    await removeDraftMedia(viewerOf(user), file.id);
    expect(await db.mediaFile.count()).toBe(0);
    const media = await db.waMedia.findFirstOrThrow();
    expect(media.removedFromDraftAt).not.toBeNull();
    expect(media).toMatchObject({ mediaFileId: null });
    expect(media.storageKey).not.toBeNull();
    expect(await channelMediaIds(ticket.id)).toEqual(new Set());
  });

  it("§7 שורה 87 — קובץ שצורף בשרשור מתוך המערכת אינו ניתן להסרה, גם בטיוטה מוואטסאפ", async () => {
    const user = await makeWaUser();
    const { ticket } = await openDraft(user);
    const message = await db.message.create({ data: { ticketId: ticket.id, kind: "MEDIA", authorUserId: user.id } });
    const file = await db.mediaFile.create({
      data: { messageId: message.id, storageKey: "media/system/1.jpeg", mimeType: "image/jpeg", sizeBytes: 10, uploaded: true },
    });
    expect(await channelMediaIds(ticket.id)).toEqual(new Set());
    await expect(removeDraftMedia(viewerOf(user), file.id)).rejects.toThrow();
  });

  it("EM-25 במקביל — קובץ שהוסר מהטיוטה אינו חוזר כשאותו קובץ מגיע שוב בתגובה", async () => {
    const user = await makeWaUser();
    const { ackWamid } = await openDraft(user, { image: true });
    await removeDraftMedia(viewerOf(user), (await db.mediaFile.findFirstOrThrow()).id);

    const reply = await inbound(user, REPLY_AT, { text: "שוב התמונה", media: { id: "m-again", mimeType: "image/jpeg" }, contextWamid: ackWamid });
    const { deps } = liveDeps({ media: { "m-again": { bytes: JPEG, mimeType: "image/jpeg" } }, extractor: fakeFieldExtractor({ result: {} }) });
    await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY });

    expect(await db.mediaFile.count()).toBe(0);
    expect((await rowOf(reply.id)).media[0]).toMatchObject({ skippedReason: "removed_before", mediaFileId: null, storageKey: null });
  });

  it("§7 שורה 74 — קובץ זהה לקובץ שכבר בטיוטה אינו נכנס שוב", async () => {
    const user = await makeWaUser();
    const { ackWamid } = await openDraft(user, { image: true });
    const reply = await inbound(user, REPLY_AT, { media: { id: "m-same", mimeType: "image/jpeg" }, contextWamid: ackWamid });
    const { deps } = liveDeps({ media: { "m-same": { bytes: JPEG, mimeType: "image/jpeg" } }, extractor: fakeFieldExtractor({ result: {} }) });
    await handleWaIntake({ waMessageId: reply.id }, { ...deps, now: DECIDE_REPLY });

    expect(await db.mediaFile.count()).toBe(1);
    expect((await rowOf(reply.id)).media[0]).toMatchObject({ skippedReason: "already_in_draft", mediaFileId: null });
  });
});

// ─────────────────────────────── ההסבר החד-פעמי ───────────────────────────────

describe("WA-16 — ההסבר החד-פעמי (§7 שורה 98)", () => {
  /** הודעה בלי ציטוט ובלי "תקלה", מוכרעת בתקרה */
  async function chat(user: WaUser, offsetMs: number, text = "מתי אתה מגיע?", spec: Partial<InboundSpec> = {}) {
    const row = await inbound(user, offsetMs, { text, ...spec });
    const { deps } = liveDeps();
    await handleWaIntake({ waMessageId: row.id }, { ...deps, now: at(offsetMs + BURST_CEILING_MS) });
    return row;
  }

  it("טיוטה שאושרה: הסבר אחד, וההודעה עצמה אינה נקלטת ואינה חלק מהטיוטה", async () => {
    const user = await makeWaUser();
    const { threadId } = await openDraft(user);
    const row = await chat(user, REPLY_AT);

    expect(await rowOf(row.id)).toMatchObject({ outcome: "IGNORED_NO_KEYWORD", text: null, threadId: null });
    const hint = await outboundFor(row.id);
    expect(hint).toMatchObject({ state: "PENDING", threadId: null, authorUserId: user.id });
    expect((await db.waThread.findUniqueOrThrow({ where: { id: threadId } })).hintSentAt).not.toBeNull();
    expect(await db.job.count({ where: { type: JOB_TYPES.waReply, payload: { equals: { waMessageId: hint!.id } } } })).toBe(1);
  });

  it("פעם אחת לכל טיוטה: הודעה נוספת כזו אינה מקבלת הסבר שני — וטיוטה חדשה מזכה בהסבר חדש", async () => {
    const user = await makeWaUser();
    await openDraft(user);
    await chat(user, REPLY_AT);
    const second = await chat(user, REPLY_AT + BURST_CEILING_MS + 60 * SEC, "בסדר, תודה");
    expect(await outboundFor(second.id)).toBeNull();

    await openDraft(user, { offsetMs: 3 * BURST_CEILING_MS });
    const third = await chat(user, 3 * BURST_CEILING_MS + REPLY_AT, "ועוד שאלה");
    expect(await outboundFor(third.id)).not.toBeNull();
  });

  it("שתי טיוטות פתוחות: הסבר אחד, ושתיהן מסומנות — אותו הסבר אינו נשלח פעמיים ברצף", async () => {
    const user = await makeWaUser();
    await openDraft(user);
    await openDraft(user, { offsetMs: 2 * BURST_CEILING_MS });
    const row = await chat(user, 3 * BURST_CEILING_MS);
    const next = await chat(user, 5 * BURST_CEILING_MS, "עוד הודעה");

    expect(await outboundFor(row.id)).not.toBeNull();
    expect(await outboundFor(next.id)).toBeNull();
    expect(await db.waThread.count({ where: { hintSentAt: null } })).toBe(0);
  });

  it.each([
    ["האישור עוד לא יצא", { state: "PENDING" as const }],
    ["האישור נכשל (131047)", { state: "FAILED" as const }],
    ["האישור יצא לפני יותר מ-24 שעות", { sentAt: at(REPLY_AT - 25 * 3600 * SEC) }],
  ])("שתיקה — %s", async (_name, ack) => {
    const user = await makeWaUser();
    const { report } = await openDraft(user);
    await db.waMessage.updateMany({ where: { direction: "OUTBOUND", repliesToId: report.id }, data: ack });
    const row = await chat(user, REPLY_AT);
    expect(await outboundFor(row.id)).toBeNull();
  });

  it.each([
    ["הטיוטה שוגרה", async (ticketId: string) => db.ticket.update({ where: { id: ticketId }, data: { isDraft: false } })],
    ["הטיוטה נמחקה", async (ticketId: string) => db.ticket.delete({ where: { id: ticketId } })],
  ])("שתיקה — %s: אין מה להשלים", async (_name, close) => {
    const user = await makeWaUser();
    const { ticket } = await openDraft(user);
    await close(ticket.id);
    const row = await chat(user, REPLY_AT);
    expect(await outboundFor(row.id)).toBeNull();
  });

  it("שתיקה — רק האישור של **מנהל עבודה בלי אתר** יצא (NO_SITE): אין טיוטה", async () => {
    const manager = await makeWaUser({ role: "SITE_MANAGER", siteId: null });
    const report = await inbound(manager, 0, { text: "תקלה בדירה 12" });
    await handleWaIntake({ waMessageId: report.id }, { ...liveDeps().deps, now: at(BURST_QUIET_MS) });
    await db.waMessage.updateMany({
      where: { direction: "OUTBOUND", repliesToId: report.id },
      data: { state: "SENT", wamid: "wamid.nosite", sentAt: at(BURST_QUIET_MS + 10 * SEC) },
    });
    const row = await chat(manager, REPLY_AT);
    expect(await outboundFor(row.id)).toBeNull();
  });

  it("שתיקה — ב-24 השעות יצאה בשיחה רק הודעת \"אין הרשאה\" (L08), ולא אישור שמתאר את הטיוטה", async () => {
    const user = await makeWaUser();
    const { threadId, report } = await openDraft(user);
    // אישור הטיוטה עצמו — לפני יותר מ-24 שעות
    await db.waMessage.updateMany({
      where: { direction: "OUTBOUND", repliesToId: report.id },
      data: { sentAt: at(REPLY_AT - 25 * 3600 * SEC) },
    });
    // תגובה שלא הותרה (הכותב איבד את ההרשאה), וההודעה עליה — לפני דקה
    const rejected = await db.waMessage.create({
      data: {
        direction: "INBOUND",
        state: "DONE",
        outcome: "REPLY_NOT_PERMITTED",
        numberId: world.numberId,
        authorUserId: user.id,
        type: "text",
        wamid: "wamid.rejected",
        threadId,
        receivedAt: at(REPLY_AT - 60 * SEC),
      },
    });
    await db.waMessage.create({
      data: {
        direction: "OUTBOUND",
        state: "SENT",
        numberId: world.numberId,
        type: "text",
        wamid: "wamid.l08",
        threadId,
        repliesToId: rejected.id,
        authorUserId: user.id,
        sentAt: at(REPLY_AT - 50 * SEC),
      },
    });

    const row = await chat(user, REPLY_AT);
    expect(await outboundFor(row.id)).toBeNull();
  });

  it("שתיקה — למי שאין לו טיוטה, ולמשתמש אחר שיש לו", async () => {
    const owner = await makeWaUser();
    const other = await makeWaUser({ name: "משה" });
    await openDraft(owner);
    const row = await chat(other, REPLY_AT);
    expect(await outboundFor(row.id)).toBeNull();
  });

  it("ב-shadow אין הסבר", async () => {
    const user = await makeWaUser();
    await openDraft(user);
    const row = await inbound(user, REPLY_AT, { text: "מתי אתה מגיע?" });
    await handleWaIntake({ waMessageId: row.id }, { ...liveDeps().deps, mode: "shadow", now: at(REPLY_AT + BURST_CEILING_MS) });
    expect(await outboundFor(row.id)).toBeNull();
  });

  it("תגובה על ההסבר עצמו אינה השלמה: ההסבר אינו חלק מטיוטה", async () => {
    const user = await makeWaUser();
    const { ticket } = await openDraft(user);
    const row = await chat(user, REPLY_AT);
    await db.waMessage.updateMany({
      where: { direction: "OUTBOUND", repliesToId: row.id },
      data: { state: "SENT", wamid: "wamid.hint", sentAt: at(REPLY_AT + BURST_CEILING_MS + 5 * SEC) },
    });

    const reply = await chat(user, 2 * BURST_CEILING_MS, "דירה 14", { contextWamid: "wamid.hint" });
    expect(await rowOf(reply.id)).toMatchObject({ outcome: "IGNORED_NO_KEYWORD", threadId: null });
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).apartmentId).toBe(world.apartmentId);
  });
});
