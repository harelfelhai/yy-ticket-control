import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import type { MailOutcome } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { DRAFT_FIELD_LABEL } from "@/lib/draft/labels";
import type { MailEnvelope } from "@/lib/email-intake/types";
import type { ReplyTemplate } from "@/lib/email-intake/reply/compose";
import { he } from "@/lib/he";
import type { EmailMessage, EmailSendResult, EmailTransport } from "@/lib/notifier/types";
import { logWarn } from "@/lib/observability/log";
import { intakeReplyMessageId, markReplyFailed, sendEmailReply } from "@/lib/services/email-reply";
import { checks } from "@/watchdog/checks";
import { fakeMailSource, matchesQuery } from "../helpers/fake-mail-source";
import {
  ARRIVED_AT,
  FIRST_MAIL_MESSAGE_ID,
  FIRST_MAIL_SUBJECT,
  MAILBOX,
  SENDER,
  SENDER_NAME,
  STRANGER,
  mailEnvelope,
} from "../helpers/mail-fixtures";
import { resetDb } from "../helpers/reset-db";

/**
 * המייל החוזר (S6, מודול D) מול בסיס נתונים אמיתי.
 *
 * מה שנבדק כאן ואי אפשר לבדוק ביחידה: שהמייל מתאר את הטיוטה **כפי שהיא
 * ברגע השליחה** ולא כפי שהייתה בהכרעה, שהנמען הוא השולח ואיש מלבדו, שניסיון
 * חוזר אינו שולח פעמיים, ושמה שנרשם בשורה היוצאת הוא מה שקרה בפועל.
 *
 * הערוץ והתיבה מדומים — אין כאן רשת. מה שזה מאפשר הוא בדיוק מה שחסר בלי
 * זה: להזריק כשל שליחה, תשובה שאבדה, וטיוטה שנמחקה בין שני הרגעים.
 */

vi.mock("@/lib/observability/log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/observability/log")>();
  return { ...actual, logInfo: vi.fn(), logWarn: vi.fn(), logError: vi.fn(), captureError: vi.fn() };
});

/** דקה אחרי שהמייל הגיע — בתוך ההבטחה של חמש הדקות */
const NOW = new Date(ARRIVED_AT.getTime() + 60_000);

const INBOUND_GMAIL_ID = "gmail-first";
const INBOUND_THREAD = "thread-first";

function fakeTransport(options: { simulated?: boolean; failTimes?: number; result?: EmailSendResult } = {}) {
  const sent: EmailMessage[] = [];
  let failuresLeft = options.failTimes ?? 0;

  const transport: EmailTransport = {
    name: "fake",
    ...(options.simulated ? { simulated: true } : {}),
    async send(message) {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error("שרת המייל אינו זמין");
      }
      sent.push(message);
      return options.result ?? { id: "gmail-out-1", threadId: INBOUND_THREAD, messageId: undefined };
    },
  };

  return { transport, sent };
}

/**
 * התיבה המדומה אינה יודעת לקרוא `rfc822msgid:` (`matchesQuery` מכסה את
 * שאילתת הסבב בלבד), ובלי הפונקציה הזו כל חיפוש היה מחזיר את **כל** התיבה —
 * כלומר "כבר נשלח" תמיד, וירוק שקרי מושלם.
 */
function byRfcMessageId(envelope: MailEnvelope, query: string): boolean {
  const wanted = /rfc822msgid:(\S+)/.exec(query)?.[1];
  return wanted === undefined ? matchesQuery(envelope, query) : envelope.rfcMessageId === wanted;
}

let senderId: string;
let otherUserId: string;
let siteId: string;
let buildingId: string;
let apartmentId: string;
let domainId: string;
let professionalId: string;
let originalBaseUrl: string | undefined;

beforeAll(() => {
  originalBaseUrl = process.env.APP_BASE_URL;
  // דומיין אמיתי, כדי שגם הקישור וגם ה-`Message-ID` ייראו כמו בפרודקשן
  process.env.APP_BASE_URL = "https://app.example.com";
});

afterAll(async () => {
  if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = originalBaseUrl;
  await db.$disconnect();
});

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(async () => {
  await resetDb();

  siteId = (await db.site.create({ data: { name: "גני אלון" } })).id;
  await db.site.create({ data: { name: "נווה שקד" } });
  buildingId = (await db.building.create({ data: { siteId, name: "ב" } })).id;
  apartmentId = (await db.apartment.create({ data: { buildingId, number: "12" } })).id;
  domainId = (await db.domain.create({ data: { name: "אינסטלציה" } })).id;
  professionalId = (
    await db.professional.create({ data: { name: "רן אינסטלציה", phone: "0501111111", email: STRANGER } })
  ).id;

  senderId = (
    await db.user.create({
      data: { role: "SITE_MANAGER", name: SENDER_NAME, phone: "0500000001", passwordHash: "x", email: SENDER, siteId },
    })
  ).id;
  otherUserId = (
    await db.user.create({
      data: {
        role: "SITE_MANAGER",
        name: "יוסי לוי",
        phone: "0500000002",
        passwordHash: "x",
        email: "yossi@example.com",
        siteId,
      },
    })
  ).id;
});

type TicketShape = "complete" | "incomplete" | "no-site" | "dispatched" | "none";

/**
 * טיוטה ממייל. `complete` היא טיוטה שלא חסר בה דבר — הבסיס ל-EM-L04, ולכן
 * כל מקרה שצריך את הנוסח הכללי מסיר ממנה משהו במפורש.
 */
async function createTicket(shape: TicketShape): Promise<string | null> {
  if (shape === "none") return null;
  const recipients = [{ kind: "professional", id: professionalId, origin: "EMAIL", removedBySystemAt: null }];
  const ticket = await db.ticket.create({
    data: {
      channel: "EMAIL",
      isDraft: shape !== "dispatched",
      createdById: senderId,
      description: "יש נזילה מתחת לכיור במטבח",
      room: "KITCHEN",
      draftRecipients: recipients as unknown as Prisma.InputJsonValue,
      ...(shape === "no-site"
        ? {}
        : { siteId, buildingId, apartmentId, domainId: shape === "incomplete" ? null : domainId }),
    },
  });
  return ticket.id;
}

interface SeedOptions {
  outcome?: MailOutcome | null;
  shape?: TicketShape;
  /** הפנייה נמחקה אחרי שההתכתבות נקשרה אליה */
  deleteTicket?: boolean;
  report?: Prisma.InputJsonValue;
  receivedAt?: Date;
  fromAddress?: string | null;
  authorUserId?: string | null;
}

/** ההודעה הנכנסת שכבר הוכרעה, והשורה היוצאת שממתינה לשליחה */
async function seed(options: SeedOptions = {}) {
  const shape = options.shape ?? "complete";
  const ticketId = await createTicket(shape);
  const thread = await db.mailThread.create({ data: ticketId ? { ticketId } : {} });

  const inbound = await db.mailboxMessage.create({
    data: {
      direction: "INBOUND",
      state: "DONE",
      outcome: options.outcome === undefined ? "DRAFT_CREATED" : options.outcome,
      gmailMessageId: INBOUND_GMAIL_ID,
      gmailThreadId: INBOUND_THREAD,
      rfcMessageId: FIRST_MAIL_MESSAGE_ID,
      referenceIds: ["older@mail.example.com"],
      threadId: thread.id,
      fromAddress: options.fromAddress === undefined ? SENDER : options.fromAddress,
      fromName: "Dana from phone",
      // התיבה עצמה ועוד כתובת שהייתה בהעתק — אף אחת מהן אינה נמענת התשובה
      toAddress: `${MAILBOX}, ${STRANGER}`,
      subject: FIRST_MAIL_SUBJECT,
      receivedAt: options.receivedAt ?? ARRIVED_AT,
      authorUserId: options.authorUserId === undefined ? senderId : options.authorUserId,
      ...(options.report === undefined ? {} : { report: options.report }),
    },
  });

  const outbound = await db.mailboxMessage.create({
    data: { direction: "OUTBOUND", state: "PENDING", threadId: thread.id, repliesToId: inbound.id },
  });

  if (options.deleteTicket && ticketId) await db.ticket.delete({ where: { id: ticketId } });

  return { inbound, outbound, ticketId, threadId: thread.id };
}

function row(id: string) {
  return db.mailboxMessage.findUniqueOrThrow({ where: { id } });
}

// ───────────────────────────────────────────────────────────────────────

describe("EM-12 — מייל חוזר תמיד, באותה שרשרת", () => {
  it("EM-12 — התשובה יוצאת לשולח בשרשרת של ההודעה הנכנסת, עם כותרות אנטי-לולאה", async () => {
    const { outbound, inbound } = await seed();
    const { transport, sent } = fakeTransport();

    const result = await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    expect(result).toMatchObject({ status: "sent", to: SENDER, via: "fake", simulated: false });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: SENDER,
      inReplyTo: FIRST_MAIL_MESSAGE_ID,
      threadId: INBOUND_THREAD,
      autoReply: true,
    });
    // `References` = אלה של ההודעה שעליה עונים, ואחריהן המזהה שלה
    expect(sent[0].references).toEqual(["older@mail.example.com", inbound.rfcMessageId]);
    expect(sent[0].subject.startsWith(he.emailIntake.replyPrefix)).toBe(true);
  });

  it("EM-12 — ה-Message-ID נגזר מהשורה היוצאת, ולכן זהה בכל ניסיון", async () => {
    const { outbound } = await seed();
    const { transport, sent } = fakeTransport();

    await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    expect(sent[0].messageId).toBe(`yy-${outbound.id}@app.example.com`);
    expect(intakeReplyMessageId(outbound.id)).toBe(sent[0].messageId);
  });

  it("EM-12 — השורה היוצאת מתעדת את מה שיצא", async () => {
    const { outbound } = await seed();
    const { transport } = fakeTransport({ result: { id: "gmail-out-9", threadId: "thread-server", messageId: "server-chosen@gmail" } });

    await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    const saved = await row(outbound.id);
    expect(saved.state).toBe("SENT");
    expect(saved.sentAt).toEqual(NOW);
    expect(saved.toAddress).toBe(SENDER);
    expect(saved.bodyText).toContain(he.emailIntake.notSentYet);
    // מה שיצא בפועל ולא מה שביקשנו — התשובה הבאה תצביע על זה (EM-14)
    expect(saved.rfcMessageId).toBe("server-chosen@gmail");
    expect(saved.gmailMessageId).toBe("gmail-out-9");
    expect(saved.gmailThreadId).toBe("thread-server");
    expect(saved.attempts).toBe(1);
    expect(saved.detail).toBeNull();
  });

  it("EM-12 — ג׳וב שרץ פעמיים אינו שולח פעמיים", async () => {
    const { outbound } = await seed();
    const first = fakeTransport();
    await sendEmailReply({ mailboxMessageId: outbound.id }, { transport: first.transport, mailSource: null, now: NOW });

    const second = fakeTransport();
    const result = await sendEmailReply(
      { mailboxMessageId: outbound.id },
      { transport: second.transport, mailSource: null, now: NOW },
    );

    expect(result).toEqual({ status: "noop", reason: "not-pending" });
    expect(second.sent).toHaveLength(0);
  });

  it("EM-12 — גם מזהה ההודעה הנכנסת מוביל לשורה היוצאת שלה", async () => {
    const { inbound, outbound } = await seed();
    const { transport, sent } = fakeTransport();

    await sendEmailReply({ mailboxMessageId: inbound.id }, { transport, mailSource: null, now: NOW });

    expect(sent).toHaveLength(1);
    expect((await row(outbound.id)).state).toBe("SENT");
  });

  it("EM-12 — שורה שאינה קיימת אינה מפילה את הג׳וב", async () => {
    const { transport, sent } = fakeTransport();
    const result = await sendEmailReply(
      { mailboxMessageId: "no-such-row" },
      { transport, mailSource: null, now: NOW },
    );

    expect(result).toEqual({ status: "noop", reason: "missing" });
    expect(sent).toHaveLength(0);
  });
});

describe("בחירת הנוסח לפי ההכרעה על ההודעה הנכנסת", () => {
  const cases: { id: string; outcome: MailOutcome; shape: TicketShape; template: ReplyTemplate }[] = [
    { id: "EM-L01", outcome: "DRAFT_CREATED", shape: "incomplete", template: "L01" },
    { id: "EM-L04", outcome: "DRAFT_CREATED", shape: "complete", template: "L04" },
    { id: "EM-L07", outcome: "DRAFT_CREATED_UNPROCESSED", shape: "complete", template: "L07_FIRST" },
    { id: "EM-L07", outcome: "REPLY_STORED_UNPROCESSED", shape: "complete", template: "L07_REPLY" },
    { id: "EM-L05", outcome: "REPLY_AFTER_DISPATCH", shape: "dispatched", template: "L05" },
    { id: "EM-L06", outcome: "REPLY_AFTER_DELETION", shape: "none", template: "L06" },
    { id: "EM-L08", outcome: "REPLY_NOT_PERMITTED", shape: "complete", template: "L08" },
    { id: "EM-L09", outcome: "NO_SITE", shape: "none", template: "L09" },
    { id: "EM-L01", outcome: "REPLY_APPLIED", shape: "incomplete", template: "L01" },
  ];

  for (const { id, outcome, shape, template } of cases) {
    it(`${id} — ${outcome} בוחרת את הנוסח ${template}`, async () => {
      const { outbound } = await seed({ outcome, shape });
      const { transport, sent } = fakeTransport();

      const result = await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

      expect(result).toMatchObject({ status: "sent", template });
      expect(sent).toHaveLength(1);
    });
  }

  it("EM-L04 — סתירה פתוחה משאירה את הנוסח הכללי גם כשלא חסר דבר", async () => {
    const { outbound, ticketId } = await seed();
    await db.draftField.create({
      data: {
        ticketId: ticketId as string,
        field: "APARTMENT",
        conflict: true,
        emailValue: { field: "APARTMENT", apartmentId } as unknown as Prisma.InputJsonValue,
      },
    });
    const { transport, sent } = fakeTransport();

    const result = await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    expect(result).toMatchObject({ template: "L01" });
    expect(sent[0].text).toContain(he.emailIntake.conflictHeading);
  });

  it("EM-L05 — מייל 'כבר נשלחה' נושא את מספר הפנייה ואת הקישור אליה", async () => {
    const { outbound, ticketId } = await seed({ outcome: "REPLY_AFTER_DISPATCH", shape: "dispatched" });
    const { transport, sent } = fakeTransport();

    await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    const ticket = await db.ticket.findUniqueOrThrow({ where: { id: ticketId as string } });
    expect(sent[0].text).toContain(`#${ticket.seq}`);
    expect(sent[0].text).toContain(`https://app.example.com/tickets/${ticket.id}`);
  });

  it("EM-L08 — 'אין לך הרשאה' מפנה לשולח המקורי בשמו", async () => {
    const { outbound } = await seed({ outcome: "REPLY_NOT_PERMITTED", authorUserId: otherUserId });
    const { transport, sent } = fakeTransport();

    await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    // הפונה הוא יוסי, והמייל מפנה אותו לדנה — שהיא זו שפתחה את הטיוטה
    expect(sent[0].text).toContain(he.emailIntake.greeting("יוסי לוי"));
    expect(sent[0].text).toContain(he.emailIntake.notPermitted(SENDER_NAME));
  });
});

describe("המייל מתאר את הטיוטה ברגע השליחה", () => {
  it("EM-12 — עריכה שנעשתה בין ההכרעה לשליחה מופיעה במייל", async () => {
    const { outbound, ticketId } = await seed();
    // מישהו נכנס לטיוטה ותיקן אותה אחרי שהג׳וב כבר נוצר
    const otherApartment = await db.apartment.create({ data: { buildingId, number: "14" } });
    await db.ticket.update({
      where: { id: ticketId as string },
      data: { apartmentId: otherApartment.id, description: "הברז באמבטיה מטפטף" },
    });
    const { transport, sent } = fakeTransport();

    await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    expect(sent[0].text).toContain("הברז באמבטיה מטפטף");
    expect(sent[0].text).toContain(he.emailIntake.summaryItem(he.directory.apartment, "14"));
    expect(sent[0].text).not.toContain("נזילה מתחת לכיור");
  });

  it("EM-A02 — כל השדות מופיעים, וערך ריק מוצג כמקף", async () => {
    const { outbound } = await seed({ shape: "incomplete" });
    const { transport, sent } = fakeTransport();

    await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    expect(sent[0].text).toContain(he.emailIntake.summaryItem(he.ticket.site, "גני אלון"));
    expect(sent[0].text).toContain(he.emailIntake.summaryItem(he.directory.domain, he.emailIntake.empty));
    expect(sent[0].text).toContain(he.emailIntake.summaryItem(he.ticket.recipients, "רן אינסטלציה"));
  });

  it("EM-A03 — בטיוטה בלי אתר, 'חסר' מציג את רשימת האתרים", async () => {
    const { outbound } = await seed({ shape: "no-site" });
    const { transport, sent } = fakeTransport();

    await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    expect(sent[0].text).toContain(he.emailIntake.missingHeading);
    expect(sent[0].text).toContain("האתרים הקיימים: גני אלון, נווה שקד.");
  });

  it("EM-C01 — שורת הסתירה מציגה שם ולא מזהה, משני הצדדים", async () => {
    const { outbound, ticketId } = await seed();
    const otherDomain = await db.domain.create({ data: { name: "חשמל" } });
    await db.draftField.create({
      data: {
        ticketId: ticketId as string,
        field: "DOMAIN",
        conflict: true,
        emailValue: { field: "DOMAIN", domainId: otherDomain.id } as unknown as Prisma.InputJsonValue,
      },
    });
    const { transport, sent } = fakeTransport();

    await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    expect(sent[0].text).toContain(he.emailIntake.conflictItem(he.directory.domain, "חשמל", "אינסטלציה"));
    expect(sent[0].text).not.toContain(otherDomain.id);
  });

  it("EM-07 — מה שנכתב ולא נמצא נקרא מהדיווח שנשמר על ההודעה הנכנסת", async () => {
    const { outbound } = await seed({
      outcome: "REPLY_APPLIED",
      report: {
        updated: [{ field: "ROOM", before: "מטבח", after: "חדר רחצה" }],
        notFound: [{ field: "DOMAIN", written: "מיזוג", options: ["אינסטלציה"] }],
        ambiguous: [],
      },
    });
    const { transport, sent } = fakeTransport();

    await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    expect(sent[0].text).toContain(he.emailIntake.updatedHeading);
    expect(sent[0].text).toContain(he.emailIntake.notFoundItem(he.directory.domain, "מיזוג"));
  });

  it("EM-12 — דיווח פגום אינו מונע את שליחת המייל", async () => {
    const { outbound } = await seed({ report: { updated: "לא מערך", notFound: [{ field: "מה?" }] } });
    const { transport, sent } = fakeTransport();

    const result = await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    expect(result).toMatchObject({ status: "sent" });
    expect(sent).toHaveLength(1);
  });
});

/**
 * הצורה היחידה בדיווח שמפילה את הניסוח: `ambiguousSection` (compose.ts)
 * זורק על פריט "נמצאו כמה התאמות" שאין בו שתי התאמות ממשיות.
 *
 * זה אינו רק JSON פגום. §5.ז מתיר לאותו אדם להיות גם איש מקצוע וגם
 * משתמש-נמען, לשם אין אילוץ ייחודיות, וההתאמות בדיווח מיוחדות **לפי
 * תווית** — ולכן שתי רשומות שונות באותו שם בדיוק מייצרות פריט תקין
 * לחלוטין עם התאמה אחת. מייל בלי שורת "נמצאו כמה התאמות" חסר מידע; מייל
 * שלא יצא כלל שובר את ההבטחה של §2.6 שלב 4.
 */
describe("EM-L03 · EM-12 — 'נמצאו כמה התאמות' אינו מונע את יציאת המייל", () => {
  const ambiguousReport = (items: unknown[]): Prisma.InputJsonValue =>
    ({ updated: [], notFound: [], ambiguous: items }) as unknown as Prisma.InputJsonValue;

  it("EM-L03 · EM-12 — שתי רשומות באותו שם (התאמה אחת אחרי הייחוד) אינן מפילות את המייל", async () => {
    const { outbound } = await seed({
      report: ambiguousReport([{ field: "RECIPIENTS", written: "יוסי לוי", matches: ["יוסי לוי"] }]),
    });
    const { transport, sent } = fakeTransport();

    const result = await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    expect(result).toMatchObject({ status: "sent" });
    expect(sent).toHaveLength(1);
    // הפריט נזרק ולא הוצג: "כתבת 'יוסי לוי' — יוסי לוי." אינו משפט
    expect(sent[0].text).not.toContain(he.emailIntake.ambiguousHeading);
    expect((await row(outbound.id)).state).toBe("SENT");
  });

  it("EM-L03 — שתי התאמות אמיתיות כן מופיעות במייל", async () => {
    const { outbound } = await seed({
      report: ambiguousReport([{ field: "RECIPIENTS", written: "יוסי", matches: ["יוסי לוי", "יוסי כהן"] }]),
    });
    const { transport, sent } = fakeTransport();

    await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    expect(sent[0].text).toContain(
      he.emailIntake.ambiguousItem(DRAFT_FIELD_LABEL.RECIPIENTS, "יוסי", "יוסי לוי, יוסי כהן"),
    );
    expect(sent[0].text).toContain(he.emailIntake.ambiguousHint);
  });

  it("EM-L03 · EM-12 — פריט בלי `matches` כלל אינו מפיל את המייל", async () => {
    const { outbound } = await seed({ report: ambiguousReport([{ field: "SITE", written: "גני" }]) });
    const { transport, sent } = fakeTransport();

    const result = await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    expect(result).toMatchObject({ status: "sent" });
    expect(sent[0].text).not.toContain(he.emailIntake.ambiguousHeading);
  });

  it("EM-L03 · EM-12 — התאמה ריקה אינה נספרת כהתאמה", async () => {
    const { outbound } = await seed({
      report: ambiguousReport([{ field: "DOMAIN", written: "מיזוג", matches: ["חשמל", "   "] }]),
    });
    const { transport, sent } = fakeTransport();

    const result = await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    expect(result).toMatchObject({ status: "sent" });
    expect(sent[0].text).not.toContain(he.emailIntake.ambiguousHeading);
  });

  it("EM-L03 — פריט שאי אפשר לנסח נזרק, והפריט התקין שלצדו נשאר", async () => {
    const { outbound } = await seed({
      report: ambiguousReport([
        { field: "RECIPIENTS", written: "יוסי לוי", matches: ["יוסי לוי"] },
        { field: "DOMAIN", written: "מיזוג", matches: ["חשמל", "אינסטלציה"] },
      ]),
    });
    const { transport, sent } = fakeTransport();

    await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    expect(sent[0].text).toContain(
      he.emailIntake.ambiguousItem(DRAFT_FIELD_LABEL.DOMAIN, "מיזוג", "חשמל, אינסטלציה"),
    );
    expect(sent[0].text).not.toContain("יוסי לוי");
  });

  it("EM-L03 — פריט שנזרק אינו נעלם בשקט אלא נרשם ללוג", async () => {
    const { outbound } = await seed({
      report: ambiguousReport([{ field: "RECIPIENTS", written: "יוסי לוי", matches: ["יוסי לוי"] }]),
    });
    const { transport } = fakeTransport();

    await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    expect(vi.mocked(logWarn).mock.calls.map((call) => call[0])).toContain("email.reply.report.dropped");
  });
});

describe("EM-03 · EM-L10 — למי לא נשלח מייל", () => {
  it("EM-L10 — הנמען הוא כתובת השולח בלבד: לא העתק ולא נמעני הטיוטה", async () => {
    const { outbound } = await seed();
    const { transport, sent } = fakeTransport();

    await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    const recipients = sent.map((message) => message.to);
    expect(recipients).toEqual([SENDER]);
    // STRANGER הוא גם הכתובת שהייתה ב"אל" של המייל הנכנס וגם המייל של
    // הנמען בטיוטה — שתי הדרכים שבהן אפשר לענות בטעות למי שאסור
    expect(recipients).not.toContain(STRANGER);
    expect(recipients).not.toContain(MAILBOX);
  });

  it("EM-03 — הכרעה שאין עליה מענה אינה שולחת מייל ונרשמת כדילוג", async () => {
    const { outbound } = await seed({ outcome: "IGNORED_UNAUTHORIZED", shape: "none" });
    const { transport, sent } = fakeTransport();

    const result = await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    expect(result).toEqual({ status: "skipped", reason: "outcome" });
    expect(sent).toHaveLength(0);
    const saved = await row(outbound.id);
    expect(saved.state).toBe("SKIPPED");
    expect(saved.detail).toContain("IGNORED_UNAUTHORIZED");
  });

  it("EM-L10 — הודעה נכנסת בלי כתובת שולח אינה מייצרת מייל", async () => {
    const { outbound } = await seed({ fromAddress: null });
    const { transport, sent } = fakeTransport();

    const result = await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    expect(result).toEqual({ status: "skipped", reason: "no-recipient" });
    expect(sent).toHaveLength(0);
    expect((await row(outbound.id)).state).toBe("SKIPPED");
  });
});

describe("EM-A08 — טיוטה ששוגרה או נמחקה בין ההכרעה לשליחה", () => {
  it("EM-A08 — טיוטה ששוגרה בינתיים: המייל אינו נשלח, והדילוג נרשם", async () => {
    const { outbound, ticketId } = await seed();
    await db.ticket.update({ where: { id: ticketId as string }, data: { isDraft: false } });
    const { transport, sent } = fakeTransport();

    const result = await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    expect(result).toEqual({ status: "skipped", reason: "dispatched" });
    expect(sent).toHaveLength(0);
    const saved = await row(outbound.id);
    expect(saved.state).toBe("SKIPPED");
    expect(saved.detail).toContain("שוגרה");
  });

  it("EM-A08 — טיוטה שנמחקה בינתיים: המייל אינו נשלח, והדילוג נרשם", async () => {
    const { outbound } = await seed({ deleteTicket: true });
    const { transport, sent } = fakeTransport();

    const result = await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    expect(result).toEqual({ status: "skipped", reason: "deleted" });
    expect(sent).toHaveLength(0);
    const saved = await row(outbound.id);
    expect(saved.state).toBe("SKIPPED");
    expect(saved.detail).toContain("נמחקה");
  });

  it("EM-17 — 'כבר נשלחה' עצמו נשלח גם כשהטיוטה כבר אינה טיוטה", async () => {
    const { outbound } = await seed({ outcome: "REPLY_AFTER_DISPATCH", shape: "dispatched" });
    const { transport, sent } = fakeTransport();

    const result = await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    expect(result).toMatchObject({ status: "sent", template: "L05" });
    expect(sent).toHaveLength(1);
  });
});

describe("EM-12 — אידמפוטנטיות מול תיבה ששכחה לענות", () => {
  it("EM-12 — בניסיון ראשון אין שאלה לתיבה", async () => {
    const { outbound } = await seed();
    const source = fakeMailSource({ match: byRfcMessageId });
    const { transport, sent } = fakeTransport();

    await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: source, now: NOW });

    expect(source.calls).toHaveLength(0);
    expect(sent).toHaveLength(1);
  });

  it("EM-12 — ניסיון חוזר אחרי תשובה שאבדה אינו שולח מייל שני", async () => {
    const { outbound } = await seed();
    const messageId = intakeReplyMessageId(outbound.id);
    const failing = fakeTransport({ failTimes: 1 });
    const source = fakeMailSource({ match: byRfcMessageId });

    // הניסיון הראשון "נכשל" — אבל בפועל Gmail קיבל את ההודעה
    await expect(
      sendEmailReply({ mailboxMessageId: outbound.id }, { transport: failing.transport, mailSource: source, now: NOW }),
    ).rejects.toThrow();
    source.deliver(mailEnvelope({ id: "gmail-out-lost", messageId }));

    const retry = fakeTransport();
    const result = await sendEmailReply(
      { mailboxMessageId: outbound.id },
      { transport: retry.transport, mailSource: source, now: NOW },
    );

    expect(result).toEqual({ status: "found-in-mailbox", to: SENDER });
    expect(retry.sent).toHaveLength(0);
    const saved = await row(outbound.id);
    expect(saved.state).toBe("SENT");
    expect(saved.gmailMessageId).toBe("gmail-out-lost");
    expect(saved.rfcMessageId).toBe(messageId);
  });

  it("EM-12 — ניסיון חוזר כשההודעה אינה בתיבה כן שולח", async () => {
    const { outbound } = await seed();
    const failing = fakeTransport({ failTimes: 1 });
    const source = fakeMailSource({ match: byRfcMessageId });

    await expect(
      sendEmailReply({ mailboxMessageId: outbound.id }, { transport: failing.transport, mailSource: source, now: NOW }),
    ).rejects.toThrow();

    const retry = fakeTransport();
    const result = await sendEmailReply(
      { mailboxMessageId: outbound.id },
      { transport: retry.transport, mailSource: source, now: NOW },
    );

    expect(source.callsTo("listIds")).toHaveLength(1);
    expect(result).toMatchObject({ status: "sent" });
    expect(retry.sent).toHaveLength(1);
    expect((await row(outbound.id)).attempts).toBe(2);
  });

  it("EM-12 — כשל חולף בחיפוש דוחה את השליחה ואינו מסתכן בכפילות", async () => {
    const { outbound } = await seed();
    const failing = fakeTransport({ failTimes: 1 });
    const source = fakeMailSource({ match: byRfcMessageId });
    await expect(
      sendEmailReply({ mailboxMessageId: outbound.id }, { transport: failing.transport, mailSource: source, now: NOW }),
    ).rejects.toThrow();

    source.failNext({ method: "listIds", kind: "transient", status: 503 });
    const retry = fakeTransport();
    await expect(
      sendEmailReply({ mailboxMessageId: outbound.id }, { transport: retry.transport, mailSource: source, now: NOW }),
    ).rejects.toThrow(/503|כשל מתוכנן/);

    expect(retry.sent).toHaveLength(0);
    expect((await row(outbound.id)).state).toBe("PENDING");
  });

  it("EM-12 — כשל שלא ייפתר מעצמו בחיפוש אינו חוסם את המייל", async () => {
    const { outbound } = await seed();
    const failing = fakeTransport({ failTimes: 1 });
    const source = fakeMailSource({ match: byRfcMessageId });
    await expect(
      sendEmailReply({ mailboxMessageId: outbound.id }, { transport: failing.transport, mailSource: source, now: NOW }),
    ).rejects.toThrow();

    source.failNext({ method: "listIds", kind: "scope", status: 403 });
    const retry = fakeTransport();
    const result = await sendEmailReply(
      { mailboxMessageId: outbound.id },
      { transport: retry.transport, mailSource: source, now: NOW },
    );

    expect(result).toMatchObject({ status: "sent" });
    expect(retry.sent).toHaveLength(1);
  });
});

describe("EM-12 — מה שנרשם הוא מה שקרה", () => {
  it("EM-12 — ערוץ מדומה נרשם SIMULATED ולעולם לא SENT", async () => {
    const { outbound } = await seed();
    const { transport, sent } = fakeTransport({ simulated: true });

    const result = await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    expect(result).toMatchObject({ status: "sent", simulated: true });
    expect(sent).toHaveLength(1);
    const saved = await row(outbound.id);
    expect(saved.state).toBe("SIMULATED");
    // אין מזהה של הודעה בתיבה, כי אין הודעה בתיבה
    expect(saved.gmailMessageId).toBeNull();
    expect(saved.sentAt).toEqual(NOW);
  });

  it("EM-12 — כשל שליחה משאיר את השורה ממתינה, עם הסיבה", async () => {
    const { outbound } = await seed();
    const { transport, sent } = fakeTransport({ failTimes: 1 });

    await expect(
      sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW }),
    ).rejects.toThrow("שרת המייל אינו זמין");

    expect(sent).toHaveLength(0);
    const saved = await row(outbound.id);
    expect(saved.state).toBe("PENDING");
    expect(saved.attempts).toBe(1);
    expect(saved.detail).toContain("שרת המייל אינו זמין");
  });
});

describe("EM-12 — חמש הדקות נמדדות", () => {
  it("EM-12 — תשובה מעבר ל-300 שניות נרשמת כמאחרת", async () => {
    const { outbound } = await seed();
    const { transport } = fakeTransport();
    const late = new Date(ARRIVED_AT.getTime() + 301_000);

    const result = await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: late });

    expect(result).toMatchObject({ latencySec: 301 });
    expect(vi.mocked(logWarn).mock.calls.map((call) => call[0])).toContain("email.reply.late");
  });

  it("EM-12 — תשובה בדיוק בגבול אינה מאחרת", async () => {
    const { outbound } = await seed();
    const { transport } = fakeTransport();
    const onTime = new Date(ARRIVED_AT.getTime() + 300_000);

    const result = await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: onTime });

    expect(result).toMatchObject({ latencySec: 300 });
    expect(vi.mocked(logWarn).mock.calls.map((call) => call[0])).not.toContain("email.reply.late");
  });
});

/**
 * הצד השני של "הג׳וב חוזר": ניסיון אחרון שנכשל.
 *
 * בלי מצב סופי השורה נשארת PENDING לנצח — אין לה מסלול חזרה לתור
 * (`rescanStuck` מסונן לנכנס בלבד), והיא ממשיכה להיספר ב-invariant
 * `email-intake-not-stuck` בכל ריצה של ה-watchdog. אזעקה שאי אפשר לסגור
 * היא בדיוק מה ש-`predicates.ts` מנמק שאין לבנות.
 */
describe("EM-12 — תשובה שמיצתה את ניסיונותיה מקבלת מצב סופי", () => {
  /** ה-invariant של מודול E, כפי שה-watchdog מריץ אותו */
  function stuckCheck() {
    const check = checks.find((candidate) => candidate.name === "email-intake-not-stuck");
    if (!check) throw new Error("הבדיקה email-intake-not-stuck אינה קיימת");
    return check;
  }

  /**
   * אחרי חלון ה-30 דקות של ה-invariant. נמדד מהשעון האמיתי ולא מ-`NOW`,
   * כי `createdAt` של השורה נכתב בידי בסיס הנתונים.
   */
  const afterWindow = () => new Date(Date.now() + 31 * 60_000);

  it("EM-12 — ניסיון אחרון שנכשל נרשם FAILED עם הסיבה, וסוגר את ה-invariant", async () => {
    const { outbound } = await seed();
    const { transport } = fakeTransport({ failTimes: 1 });
    await expect(
      sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW }),
    ).rejects.toThrow();

    // כל עוד השורה ממתינה, ה-watchdog מתריע — וזו ההתרעה שאין דרך לסגור
    await expect(stuckCheck().run(afterWindow())).rejects.toThrow();

    await markReplyFailed({ mailboxMessageId: outbound.id }, new Error("שרת המייל אינו זמין"));

    const saved = await row(outbound.id);
    expect(saved.state).toBe("FAILED");
    expect(saved.detail).toContain("שרת המייל אינו זמין");
    expect(saved.nextAttemptAt).toBeNull();
    await expect(stuckCheck().run(afterWindow())).resolves.toBeUndefined();
  });

  it("EM-12 — שורה שכבר נשלחה אינה נדרסת ל-FAILED", async () => {
    const { outbound } = await seed();
    const { transport } = fakeTransport();
    await sendEmailReply({ mailboxMessageId: outbound.id }, { transport, mailSource: null, now: NOW });

    await markReplyFailed({ mailboxMessageId: outbound.id }, new Error("כשל מאוחר"));

    const saved = await row(outbound.id);
    expect(saved.state).toBe("SENT");
    expect(saved.detail).toBeNull();
  });

  it("EM-12 — גם מזהה ההודעה הנכנסת מסמן את השורה היוצאת", async () => {
    const { inbound, outbound } = await seed();

    await markReplyFailed({ mailboxMessageId: inbound.id }, new Error("סוג עבודה לא מוכר"));

    expect((await row(outbound.id)).state).toBe("FAILED");
    // ההודעה הנכנסת עצמה אינה נוגעת בזה — היא כבר הוכרעה
    expect((await row(inbound.id)).state).toBe("DONE");
  });

  it("EM-12 — שורה שאינה קיימת אינה מפילה את הסימון", async () => {
    await expect(markReplyFailed({ mailboxMessageId: "no-such-row" }, new Error("x"))).resolves.toBeUndefined();
  });
});
