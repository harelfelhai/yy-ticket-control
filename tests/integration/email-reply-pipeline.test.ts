import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { MailEnvelope } from "@/lib/email-intake/types";
import { he } from "@/lib/he";
import type { EmailMessage, EmailSendResult, EmailTransport } from "@/lib/notifier/types";
import { type Viewer } from "@/lib/permissions";
import { getTicketCorrespondence } from "@/lib/services/email-correspondence";
import { handleEmailIntake } from "@/lib/services/email-intake";
import { sendEmailReply } from "@/lib/services/email-reply";
import { removeDraftMedia, updateDraftFields } from "@/lib/services/draft-fields";
import { submitDraft, TicketError } from "@/lib/services/tickets";
import { fakeFieldExtractor, type FakeFieldExtractor } from "../helpers/fake-field-extractor";
import { fakeMailSource } from "../helpers/fake-mail-source";
import {
  ARRIVED_AT,
  FIRST_MAIL_SUBJECT,
  REPLY_ARRIVED_AT,
  SAMPLE_APARTMENT,
  SAMPLE_BUILDING,
  SAMPLE_SITE,
  SENDER,
  SENDER_NAME,
  STRANGER,
  STRANGER_NAME,
  firstMail,
  inlineImagePart,
  replyInThread,
  type MailFixture,
} from "../helpers/mail-fixtures";
import { resetDb } from "../helpers/reset-db";

/**
 * הצינור המלא של תשובה בשרשרת (S7) — מקצה לקצה, מול בסיס נתונים אמיתי.
 *
 * **למה זה קובץ נפרד, ולא תוספת ל-`email-intake.test.ts`.** מודול R בדק שם
 * את מנוע ההכרעה וההכרעות-בין-מיזוג לעומק, אבל דרך `existingThread` — שרשרת
 * שנזרעת ישירות בבסיס הנתונים, בלי לעבור דרך מייל ראשון אמיתי. מודול D
 * (`email-reply.ts`, S6) בדק את בחירת הנוסח בעצמו, דרך שורה יוצאת שנוצרת
 * ביד. אף אחד מהם לא הרכיב את השרשרת המלאה: מייל ראשון אמיתי דרך
 * `handleEmailIntake` → טיוטה → תשובה אמיתית דרך `handleEmailIntake` שוב →
 * המייל החוזר שבאמת יוצא (`sendEmailReply`, לא רק "נוצר ג׳וב") → ובמקרה
 * הסתירה, גם `submitDraft` האמיתי (S4) שמסרב לשגר. זה בדיוק התפר שהערת
 * ה-README של הצינור (`email-pipeline.test.ts`) מזהירה מפניו: "מה שכל שלב
 * מוסר לבא אחריו אינו נבדק באף אחת מבדיקות המודולים".
 *
 * **שבעה תרחישים, לפי §5.ה3 כלל 9 ו-§5.ה4**, כל אחד ממש את המסלול המלא:
 * מורשה ורשאי בלי עריכה קודמת (a), מורשה ורשאי **עם** עריכה קודמת שסותרת
 * (b), מורשה ושאינו רשאי (c), זר — קבלן בהעתק שאינו משתמש (d), אחרי שיגור
 * אמיתי (e), אחרי מחיקת הטיוטה (f), וכפילות קובץ EM-25 עם מבט גם דרך
 * ההתכתבות של מודול K (g).
 *
 * **בלי רשת**: התיבה, המחלץ והערוץ מזויפים, כמו בכל שאר בדיקות S6/S7.
 */

const DOMAIN_NAME = "אינסטלציה";
const OTHER_DOMAIN_NAME = "חשמל";
const PRO_NAME = "יוסי כהן";

/** דקה אחרי הגעת המייל הראשון — בתוך הבטחת חמש הדקות */
const NOW = new Date(ARRIVED_AT.getTime() + 60_000);
/** דקה אחרי הגעת התשובה */
const REPLY_NOW = new Date(REPLY_ARRIVED_AT.getTime() + 60_000);

let siteId: string;
let buildingId: string;
let domainId: string;
let professionalId: string;
let adminId: string;

beforeEach(async () => {
  await resetDb();

  siteId = (await db.site.create({ data: { name: SAMPLE_SITE } })).id;
  buildingId = (await db.building.create({ data: { siteId, name: `בניין ${SAMPLE_BUILDING}` } })).id;
  // הדירה עצמה דרושה כדי שהתאמת הטקסט (`matchApartment`) תצליח — המזהה
  // שלה אינו נבדק כאן במפורש
  await db.apartment.create({ data: { buildingId, number: SAMPLE_APARTMENT } });
  domainId = (await db.domain.create({ data: { name: DOMAIN_NAME } })).id;
  professionalId = (await db.professional.create({ data: { name: PRO_NAME, phone: "0501110000" } })).id;

  // מנהל מערכת: כך האתר מגיע מהמייל ולא מהמשתמש, וההרשאה שלו פותחת
  adminId = (
    await db.user.create({
      data: { role: "ADMIN", name: SENDER_NAME, phone: "0500000000", passwordHash: "x", email: SENDER },
    })
  ).id;

  await db.mailChannelState.create({
    data: { channel: "EMAIL", mailbox: "office@example.com", activatedAt: new Date(ARRIVED_AT.getTime() - 86_400_000) },
  });
});

afterAll(async () => {
  await db.$disconnect();
});

// ─────────────────────────────── עזרים ───────────────────────────────

function adminViewer(): Viewer {
  return { kind: "user", id: adminId, role: "ADMIN", siteId: null };
}

/** שורת היומן שסבב אמיתי היה יוצר — PENDING עם מזהה Gmail בלבד */
async function inboundRow(envelope: MailEnvelope): Promise<string> {
  const row = await db.mailboxMessage.create({
    data: { direction: "INBOUND", state: "PENDING", gmailMessageId: envelope.sourceId },
    select: { id: true },
  });
  return row.id;
}

/** מריצה הודעה אחת דרך `handleEmailIntake` בדיוק כפי שג׳וב הקליטה עושה בפרודקשן */
async function intake(fixture: MailFixture, extractor: FakeFieldExtractor, now: Date) {
  const source = fakeMailSource({ messages: [fixture], match: () => true });
  const id = await inboundRow(fixture.envelope);
  const outcome = await handleEmailIntake({ mailboxMessageId: id }, { source, extractor, now });
  return { id, outcome };
}

/**
 * פותחת טיוטה ממייל ראשון **אמיתי**, דרך `handleEmailIntake` — לא
 * `existingThread`. האתר/בניין/דירה/תיאור ממולאים; תחום ונמענים נשארים
 * חסרים בכוונה, כדי שכל תרחיש יוכל להראות מה תשובה ממלאת.
 */
async function openDraftViaFirstMail(): Promise<{ ticketId: string; inboundId: string }> {
  const extractor = fakeFieldExtractor({
    result: { site: SAMPLE_SITE, building: SAMPLE_BUILDING, apartment: SAMPLE_APARTMENT, description: "יש נזילה מתחת לכיור במטבח" },
  });
  const { id, outcome } = await intake(firstMail(), extractor, NOW);
  expect(outcome).toMatchObject({ status: "decided", outcome: "DRAFT_CREATED" });

  const ticket = await db.ticket.findFirstOrThrow();
  return { ticketId: ticket.id, inboundId: id };
}

async function outboundReplyTo(repliesToId: string) {
  return db.mailboxMessage.findFirstOrThrow({ where: { direction: "OUTBOUND", repliesToId } });
}

/** ערוץ שליחה מזויף שאוסף את מה שיצא, בלי רשת (כמו ב-`email-pipeline.test.ts`) */
function fakeTransport(): { transport: EmailTransport; sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  const transport: EmailTransport = {
    name: "fake",
    async send(message) {
      sent.push(message);
      const result: EmailSendResult = { id: "gmail-out-1", ...(message.threadId ? { threadId: message.threadId } : {}) };
      return result;
    },
  };
  return { transport, sent };
}

// ─────────────────────────────── (a) מורשה ורשאי, בלי עריכה קודמת ───────────────────────────────

describe("הצינור המלא של תשובה — מקצה לקצה", () => {
  it("EM-15 · EM-C03 — תשובה ממורשה שרשאי לערוך, בלי עריכה קודמת: ממוזגת במלואה, ותג 'מהמייל' על כל שדה", async () => {
    const { ticketId } = await openDraftViaFirstMail();

    // אין עריכה קודמת במערכת — כל מה שהטיוטה מחזיקה הגיע מהמייל הראשון בלבד
    const before = await db.draftField.findMany({ where: { ticketId } });
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((f) => f.fromEmail && !f.conflict && f.systemEditedAt === null)).toBe(true);

    const extractor = fakeFieldExtractor({ result: { domain: DOMAIN_NAME, recipientsAdd: [PRO_NAME] } });
    const { id: replyId, outcome } = await intake(
      replyInThread({ text: `התחום הוא ${DOMAIN_NAME}, ונא לשלוח את ${PRO_NAME}.`, html: null }),
      extractor,
      REPLY_NOW,
    );

    expect(outcome).toMatchObject({ status: "decided", outcome: "REPLY_APPLIED" });

    const ticket = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.domainId).toBe(domainId);
    expect(ticket.draftRecipients).toEqual([
      expect.objectContaining({ kind: "professional", id: professionalId, origin: "EMAIL" }),
    ]);

    // כל שדה — גם מה שהמייל הראשון מילא וגם מה שהתשובה השלימה — נושא את
    // תג "מהמייל", בלי סתירה ובלי חותמת עריכת מערכת: אף אדם לא נגע בטיוטה
    const fields = await db.draftField.findMany({ where: { ticketId } });
    expect(fields.map((f) => f.field).sort()).toEqual(["APARTMENT", "BUILDING", "DESCRIPTION", "DOMAIN", "RECIPIENTS", "SITE"]);
    expect(fields.every((f) => f.fromEmail && !f.conflict && f.systemEditedAt === null)).toBe(true);

    const row = await db.mailboxMessage.findUniqueOrThrow({ where: { id: replyId } });
    const report = row.report as { updated: { field: string }[] };
    expect(report.updated.map((u) => u.field).sort()).toEqual(["DOMAIN", "RECIPIENTS"]);

    // המייל החוזר יוצא בפועל, ובנוסח הנכון: הטיוטה כעת שלמה ובלי סתירה —
    // EM-L04, לא הכללי EM-L01
    const outbound = await outboundReplyTo(replyId);
    const { transport, sent } = fakeTransport();
    const result = await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: REPLY_NOW });

    expect(result).toMatchObject({ status: "sent", template: "L04", to: SENDER, simulated: false });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: SENDER, subject: `Re: ${FIRST_MAIL_SUBJECT}` });
  });

  // ─────────────────────────────── (b) מורשה ורשאי, עם עריכה קודמת שסותרת ───────────────────────────────

  it("EM-C04 — שדה שנערך במערכת לפני התשובה: סתירה נפתחת דרך הצינור האמיתי, וחוסמת שיגור אמיתי", async () => {
    const { ticketId } = await openDraftViaFirstMail();
    const otherDomain = await db.domain.create({ data: { name: OTHER_DOMAIN_NAME } });

    // עריכה במערכת — שעון מפורש, יום לפני שהתשובה מגיעה, כדי שהסדר לא ייתלה
    // בשעון האמיתי של הרצת הבדיקה
    const systemEditAt = new Date(ARRIVED_AT.getTime() + 30 * 60_000);
    await updateDraftFields(adminViewer(), ticketId, { domainId: otherDomain.id }, systemEditAt);

    const extractor = fakeFieldExtractor({ result: { domain: DOMAIN_NAME } });
    const { id: replyId, outcome } = await intake(
      replyInThread({ text: `התחום הוא ${DOMAIN_NAME}.`, html: null }),
      extractor,
      REPLY_NOW,
    );

    expect(outcome).toMatchObject({ status: "decided", outcome: "REPLY_APPLIED" });

    // אף צד לא דרס את השני: הערך שהמערכת קבעה נשאר על הפנייה
    const ticket = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.domainId).toBe(otherDomain.id);

    const field = await db.draftField.findUniqueOrThrow({ where: { ticketId_field: { ticketId, field: "DOMAIN" } } });
    expect(field.conflict).toBe(true);
    expect(field.emailValue).toMatchObject({ field: "DOMAIN", domainId });
    expect(field.systemEditedAt).toEqual(systemEditAt);

    // סתירה אינה "עודכן מהתשובה שלך"
    const row = await db.mailboxMessage.findUniqueOrThrow({ where: { id: replyId } });
    expect((row.report as { updated: unknown[] }).updated).toEqual([]);

    // ומהצד השני: submitDraft האמיתי (S4) מסרב לשגר כל עוד הסתירה פתוחה —
    // ראה tests/integration/draft-fields.test.ts "סתירה פתוחה חוסמת את
    // השיגור" לבדיקת ההתנהגות המלאה של submitDraft עצמה; כאן רק מאמתים
    // שהמסלול מגיע לחסימה הזו בפועל, לא מדגימים אותה מחדש
    await expect(submitDraft(adminViewer(), ticketId)).rejects.toThrow(TicketError);
    await expect(submitDraft(adminViewer(), ticketId)).rejects.toThrow(he.emailDraft.conflictBanner(1));
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticketId } })).isDraft).toBe(true);
    expect(await db.assignment.count({ where: { ticketId } })).toBe(0);
  });

  // ─────────────────────────────── (c) מורשה ואינו רשאי ───────────────────────────────

  it("EM-15 — משתמש מורשה שאינו רשאי לערוך: הטיוטה אינה נוגעת, אך הוא מקבל תשובה (L08)", async () => {
    const { ticketId } = await openDraftViaFirstMail();
    const beforeTicket = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    const beforeFields = await db.draftField.findMany({ where: { ticketId }, orderBy: { field: "asc" } });

    const otherSite = await db.site.create({ data: { name: "אתר אחר לגמרי" } });
    const outsider = await db.user.create({
      data: {
        role: "SITE_MANAGER",
        name: "מנהל זר",
        phone: "0500000077",
        passwordHash: "x",
        email: "outsider@example.com",
        siteId: otherSite.id,
      },
    });

    const extractor = fakeFieldExtractor({ result: { domain: DOMAIN_NAME } });
    const { id: replyId, outcome } = await intake(
      replyInThread({ from: outsider.email as string, fromName: "מנהל זר" }),
      extractor,
      REPLY_NOW,
    );

    expect(outcome).toMatchObject({ status: "decided", outcome: "REPLY_NOT_PERMITTED" });

    // הטיוטה לא זזה — לא הפנייה עצמה ולא שדותיה
    expect(await db.ticket.findUniqueOrThrow({ where: { id: ticketId } })).toEqual(beforeTicket);
    expect(await db.draftField.findMany({ where: { ticketId }, orderBy: { field: "asc" } })).toEqual(beforeFields);

    // אבל הוא כן מקבל תשובה — הנוסח "אין לך הרשאה" (L08), לא "כבר נשלחה"
    const outbound = await outboundReplyTo(replyId);
    const { transport, sent } = fakeTransport();
    const result = await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: REPLY_NOW });

    expect(result).toMatchObject({ status: "sent", template: "L08", to: outsider.email });
    expect(sent).toHaveLength(1);
  });

  // ─────────────────────────────── (d) זר — קבלן בהעתק ───────────────────────────────

  it("EM-15 · EM-L10 — קבלן שהיה בהעתק, שאינו משתמש במערכת: לא נקלט ולא נענה", async () => {
    const { ticketId } = await openDraftViaFirstMail();
    const beforeTicket = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    const beforeFieldCount = await db.draftField.count({ where: { ticketId } });

    const { id: replyId, outcome } = await intake(
      replyInThread({ from: STRANGER, fromName: STRANGER_NAME, cc: [SENDER] }),
      fakeFieldExtractor({ result: { domain: DOMAIN_NAME } }),
      REPLY_NOW,
    );

    // מקרה 3 של כלל 9 מוכרע כבר בשלב 6 של הסולם (findSender), לפני מסלול
    // התשובה — ולכן זו אותה הכרעה כמו מייל ראשון מזר
    expect(outcome).toMatchObject({ status: "decided", outcome: "IGNORED_UNAUTHORIZED" });

    // אין מענה לזר (EM-L10: מענה היה מאשר לו שמישהו קורא את התיבה), ואין נגיעה בטיוטה
    expect(await db.mailboxMessage.count({ where: { direction: "OUTBOUND", repliesToId: replyId } })).toBe(0);
    expect(await db.ticket.findUniqueOrThrow({ where: { id: ticketId } })).toEqual(beforeTicket);
    expect(await db.draftField.count({ where: { ticketId } })).toBe(beforeFieldCount);
  });

  // ─────────────────────────────── (e) אחרי שיגור אמיתי ───────────────────────────────

  it("§7 שורה 77 · EM-L05 — תשובה אחרי שיגור אמיתי (submitDraft): הפנייה אינה נוגעת, נוסח 'כבר נשלחה'", async () => {
    const { ticketId } = await openDraftViaFirstMail();

    // משלימה את השדות החסרים כדי ש-submitDraft האמיתי יצליח, ואז משגרת בפועל
    await updateDraftFields(adminViewer(), ticketId, {
      domainId,
      recipients: [{ kind: "professional", id: professionalId }],
    });
    await submitDraft(adminViewer(), ticketId, [{ kind: "professional", id: professionalId }]);
    const dispatched = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(dispatched.isDraft).toBe(false);

    const { id: replyId, outcome } = await intake(replyInThread(), fakeFieldExtractor(), REPLY_NOW);

    expect(outcome).toMatchObject({ status: "decided", outcome: "REPLY_AFTER_DISPATCH" });
    expect(await db.ticket.findUniqueOrThrow({ where: { id: ticketId } })).toEqual(dispatched);
    expect(await db.draftField.count({ where: { ticketId } })).toBe(6); // ללא שינוי

    const outbound = await outboundReplyTo(replyId);
    const { transport, sent } = fakeTransport();
    const result = await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: REPLY_NOW });
    expect(result).toMatchObject({ status: "sent", template: "L05", to: SENDER });
    expect(sent).toHaveLength(1);
  });

  // ─────────────────────────────── (f) אחרי מחיקת הטיוטה ───────────────────────────────

  it("§2.6 שלב 6 · EM-L06 — תשובה אחרי מחיקת הטיוטה: לא נקלטת, נוסח 'נמחקה'", async () => {
    const { ticketId } = await openDraftViaFirstMail();
    await db.ticket.delete({ where: { id: ticketId } });

    const { id: replyId, outcome } = await intake(replyInThread(), fakeFieldExtractor(), REPLY_NOW);

    expect(outcome).toMatchObject({ status: "decided", outcome: "REPLY_AFTER_DELETION" });
    expect(await db.ticket.findUnique({ where: { id: ticketId } })).toBeNull();

    const outbound = await outboundReplyTo(replyId);
    const { transport, sent } = fakeTransport();
    const result = await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: REPLY_NOW });
    expect(result).toMatchObject({ status: "sent", template: "L06", to: SENDER });
    expect(sent).toHaveLength(1);
  });

  // ─────────────────────────────── (g) EM-25 — כפילות קובץ ───────────────────────────────

  it("EM-25 — קובץ שהוסר במסך 7 אינו קם לתחייה בתשובה, מקצה לקצה: הצינור וגם ההתכתבות (מודול K)", async () => {
    const firstWithImage = firstMail({ parts: [inlineImagePart()] });
    const firstExtractor = fakeFieldExtractor({
      result: { site: SAMPLE_SITE, building: SAMPLE_BUILDING, apartment: SAMPLE_APARTMENT, description: "יש נזילה מתחת לכיור במטבח" },
    });
    const { outcome: firstOutcome } = await intake(firstWithImage, firstExtractor, NOW);
    expect(firstOutcome).toMatchObject({ status: "decided", outcome: "DRAFT_CREATED" });

    const ticket = await db.ticket.findFirstOrThrow();
    const media = await db.mediaFile.findFirstOrThrow();
    // הסרה אמיתית דרך שירות מסך 7 — לא כתיבה ישירה לטבלה
    await removeDraftMedia(adminViewer(), media.id);
    expect(await db.mediaFile.count()).toBe(0);

    const replyWithSameImage = replyInThread({ parts: [inlineImagePart()] });
    const { id: replyId, outcome } = await intake(replyWithSameImage, fakeFieldExtractor(), REPLY_NOW);

    expect(outcome).toMatchObject({ status: "decided" });
    expect(await db.mediaFile.count()).toBe(0);

    const attachment = await db.mailboxAttachment.findFirstOrThrow({ where: { messageId: replyId } });
    expect(attachment).toMatchObject({ skippedReason: "removed_before", mediaFileId: null });
    expect(await db.mailboxAttachment.count()).toBe(2);

    // ומבעד לעיניים של ההתכתבות (מודול K, `getTicketCorrespondence`): שתי
    // ההופעות נשמרות, וההופעה השנייה מסומנת בדיוק כמו ב-`MailboxAttachment` —
    // זו בדיוק הנקודה שבגללה Module X (נתיב ההורדה) קורא ל-`canViewCorrespondence`
    // ולא בונה הרשאה נפרדת משלו (ראה התיעוד ב-`email-attachments/[id]/route.ts`)
    const correspondence = await getTicketCorrespondence(adminViewer(), ticket.id);
    expect(correspondence).not.toBeNull();
    const replyMessage = correspondence?.find((m) => m.id === replyId);
    expect(replyMessage?.attachments).toHaveLength(1);
    expect(replyMessage?.attachments[0]).toMatchObject({ skippedReason: "removed_before", mediaFileId: null });
  });
});
