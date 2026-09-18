import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runEmailIntake } from "@/jobs/handlers/email";
import { JOB_TYPES } from "@/jobs/types";
import { db } from "@/lib/db";
import type { MailEnvelope } from "@/lib/email-intake/types";
import { canViewTicket } from "@/lib/permissions";
import { handleEmailIntake } from "@/lib/services/email-intake";
import { selectStorage } from "@/lib/storage";
import { aiError, fakeFieldExtractor } from "../helpers/fake-field-extractor";
import { fakeMailSource } from "../helpers/fake-mail-source";
import {
  ARRIVED_AT,
  FIRST_MAIL_MESSAGE_ID,
  FIRST_MAIL_SUBJECT,
  MAILBOX,
  OTHER_SENDER,
  OUTGOING_REPLY_MESSAGE_ID,
  SAMPLE_APARTMENT,
  SAMPLE_BUILDING,
  SAMPLE_SITE,
  SENDER,
  autoReplyMail,
  documentAttachmentPart,
  firstMail,
  forwardedMail,
  inlineImagePart,
  mailFromStranger,
  mailWithAttachments,
  mailWithoutKeyword,
  pdfAttachmentPart,
  replyInThread,
  type MailFixture,
} from "../helpers/mail-fixtures";
import { resetDb } from "../helpers/reset-db";

/**
 * הצינור של המייל הנכנס (S6, מודול C): סולם ההכרעה ומסלול המייל החדש —
 * מול בסיס נתונים אמיתי, מול אחסון אמיתי, ובלי רשת.
 *
 * מה שנבדק כאן ואינו נבדק ביחידה: שכל דרגה בסולם **מכריעה ועוצרת**, מה
 * באמת נכתב לשורות (ובעיקר מה **לא** נכתב — כותרת וגוף של הודעה שלא
 * נקלטה), ושהטרנזאקציה של המייל הראשון יוצרת את כל מה שהיא מבטיחה.
 */

const SITE_NAME = SAMPLE_SITE;
const BUILDING_NAME = `בניין ${SAMPLE_BUILDING}`;
const DOMAIN_NAME = "אינסטלציה";
const PRO_NAME = "יוסי כהן";

/** גוף שמזכיר **מילולית** את כל מה שהמחלץ המזויף יחזיר — שומר ההזיה בודק זאת */
const HAPPY_TEXT = [
  `יש נזילה מתחת לכיור במטבח, בדירה ${SAMPLE_APARTMENT} בבניין ${SAMPLE_BUILDING} באתר ${SAMPLE_SITE}.`,
  `התחום הוא ${DOMAIN_NAME}, ונא לשלוח את ${PRO_NAME}.`,
].join("\n");

/** הבתים הפותחים של מעטפת TNEF (`winmail.dat`), כפי ש-`classifyAttachment` מזהה אותם */
const TNEF_BYTES = Buffer.from([0x78, 0x9f, 0x3e, 0x22, 0x01, 0x00, 0x01, 0x00]);

/** מה שהמחלץ "קרא" מהגוף שלמעלה */
const HAPPY_EXTRACTION = {
  site: SITE_NAME,
  building: SAMPLE_BUILDING,
  apartment: SAMPLE_APARTMENT,
  domain: DOMAIN_NAME,
  description: "יש נזילה מתחת לכיור במטבח",
  recipientsAdd: [PRO_NAME],
} as const;

let siteId: string;
let buildingId: string;
let apartmentId: string;
let domainId: string;
let professionalId: string;
let adminId: string;
let managerId: string;

const NOW = new Date(ARRIVED_AT.getTime() + 60_000);

beforeEach(async () => {
  await resetDb();

  siteId = (await db.site.create({ data: { name: SITE_NAME } })).id;
  buildingId = (await db.building.create({ data: { siteId, name: BUILDING_NAME } })).id;
  apartmentId = (await db.apartment.create({ data: { buildingId, number: SAMPLE_APARTMENT } })).id;
  domainId = (await db.domain.create({ data: { name: DOMAIN_NAME } })).id;
  professionalId = (await db.professional.create({ data: { name: PRO_NAME, phone: "0501110000" } })).id;

  // השולח הרגיל הוא מנהל מערכת: כך טיוטה בלי אתר היא מצב חוקי, ורוב
  // הבדיקות אינן תלויות בגזירת האתר מהמשתמש
  adminId = (
    await db.user.create({
      data: { role: "ADMIN", name: "דנה כהן", phone: "0500000000", passwordHash: "x", email: SENDER },
    })
  ).id;

  managerId = (
    await db.user.create({
      data: {
        role: "SITE_MANAGER",
        name: "יוסי לוי",
        phone: "0500000001",
        passwordHash: "x",
        email: OTHER_SENDER,
        siteId,
      },
    })
  ).id;

  await db.mailChannelState.create({
    data: { channel: "EMAIL", mailbox: MAILBOX, activatedAt: new Date(ARRIVED_AT.getTime() - 86_400_000) },
  });
});

afterAll(async () => {
  await db.$disconnect();
});

// ─────────────────────────────── עזרים ───────────────────────────────

/** שורת היומן שהסבב (מודול B) יוצר — PENDING עם מזהה Gmail בלבד */
async function inbound(envelope: MailEnvelope): Promise<string> {
  const row = await db.mailboxMessage.create({
    data: { direction: "INBOUND", state: "PENDING", gmailMessageId: envelope.sourceId },
    select: { id: true },
  });
  return row.id;
}

interface RunOptions {
  now?: Date;
  extraction?: Parameters<typeof fakeFieldExtractor>[0];
  /** `null` = אין מנוע חילוץ בסביבה (EM-11) */
  noExtractor?: boolean;
  messages?: (MailFixture | MailEnvelope)[];
}

async function run(fixture: MailFixture, options: RunOptions = {}) {
  const source = fakeMailSource({ messages: options.messages ?? [fixture], match: () => true });
  const extractor = options.noExtractor ? null : fakeFieldExtractor(options.extraction ?? {});
  const id = await inbound(fixture.envelope);
  const outcome = await handleEmailIntake(
    { mailboxMessageId: id },
    { source, extractor, now: options.now ?? NOW },
  );
  return { id, source, extractor, outcome };
}

async function rowOf(id: string) {
  return db.mailboxMessage.findUniqueOrThrow({ where: { id } });
}

async function jobsOfType(type: string) {
  return db.job.findMany({ where: { type }, orderBy: { runAt: "asc" } });
}

// ─────────────────────────────── הסולם ───────────────────────────────

describe("סולם ההכרעה", () => {
  it("EM-02 — ג׳וב כפול על שורה שכבר הוכרעה אינו כותב דבר ואינו נוגע בתיבה", async () => {
    const mail = firstMail({ text: HAPPY_TEXT });
    const { id, outcome } = await run(mail, { extraction: { result: HAPPY_EXTRACTION } });
    expect(outcome).toMatchObject({ status: "decided", outcome: "DRAFT_CREATED" });

    const source = fakeMailSource({ messages: [mail], match: () => true });
    const second = await handleEmailIntake(
      { mailboxMessageId: id },
      { source, extractor: fakeFieldExtractor({ result: HAPPY_EXTRACTION }), now: NOW },
    );

    expect(second).toEqual({ kind: "email-intake", status: "duplicate" });
    expect(source.calls).toEqual([]);
    expect(await db.ticket.count()).toBe(1);
    expect(await db.mailThread.count()).toBe(1);
  });

  it("EM-21 — הודעה שנמחקה מהתיבה מוכרעת GONE ואינה נשארת ממתינה", async () => {
    const mail = firstMail();
    const source = fakeMailSource({ messages: [], match: () => true });
    const id = await inbound(mail.envelope);

    const outcome = await handleEmailIntake(
      { mailboxMessageId: id },
      { source, extractor: fakeFieldExtractor(), now: NOW },
    );

    expect(outcome).toMatchObject({ status: "decided", outcome: "GONE" });
    const row = await rowOf(id);
    expect(row.state).toBe("DONE");
    expect(row.subject).toBeNull();
    expect(row.bodyText).toBeNull();
  });

  it("EM-22 — מייל שהגיע לפני הפעלת היכולת אינו נקלט", async () => {
    await db.mailChannelState.update({
      where: { channel: "EMAIL" },
      data: { activatedAt: new Date(ARRIVED_AT.getTime() + 1_000) },
    });

    const { id, outcome } = await run(firstMail({ text: HAPPY_TEXT }));

    expect(outcome).toMatchObject({ outcome: "IGNORED_BEFORE_ACTIVATION" });
    expect((await rowOf(id)).state).toBe("DONE");
    expect(await db.ticket.count()).toBe(0);
  });

  it("EM-A14 — מייל מכתובת התיבה עצמה אינו פותח פנייה, גם כשהיא רשומה כמייל של משתמש", async () => {
    await db.user.create({
      data: { role: "ADMIN", name: "תיבה", phone: "0509999999", passwordHash: "x", email: MAILBOX },
    });

    const { outcome } = await run(firstMail({ from: MAILBOX, text: HAPPY_TEXT }));

    expect(outcome).toMatchObject({ outcome: "IGNORED_OWN_MESSAGE" });
    expect(await db.ticket.count()).toBe(0);
  });

  it("EM-A14 — מייל שהמערכת שלחה וחזר לתיבה מזוהה לפי Message-ID", async () => {
    await db.mailboxMessage.create({
      data: { direction: "OUTBOUND", state: "SENT", rfcMessageId: OUTGOING_REPLY_MESSAGE_ID },
    });

    const { outcome } = await run(
      firstMail({ messageId: OUTGOING_REPLY_MESSAGE_ID, text: HAPPY_TEXT }),
    );

    expect(outcome).toMatchObject({ outcome: "IGNORED_OWN_MESSAGE" });
  });

  it("EM-23 — תשובה אוטומטית אינה נקלטת ואינה נענית", async () => {
    const { outcome } = await run(autoReplyMail());

    expect(outcome).toMatchObject({ outcome: "IGNORED_AUTO_REPLY" });
    expect(await db.mailboxMessage.count({ where: { direction: "OUTBOUND" } })).toBe(0);
  });

  it("EM-03 — מייל מכתובת שאינה של משתמש מורשה אינו נקלט ואינו נענה", async () => {
    const { id, outcome } = await run(mailFromStranger());

    expect(outcome).toMatchObject({ outcome: "IGNORED_UNAUTHORIZED" });
    expect(await db.ticket.count()).toBe(0);
    // אין שורה יוצאת **בכלל**: תשובה לכתובת זרה מאשרת לה שמישהו מנטר את התיבה
    expect(await db.mailboxMessage.count({ where: { direction: "OUTBOUND" } })).toBe(0);
    expect(await jobsOfType(JOB_TYPES.emailReply)).toEqual([]);
    expect((await rowOf(id)).fromAddress).toBe("contractor@vendor.example.com");
  });

  it("EM-U04 — משתמש שהושבת נחסם בכל כתובותיו", async () => {
    await db.user.update({ where: { id: adminId }, data: { active: false } });

    const { outcome } = await run(firstMail({ text: HAPPY_TEXT }));

    expect(outcome).toMatchObject({ outcome: "IGNORED_UNAUTHORIZED" });
  });

  it("EM-U04 — משתמש שההרשאה שלו לפתיחה במייל בוטלה אינו נקלט", async () => {
    await db.user.update({ where: { id: adminId }, data: { emailIntakeEnabled: false } });

    const { outcome } = await run(firstMail({ text: HAPPY_TEXT }));

    expect(outcome).toMatchObject({ outcome: "IGNORED_UNAUTHORIZED" });
  });

  it("EM-04 — כתובת נוספת של משתמש פעיל פותחת פנייה בשמו", async () => {
    await db.userEmailAlias.create({ data: { userId: adminId, address: "dana.private@example.com" } });

    const { outcome } = await run(firstMail({ from: "dana.private@example.com", text: HAPPY_TEXT }), {
      extraction: { result: HAPPY_EXTRACTION },
    });

    expect(outcome).toMatchObject({ status: "decided", outcome: "DRAFT_CREATED" });
    const ticket = await db.ticket.findFirstOrThrow();
    expect(ticket.createdById).toBe(adminId);
  });

  it("EM-14 — תשובה בשרשרת מוכרת אינה פותחת פנייה חדשה ואינה נוגעת בטיוטה", async () => {
    const { threadId, ticketId } = await existingThread();

    const { id, outcome } = await run(replyInThread(), { now: new Date(ARRIVED_AT.getTime() + 86_400_000 * 3) });

    expect(outcome).toEqual({ kind: "email-intake", status: "skipped", reason: "reply-path-not-built" });
    const row = await rowOf(id);
    expect(row.state).toBe("SKIPPED");
    expect(row.outcome).toBeNull();
    expect(row.threadId).toBe(threadId);
    expect(row.detail).toContain("S7");
    // הטיוטה לא נגעה: אין שדות חדשים, אין מייל חוזר, ואין פנייה שנייה
    expect(await db.ticket.count()).toBe(1);
    expect(await db.draftField.count({ where: { ticketId } })).toBe(0);
    expect(await db.mailboxMessage.count({ where: { direction: "OUTBOUND", repliesToId: id } })).toBe(0);
  });

  it("EM-14 — שרשרת מזוהה גם כשכותרות השרשור אבדו, לפי מזהה השרשור של Gmail", async () => {
    await existingThread();

    const { outcome } = await run(
      replyInThread({ inReplyTo: null, references: [], headers: { References: null } }),
      { now: new Date(ARRIVED_AT.getTime() + 86_400_000 * 3) },
    );

    expect(outcome).toMatchObject({ status: "skipped" });
    expect(await db.ticket.count()).toBe(1);
  });

  it("EM-01 — מייל חדש בלי המילה בכותרת אינו נקלט ואינו נענה", async () => {
    const { id, outcome } = await run(mailWithoutKeyword());

    expect(outcome).toMatchObject({ outcome: "IGNORED_SUBJECT" });
    expect(await db.ticket.count()).toBe(0);
    expect(await db.mailboxMessage.count({ where: { direction: "OUTBOUND" } })).toBe(0);
    expect((await rowOf(id)).subject).toBeNull();
  });

  it("EM-03 — שורה של הודעה שלא נקלטה שומרת מזהים ושולח, ולעולם לא כותרת וגוף", async () => {
    const { id } = await run(mailWithoutKeyword());
    const row = await rowOf(id);

    expect(row.subject).toBeNull();
    expect(row.bodyText).toBeNull();
    expect(row.fullText).toBeNull();
    expect(row.report).toBeNull();
    // מה שכן נשמר: מזהים, שולח ומועד — בלי זה אי אפשר לענות על "למה
    // המייל שלי לא נקלט"
    expect(row.fromAddress).toBe(SENDER);
    expect(row.rfcMessageId).toBe("no-keyword@mail.example.com");
    expect(row.gmailThreadId).toBe("thread-no-keyword");
    expect(row.receivedAt).toEqual(ARRIVED_AT);
  });

  it("EM-01 — הסולם עוצר בדרגה הראשונה שתופסת: תשובה אוטומטית קודמת לכלל הכותרת", async () => {
    // הכותרת של התשובה האוטומטית מכילה "תקלה" (היא `Automatic reply: …`),
    // ולכן אילו הסדר היה הפוך הייתה נפתחת ממנה טיוטה
    const { outcome } = await run(autoReplyMail());

    expect(outcome).toMatchObject({ outcome: "IGNORED_AUTO_REPLY" });
    expect(await db.ticket.count()).toBe(0);
  });
});

// ─────────────────────────────── דחייה מול הכרעה ───────────────────────────────

describe("כשל זמני אינו הכרעה", () => {
  it("EM-12 — כשל זמני מול Gmail דוחה את ההודעה ומתזמן ג׳וב חדש", async () => {
    const mail = firstMail({ text: HAPPY_TEXT });
    const source = fakeMailSource({
      messages: [mail],
      match: () => true,
      failures: [{ method: "getMessage", kind: "transient", status: 503 }],
    });
    const id = await inbound(mail.envelope);

    const outcome = await handleEmailIntake(
      { mailboxMessageId: id },
      { source, extractor: fakeFieldExtractor(), now: NOW },
    );

    expect(outcome).toMatchObject({ status: "deferred", reason: "gmail" });
    const row = await rowOf(id);
    expect(row.state).toBe("PENDING");
    expect(row.outcome).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt).toEqual(new Date(NOW.getTime() + 60_000));

    // הג׳וב נוצר באותה טרנזאקציה של הדחייה, עם `runAt` של הניסיון הבא
    const jobs = await jobsOfType(JOB_TYPES.emailIntake);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].runAt).toEqual(row.nextAttemptAt);
    expect(jobs[0].payload).toEqual({ mailboxMessageId: id });
  });

  it("EM-12 — הניסיון החוזר מכריע כרגיל אחרי שהתקלה חלפה", async () => {
    const mail = firstMail({ text: HAPPY_TEXT });
    const source = fakeMailSource({
      messages: [mail],
      match: () => true,
      failures: [{ method: "getMessage", kind: "transient" }],
    });
    const id = await inbound(mail.envelope);
    const deps = { source, extractor: fakeFieldExtractor({ result: HAPPY_EXTRACTION }) };

    await handleEmailIntake({ mailboxMessageId: id }, { ...deps, now: NOW });
    const outcome = await handleEmailIntake(
      { mailboxMessageId: id },
      { ...deps, now: new Date(NOW.getTime() + 120_000) },
    );

    expect(outcome).toMatchObject({ status: "decided", outcome: "DRAFT_CREATED" });
    expect((await rowOf(id)).nextAttemptAt).toBeNull();
  });

  it("EM-12 — ג׳וב שרץ לפני שהגיע זמן הדחייה אינו שורף ניסיון", async () => {
    const mail = firstMail({ text: HAPPY_TEXT });
    const source = fakeMailSource({
      messages: [mail],
      match: () => true,
      failures: [{ method: "getMessage", kind: "transient" }],
    });
    const id = await inbound(mail.envelope);
    const deps = { source, extractor: fakeFieldExtractor() };

    await handleEmailIntake({ mailboxMessageId: id }, { ...deps, now: NOW });
    source.clearCalls();
    const early = await handleEmailIntake({ mailboxMessageId: id }, { ...deps, now: NOW });

    expect(early).toMatchObject({ status: "deferred" });
    expect(source.calls).toEqual([]);
    expect((await rowOf(id)).attempts).toBe(1);
  });

  it("EM-20 — טוקן שנשלל נזרק ברעש ואינו הופך להכרעה", async () => {
    const mail = firstMail({ text: HAPPY_TEXT });
    const source = fakeMailSource({
      messages: [mail],
      match: () => true,
      failures: [{ method: "getMessage", kind: "auth", status: 401, times: Number.POSITIVE_INFINITY }],
    });
    const id = await inbound(mail.envelope);

    await expect(
      handleEmailIntake({ mailboxMessageId: id }, { source, extractor: fakeFieldExtractor(), now: NOW }),
    ).rejects.toThrow();

    const row = await rowOf(id);
    expect(row.state).toBe("PENDING");
    expect(row.outcome).toBeNull();
  });

  it("EM-12 — כשל זמני בהורדת קובץ מצורף דוחה ואינו פותח פנייה בלי הקובץ", async () => {
    const mail = mailWithAttachments({ subject: FIRST_MAIL_SUBJECT, text: HAPPY_TEXT });
    const source = fakeMailSource({
      messages: [mail],
      match: () => true,
      failures: [{ method: "getAttachment", kind: "transient" }],
    });
    const id = await inbound(mail.envelope);

    const outcome = await handleEmailIntake(
      { mailboxMessageId: id },
      { source, extractor: fakeFieldExtractor({ result: HAPPY_EXTRACTION }), now: NOW },
    );

    expect(outcome).toMatchObject({ status: "deferred", reason: "attachment" });
    expect(await db.ticket.count()).toBe(0);
  });

  it("EM-12 — הדחייה אינה נמשכת לנצח: בגג הניסיונות השורה נעצרת ברעש", async () => {
    const mail = firstMail({ text: HAPPY_TEXT });
    const source = fakeMailSource({
      messages: [mail],
      match: () => true,
      failures: [{ method: "getMessage", kind: "transient", times: Number.POSITIVE_INFINITY }],
    });
    const id = await inbound(mail.envelope);
    const deps = { source, extractor: fakeFieldExtractor() };

    // כל ריצה היא הג׳וב שהדחייה הקודמת תזמנה, בזמנו
    let now = NOW;
    let last: Awaited<ReturnType<typeof handleEmailIntake>> | undefined;
    for (let round = 0; round < 60; round += 1) {
      last = await handleEmailIntake({ mailboxMessageId: id }, { ...deps, now });
      const current = await rowOf(id);
      if (current.state !== "PENDING") break;
      now = new Date((current.nextAttemptAt as Date).getTime() + 1_000);
    }

    expect(last).toMatchObject({ status: "exhausted", reason: "gmail" });

    const row = await rowOf(id);
    // **לא PENDING**: שורה שנשארת PENDING עם `nextAttemptAt` עתידי אינה
    // נראית לא ל-`email-intake-not-stuck` ולא לסריקת התקועים של הסבב —
    // שתיהן סופרות `nextAttemptAt` ריק או שעבר בלבד
    expect(row.state).toBe("FAILED");
    expect(row.outcome).toBeNull();
    expect(row.nextAttemptAt).toBeNull();
    expect(row.detail).toContain("ניסיונות");

    // ואין ג׳וב נוסף: טבלת התור אינה גדלה בשורה בשעה לנצח
    const jobs = await jobsOfType(JOB_TYPES.emailIntake);
    expect(jobs).toHaveLength(row.attempts - 1);
  });
});

// ─────────────────────────────── EM-11 ───────────────────────────────

describe("EM-11 — החילוץ אינו זמין", () => {
  it("EM-11 — כשל זמני בחילוץ נדחה כל עוד יש תקציב, ואינו הכרעה", async () => {
    const mail = firstMail({ text: HAPPY_TEXT });
    const source = fakeMailSource({ messages: [mail], match: () => true });
    const extractor = fakeFieldExtractor({
      result: HAPPY_EXTRACTION,
      error: aiError("transient"),
      failTimes: 1,
    });
    const id = await inbound(mail.envelope);

    const first = await handleEmailIntake(
      { mailboxMessageId: id },
      { source, extractor, now: new Date(ARRIVED_AT.getTime() + 10_000) },
    );
    expect(first).toMatchObject({ status: "deferred", reason: "extraction" });
    expect((await rowOf(id)).nextAttemptAt).toEqual(new Date(ARRIVED_AT.getTime() + 40_000));

    const second = await handleEmailIntake(
      { mailboxMessageId: id },
      { source, extractor, now: new Date(ARRIVED_AT.getTime() + 45_000) },
    );
    expect(second).toMatchObject({ status: "decided", outcome: "DRAFT_CREATED" });
    expect(extractor.calls).toHaveLength(2);
  });

  it("EM-11 — אחרי התקציב ושני ניסיונות ההכרעה סופית: טיוטה שתוכן המייל הוא התיאור שלה", async () => {
    const mail = firstMail({ text: HAPPY_TEXT });
    const source = fakeMailSource({ messages: [mail], match: () => true });
    const extractor = fakeFieldExtractor({ error: aiError("transient") });
    const id = await inbound(mail.envelope);

    // מייל שנקלט באיחור: ארבע הדקות כבר מאחוריו, ובכל זאת שני ניסיונות
    const late = new Date(ARRIVED_AT.getTime() + 10 * 60_000);
    expect(
      await handleEmailIntake({ mailboxMessageId: id }, { source, extractor, now: late }),
    ).toMatchObject({ status: "deferred", reason: "extraction" });

    const final = await handleEmailIntake(
      { mailboxMessageId: id },
      { source, extractor, now: new Date(late.getTime() + 31_000) },
    );

    expect(final).toMatchObject({ status: "decided", outcome: "DRAFT_CREATED_UNPROCESSED" });
    // הרצפה היא **שני ניסיונות חילוץ**, לא שניים ועוד אחד: הניסיון השני הוא
    // כבר זה שמכריע
    expect(extractor.calls).toHaveLength(2);

    const ticket = await db.ticket.findFirstOrThrow();
    expect(ticket.description).toContain("נזילה מתחת לכיור");
    expect(ticket.siteId).toBeNull();
    expect(ticket.domainId).toBeNull();
    // המייל החוזר יוצא גם כאן — L07 הוא נוסח ולא שתיקה
    expect(await db.mailboxMessage.count({ where: { direction: "OUTBOUND" } })).toBe(1);
  });

  it("EM-11 — בלי מנוע חילוץ בסביבה ההכרעה מיידית, בלי שום ניסיון", async () => {
    const { id, outcome } = await run(firstMail({ text: HAPPY_TEXT }), { noExtractor: true });

    expect(outcome).toMatchObject({ status: "decided", outcome: "DRAFT_CREATED_UNPROCESSED" });
    expect((await rowOf(id)).attempts).toBe(0);
    const [field] = await db.draftField.findMany();
    expect(field).toMatchObject({ field: "DESCRIPTION", fromEmail: true });
  });

  it("EM-09 · EM-10 — מנהל עבודה מקבל את האתר שלו גם כשהחילוץ אינו זמין", async () => {
    const { outcome } = await run(firstMail({ from: OTHER_SENDER, text: HAPPY_TEXT }), {
      noExtractor: true,
    });

    expect(outcome).toMatchObject({ status: "decided", outcome: "DRAFT_CREATED_UNPROCESSED" });

    // גזירת האתר מהשולח (§2.6 שלב 3) אינה תלויה בשירות החילוץ: "ושאר
    // השדות ריקים" מדבר על מה שנקרא מהמייל, ולא על מה שנגזר מהמשתמש
    const ticket = await db.ticket.findFirstOrThrow();
    expect(ticket).toMatchObject({ createdById: managerId, siteId });
    // האתר נגזר ואינו "מהמייל" — ולכן אין לו שורת DraftField, כמו במסלול המלא
    expect(await db.draftField.count({ where: { field: "SITE" } })).toBe(0);

    // זו הנקודה: טיוטה בלי אתר שמורה למנהל מערכת ולבעלים (EM-10), ומנהל
    // עבודה אינו רשאי לראות אותה — כלומר המייל החוזר היה מפנה את השולח
    // לטיוטה שלו עצמו ומחזיר לו 404
    expect(
      canViewTicket(
        { kind: "user", id: managerId, role: "SITE_MANAGER", siteId },
        { siteId: ticket.siteId, createdById: ticket.createdById, closedAt: ticket.closedAt },
      ),
    ).toBe(true);
  });

  it("EM-11 — רצפת שני ניסיונות החילוץ אינה נשחקת על ידי דחיות מסיבה אחרת", async () => {
    const mail = firstMail({ text: HAPPY_TEXT });
    const source = fakeMailSource({
      messages: [mail],
      match: () => true,
      failures: [{ method: "getMessage", kind: "transient", times: 2 }],
    });
    const extractor = fakeFieldExtractor({
      result: HAPPY_EXTRACTION,
      error: aiError("transient"),
      failTimes: 1,
    });
    const id = await inbound(mail.envelope);
    const deps = { source, extractor };

    // שתי דחיות מול Gmail שורפות שלוש וחצי מארבע דקות התקציב, ומעלות את
    // `attempts` ל-2 — מונה שמשותף לשלוש סיבות הדחייה
    const first = await handleEmailIntake(
      { mailboxMessageId: id },
      { ...deps, now: new Date(ARRIVED_AT.getTime() + 30_000) },
    );
    expect(first).toMatchObject({ status: "deferred", reason: "gmail" });

    const second = await handleEmailIntake(
      { mailboxMessageId: id },
      { ...deps, now: (await rowOf(id)).nextAttemptAt as Date },
    );
    expect(second).toMatchObject({ status: "deferred", reason: "gmail" });

    // הקריאה הראשונה **למחלץ** נכשלת כשהתקציב כבר מאחור. הרצפה קיימת בדיוק
    // בשביל זה: תקלה רגעית אחת אצל ספק ה-AI אינה הכרעה שאין ממנה חזרה
    const third = await handleEmailIntake(
      { mailboxMessageId: id },
      { ...deps, now: (await rowOf(id)).nextAttemptAt as Date },
    );
    expect(third).toMatchObject({ status: "deferred", reason: "extraction" });

    const fourth = await handleEmailIntake(
      { mailboxMessageId: id },
      { ...deps, now: new Date(((await rowOf(id)).nextAttemptAt as Date).getTime() + 1_000) },
    );
    expect(fourth).toMatchObject({ status: "decided", outcome: "DRAFT_CREATED" });
    expect(extractor.calls).toHaveLength(2);
    expect((await db.ticket.findFirstOrThrow()).siteId).toBe(siteId);
  });

  it("EM-11 — מייל שגופו HTML בלבד: התיאור נגזר מה-HTML ואינו ריק", async () => {
    // multipart/alternative עם `text/plain` ריק — מה שלקוחות web שולחים
    // בפועל, וגם הסיבה שקיים מסלול הגיבוי מה-HTML
    const html = '<div dir="rtl">יש נזילה מתחת לכיור במטבח.</div><div dir="rtl">תודה, דנה</div>';
    const { id, outcome } = await run(firstMail({ text: "", html }), { noExtractor: true });

    expect(outcome).toMatchObject({ status: "decided", outcome: "DRAFT_CREATED_UNPROCESSED" });
    const ticket = await db.ticket.findFirstOrThrow();
    expect(ticket.description).toContain("יש נזילה מתחת לכיור במטבח");
    expect((await rowOf(id)).bodyText).toContain("תודה, דנה");
  });

  it("EM-11 — כשל קבוע בחילוץ הולך ישר להכרעה ואינו נדחה", async () => {
    const mail = firstMail({ text: HAPPY_TEXT });
    const source = fakeMailSource({ messages: [mail], match: () => true });
    const extractor = fakeFieldExtractor({ error: aiError("permanent") });
    const id = await inbound(mail.envelope);

    const outcome = await handleEmailIntake(
      { mailboxMessageId: id },
      { source, extractor, now: new Date(ARRIVED_AT.getTime() + 5_000) },
    );

    expect(outcome).toMatchObject({ status: "decided", outcome: "DRAFT_CREATED_UNPROCESSED" });
    expect(extractor.calls).toHaveLength(1);
    expect(await jobsOfType(JOB_TYPES.emailIntake)).toEqual([]);
  });

  it("EM-A06 — קבצים מצורפים נכנסים לטיוטה גם כשהחילוץ אינו זמין", async () => {
    const mail = mailWithAttachments({ subject: FIRST_MAIL_SUBJECT, text: HAPPY_TEXT });
    const source = fakeMailSource({ messages: [mail], match: () => true });
    const id = await inbound(mail.envelope);

    await handleEmailIntake({ mailboxMessageId: id }, { source, extractor: null, now: NOW });

    expect(await db.mediaFile.count()).toBe(2);
    expect(await db.mailboxAttachment.count()).toBe(2);
  });
});

// ─────────────────────────────── מסלול המייל החדש ───────────────────────────────

describe("מסלול המייל החדש", () => {
  it("EM-05 — הטרנזאקציה כותבת את כל מה שהיא מבטיחה", async () => {
    const { id, outcome } = await run(firstMail({ text: HAPPY_TEXT }), {
      extraction: { result: HAPPY_EXTRACTION },
    });

    expect(outcome).toMatchObject({ status: "decided", outcome: "DRAFT_CREATED" });

    const ticket = await db.ticket.findFirstOrThrow();
    expect(ticket).toMatchObject({
      channel: "EMAIL",
      isDraft: true,
      createdById: adminId,
      siteId,
      buildingId,
      apartmentId,
      domainId,
      description: "יש נזילה מתחת לכיור במטבח",
    });
    expect(ticket.draftRecipients).toEqual([
      { kind: "professional", id: professionalId, origin: "EMAIL", removedBySystemAt: null },
    ]);

    // שורת `DraftField` לכל שדה שהמייל מילא, ורק לו
    const fields = await db.draftField.findMany({ orderBy: { field: "asc" } });
    expect(fields.map((row) => row.field).sort()).toEqual(
      ["APARTMENT", "BUILDING", "DESCRIPTION", "DOMAIN", "RECIPIENTS", "SITE"].sort(),
    );
    expect(fields.every((row) => row.fromEmail && !row.conflict && row.systemEditedAt === null)).toBe(true);

    const thread = await db.mailThread.findFirstOrThrow();
    expect(thread.ticketId).toBe(ticket.id);

    const row = await rowOf(id);
    expect(row).toMatchObject({
      state: "DONE",
      outcome: "DRAFT_CREATED",
      threadId: thread.id,
      authorUserId: adminId,
      subject: FIRST_MAIL_SUBJECT,
      rfcMessageId: FIRST_MAIL_MESSAGE_ID,
      gmailThreadId: "thread-first",
    });
    expect(row.bodyText).toContain("נזילה");
    expect(row.report).toEqual({ updated: [], notFound: [], ambiguous: [] });

    // השורה היוצאת וג׳וב השליחה — באותה טרנזאקציה
    const outbound = await db.mailboxMessage.findFirstOrThrow({ where: { direction: "OUTBOUND" } });
    expect(outbound).toMatchObject({
      state: "PENDING",
      repliesToId: id,
      threadId: thread.id,
      toAddress: SENDER,
      sentAt: null,
    });
    const replyJobs = await jobsOfType(JOB_TYPES.emailReply);
    expect(replyJobs).toHaveLength(1);
    expect(replyJobs[0].payload).toEqual({ mailboxMessageId: outbound.id });
  });

  it("EM-07 — ערך שאינו ברשימה אינו נוצר, השדה נשאר ריק, והאפשרויות מדווחות", async () => {
    const text = `${HAPPY_TEXT}\nהתחום הוא חשמל.`;
    const { id } = await run(firstMail({ text }), {
      extraction: { result: { ...HAPPY_EXTRACTION, domain: "חשמל" } },
    });

    expect(await db.domain.count()).toBe(1);
    const ticket = await db.ticket.findFirstOrThrow();
    expect(ticket.domainId).toBeNull();
    expect(await db.draftField.count({ where: { field: "DOMAIN" } })).toBe(0);

    const report = (await rowOf(id)).report as { notFound: { field: string; written: string; options: string[] | null }[] };
    expect(report.notFound).toEqual([{ field: "DOMAIN", written: "חשמל", options: [DOMAIN_NAME] }]);
  });

  it("EM-L02 — רשימת אפשרויות נמסרת לאתר, לבניין ולתחום בלבד ולא לדירה", async () => {
    const text = `${HAPPY_TEXT}\nהדירה היא 99.`;
    const { id } = await run(firstMail({ text }), {
      extraction: { result: { ...HAPPY_EXTRACTION, apartment: "99" } },
    });

    const report = (await rowOf(id)).report as { notFound: { field: string; options: string[] | null }[] };
    expect(report.notFound).toEqual([{ field: "APARTMENT", written: "99", options: null }]);
  });

  it("EM-08 — ערך שמתאים ליותר מרשומה אחת אינו נבחר, וההתאמות מדווחות", async () => {
    await db.professional.create({ data: { name: "יוסי לוי", phone: "0502220000" } });
    const text = `${HAPPY_TEXT}\nנא לשלוח את יוסי.`;

    const { id } = await run(firstMail({ text }), {
      extraction: { result: { ...HAPPY_EXTRACTION, recipientsAdd: ["יוסי"] } },
    });

    const ticket = await db.ticket.findFirstOrThrow();
    expect(ticket.draftRecipients).toEqual([]);
    const report = (await rowOf(id)).report as { ambiguous: { field: string; matches: string[] }[] };
    expect(report.ambiguous).toHaveLength(1);
    // "יוסי לוי" הוא גם איש מקצוע וגם משתמש — שתי רשומות, תווית אחת
    expect(report.ambiguous[0].matches.sort()).toEqual([PRO_NAME, "יוסי לוי"].sort());
  });

  it("EM-05a — ערך שהמחלץ החזיר ואינו מופיע מילולית בטקסט נזרק", async () => {
    // "מיזוג אוויר" אינו כתוב בשום מקום בגוף — הזיה קלאסית של מודל
    await db.domain.create({ data: { name: "מיזוג אוויר" } });

    const { id } = await run(firstMail({ text: HAPPY_TEXT }), {
      extraction: { result: { ...HAPPY_EXTRACTION, domain: "מיזוג אוויר" } },
    });

    const ticket = await db.ticket.findFirstOrThrow();
    expect(ticket.domainId).toBeNull();
    // נזרק לפני ההתאמה, ולכן אינו מדווח גם כ"לא נמצא ברשימה"
    const report = (await rowOf(id)).report as { notFound: unknown[] };
    expect(report.notFound).toEqual([]);
  });

  it("EM-05a — ערך שנקרא מקובץ מצורף אינו נדרש להופיע בגוף המייל", async () => {
    // צילום של פתק מהדייר: הגוף אינו מזכיר אתר, בניין ותחום — הם נקראו
    // מהתמונה. שומר ההזיה בודק מילוליות מול הטקסט **שנקרא**, ולתמונה אין
    // טקסט כזה, ולכן הפטור. בלעדיו הפנייה מצילום לא הייתה ממלאת שום שדה
    const mail = mailWithAttachments({
      subject: FIRST_MAIL_SUBJECT,
      text: "מצרף צילום של הפתק שהדייר השאיר.",
      parts: [inlineImagePart()],
    });
    const source = fakeMailSource({ messages: [mail], match: () => true });
    const id = await inbound(mail.envelope);

    await handleEmailIntake(
      { mailboxMessageId: id },
      {
        source,
        extractor: fakeFieldExtractor({
          result: {
            site: SITE_NAME,
            building: SAMPLE_BUILDING,
            domain: DOMAIN_NAME,
            description: "נזילה מתחת לכיור",
            source: "attachment",
          },
        }),
        now: NOW,
      },
    );

    const ticket = await db.ticket.findFirstOrThrow();
    expect(ticket).toMatchObject({ siteId, buildingId, domainId });
    const report = (await rowOf(id)).report as { notFound: unknown[]; ambiguous: unknown[] };
    expect(report).toMatchObject({ notFound: [], ambiguous: [] });
  });

  it("EM-05a — חדר שנקרא מהמייל נכתב לטיוטה ונושא תג מהמייל", async () => {
    // החדר חוזר מהמחלץ כערך של הספירה ולא כטקסט, ולכן אינו עובר התאמה —
    // וזה בדיוק השלב שאפשר למחוק בלי ששום בדיקה אחרת תרגיש
    const { outcome } = await run(firstMail({ text: HAPPY_TEXT }), {
      extraction: { result: { ...HAPPY_EXTRACTION, room: "KITCHEN" } },
    });

    expect(outcome).toMatchObject({ outcome: "DRAFT_CREATED" });
    expect((await db.ticket.findFirstOrThrow()).room).toBe("KITCHEN");
    const field = await db.draftField.findFirstOrThrow({ where: { field: "ROOM" } });
    expect(field.fromEmail).toBe(true);
  });

  it("EM-09 — מנהל עבודה: האתר נגזר ממנו ואינו נושא תג מהמייל", async () => {
    const { outcome } = await run(firstMail({ from: OTHER_SENDER, text: HAPPY_TEXT }), {
      extraction: { result: HAPPY_EXTRACTION },
    });

    expect(outcome).toMatchObject({ outcome: "DRAFT_CREATED" });
    const ticket = await db.ticket.findFirstOrThrow();
    expect(ticket).toMatchObject({ createdById: managerId, siteId, buildingId });
    expect(await db.draftField.count({ where: { field: "SITE" } })).toBe(0);
  });

  it("EM-09 · EM-L09 — מנהל עבודה שאינו משויך לאתר: אין טיוטה, ויש מייל שמסביר", async () => {
    await db.user.update({ where: { id: managerId }, data: { siteId: null } });

    const { id, outcome } = await run(firstMail({ from: OTHER_SENDER, text: HAPPY_TEXT }), {
      extraction: { result: HAPPY_EXTRACTION },
    });

    expect(outcome).toMatchObject({ status: "decided", outcome: "NO_SITE" });
    expect(await db.ticket.count()).toBe(0);
    expect(await db.mailThread.count()).toBe(0);

    const row = await rowOf(id);
    expect(row.state).toBe("DONE");
    // הכותרת נשמרת כאן דווקא, כי המייל החוזר חייב לצאת באותה שרשרת
    expect(row.subject).toBe(FIRST_MAIL_SUBJECT);
    expect(row.bodyText).toBeNull();

    const outbound = await db.mailboxMessage.findFirstOrThrow({ where: { direction: "OUTBOUND" } });
    expect(outbound.repliesToId).toBe(id);
    expect(await jobsOfType(JOB_TYPES.emailReply)).toHaveLength(1);
  });

  it("EM-10 — מנהל מערכת שלא זוהה אתר במייל שלו מקבל טיוטה בלי אתר", async () => {
    const { outcome } = await run(firstMail({ text: "יש נזילה במטבח, נא לטפל." }), {
      extraction: { result: { description: "יש נזילה במטבח" } },
    });

    expect(outcome).toMatchObject({ outcome: "DRAFT_CREATED" });
    const ticket = await db.ticket.findFirstOrThrow();
    expect(ticket.siteId).toBeNull();
    expect(ticket.buildingId).toBeNull();
    expect(ticket.isDraft).toBe(true);
  });

  it("EM-C10 — בטיוטה בלי אתר בניין ודירה מהמייל אינם מותאמים כלל", async () => {
    // המחלץ קרא בניין ודירה, אך האתר שנכתב אינו קיים — ובלי אתר אין מול
    // מה להתאים אותם. הם חסרים, ולא "לא נמצאו ברשימה": השולח אכן כתב אותם
    const text = `יש נזילה בדירה ${SAMPLE_APARTMENT} בבניין ${SAMPLE_BUILDING} באתר שדות יער.`;
    const { id } = await run(firstMail({ text }), {
      extraction: {
        result: {
          site: "שדות יער",
          building: SAMPLE_BUILDING,
          apartment: SAMPLE_APARTMENT,
          description: "יש נזילה",
        },
      },
    });

    const ticket = await db.ticket.findFirstOrThrow();
    expect(ticket.siteId).toBeNull();
    expect(ticket.buildingId).toBeNull();
    expect(ticket.apartmentId).toBeNull();
    const report = (await rowOf(id)).report as { notFound: { field: string; options: string[] | null }[] };
    expect(report.notFound).toEqual([{ field: "SITE", written: "שדות יער", options: [SITE_NAME] }]);
  });

  it("EM-A04 — במייל מועבר הבלוק המועבר מגיע לחילוץ במלואו", async () => {
    const { extractor } = await run(forwardedMail());

    expect(extractor?.lastCall?.text).toContain("המעלית בבניין א' נתקעת בין הקומות");
    expect(extractor?.lastCall?.isReply).toBe(false);
  });
});

// ─────────────────────────────── קבצים מצורפים ───────────────────────────────

describe("קבצים מצורפים", () => {
  it("EM-06 · EM-06a — מדיה נכנסת לטיוטה, ומה שאינו מדיה נשאר בהתכתבות בלבד", async () => {
    const mail = mailWithAttachments({
      subject: FIRST_MAIL_SUBJECT,
      text: HAPPY_TEXT,
      parts: [inlineImagePart(), pdfAttachmentPart(), documentAttachmentPart()],
    });
    const source = fakeMailSource({ messages: [mail], match: () => true });
    const id = await inbound(mail.envelope);

    await handleEmailIntake(
      { mailboxMessageId: id },
      { source, extractor: fakeFieldExtractor({ result: HAPPY_EXTRACTION }), now: NOW },
    );

    // שלושה חלקים ביומן, שניים מהם מדיה בטיוטה
    const attachments = await db.mailboxAttachment.findMany({ orderBy: { partIndex: "asc" } });
    expect(attachments).toHaveLength(3);
    expect(attachments.map((row) => [row.mimeType, row.isMedia, row.skippedReason])).toEqual([
      ["image/png", true, null],
      ["application/pdf", true, null],
      ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", false, "not-media"],
    ]);
    expect(attachments[0].inline).toBe(true);
    expect(attachments[2].storageKey).toBeNull();
    expect(attachments[2].mediaFileId).toBeNull();

    // הודעת מדיה אחת בשרשור עם שני הקבצים, וג׳וב חילוץ טקסט לכל אחד
    const media = await db.mediaFile.findMany();
    expect(media).toHaveLength(2);
    expect(media.every((file) => file.uploaded && file.aiStatus === "PENDING")).toBe(true);
    expect(await db.message.count({ where: { kind: "MEDIA" } })).toBe(1);
    expect(await jobsOfType(JOB_TYPES.extract)).toHaveLength(2);
    expect(await jobsOfType(JOB_TYPES.transcribe)).toHaveLength(0);

    // הבתים באמת נכתבו לאחסון, לפני הטרנזאקציה
    const storage = selectStorage();
    for (const file of media) {
      const bytes = await storage.read(file.storageKey);
      expect(bytes.byteLength).toBe(file.sizeBytes);
    }

    // קובץ שאינו מדיה אינו יורד כלל — אין מה לעשות בבתים שלו
    expect(source.callsTo("getAttachment").map((call) => call.attachmentId)).toEqual(["attachment-pdf"]);
  });

  it("EM-06 — הבתים של הקבצים נשלחים לחילוץ", async () => {
    const mail = mailWithAttachments({
      subject: FIRST_MAIL_SUBJECT,
      text: HAPPY_TEXT,
      parts: [inlineImagePart(), documentAttachmentPart()],
    });
    const source = fakeMailSource({ messages: [mail], match: () => true });
    const extractor = fakeFieldExtractor({ result: HAPPY_EXTRACTION });
    const id = await inbound(mail.envelope);

    await handleEmailIntake({ mailboxMessageId: id }, { source, extractor, now: NOW });

    expect(extractor.lastCall?.attachments.map((file) => file.mimeType)).toEqual(["image/png"]);
  });

  it("EM-06a — קובץ גדול מהתקרה נרשם בהתכתבות ואינו יורד", async () => {
    const mail = mailWithAttachments({
      subject: FIRST_MAIL_SUBJECT,
      text: HAPPY_TEXT,
      parts: [pdfAttachmentPart({ attachmentId: "huge" })],
    });
    // הגודל מוצהר בהודעה; ההורדה נחסכת עוד לפניה
    mail.envelope.parts[0].sizeBytes = 60 * 1024 * 1024;
    const source = fakeMailSource({ messages: [mail], match: () => true });
    const id = await inbound(mail.envelope);

    await handleEmailIntake(
      { mailboxMessageId: id },
      { source, extractor: fakeFieldExtractor({ result: HAPPY_EXTRACTION }), now: NOW },
    );

    const [attachment] = await db.mailboxAttachment.findMany();
    expect(attachment.skippedReason).toBe("too-large");
    expect(attachment.storageKey).toBeNull();
    expect(await db.mediaFile.count()).toBe(0);
    expect(source.callsTo("getAttachment")).toEqual([]);
  });

  it("EM-06a — הצהרה כללית נפתרת מהבתים ומהשם, וקובץ שאינו מדיה אינו נכנס לטיוטה", async () => {
    // `application/octet-stream` הוא מה ש-Outlook שולח בפועל על קבצים
    // רבים. כאן הוא ZIP בתחפושת: הוא **כן** יורד (אי אפשר לדעת בלי הבתים),
    // ורק אחרי הסיווג מתברר שאין מה לעשות איתו
    const mail = mailWithAttachments({
      subject: FIRST_MAIL_SUBJECT,
      text: HAPPY_TEXT,
      parts: [
        documentAttachmentPart({ mimeType: "application/octet-stream", attachmentId: "blob" }),
      ],
    });
    const source = fakeMailSource({ messages: [mail], match: () => true });
    const id = await inbound(mail.envelope);

    await handleEmailIntake(
      { mailboxMessageId: id },
      { source, extractor: fakeFieldExtractor({ result: HAPPY_EXTRACTION }), now: NOW },
    );

    expect(source.callsTo("getAttachment").map((call) => call.attachmentId)).toEqual(["blob"]);
    const [attachment] = await db.mailboxAttachment.findMany();
    expect(attachment.isMedia).toBe(false);
    expect(attachment.skippedReason).toBe("not-media");
    expect(attachment.storageKey).toBeNull();
    // חתימת ה-ZIP נשמרת גם לקובץ שלא נכנס — זו ההתכתבות
    expect(attachment.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await db.mediaFile.count()).toBe(0);
  });

  it("EM-06a — מדיה שאינה ברשימת ההיתר של האחסון נשארת בהתכתבות בלבד", async () => {
    const mail = mailWithAttachments({
      subject: FIRST_MAIL_SUBJECT,
      text: HAPPY_TEXT,
      parts: [
        {
          mimeType: "image/gif",
          bytes: Buffer.from("GIF89a-bytes"),
          filename: "animation.gif",
          attachmentId: "gif",
        },
      ],
    });
    const source = fakeMailSource({ messages: [mail], match: () => true });
    const id = await inbound(mail.envelope);

    await handleEmailIntake(
      { mailboxMessageId: id },
      { source, extractor: fakeFieldExtractor({ result: HAPPY_EXTRACTION }), now: NOW },
    );

    const [attachment] = await db.mailboxAttachment.findMany();
    expect(attachment).toMatchObject({ isMedia: true, skippedReason: "unsupported-type", storageKey: null });
    expect(await db.mediaFile.count()).toBe(0);
  });

  it("EM-06 — הגזירה של מפתח האחסון דטרמיניסטית לפי ההודעה והחלק", async () => {
    const mail = mailWithAttachments({
      subject: FIRST_MAIL_SUBJECT,
      text: HAPPY_TEXT,
      parts: [inlineImagePart()],
    });
    const source = fakeMailSource({ messages: [mail], match: () => true });
    const id = await inbound(mail.envelope);

    await handleEmailIntake(
      { mailboxMessageId: id },
      { source, extractor: fakeFieldExtractor({ result: HAPPY_EXTRACTION }), now: NOW },
    );

    const file = await db.mediaFile.findFirstOrThrow();
    expect(file.storageKey).toBe("media/mail/gmail-attachments/0.png");
    expect(file.originalName).toBe("image001.png");
  });

  it("EM-06a — קובץ שהתיבה כבר אינה מוסרת אינו דוחה את הפנייה, ונרשם עם הסיבה", async () => {
    // 404 על הקובץ (הדייר מחק את המייל, Gmail אינו מוסר את החלק) אינו כשל
    // זמני: ניסיון חוזר יחזיר 404 שוב. הפנייה נפתחת בלי הקובץ — אחרת היא
    // הייתה נדחית לנצח, והשולח לא היה מקבל דבר
    const mail = mailWithAttachments({
      subject: FIRST_MAIL_SUBJECT,
      text: HAPPY_TEXT,
      parts: [pdfAttachmentPart()],
    });
    const source = fakeMailSource({
      messages: [mail],
      match: () => true,
      failures: [{ method: "getAttachment", kind: "not_found", status: 404 }],
    });
    const id = await inbound(mail.envelope);

    const outcome = await handleEmailIntake(
      { mailboxMessageId: id },
      { source, extractor: fakeFieldExtractor({ result: HAPPY_EXTRACTION }), now: NOW },
    );

    expect(outcome).toMatchObject({ status: "decided", outcome: "DRAFT_CREATED" });
    const [attachment] = await db.mailboxAttachment.findMany();
    expect(attachment).toMatchObject({
      skippedReason: "download-failed",
      isMedia: true,
      storageKey: null,
      sha256: null,
    });
    expect(await db.mediaFile.count()).toBe(0);
  });

  it("EM-06a — מעטפת TNEF וחלק ריק נרשמים בהתכתבות עם הסיבה ואינם הופכים למדיה", async () => {
    // שניהם מתגלים **מהבתים** ולא מההצהרה: Outlook מוסר את `winmail.dat`
    // כ-`application/octet-stream`, וחלק בגודל אפס נראה כתמונה עד שמסתכלים
    const mail = mailWithAttachments({
      subject: FIRST_MAIL_SUBJECT,
      text: HAPPY_TEXT,
      parts: [
        {
          mimeType: "application/octet-stream",
          bytes: TNEF_BYTES,
          filename: "winmail.dat",
          attachmentId: "tnef",
        },
        {
          mimeType: "image/png",
          bytes: Buffer.alloc(0),
          filename: "empty.png",
          attachmentId: "empty",
        },
      ],
    });
    const source = fakeMailSource({ messages: [mail], match: () => true });
    const id = await inbound(mail.envelope);

    await handleEmailIntake(
      { mailboxMessageId: id },
      { source, extractor: fakeFieldExtractor({ result: HAPPY_EXTRACTION }), now: NOW },
    );

    const attachments = await db.mailboxAttachment.findMany({ orderBy: { partIndex: "asc" } });
    expect(attachments.map((row) => [row.mimeType, row.isMedia, row.skippedReason])).toEqual([
      ["application/ms-tnef", false, "tnef"],
      ["image/png", true, "empty"],
    ]);
    expect(attachments.every((row) => row.storageKey === null)).toBe(true);
    expect(await db.mediaFile.count()).toBe(0);
  });
});

describe("חיווט הג׳וב", () => {
  it("EM-02 — נקודת הכניסה של התור מריצה את אותו סולם, בלי לגעת בסביבה", async () => {
    const mail = firstMail({ text: HAPPY_TEXT });
    const source = fakeMailSource({ messages: [mail], match: () => true });
    const id = await inbound(mail.envelope);

    const outcome = await runEmailIntake(
      { mailboxMessageId: id },
      { source, extractor: fakeFieldExtractor({ result: HAPPY_EXTRACTION }), now: NOW },
    );

    expect(outcome).toMatchObject({ status: "decided", outcome: "DRAFT_CREATED" });
    expect(await db.ticket.count()).toBe(1);
  });

  it("EM-11 — `extractor: null` מפורש עובר דרך הנקודה ואינו נבחר מהסביבה", async () => {
    const mail = firstMail({ text: HAPPY_TEXT });
    const source = fakeMailSource({ messages: [mail], match: () => true });
    const id = await inbound(mail.envelope);

    const outcome = await runEmailIntake({ mailboxMessageId: id }, { source, extractor: null, now: NOW });

    expect(outcome).toMatchObject({ outcome: "DRAFT_CREATED_UNPROCESSED" });
  });
});

describe("מצבי קצה", () => {
  it("EM-03 — במצב פיילוט נקלט רק מי שברשימה, גם כשהוא משתמש מורשה", async () => {
    const previous = process.env.EMAIL_INTAKE_PILOT_ADDRESSES;
    process.env.EMAIL_INTAKE_PILOT_ADDRESSES = OTHER_SENDER;
    try {
      const { outcome } = await run(firstMail({ text: HAPPY_TEXT }), {
        extraction: { result: HAPPY_EXTRACTION },
      });
      expect(outcome).toMatchObject({ outcome: "IGNORED_UNAUTHORIZED" });
    } finally {
      if (previous === undefined) delete process.env.EMAIL_INTAKE_PILOT_ADDRESSES;
      else process.env.EMAIL_INTAKE_PILOT_ADDRESSES = previous;
    }
  });

  it("EM-12 — תשובה קטועה של השירות נדחית ואינה מוכרעת", async () => {
    // לא כותרת, לא גוף, לא חלקים — **וגם לא שולח**. זו אינה מעטפה של אדם
    // אלא תשובה חלקית של Gmail, והכרעה עליה הייתה קובעת גורל לפי נתונים
    // שלא הגיעו
    const mail = firstMail({ subject: "", text: "", messageId: null, from: null });
    const { id, outcome } = await run(mail);

    expect(outcome).toMatchObject({ status: "deferred", reason: "gmail" });
    const row = await rowOf(id);
    expect(row.state).toBe("PENDING");
    expect(row.outcome).toBeNull();
    expect(await jobsOfType(JOB_TYPES.emailIntake)).toHaveLength(1);
  });

  it("EM-01 — מייל ריק אמיתי של אדם מוכרע IGNORED_SUBJECT ואינו נדחה", async () => {
    // שליחה מוקדמת בטעות: בלי כותרת, בלי גוף ובלי צרופות — אבל עם From
    // וכותרות מלאות. לכלל הכותרת (§2.6 שלב 1) יש תשובה למקרה הזה, והיא
    // "מתעלמת ממנו בשקט"; דחייה חוזרת לנצח אינה הכרעה כלל
    const { id, outcome } = await run(firstMail({ subject: "", text: "" }));

    expect(outcome).toMatchObject({ status: "decided", outcome: "IGNORED_SUBJECT" });
    const row = await rowOf(id);
    expect(row.state).toBe("DONE");
    expect(row.attempts).toBe(0);
    expect(row.subject).toBeNull();
    // אין מייל חוזר ואין ג׳וב נוסף — הודעה שלא נקלטה אינה נענית (EM-03)
    expect(await db.mailboxMessage.count({ where: { direction: "OUTBOUND" } })).toBe(0);
    expect(await jobsOfType(JOB_TYPES.emailIntake)).toEqual([]);
  });

  it("EM-06 — קובץ וידאו נכנס כמדיה ומסומן מיד כמדולג, בלי ג׳וב AI", async () => {
    const mail = mailWithAttachments({
      subject: FIRST_MAIL_SUBJECT,
      text: HAPPY_TEXT,
      parts: [{ mimeType: "video/mp4", bytes: Buffer.from("clip-bytes"), filename: "clip.mp4" }],
    });
    const source = fakeMailSource({ messages: [mail], match: () => true });
    const id = await inbound(mail.envelope);

    await handleEmailIntake(
      { mailboxMessageId: id },
      { source, extractor: fakeFieldExtractor({ result: HAPPY_EXTRACTION }), now: NOW },
    );

    const file = await db.mediaFile.findFirstOrThrow();
    expect(file).toMatchObject({ mimeType: "video/mp4", aiStatus: "SKIPPED", uploaded: true });
    expect(await jobsOfType(JOB_TYPES.extract)).toEqual([]);
    expect(await jobsOfType(JOB_TYPES.transcribe)).toEqual([]);
  });

  it("EM-05 — שורה שנמחקה בין יצירת הג׳וב להרצתו אינה תקלה", async () => {
    const source = fakeMailSource({ messages: [firstMail()], match: () => true });

    const outcome = await handleEmailIntake(
      { mailboxMessageId: "missing-row-id" },
      { source, extractor: fakeFieldExtractor(), now: NOW },
    );

    expect(outcome).toEqual({ kind: "email-intake", status: "missing" });
    expect(source.calls).toEqual([]);
  });

  it("EM-12 — ג׳וב קליטה על שורה יוצאת הוא באג, ונכשל ברעש", async () => {
    const row = await db.mailboxMessage.create({
      data: { direction: "OUTBOUND", state: "PENDING" },
      select: { id: true },
    });
    const source = fakeMailSource({ messages: [], match: () => true });

    await expect(
      handleEmailIntake({ mailboxMessageId: row.id }, { source, extractor: null, now: NOW }),
    ).rejects.toThrow(/שורה יוצאת/);
  });
});

// ─────────────────────────────── עזר ───────────────────────────────

/**
 * טיוטה קיימת עם שרשרת מיילים — הבסיס לכל בדיקה של "תשובה בשרשרת".
 * השורה היוצאת נושאת את `OUTGOING_REPLY_MESSAGE_ID`, שאליו `replyInThread`
 * מצביע ב-`In-Reply-To`.
 */
async function existingThread(): Promise<{ threadId: string; ticketId: string }> {
  const ticket = await db.ticket.create({
    data: {
      channel: "EMAIL",
      isDraft: true,
      createdById: adminId,
      siteId,
      description: "נזילה במטבח",
    },
    select: { id: true },
  });
  const thread = await db.mailThread.create({ data: { ticketId: ticket.id }, select: { id: true } });

  await db.mailboxMessage.create({
    data: {
      direction: "INBOUND",
      state: "DONE",
      outcome: "DRAFT_CREATED",
      threadId: thread.id,
      gmailMessageId: "gmail-first",
      gmailThreadId: "thread-first",
      rfcMessageId: FIRST_MAIL_MESSAGE_ID,
      fromAddress: SENDER,
      receivedAt: ARRIVED_AT,
    },
  });
  await db.mailboxMessage.create({
    data: {
      direction: "OUTBOUND",
      state: "SENT",
      threadId: thread.id,
      gmailThreadId: "thread-first",
      rfcMessageId: OUTGOING_REPLY_MESSAGE_ID,
      toAddress: SENDER,
    },
  });

  return { threadId: thread.id, ticketId: ticket.id };
}
