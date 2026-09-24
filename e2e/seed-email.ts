import "dotenv/config";
import { createHash } from "node:crypto";
import { db } from "../src/lib/db";
import {
  DISPATCHED_BODY,
  DISPATCHED_DESCRIPTION,
  DISPATCHED_REPLY,
  FIRST_BODY,
  LATE_REPLY,
  MEDIA_NAME,
  NON_MEDIA_NAME,
  NO_SITE_BODY,
  REPLY_ACK_BODY,
  REPLY_BODY,
  THREAD_FILE_NAME,
} from "./email-fixtures";

/**
 * זורע שני תרחישים של פנייה ממייל — התשתית של `email-draft.spec.ts` ושל
 * `email-conflicts.spec.ts` (מסכים 7 ו-7א, אפיון 1.3).
 *
 * **ישירות בבסיס, לא דרך התיבה.** הצינור שקורא את התיבה (S6–S7) נבדק
 * במקומו עם מקור מזויף; מה שהמסך צריך הוא **מה שהצינור משאיר אחריו**: פנייה
 * בערוץ `EMAIL`, שורות `DraftField` עם תג וסתירה, `MailThread` עם ההודעות
 * משני הכיוונים, קובץ מצורף שנכנס לטיוטה כמדיה וקובץ שנשמר בהתכתבות בלבד.
 *
 * רץ כסקריפט נפרד (tsx) עם `DATABASE_URL` של סביבת ה-E2E — ראו
 * `seed-archive.ts` למה. **מאפס ולא מדלג**: הבדיקות מכריעות את הסתירה
 * ומסירות את הקובץ, ופרויקט הדסקטופ שרץ אחרי המובייל צריך תרחיש נקי.
 *
 * אותו סקריפט משמש גם לצילומי המסך המקומיים מול `yy_dev` — הוא נוגע רק
 * בפניות שהוא עצמו זרע (מזוהות לפי התיאור), ולא בשום דבר אחר.
 */

const MAILBOX = "mailbox@example.com";

function sha(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

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
    (await db.domain.findFirst({ where: { name: "חשמל" } })) ?? (await db.domain.create({ data: { name: "חשמל" } }));
  const pro =
    (await db.professional.findFirst({ where: { name: "קבלן ממייל" } })) ??
    (await db.professional.create({ data: { name: "קבלן ממייל", phone: "050-7770001" } }));

  const senderAddress = admin.email ?? "sender@example.com";
  const senderName = admin.name;

  // ── איפוס: מה שנזרע בריצה קודמת נמחק, כולל ההתכתבות שלו ─────────────
  const previous = await db.ticket.findMany({
    where: { description: { in: [FIRST_BODY, DISPATCHED_DESCRIPTION, NO_SITE_BODY] } },
    select: { id: true },
  });
  if (previous.length > 0) {
    const ticketIds = previous.map((t) => t.id);
    const threads = await db.mailThread.findMany({ where: { ticketId: { in: ticketIds } }, select: { id: true } });
    const threadIds = threads.map((t) => t.id);
    // ההודעות אינן נמחקות עם השרשרת (SetNull), ולכן קודם הן
    await db.mailboxMessage.deleteMany({ where: { threadId: { in: threadIds } } });
    // תשובה שהגיעה אחרי השיגור אינה בשרשרת (הצינור אינו כותב לה threadId),
    // ולכן נמחקת לפי המזהה שהזריעה נותנת לכל הודעה נכנסת
    await db.mailboxMessage.deleteMany({ where: { threadId: null, rfcMessageId: { startsWith: "<e2e-" } } });
    await db.mailThread.deleteMany({ where: { id: { in: threadIds } } });
    // הפנייה גוררת איתה שדות, הודעות, מדיה ושיוכים (Cascade)
    await db.ticket.deleteMany({ where: { id: { in: ticketIds } } });
  }

  const now = Date.now();
  const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000);

  // ── תרחיש 1: טיוטה ממייל עם סתירה על הבניין וקובץ בטיוטה ──────────────
  const draft = await db.ticket.create({
    data: {
      siteId: site.id,
      buildingId: buildingA.id,
      domainId: domain.id,
      channel: "EMAIL",
      isDraft: true,
      description: FIRST_BODY,
      createdById: admin.id,
      draftRecipients: [],
      createdAt: minutesAgo(60),
      lastActivityAt: minutesAgo(30),
    },
  });
  const thread = await db.mailThread.create({ data: { ticketId: draft.id } });

  const first = await db.mailboxMessage.create({
    data: {
      direction: "INBOUND",
      state: "DONE",
      outcome: "DRAFT_CREATED",
      threadId: thread.id,
      rfcMessageId: `<e2e-${draft.id}-1@example.com>`,
      fromAddress: senderAddress,
      fromName: senderName,
      toAddress: MAILBOX,
      authorUserId: admin.id,
      subject: "תקלה בדירה",
      bodyText: FIRST_BODY,
      fullText: FIRST_BODY,
      receivedAt: minutesAgo(60),
      createdAt: minutesAgo(60),
    },
  });

  // הקובץ שנכנס לטיוטה: הודעת MEDIA מהשולח, רשומת MediaFile, והצמדה למייל
  const mediaMessage = await db.message.create({
    data: { ticketId: draft.id, kind: "MEDIA", authorUserId: admin.id, createdAt: minutesAgo(60) },
  });
  const mediaFile = await db.mediaFile.create({
    data: {
      messageId: mediaMessage.id,
      storageKey: `e2e/email/${draft.id}/${MEDIA_NAME}`,
      mimeType: "image/png",
      sizeBytes: 2048,
      originalName: MEDIA_NAME,
      uploaded: true,
      uploaderUserId: admin.id,
      aiStatus: "SKIPPED",
    },
  });
  await db.mailboxAttachment.createMany({
    data: [
      {
        messageId: first.id,
        partIndex: 1,
        filename: MEDIA_NAME,
        mimeType: "image/png",
        sizeBytes: 2048,
        sha256: sha(`${draft.id}-logo`),
        storageKey: `e2e/mail/${first.id}/1`,
        isMedia: true,
        inline: true,
        mediaFileId: mediaFile.id,
      },
      {
        messageId: first.id,
        partIndex: 2,
        filename: NON_MEDIA_NAME,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: 3072,
        sha256: sha(`${draft.id}-quote`),
        // כמו הצינור: לקובץ שאינו מדיה אין בתים שמורים, ולכן גם אין קישור
        storageKey: null,
        isMedia: false,
        skippedReason: "not-media",
      },
    ],
  });

  // קובץ שצורף בשרשור של הטיוטה מתוך המערכת: הודעת MEDIA בלי הצמדה למייל
  const threadFileMessage = await db.message.create({
    data: { ticketId: draft.id, kind: "MEDIA", authorUserId: admin.id, createdAt: minutesAgo(40) },
  });
  await db.mediaFile.create({
    data: {
      messageId: threadFileMessage.id,
      storageKey: `e2e/thread/${draft.id}/${THREAD_FILE_NAME}`,
      mimeType: "application/pdf",
      sizeBytes: 4096,
      originalName: THREAD_FILE_NAME,
      uploaded: true,
      uploaderUserId: admin.id,
      aiStatus: "SKIPPED",
    },
  });

  await db.mailboxMessage.create({
    data: {
      direction: "OUTBOUND",
      state: "SENT",
      threadId: thread.id,
      repliesToId: first.id,
      fromAddress: MAILBOX,
      toAddress: senderAddress,
      subject: "Re: תקלה בדירה",
      bodyText: "המייל שלך התקבל ונשמר כטיוטה במערכת. הטיוטה עוד לא נשלחה לאיש.",
      sentAt: minutesAgo(58),
      createdAt: minutesAgo(59),
    },
  });

  const reply = await db.mailboxMessage.create({
    data: {
      direction: "INBOUND",
      state: "DONE",
      outcome: "REPLY_APPLIED",
      threadId: thread.id,
      rfcMessageId: `<e2e-${draft.id}-3@example.com>`,
      fromAddress: senderAddress,
      fromName: senderName,
      toAddress: MAILBOX,
      authorUserId: admin.id,
      subject: "Re: תקלה בדירה",
      bodyText: REPLY_BODY,
      fullText: REPLY_BODY,
      receivedAt: minutesAgo(30),
      createdAt: minutesAgo(30),
    },
  });

  // המייל החוזר על התשובה — יוצא באותה טרנזאקציה של המיזוג, ולכן הוא
  // האחרון בהתכתבות (EM-S7-02: "המייל האחרון פתוח")
  await db.mailboxMessage.create({
    data: {
      direction: "OUTBOUND",
      state: "SENT",
      threadId: thread.id,
      repliesToId: reply.id,
      fromAddress: MAILBOX,
      toAddress: senderAddress,
      subject: "Re: תקלה בדירה",
      bodyText: REPLY_ACK_BODY,
      sentAt: minutesAgo(29),
      createdAt: minutesAgo(29),
    },
  });

  // תיאור ותחום מהמייל הראשון; הבניין נערך במערכת ל"בניין א" ואז התשובה
  // הציעה "בניין ב" — סתירה פתוחה (§5.ה4)
  await db.draftField.createMany({
    data: [
      { ticketId: draft.id, field: "DESCRIPTION", fromEmail: true, emailMessageId: first.id },
      { ticketId: draft.id, field: "DOMAIN", fromEmail: true, emailMessageId: first.id },
      {
        ticketId: draft.id,
        field: "BUILDING",
        fromEmail: false,
        systemEditedAt: minutesAgo(45),
        conflict: true,
        emailValue: { field: "BUILDING", buildingId: buildingB.id },
        emailMessageId: reply.id,
      },
    ],
  });

  // ── תרחיש 2: פנייה ממייל שכבר שוגרה — ההתכתבות בחלון "פרטים" ───────────
  const dispatched = await db.ticket.create({
    data: {
      siteId: site.id,
      buildingId: buildingA.id,
      apartmentId: apartment.id,
      domainId: domain.id,
      channel: "EMAIL",
      isDraft: false,
      description: DISPATCHED_DESCRIPTION,
      createdById: admin.id,
      createdAt: minutesAgo(120),
      lastActivityAt: minutesAgo(10),
    },
  });
  // השיגור הוא השיוך: מועד השיוך הראשון הוא מה שחלון "פרטים" חותך לפיו
  await db.assignment.create({
    data: { ticketId: dispatched.id, professionalId: pro.id, status: "SENT", createdAt: minutesAgo(100) },
  });
  const thread2 = await db.mailThread.create({ data: { ticketId: dispatched.id } });
  const original = await db.mailboxMessage.create({
    data: {
      direction: "INBOUND",
      state: "DONE",
      outcome: "DRAFT_CREATED",
      threadId: thread2.id,
      rfcMessageId: `<e2e-${dispatched.id}-1@example.com>`,
      fromAddress: senderAddress,
      fromName: senderName,
      toAddress: MAILBOX,
      authorUserId: admin.id,
      subject: "תקלה בלוח החשמל",
      bodyText: DISPATCHED_BODY,
      fullText: DISPATCHED_BODY,
      receivedAt: minutesAgo(120),
      createdAt: minutesAgo(120),
    },
  });
  await db.mailboxMessage.create({
    data: {
      direction: "OUTBOUND",
      state: "SENT",
      threadId: thread2.id,
      repliesToId: original.id,
      fromAddress: MAILBOX,
      toAddress: senderAddress,
      subject: "Re: תקלה בלוח החשמל",
      bodyText: DISPATCHED_REPLY,
      sentAt: minutesAgo(118),
      createdAt: minutesAgo(119),
    },
  });

  // תשובה שהגיעה **אחרי** השיגור: הנכנסת אינה בשרשרת (כמו בצינור), והמייל
  // החוזר עליה ("כבר נשלחה") כן — אבל נוצר אחרי השיגור, ולכן אינו מוצג
  const late = await db.mailboxMessage.create({
    data: {
      direction: "INBOUND",
      state: "DONE",
      outcome: "REPLY_AFTER_DISPATCH",
      rfcMessageId: `<e2e-${dispatched.id}-3@example.com>`,
      fromAddress: senderAddress,
      fromName: senderName,
      toAddress: MAILBOX,
      authorUserId: admin.id,
      subject: "Re: תקלה בלוח החשמל",
      receivedAt: minutesAgo(31),
      createdAt: minutesAgo(31),
    },
  });
  await db.mailboxMessage.create({
    data: {
      direction: "OUTBOUND",
      state: "SENT",
      threadId: thread2.id,
      repliesToId: late.id,
      fromAddress: MAILBOX,
      toAddress: senderAddress,
      subject: "Re: תקלה בלוח החשמל",
      bodyText: LATE_REPLY,
      sentAt: minutesAgo(30),
      createdAt: minutesAgo(30),
    },
  });

  // ── תרחיש 3: טיוטה ממייל בלי אתר (§2.6 שלב 3, §5.ז) ────────────────────
  const noSite = await db.ticket.create({
    data: {
      siteId: null,
      channel: "EMAIL",
      isDraft: true,
      description: NO_SITE_BODY,
      createdById: admin.id,
      draftRecipients: [],
      createdAt: minutesAgo(20),
      lastActivityAt: minutesAgo(20),
    },
  });
  const thread3 = await db.mailThread.create({ data: { ticketId: noSite.id } });
  await db.mailboxMessage.create({
    data: {
      direction: "INBOUND",
      state: "DONE",
      outcome: "DRAFT_CREATED",
      threadId: thread3.id,
      rfcMessageId: `<e2e-${noSite.id}-1@example.com>`,
      fromAddress: senderAddress,
      fromName: senderName,
      toAddress: MAILBOX,
      authorUserId: admin.id,
      subject: "תקלה",
      bodyText: NO_SITE_BODY,
      fullText: NO_SITE_BODY,
      receivedAt: minutesAgo(20),
      createdAt: minutesAgo(20),
    },
  });
  await db.draftField.create({
    data: { ticketId: noSite.id, field: "DESCRIPTION", fromEmail: true },
  });

  console.log(`DRAFT_ID=${draft.id}`);
  console.log(`DISPATCHED_ID=${dispatched.id}`);
  console.log(`NO_SITE_ID=${noSite.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
