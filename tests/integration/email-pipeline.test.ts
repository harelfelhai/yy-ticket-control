import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { JOB_TYPES } from "@/jobs/types";
import { type JobResult, type WorkerDeps, drainJobs } from "@/jobs/worker";
import { db } from "@/lib/db";
import type { EmailMessage, EmailTransport } from "@/lib/notifier/types";
import { EMAIL_CHANNEL, runEmailPoll } from "@/lib/services/email-poll";
import { intakeReplyMessageId } from "@/lib/services/email-reply";
import { fakeFieldExtractor } from "../helpers/fake-field-extractor";
import { fakeMailSource } from "../helpers/fake-mail-source";
import {
  FIRST_MAIL_MESSAGE_ID,
  FIRST_MAIL_SUBJECT,
  MAILBOX,
  SAMPLE_APARTMENT,
  SAMPLE_BUILDING,
  SAMPLE_SITE,
  SENDER,
  SENDER_NAME,
  STRANGER,
  firstMail,
  mailFromStranger,
  mailWithoutKeyword,
  type MailFixture,
} from "../helpers/mail-fixtures";
import { resetDb } from "../helpers/reset-db";

/**
 * **הבדיקה היחידה שמריצה את שלושת השלבים יחד** (S6): הסבב שמגלה, ג׳וב
 * הקליטה שמכריע ופותח טיוטה, וג׳וב התשובה ששולח — כל אחד דרך התור, בנתיב
 * הדואר, כפי שהעובד מריץ אותם בפרודקשן.
 *
 * **למה זה לא נובע מהבדיקות של המודולים.** לכל שלב יש בדיקה משלו, וכל אחת
 * מהן מזריקה בעצמה את הקלט של השלב: `email-intake.test.ts` יוצרת את שורת
 * היומן בעצמה, ו-`email-reply.test.ts` יוצרת את השורה היוצאת ואת ההכרעה
 * שעליה. כלומר **התפרים עצמם — מה שכל שלב מוסר לבא אחריו — אינם נבדקים
 * באף אחת מהן**: מזהה שנכתב בשם אחר במטען הג׳וב, סוג ג׳וב שאף `case`
 * ב-`runJob` אינו מכיר, או ג׳וב דואר שאף לולאה אינה תופסת — כולם עוברים את
 * כל בדיקות המודולים ומייצרים מייל שלא נענה לעולם. זו הבדיקה שנופלת עליהם.
 *
 * **אין כאן רשת**: התיבה, המחלץ וערוץ השליחה כולם מזויפים
 * (`tests/helpers/`), והם מוזרקים ל-`drainJobs` דרך `WorkerDeps` — אותה
 * דרך שבה `worker.ts` בוחר ספקים לפי הסביבה בפרודקשן.
 */

/**
 * **הזמנים נגזרים משעון אמיתי ולא מתאריך קבוע**, בניגוד לשאר בדיקות S6.
 *
 * הסיבה היא התור: `Job.runAt` מקבל את ברירת המחדל `now()` של **בסיס
 * הנתונים**, ואי אפשר להזיז אותה מכאן (`vi.setSystemTime` מזיז את שעון
 * התהליך בלבד). תפיסה עם `now` קבוע מהעבר אינה מוצאת אף ג׳וב — התנאי הוא
 * `runAt <= now` — והצינור כולו נראה כתור ריק שמצליח. הבדיקות שאינן
 * עוברות דרך התור אינן נתקלות בזה, וזו בדיוק הבדיקה שכן.
 *
 * מה שנשמר קבוע הוא ה**הפרשים**: המייל הגיע דקה לפני "עכשיו" (ולכן
 * ההשהיה היא 120 שניות בדיוק, בתוך ההבטחה של חמש הדקות), וההפעלה הייתה
 * יממה לפניו (ולכן הוא מעל הרצפה של EM-22).
 */
let arrivedAt: Date;
let now: Date;
let activatedAt: Date;

/** ההשהיה שהמייל החוזר ידווח — הפרש קבוע, גם כשהשעון עצמו אינו */
const EXPECTED_LATENCY_SEC = 120;

const DOMAIN_NAME = "אינסטלציה";
const PRO_NAME = "יוסי כהן";

/**
 * גוף שמזכיר **מילולית** כל ערך שהמחלץ המזויף יחזיר.
 *
 * זו אינה קפדנות לשמה: `matching.ts` מפיל ערך שאינו מופיע בטקסט כפי
 * שנכתב (שומר ההזיה), ובגוף אחר הטיוטה הייתה נוצרת ריקה — והבדיקה הייתה
 * נכשלת על משהו שאינו הצינור.
 */
const MAIL_TEXT = [
  `יש נזילה מתחת לכיור במטבח, בדירה ${SAMPLE_APARTMENT} בבניין ${SAMPLE_BUILDING} באתר ${SAMPLE_SITE}.`,
  `התחום הוא ${DOMAIN_NAME}, ונא לשלוח את ${PRO_NAME}.`,
].join("\n");

/** מה שהמחלץ "קרא" מהגוף שלמעלה — מספיק לטיוטה שלא חסר בה דבר (L04) */
const EXTRACTION = {
  site: SAMPLE_SITE,
  building: SAMPLE_BUILDING,
  apartment: SAMPLE_APARTMENT,
  domain: DOMAIN_NAME,
  description: "יש נזילה מתחת לכיור במטבח",
  recipientsAdd: [PRO_NAME],
} as const;

let senderId: string;
let siteId: string;
let professionalId: string;
let originalGmailUser: string | undefined;
let originalBaseUrl: string | undefined;

beforeEach(async () => {
  await resetDb();

  const base = Date.now();
  arrivedAt = new Date(base - 60_000);
  now = new Date(base + 60_000);
  activatedAt = new Date(base - 24 * 60 * 60_000);

  originalGmailUser = process.env.GMAIL_USER;
  originalBaseUrl = process.env.APP_BASE_URL;
  // שומר התיבה של הסבב משווה את הפרופיל שחזר מול המשתנה הזה
  process.env.GMAIL_USER = MAILBOX;
  // הדומיין של ה-`Message-ID` היוצא נגזר מכאן (`intakeReplyMessageId`)
  process.env.APP_BASE_URL = "https://app.example.com";

  siteId = (await db.site.create({ data: { name: SAMPLE_SITE } })).id;
  const buildingId = (await db.building.create({ data: { siteId, name: SAMPLE_BUILDING } })).id;
  await db.apartment.create({ data: { buildingId, number: SAMPLE_APARTMENT } });
  await db.domain.create({ data: { name: DOMAIN_NAME } });
  professionalId = (await db.professional.create({ data: { name: PRO_NAME, phone: "0501110000" } })).id;

  // מנהל מערכת ולא מנהל עבודה: כך האתר מגיע מהמייל ולא מהמשתמש, ומה
  // שנבדק הוא החילוץ ולא גזירת האתר (זו EM-09, ושייכת למודול C)
  senderId = (
    await db.user.create({
      data: { role: "ADMIN", name: SENDER_NAME, phone: "0500000000", passwordHash: "x", email: SENDER },
    })
  ).id;

  await db.mailChannelState.create({
    data: { channel: EMAIL_CHANNEL, mailbox: MAILBOX, activatedAt },
  });
});

afterAll(async () => {
  if (originalGmailUser === undefined) delete process.env.GMAIL_USER;
  else process.env.GMAIL_USER = originalGmailUser;
  if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = originalBaseUrl;
  await db.$disconnect();
});

// ─────────────────────────────── הרכבת הצינור ───────────────────────────────

/**
 * ערוץ שליחה מזויף שאוסף את מה שיצא.
 *
 * `simulated` אינו נקבע: ערוץ שמצהיר על עצמו כמדומה נרשם `SIMULATED` ולא
 * `SENT`, והבדיקה כאן היא בדיוק על השורה שנרשמת.
 */
function fakeTransport(): { transport: EmailTransport; sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  const transport: EmailTransport = {
    name: "fake",
    async send(message) {
      sent.push(message);
      // Gmail מחזיר את השרשור שההודעה **צורפה אליו בפועל**; כאן זה השרשור
      // שביקשנו, וזו הנקודה — השורה היוצאת שומרת את מה שחזר.
      return { id: "gmail-out-1", ...(message.threadId ? { threadId: message.threadId } : {}) };
    },
  };
  return { transport, sent };
}

/** התיבה, המחלץ והערוץ — כפי שהעובד מקבל אותם */
function pipeline(fixtures: readonly MailFixture[]) {
  const source = fakeMailSource({ messages: fixtures });
  const extractor = fakeFieldExtractor({ result: EXTRACTION });
  const { transport, sent } = fakeTransport();
  const deps: WorkerDeps = { mailSource: source, fieldExtractor: extractor, transport };
  return { source, extractor, transport, sent, deps };
}

/**
 * סבב אחד של נתיב הדואר, עם תקרה של ג׳וב אחד.
 *
 * התקרה היא מה שהופך את הבדיקה לבדיקת **שרשרת**: בלעדיה `drainJobs` היה
 * מרוקן גם את ג׳וב התשובה שנוצר תוך כדי, ולא היה אפשר לראות שהוא אכן נוצר
 * על ידי ג׳וב הקליטה ולא היה שם מלכתחילה.
 */
function drainOneMailJob(deps: WorkerDeps): Promise<JobResult[]> {
  return drainJobs(deps, now, 1, "mail");
}

function inboundRows() {
  return db.mailboxMessage.findMany({ where: { direction: "INBOUND" }, orderBy: { createdAt: "asc" } });
}

function outboundRows() {
  return db.mailboxMessage.findMany({ where: { direction: "OUTBOUND" }, orderBy: { createdAt: "asc" } });
}

/** התוצאה של ג׳וב יחיד שרץ בהצלחה — מה ש-`runJob` החזיר */
function outcomeOf(results: JobResult[]): unknown {
  expect(results).toHaveLength(1);
  const [result] = results;
  expect(result.status).toBe("done");
  return result.status === "done" ? result.outcome : undefined;
}

// ─────────────────────────────── המסלול המלא ───────────────────────────────

describe("הצינור מקצה לקצה", () => {
  it("EM-01 · EM-05 · EM-12 — מייל עם המילה משולח מורשה: סבב → ג׳וב קליטה → טיוטה → מייל חוזר בשרשרת", async () => {
    const mail = firstMail({ text: MAIL_TEXT, receivedAt: arrivedAt });
    const { source, sent, deps } = pipeline([mail]);

    // ─── שלב 1: הסבב מגלה וכותב שורה אחת וג׳וב אחד ───
    const poll = await runEmailPoll({ source, now });
    expect(poll).toMatchObject({ status: "ok", discovered: 1, skipped: 0, raced: 0 });

    const [discovered] = await inboundRows();
    expect(discovered).toMatchObject({ state: "PENDING", gmailMessageId: mail.envelope.sourceId });
    // השורה נולדת ריקה מתוכן: הסבב אינו קורא את ההודעה, רק את מזהיה
    expect(discovered.subject).toBeNull();
    expect(await db.job.findMany({ where: { type: JOB_TYPES.emailIntake } })).toHaveLength(1);

    // ─── שלב 2: נתיב הדואר מריץ את ג׳וב הקליטה ───
    const intake = await drainOneMailJob(deps);
    expect(outcomeOf(intake)).toMatchObject({
      kind: "email-intake",
      status: "decided",
      outcome: "DRAFT_CREATED",
    });

    const inbound = await db.mailboxMessage.findUniqueOrThrow({ where: { id: discovered.id } });
    expect(inbound).toMatchObject({
      state: "DONE",
      outcome: "DRAFT_CREATED",
      fromAddress: SENDER,
      authorUserId: senderId,
      subject: FIRST_MAIL_SUBJECT,
      rfcMessageId: FIRST_MAIL_MESSAGE_ID,
      receivedAt: arrivedAt,
    });

    // הפנייה — טיוטה בערוץ מייל, בבעלות השולח (§2.6 שלב 3)
    const ticket = await db.ticket.findFirstOrThrow({ include: { draftFields: true } });
    expect(ticket).toMatchObject({
      channel: "EMAIL",
      isDraft: true,
      createdById: senderId,
      siteId,
      description: EXTRACTION.description,
    });
    expect(inbound.threadId).not.toBeNull();

    // ─── שלב 3: ג׳וב התשובה, שג׳וב הקליטה יצר ───
    const replyJobs = await db.job.findMany({ where: { type: JOB_TYPES.emailReply } });
    expect(replyJobs).toHaveLength(1);
    const [outboundBefore] = await outboundRows();
    expect(replyJobs[0].payload).toEqual({ mailboxMessageId: outboundBefore.id });
    expect(outboundBefore).toMatchObject({ state: "PENDING", repliesToId: inbound.id });
    // המייל טרם יצא — עד כאן אין שום שליחה
    expect(sent).toEqual([]);

    const reply = await drainOneMailJob(deps);
    expect(outcomeOf(reply)).toMatchObject({
      status: "sent",
      // לא חסר דבר בטיוטה ואין סתירה → הנוסח הקצר (EM-L04)
      template: "L04",
      to: SENDER,
      simulated: false,
      // ההבטחה של §2.6 שלב 4, נמדדת מזמן ההגעה
      latencySec: EXPECTED_LATENCY_SEC,
    });

    // מה ש**יצא** — הנמען הוא השולח בלבד, והשרשור הוא של ההודעה הנכנסת
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: SENDER,
      subject: `Re: ${FIRST_MAIL_SUBJECT}`,
      inReplyTo: FIRST_MAIL_MESSAGE_ID,
      threadId: mail.envelope.sourceThreadId,
      autoReply: true,
    });
    expect(sent[0].references).toContain(FIRST_MAIL_MESSAGE_ID);

    // ומה ש**נרשם** — זה מה שקרה, כולל שדות השרשור לתשובה הבאה
    const [outbound] = await outboundRows();
    expect(outbound).toMatchObject({
      state: "SENT",
      sentAt: now,
      toAddress: SENDER,
      subject: `Re: ${FIRST_MAIL_SUBJECT}`,
      rfcMessageId: intakeReplyMessageId(outbound.id),
      gmailMessageId: "gmail-out-1",
      gmailThreadId: mail.envelope.sourceThreadId,
      threadId: inbound.threadId,
      detail: null,
    });
    expect(outbound.bodyText).toContain(SAMPLE_SITE);

    // התור ריק: שני הג׳ובים הסתיימו, ולא נוצר שלישי
    expect(await db.job.count({ where: { status: "PENDING" } })).toBe(0);
    expect(await db.job.count({ where: { status: "DONE" } })).toBe(2);
  });

  it("EM-M03 — כל שדה שהמייל מילא נושא תג \"מהמייל\", ושדה שלא מולא אינו נרשם כלל", async () => {
    const { source, deps } = pipeline([firstMail({ text: MAIL_TEXT, receivedAt: arrivedAt })]);

    await runEmailPoll({ source, now });
    await drainOneMailJob(deps);

    const fields = await db.draftField.findMany({ orderBy: { field: "asc" } });
    expect(fields.map((field) => field.field).sort()).toEqual([
      "APARTMENT",
      "BUILDING",
      "DESCRIPTION",
      "DOMAIN",
      "RECIPIENTS",
      "SITE",
    ]);
    // התג הוא הדרישה עצמה: ערך שהגיע ממייל ואיש לא ערך אותו מאז
    expect(fields.every((field) => field.fromEmail)).toBe(true);
    // חדר לא הוזכר בגוף, ולכן אין לו שורה — היעדר שורה נקרא כשדה ריק
    expect(fields.some((field) => field.field === "ROOM")).toBe(false);

    const ticket = await db.ticket.findFirstOrThrow();
    expect(ticket.draftRecipients).toEqual([
      expect.objectContaining({ kind: "professional", id: professionalId, origin: "EMAIL" }),
    ]);
  });

  it("EM-02 · EM-21 — סבב שני על אותה תיבה אינו פותח פנייה שנייה ואינו שולח מייל שני", async () => {
    const mail = firstMail({ text: MAIL_TEXT, receivedAt: arrivedAt });
    const { source, sent, deps } = pipeline([mail]);

    const first = await runEmailPoll({ source, now });
    await drainOneMailJob(deps);
    await drainOneMailJob(deps);
    expect(first.discovered).toBe(1);
    expect(sent).toHaveLength(1);

    // אותה הודעה עדיין בתיבה — המערכת אינה משנה בה דבר (EM-20), ולכן
    // הסבב הבא רואה אותה שוב. האינדקס הייחודי הוא מה שמכריע.
    const second = await runEmailPoll({ source, now: new Date(now.getTime() + 60_000) });
    expect(second).toMatchObject({ status: "ok", discovered: 0, skipped: 1 });

    // אין ג׳וב חדש לרוץ, ולכן גם אין מייל שני
    expect(await drainOneMailJob(deps)).toEqual([]);
    expect(await db.ticket.count()).toBe(1);
    expect(await inboundRows()).toHaveLength(1);
    expect(await outboundRows()).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("EM-12 — ג׳ובי הדואר אינם נתפסים בנתיב הכללי, ולכן אינם ממתינים מאחורי עבודה ארוכה", async () => {
    const { source, sent, deps } = pipeline([firstMail({ text: MAIL_TEXT, receivedAt: arrivedAt })]);
    await runEmailPoll({ source, now });

    // הלולאה הכללית סורקת את התור ואינה מוצאת בו דבר — ג׳וב הקליטה שייך
    // לנתיב הדואר בלבד
    expect(await drainJobs(deps, now, 20, "general")).toEqual([]);
    expect(await db.ticket.count()).toBe(0);
    expect(sent).toEqual([]);

    // ואותו ג׳וב בדיוק נתפס בנתיב הדואר
    await drainOneMailJob(deps);
    await drainOneMailJob(deps);
    expect(await db.ticket.count()).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("EM-A11 — תיבת המערכת בהעתק בלבד: נקלט כמו מייל ישיר, והמייל החוזר הולך לשולח בלבד", async () => {
    // המנהל כתב לקבלן והעתיק את המערכת (§7 שורה 80): השאילתה מסננת לפי
    // השולח ולא לפי הנמען, ושום שלב בהכרעה אינו שואל למי המייל נשלח
    const contractor = "contractor@example.com";
    const mail = firstMail({ text: MAIL_TEXT, receivedAt: arrivedAt, to: [contractor], cc: [MAILBOX] });
    const { source, sent, deps } = pipeline([mail]);

    expect(await runEmailPoll({ source, now })).toMatchObject({ status: "ok", discovered: 1 });
    expect(outcomeOf(await drainOneMailJob(deps))).toMatchObject({ status: "decided", outcome: "DRAFT_CREATED" });
    expect(await db.ticket.count({ where: { channel: "EMAIL", isDraft: true } })).toBe(1);

    await drainOneMailJob(deps);
    // מי שהיה ב-To אינו מקבל דבר: המייל החוזר הוא לשולח בלבד (EM-L10)
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(SENDER);
  });
});

// ─────────────────────────────── מה שאינו נקלט ואינו נענה ───────────────────────────────

describe("הצינור מקצה לקצה — הכרעות שאין עליהן מענה", () => {
  it("EM-03 — מייל בלי המילה בכותרת אינו פותח פנייה ואינו נענה", async () => {
    const mail = mailWithoutKeyword({ receivedAt: arrivedAt });
    const { source, extractor, sent, deps } = pipeline([mail]);

    // הסבב **כן** מגלה אותו: כלל הכותרת מוכרע בקוד ולא בשאילתה
    const poll = await runEmailPoll({ source, now });
    expect(poll.discovered).toBe(1);

    const intake = await drainOneMailJob(deps);
    expect(outcomeOf(intake)).toMatchObject({ status: "decided", outcome: "IGNORED_SUBJECT" });

    // אין פנייה, אין שורה יוצאת, אין ג׳וב תשובה — ולכן אין מה לרוקן
    expect(await db.ticket.count()).toBe(0);
    expect(await outboundRows()).toEqual([]);
    expect(await db.job.count({ where: { type: JOB_TYPES.emailReply } })).toBe(0);
    expect(await drainOneMailJob(deps)).toEqual([]);
    expect(sent).toEqual([]);
    // מייל שלא נקלט אינו מגיע למחלץ כלל
    expect(extractor.calls).toEqual([]);

    // השורה שומרת מזהים ושולח — ולא כותרת ולא גוף. התיבה משותפת עם מערכת
    // אחרת, ואין להעתיק את תוכנה בלי סיבה.
    const [row] = await inboundRows();
    expect(row).toMatchObject({ state: "DONE", outcome: "IGNORED_SUBJECT", fromAddress: SENDER });
    expect(row.subject).toBeNull();
    expect(row.bodyText).toBeNull();
  });

  it("EM-03 — מייל מכתובת שאינה של משתמש מורשה אינו פותח פנייה ואינו נענה", async () => {
    const mail = mailFromStranger({ receivedAt: arrivedAt });
    // התיבה מחזירה את ההודעה בלי קשר לשאילתה: הסבב לא היה שואל על כתובת
    // שאינה מורשה, והבדיקה כאן היא על השלב שאחריו — הודעה שהגיעה ליומן
    // (דרך כתובת נוספת שהוסרה, או מרוץ) ונדחית בהכרעה.
    const source = fakeMailSource({ messages: [mail], match: () => true });
    const extractor = fakeFieldExtractor({ result: EXTRACTION });
    const { transport, sent } = fakeTransport();
    const deps: WorkerDeps = { mailSource: source, fieldExtractor: extractor, transport };

    const poll = await runEmailPoll({ source, now });
    expect(poll.discovered).toBe(1);

    const intake = await drainOneMailJob(deps);
    expect(outcomeOf(intake)).toMatchObject({ status: "decided", outcome: "IGNORED_UNAUTHORIZED" });

    // מענה לזר מאשר לו שמישהו קורא את התיבה הזו — ולכן אין מענה כלל
    expect(await db.ticket.count()).toBe(0);
    expect(await outboundRows()).toEqual([]);
    expect(sent).toEqual([]);

    const [row] = await inboundRows();
    expect(row).toMatchObject({ outcome: "IGNORED_UNAUTHORIZED", fromAddress: STRANGER, authorUserId: null });
    expect(row.subject).toBeNull();
  });
});
