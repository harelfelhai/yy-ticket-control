import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  canViewCorrespondence,
  getTicketCorrespondence,
} from "@/lib/services/email-correspondence";
import type { SessionUser } from "@/lib/session";
import { toViewer } from "@/lib/session";
import type { Viewer } from "@/lib/permissions";
import { resetDb } from "../helpers/reset-db";

/**
 * התכתבות המייל (S7, מודול K) מול בסיס נתונים אמיתי — EM-M01, §3.1.
 *
 * מה שנבדק כאן ואי אפשר לבדוק ביחידה: הרשאת צפייה אמיתית מול `Assignment`,
 * הסדר בפועל של שורות משני הכיוונים, וסינון `PENDING` דרך השאילתה ולא
 * ביד.
 */

let admin: SessionUser;
let manager: SessionUser; // מנהל אתר א — פותח הפנייה
let otherManager: SessionUser; // מנהל אתר ב — לא אמור לראות
let siteId: string;
let otherSiteId: string;
let contractorId: string;
let strangerContractorId: string;

beforeEach(async () => {
  await resetDb();

  siteId = (await db.site.create({ data: { name: "גני אלון" } })).id;
  otherSiteId = (await db.site.create({ data: { name: "נווה שקד" } })).id;

  contractorId = (
    await db.professional.create({ data: { name: "יוסי אינסטלציה", phone: "0501111111" } })
  ).id;
  strangerContractorId = (
    await db.professional.create({ data: { name: "קבלן זר", phone: "0502222222" } })
  ).id;

  const adminRow = await db.user.create({
    data: { role: "ADMIN", name: "מנהלת מערכת", phone: "0500000000", passwordHash: "x" },
  });
  admin = { id: adminRow.id, name: adminRow.name, role: adminRow.role, siteId: adminRow.siteId };

  const managerRow = await db.user.create({
    data: { role: "SITE_MANAGER", name: "מנהל גני אלון", phone: "0500000001", passwordHash: "x", siteId },
  });
  manager = { id: managerRow.id, name: managerRow.name, role: managerRow.role, siteId: managerRow.siteId };

  const otherRow = await db.user.create({
    data: {
      role: "SITE_MANAGER",
      name: "מנהל נווה שקד",
      phone: "0500000002",
      passwordHash: "x",
      siteId: otherSiteId,
    },
  });
  otherManager = {
    id: otherRow.id,
    name: otherRow.name,
    role: otherRow.role,
    siteId: otherRow.siteId,
  };
});

afterAll(async () => {
  await db.$disconnect();
});

const managerViewer = (): Viewer => toViewer(manager);
const otherManagerViewer = (): Viewer => toViewer(otherManager);
const adminViewer = (): Viewer => toViewer(admin);

/** טיוטת מייל בסיסית, פתוחה על ידי `manager` באתר `siteId` */
async function emailDraftTicket(overrides: Record<string, unknown> = {}) {
  return db.ticket.create({
    data: {
      channel: "EMAIL",
      isDraft: true,
      siteId,
      createdById: manager.id,
      description: "נזילה במקלחת",
      ...overrides,
    },
  });
}

describe("getTicketCorrespondence", () => {
  it("EM-M01 — מחזירה null לפנייה שאינה קיימת", async () => {
    await expect(getTicketCorrespondence(managerViewer(), "no-such-ticket")).resolves.toBeNull();
  });

  it("EM-M01 — מחזירה [] לפנייה קיימת בלי שרשרת מייל (פנייה שלא נפתחה במייל)", async () => {
    const ticket = await db.ticket.create({
      data: {
        channel: "SELF",
        siteId,
        createdById: manager.id,
        description: "אין חשמל בחדר מדרגות",
      },
    });

    await expect(getTicketCorrespondence(managerViewer(), ticket.id)).resolves.toEqual([]);
  });

  it("EM-M01 — מחזירה [] לטיוטת מייל שעדיין אין לה MailThread", async () => {
    // תרחיש תיאורטי (בפועל `createEmailDraft` תמיד יוצר thread), אבל
    // הפונקציה לא אמורה להניח את קיומו.
    const ticket = await emailDraftTicket();
    await expect(getTicketCorrespondence(managerViewer(), ticket.id)).resolves.toEqual([]);
  });

  it("EM-M01 — מחזירה null לצופה שאינו רשאי לראות את הפנייה", async () => {
    const ticket = await emailDraftTicket();
    await db.mailThread.create({ data: { ticketId: ticket.id } });

    // מנהל אתר אחר, בלי שיוך — לא רשאי לראות פנייה של גני אלון
    await expect(getTicketCorrespondence(otherManagerViewer(), ticket.id)).resolves.toBeNull();
  });

  it("EM-M01 — מחזירה null לקבלן שאינו משויך לפנייה", async () => {
    const ticket = await emailDraftTicket();
    await db.mailThread.create({ data: { ticketId: ticket.id } });

    const strangerViewer: Viewer = { kind: "professional", id: strangerContractorId };
    await expect(getTicketCorrespondence(strangerViewer, ticket.id)).resolves.toBeNull();
  });

  it("EM-M01 — מציגה לקבלן משויך את ההתכתבות, וכוללת קובץ מצורף בצורה הנכונה", async () => {
    const ticket = await emailDraftTicket();
    const thread = await db.mailThread.create({ data: { ticketId: ticket.id } });
    await db.assignment.create({
      data: { ticketId: ticket.id, professionalId: contractorId, status: "SENT" },
    });

    const inbound = await db.mailboxMessage.create({
      data: {
        direction: "INBOUND",
        state: "DONE",
        outcome: "DRAFT_CREATED",
        threadId: thread.id,
        fromAddress: "dana@example.com",
        fromName: "דנה כהן",
        toAddress: "office@example.com",
        subject: "תקלה: נזילה במקלחת",
        bodyText: "יש נזילה מתחת לכיור",
        receivedAt: new Date("2026-09-16T07:12:00.000Z"),
      },
    });

    const media = await db.mediaFile.create({
      data: { storageKey: "media/2026/09/photo.jpg", mimeType: "image/jpeg", sizeBytes: 1024, uploaded: true },
    });

    await db.mailboxAttachment.create({
      data: {
        messageId: inbound.id,
        partIndex: 0,
        filename: "photo.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1024,
        sha256: "abc123",
        storageKey: "media/2026/09/photo.jpg",
        isMedia: true,
        mediaFileId: media.id,
      },
    });

    const strangerViewer: Viewer = { kind: "professional", id: contractorId };
    const result = await getTicketCorrespondence(strangerViewer, ticket.id);

    expect(result).toHaveLength(1);
    expect(result?.[0]).toMatchObject({
      id: inbound.id,
      direction: "INBOUND",
      state: "DONE",
      outcome: "DRAFT_CREATED",
      fromAddress: "dana@example.com",
      subject: "תקלה: נזילה במקלחת",
      bodyText: "יש נזילה מתחת לכיור",
    });
    expect(result?.[0].attachments).toEqual([
      {
        id: expect.any(String),
        filename: "photo.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1024,
        isMedia: true,
        mediaFileId: media.id,
        skippedReason: null,
      },
    ]);
  });

  it("EM-M01 — מסדרת לפי createdAt, על פני שני הכיוונים", async () => {
    const ticket = await emailDraftTicket();
    const thread = await db.mailThread.create({ data: { ticketId: ticket.id } });

    // נכתבות בכוונה בסדר הפוך לסדר הכרונולוגי הרצוי, ו-createdAt נקבע ידנית
    // כדי שהבדיקה תדע בוודאות איזו שורה "קדמה" לאיזו.
    const third = await db.mailboxMessage.create({
      data: {
        direction: "OUTBOUND",
        state: "SENT",
        threadId: thread.id,
        toAddress: "dana@example.com",
        subject: "עדכון על הפנייה שלך",
        bodyText: "קיבלנו את התשובה שלך",
        sentAt: new Date("2026-09-18T07:00:00.000Z"),
        createdAt: new Date("2026-09-18T06:41:00.000Z"),
      },
    });
    const second = await db.mailboxMessage.create({
      data: {
        direction: "INBOUND",
        state: "DONE",
        outcome: "REPLY_APPLIED",
        threadId: thread.id,
        fromAddress: "dana@example.com",
        bodyText: "עוד פרט: זה בבניין ב",
        receivedAt: new Date("2026-09-18T06:40:00.000Z"),
        createdAt: new Date("2026-09-18T06:40:30.000Z"),
      },
    });
    const first = await db.mailboxMessage.create({
      data: {
        direction: "INBOUND",
        state: "DONE",
        outcome: "DRAFT_CREATED",
        threadId: thread.id,
        fromAddress: "dana@example.com",
        subject: "תקלה: נזילה",
        bodyText: "יש נזילה",
        receivedAt: new Date("2026-09-16T07:12:00.000Z"),
        createdAt: new Date("2026-09-16T07:12:05.000Z"),
      },
    });

    const result = await getTicketCorrespondence(managerViewer(), ticket.id);

    expect(result?.map((m) => m.id)).toEqual([first.id, second.id, third.id]);
  });

  it("EM-M01 — משמיטה הודעה שעדיין PENDING בשני הכיוונים", async () => {
    const ticket = await emailDraftTicket();
    const thread = await db.mailThread.create({ data: { ticketId: ticket.id } });

    // נכנסת שעדיין לא הוכרעה (ממתינה לניסיון הבא מול Gmail/מחלץ)
    await db.mailboxMessage.create({
      data: {
        direction: "INBOUND",
        state: "PENDING",
        threadId: thread.id,
        fromAddress: "dana@example.com",
      },
    });

    // יוצאת שתוזמנה לשליחה אך עוד לא נשלחה — `scheduleReply` לא כותב לה
    // נושא או גוף, ולכן אין לה מה להציג
    const decided = await db.mailboxMessage.create({
      data: {
        direction: "INBOUND",
        state: "DONE",
        outcome: "DRAFT_CREATED",
        threadId: thread.id,
        fromAddress: "dana@example.com",
        subject: "תקלה",
        bodyText: "יש נזילה",
        receivedAt: new Date("2026-09-16T07:12:00.000Z"),
      },
    });
    await db.mailboxMessage.create({
      data: {
        direction: "OUTBOUND",
        state: "PENDING",
        threadId: thread.id,
        repliesToId: decided.id,
        toAddress: "dana@example.com",
      },
    });

    const result = await getTicketCorrespondence(managerViewer(), ticket.id);

    expect(result?.map((m) => m.id)).toEqual([decided.id]);
  });

  it("EM-M01 — כוללת תשובה שלא נקלטה (IGNORED_UNAUTHORIZED) — היא עדיין קרתה", async () => {
    const ticket = await emailDraftTicket();
    const thread = await db.mailThread.create({ data: { ticketId: ticket.id } });

    const stranger = await db.mailboxMessage.create({
      data: {
        direction: "INBOUND",
        state: "DONE",
        outcome: "IGNORED_UNAUTHORIZED",
        threadId: thread.id,
        fromAddress: "contractor@vendor.example.com",
        fromName: "קבלן שהיה בהעתק",
        receivedAt: new Date("2026-09-18T06:40:00.000Z"),
        // כלל: הודעה שהתעלמו ממנה נשמרת בלי כותרת ובלי גוף
      },
    });

    const result = await getTicketCorrespondence(managerViewer(), ticket.id);

    expect(result?.map((m) => m.id)).toEqual([stranger.id]);
    expect(result?.[0]).toMatchObject({ subject: null, bodyText: null, outcome: "IGNORED_UNAUTHORIZED" });
  });

  it("EM-M01 · EM-A08 — כוללת מייל חוזר שדולג במפורש (SKIPPED, §7 #77)", async () => {
    const ticket = await emailDraftTicket();
    const thread = await db.mailThread.create({ data: { ticketId: ticket.id } });

    const skipped = await db.mailboxMessage.create({
      data: {
        direction: "OUTBOUND",
        state: "SKIPPED",
        threadId: thread.id,
        toAddress: "dana@example.com",
        detail: "הטיוטה שוגרה לפני שהמייל החוזר יצא",
      },
    });

    const result = await getTicketCorrespondence(managerViewer(), ticket.id);

    expect(result?.map((m) => m.id)).toEqual([skipped.id]);
    expect(result?.[0].state).toBe("SKIPPED");
  });

  it("EM-M01 — מנהל מערכת רואה את ההתכתבות של כל אתר", async () => {
    const ticket = await emailDraftTicket();
    const thread = await db.mailThread.create({ data: { ticketId: ticket.id } });
    await db.mailboxMessage.create({
      data: {
        direction: "INBOUND",
        state: "DONE",
        outcome: "DRAFT_CREATED",
        threadId: thread.id,
        fromAddress: "dana@example.com",
        subject: "תקלה",
        bodyText: "יש נזילה",
        receivedAt: new Date(),
      },
    });

    const result = await getTicketCorrespondence(adminViewer(), ticket.id);
    expect(result).toHaveLength(1);
  });
});

describe("canViewCorrespondence", () => {
  it("EM-M01 — canViewCorrespondence: false לפנייה שאינה קיימת", async () => {
    await expect(canViewCorrespondence(managerViewer(), "no-such-ticket")).resolves.toBe(false);
  });

  it("EM-M01 — canViewCorrespondence: true למנהל האתר, false למנהל אתר אחר", async () => {
    const ticket = await emailDraftTicket();

    await expect(canViewCorrespondence(managerViewer(), ticket.id)).resolves.toBe(true);
    await expect(canViewCorrespondence(otherManagerViewer(), ticket.id)).resolves.toBe(false);
  });

  it("EM-M01 — canViewCorrespondence: true לקבלן עם שיוך פעיל, false לקבלן שהוסר", async () => {
    const ticket = await emailDraftTicket();
    const assignment = await db.assignment.create({
      data: { ticketId: ticket.id, professionalId: contractorId, status: "SENT" },
    });

    const contractorViewer: Viewer = { kind: "professional", id: contractorId };
    await expect(canViewCorrespondence(contractorViewer, ticket.id)).resolves.toBe(true);

    await db.assignment.update({ where: { id: assignment.id }, data: { status: "REMOVED" } });
    await expect(canViewCorrespondence(contractorViewer, ticket.id)).resolves.toBe(false);
  });
});
