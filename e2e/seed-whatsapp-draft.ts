import "dotenv/config";
import { db } from "../src/lib/db";
import { writeLocalObject } from "../src/lib/storage/local";
import {
  WA_ACK,
  WA_DISPATCHED_ACK,
  WA_DISPATCHED_REPORT,
  WA_DRAFT_NUMBER_ID,
  WA_LATE_ACK,
  WA_REPLY,
  WA_REPLY_ACK,
  WA_REPORT,
  WA_TRANSCRIPT,
} from "./whatsapp-fixtures";

/**
 * זריעת טיוטה מוואטסאפ למסך 7 (W8), כתהליך tsx — המקבילה של `seed-email.ts`.
 *
 * **שורות במסד, לא הצינור.** הצינור עצמו נבדק ב-integration (`wa-intake-*.test.ts`);
 * כאן נבדק מה המסך מציג, ולכן המצב נכתב כמו שהצינור משאיר אותו:
 *
 * - **טיוטה עם שיחה:** דיווח עם תמונה (בכיתוב) והקלטה מתומללת, אישור שנקרא, תגובה
 *   שנקלטה ופתחה סתירה בבניין, ואישור עליה שלא נשלח. תיאור ותחום מוואטסאפ.
 * - **פנייה מוואטסאפ ששוגרה:** דיווח ואישור לפני השיגור, ותגובה מאוחרת עם "כבר
 *   נשלחה" אחריו — חלון "פרטים" מציג רק את מה שקדם לשיגור (WA-S2-01).
 *
 * כל ריצה מוחקת את מה שהריצה הקודמת זרעה, ורק אותו: הבסיס משותף לכל הבדיקות.
 */

/** תמונה אמיתית, 1×1 — כדי שהבועה והאריח יציגו תמונה ולא סמל שבור */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const OGG = Buffer.from("OggS-e2e-voice-note");

async function main(): Promise<void> {
  const admin = await db.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("אין מנהל מערכת בבסיס — ה-seed הראשי אמור היה לזרוע אותו");
  const site = await db.site.findFirst({ orderBy: { createdAt: "asc" } });
  if (!site) throw new Error("אין אתר בבסיס — ה-seed הראשי אמור היה לזרוע אותו");

  const building = async (name: string) =>
    (await db.building.findFirst({ where: { siteId: site.id, name } })) ??
    db.building.create({ data: { siteId: site.id, name } });
  const buildingA = await building("בניין א");
  const buildingB = await building("בניין ב");
  const apartment =
    (await db.apartment.findFirst({ where: { buildingId: buildingA.id }, orderBy: { number: "asc" } })) ??
    (await db.apartment.create({ data: { buildingId: buildingA.id, number: "1" } }));
  const domain =
    (await db.domain.findFirst({ where: { name: "אינסטלציה" } })) ??
    (await db.domain.create({ data: { name: "אינסטלציה" } }));
  const pro =
    (await db.professional.findFirst({ where: { name: "קבלן מוואטסאפ" } })) ??
    (await db.professional.create({ data: { name: "קבלן מוואטסאפ", phone: "050-7770088" } }));

  // ─── ניקוי הריצה הקודמת ───
  const previous = await db.ticket.findMany({
    where: { description: { in: [WA_REPORT, WA_DISPATCHED_REPORT] } },
    select: { id: true },
  });
  const oldNumber = await db.waNumber.findUnique({ where: { phoneNumberId: WA_DRAFT_NUMBER_ID } });
  if (oldNumber) await db.waMessage.deleteMany({ where: { numberId: oldNumber.id } });
  if (previous.length > 0) {
    const ticketIds = previous.map((t) => t.id);
    await db.waThread.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await db.ticket.deleteMany({ where: { id: { in: ticketIds } } });
  }

  const now = Date.now();
  const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000);
  const number = await db.waNumber.upsert({
    where: { phoneNumberId: WA_DRAFT_NUMBER_ID },
    create: {
      phoneNumberId: WA_DRAFT_NUMBER_ID,
      wabaId: "200000000000088",
      displayPhone: "+972 50-000-0088",
      tokenCipher: null,
      activatedAt: minutesAgo(60 * 24 * 60),
      connectedAt: minutesAgo(60 * 24 * 60),
    },
    update: { status: "CONNECTED", connectedAt: minutesAgo(60 * 24 * 60) },
  });
  let seq = 0;
  const row = (data: Record<string, unknown>) =>
    db.waMessage.create({
      data: {
        numberId: number.id,
        direction: "INBOUND",
        state: "DONE",
        type: "text",
        wamid: `wamid.e2e-${now}-${seq++}`,
        ...data,
      } as Parameters<typeof db.waMessage.create>[0]["data"],
    });

  // ─── הטיוטה ───
  const draft = await db.ticket.create({
    data: {
      siteId: site.id,
      buildingId: buildingA.id,
      domainId: domain.id,
      channel: "WHATSAPP",
      isDraft: true,
      description: WA_REPORT,
      createdById: admin.id,
      draftRecipients: [],
      createdAt: minutesAgo(60),
      lastActivityAt: minutesAgo(29),
    },
  });
  const thread = await db.waThread.create({ data: { ticketId: draft.id } });

  const report = await row({
    outcome: "DRAFT_CREATED",
    type: "image",
    text: WA_REPORT,
    threadId: thread.id,
    authorUserId: admin.id,
    receivedAt: minutesAgo(60),
    createdAt: minutesAgo(60),
  });
  const voice = await row({
    outcome: "DRAFT_CREATED",
    type: "audio",
    threadId: thread.id,
    authorUserId: admin.id,
    receivedAt: minutesAgo(59.5),
    createdAt: minutesAgo(59.5),
  });

  // הקבצים שנכנסו לטיוטה — כמו ש-`writeMedia` משאיר אותם: קובץ מדיה בשרשור, והקובץ
  // בשיחה מצביע עליו ועל אותם בתים
  const attach = async (
    message: { id: string },
    file: { bytes: Buffer; mimeType: string; key: string; transcript?: string },
  ) => {
    await writeLocalObject(file.key, file.bytes);
    const holder = await db.message.create({
      data: { ticketId: draft.id, kind: "MEDIA", authorUserId: admin.id, createdAt: minutesAgo(59) },
    });
    const media = await db.mediaFile.create({
      data: {
        messageId: holder.id,
        storageKey: file.key,
        mimeType: file.mimeType,
        sizeBytes: file.bytes.byteLength,
        uploaded: true,
        uploaderUserId: admin.id,
        transcription: file.transcript ?? null,
        aiStatus: file.transcript ? "DONE" : "SKIPPED",
      },
    });
    await db.waMedia.create({
      data: {
        messageId: message.id,
        partIndex: 0,
        waMediaId: `e2e-${message.id}`,
        mimeType: file.mimeType,
        sizeBytes: file.bytes.byteLength,
        voice: Boolean(file.transcript),
        transcript: file.transcript ?? null,
        storageKey: file.key,
        isMedia: true,
        mediaFileId: media.id,
      },
    });
  };
  await attach(report, { bytes: PNG, mimeType: "image/png", key: `e2e/wa/${report.id}/0.png` });
  await attach(voice, { bytes: OGG, mimeType: "audio/ogg", key: `e2e/wa/${voice.id}/0.ogg`, transcript: WA_TRANSCRIPT });

  const ack = await row({
    direction: "OUTBOUND",
    state: "SENT",
    text: WA_ACK,
    threadId: thread.id,
    repliesToId: voice.id,
    sentAt: minutesAgo(58),
    deliveredAt: minutesAgo(58),
    readAt: minutesAgo(57),
    createdAt: minutesAgo(58.5),
  });
  const reply = await row({
    outcome: "REPLY_APPLIED",
    text: WA_REPLY,
    contextWamid: ack.wamid,
    threadId: thread.id,
    authorUserId: admin.id,
    receivedAt: minutesAgo(30),
    createdAt: minutesAgo(30),
  });
  // האישור על התגובה לא הגיע לשולח — Meta דיווחה כישלון
  await row({
    direction: "OUTBOUND",
    state: "FAILED",
    errorCode: 131026,
    text: WA_REPLY_ACK,
    threadId: thread.id,
    repliesToId: reply.id,
    sentAt: minutesAgo(29),
    createdAt: minutesAgo(29.5),
  });

  await db.draftField.createMany({
    data: [
      { ticketId: draft.id, field: "DESCRIPTION", fromChannel: true, waMessageId: report.id },
      { ticketId: draft.id, field: "DOMAIN", fromChannel: true, waMessageId: report.id },
      {
        ticketId: draft.id,
        field: "BUILDING",
        fromChannel: false,
        systemEditedAt: minutesAgo(45),
        conflict: true,
        channelValue: { field: "BUILDING", buildingId: buildingB.id },
        waMessageId: reply.id,
      },
    ],
  });

  // ─── פנייה ששוגרה ───
  const dispatched = await db.ticket.create({
    data: {
      siteId: site.id,
      buildingId: buildingA.id,
      apartmentId: apartment.id,
      domainId: domain.id,
      channel: "WHATSAPP",
      isDraft: false,
      description: WA_DISPATCHED_REPORT,
      createdById: admin.id,
      createdAt: minutesAgo(120),
      lastActivityAt: minutesAgo(10),
    },
  });
  await db.assignment.create({
    data: { ticketId: dispatched.id, professionalId: pro.id, status: "SENT", createdAt: minutesAgo(100) },
  });
  const thread2 = await db.waThread.create({ data: { ticketId: dispatched.id } });
  const original = await row({
    outcome: "DRAFT_CREATED",
    text: WA_DISPATCHED_REPORT,
    threadId: thread2.id,
    authorUserId: admin.id,
    receivedAt: minutesAgo(120),
    createdAt: minutesAgo(120),
  });
  await row({
    direction: "OUTBOUND",
    state: "SENT",
    text: WA_DISPATCHED_ACK,
    threadId: thread2.id,
    repliesToId: original.id,
    sentAt: minutesAgo(118),
    deliveredAt: minutesAgo(118),
    createdAt: minutesAgo(119),
  });
  const late = await row({
    outcome: "REPLY_AFTER_DISPATCH",
    threadId: thread2.id,
    authorUserId: admin.id,
    receivedAt: minutesAgo(31),
    createdAt: minutesAgo(31),
  });
  await row({
    direction: "OUTBOUND",
    state: "SENT",
    text: WA_LATE_ACK,
    threadId: thread2.id,
    repliesToId: late.id,
    sentAt: minutesAgo(30),
    createdAt: minutesAgo(30),
  });

  console.log(`DRAFT_ID=${draft.id}`);
  console.log(`DISPATCHED_ID=${dispatched.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
