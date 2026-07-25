import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import type { Viewer } from "@/lib/permissions";
import {
  addAssignments,
  addMessage,
  closeTicket,
  createTicket,
  deleteTicket,
  removeAssignment,
  reopenTicket,
  setAssignmentStatus,
  setHandler,
  updateResidentName,
  updateTicketFields,
} from "@/lib/services/tickets";
import { ensurePortalLink, resolveToken } from "@/lib/services/portal";
import type { SessionUser } from "@/lib/session";
import { deriveTicketStatus } from "@/lib/ticket-status";
import { resetDb } from "../helpers/reset-db";

let opener: SessionUser;
let otherManager: SessionUser;
let admin: SessionUser;
let siteId: string;
let base: Record<string, string>;
let electrician: string;
let plumber: string;

const asUser = (u: SessionUser): Viewer => ({
  kind: "user",
  id: u.id,
  role: u.role,
  siteId: u.siteId,
});

beforeEach(async () => {
  await resetDb();

  const site = await db.site.create({ data: { name: "אתר" } });
  siteId = site.id;
  const building = await db.building.create({ data: { siteId, name: "בניין א" } });
  const apartment = await db.apartment.create({ data: { buildingId: building.id, number: "7" } });
  const domain = await db.domain.create({ data: { name: "חשמל" } });
  base = { buildingId: building.id, apartmentId: apartment.id, domainId: domain.id };

  electrician = (await db.professional.create({ data: { name: "יוסי", phone: "0501111111" } })).id;
  plumber = (await db.professional.create({ data: { name: "משה", phone: "0502222222" } })).id;

  const mk = async (name: string, phone: string, role: "SITE_MANAGER" | "ADMIN") => {
    const user = await db.user.create({
      data: {
        role,
        name,
        phone,
        passwordHash: "x",
        siteId: role === "SITE_MANAGER" ? siteId : null,
      },
    });
    return { id: user.id, name: user.name, role: user.role, siteId: user.siteId };
  };

  opener = await mk("דוד", "0500000001", "SITE_MANAGER");
  otherManager = await mk("רון", "0500000002", "SITE_MANAGER");
  admin = await mk("מנהל", "0500000003", "ADMIN");
});

afterAll(async () => {
  await db.$disconnect();
});

async function makeTicket(recipientIds: string[] = [electrician]) {
  const { ticket } = await createTicket(opener, {
    siteId,
    ...base,
    description: "אין חשמל",
    recipients: recipientIds.map((id) => ({ kind: "professional" as const, id })),
  });
  return ticket;
}

async function statusOf(ticketId: string) {
  const ticket = await db.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: { assignments: true },
  });
  return deriveTicketStatus(
    ticket,
    ticket.assignments.map((a) => ({ status: a.status, recipientName: "" })),
  );
}

describe("addMessage", () => {
  it("מוסיף תגובה ומעדכן את זמן התנועה האחרון", async () => {
    const ticket = await makeTicket();
    const before = ticket.lastActivityAt;

    await new Promise((r) => setTimeout(r, 5));
    await addMessage(asUser(opener), ticket.id, "בדקתי, צריך להחליף מפסק");

    const updated = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.lastActivityAt.getTime()).toBeGreaterThan(before.getTime());
  });

  it("מנקה את סימון ההסלמה — פנייה שקרה בה משהו אינה תקועה", async () => {
    const ticket = await makeTicket();
    await db.ticket.update({ where: { id: ticket.id }, data: { escalated: true } });

    await addMessage(asUser(opener), ticket.id, "מטפל");

    const updated = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.escalated).toBe(false);
  });

  it("מסמן אוטומטית את המנהל שכתב כמטפל", async () => {
    const ticket = await makeTicket();
    await addMessage(asUser(otherManager), ticket.id, "אני מטפל בזה");

    const updated = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.handlerId).toBe(otherManager.id);
  });

  it("אינו מחליף מטפל קיים — שני מנהלים לא 'גונבים' את הסימון זה מזה", async () => {
    const ticket = await makeTicket();
    await addMessage(asUser(otherManager), ticket.id, "אני מטפל");
    await addMessage(asUser(opener), ticket.id, "תודה");

    const updated = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.handlerId).toBe(otherManager.id);
  });

  it("דוחה הודעה ריקה", async () => {
    const ticket = await makeTicket();
    await expect(addMessage(asUser(opener), ticket.id, "   ")).rejects.toThrow(
      he.ticket.emptyMessage,
    );
  });

  it("מנהל עבודה מאתר אחר אינו רשאי להגיב", async () => {
    const otherSite = await db.site.create({ data: { name: "אתר אחר" } });
    const stranger = await db.user.create({
      data: {
        role: "SITE_MANAGER",
        name: "זר",
        phone: "0509999999",
        passwordHash: "x",
        siteId: otherSite.id,
      },
    });
    const ticket = await makeTicket();

    await expect(
      addMessage(
        { kind: "user", id: stranger.id, role: "SITE_MANAGER", siteId: otherSite.id },
        ticket.id,
        "שלום",
      ),
    ).rejects.toThrow(he.common.notAllowed);
  });

  it("נמען שהוסר אינו יכול להגיב", async () => {
    const ticket = await makeTicket();
    const assignment = await db.assignment.findFirstOrThrow({ where: { ticketId: ticket.id } });
    await removeAssignment(asUser(opener), assignment.id);

    await expect(
      addMessage({ kind: "professional", id: electrician }, ticket.id, "עדיין כאן?"),
    ).rejects.toThrow(he.common.notAllowed);
  });
});

describe("setHandler", () => {
  it("מסמן מטפל ורושם אירוע בשרשור", async () => {
    const ticket = await makeTicket();
    await setHandler(asUser(otherManager), ticket.id);

    const updated = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.handlerId).toBe(otherManager.id);

    const event = await db.message.findFirstOrThrow({
      where: { ticketId: ticket.id, eventType: "HANDLER_SET" },
    });
    expect(event.eventMeta).toMatchObject({ userName: "רון" });
  });

  it("נמען אינו יכול לסמן את עצמו כמטפל", async () => {
    const ticket = await makeTicket();
    await expect(
      setHandler({ kind: "professional", id: electrician }, ticket.id),
    ).rejects.toThrow(he.common.notAllowed);
  });
});

describe("closeTicket", () => {
  it("הפותח סוגר", async () => {
    const ticket = await makeTicket();
    await closeTicket(asUser(opener), ticket.id);

    const updated = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.closedAt).not.toBeNull();
    expect(updated.closedById).toBe(opener.id);
    expect(await statusOf(ticket.id)).toBe("CLOSED");
  });

  it("מנהל מערכת סוגר פנייה שלא פתח", async () => {
    const ticket = await makeTicket();
    await closeTicket(asUser(admin), ticket.id);
    expect(await statusOf(ticket.id)).toBe("CLOSED");
  });

  it("מנהל עבודה אחר באותו אתר אינו סוגר פנייה שלא פתח", async () => {
    const ticket = await makeTicket();
    await expect(closeTicket(asUser(otherManager), ticket.id)).rejects.toThrow(
      he.common.notAllowed,
    );
  });

  it("נמען לעולם אינו סוגר, גם אחרי שסימן טופל", async () => {
    const ticket = await makeTicket();
    const assignment = await db.assignment.findFirstOrThrow({ where: { ticketId: ticket.id } });
    await setAssignmentStatus(assignment.id, "DONE");

    await expect(
      closeTicket({ kind: "professional", id: electrician }, ticket.id),
    ).rejects.toThrow(he.common.notAllowed);
    expect(await statusOf(ticket.id)).toBe("AWAITING_OPENER_APPROVAL");
  });

  it("סגירה חוזרת אינה משנה דבר ואינה זורקת", async () => {
    const ticket = await makeTicket();
    await closeTicket(asUser(opener), ticket.id);
    const first = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });

    await closeTicket(asUser(opener), ticket.id);
    const second = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });

    expect(second.closedAt?.getTime()).toBe(first.closedAt?.getTime());
  });
});

describe("reopenTicket", () => {
  it("מאפס את כל השיוכים הפעילים ל'נשלח'", async () => {
    // פתיחה מחדש פירושה שהעבודה לא הושלמה. "טופל" ישן היה גורם לפנייה
    // להיראות מיד כ"ממתין לאישור" ולהסתיר את העובדה שהיא חזרה לקבלנים.
    const ticket = await makeTicket([electrician, plumber]);
    for (const a of await db.assignment.findMany({ where: { ticketId: ticket.id } })) {
      await setAssignmentStatus(a.id, "DONE");
    }
    await closeTicket(asUser(opener), ticket.id);

    await reopenTicket(asUser(opener), ticket.id);

    const assignments = await db.assignment.findMany({ where: { ticketId: ticket.id } });
    expect(assignments.every((a) => a.status === "SENT")).toBe(true);
    expect(assignments.every((a) => a.viewedAt === null)).toBe(true);
    expect(await statusOf(ticket.id)).toBe("NEW");
  });

  it("שיוך שהוסר נשאר מוסר — ההסרה הייתה החלטה נפרדת", async () => {
    const ticket = await makeTicket([electrician, plumber]);
    const [first] = await db.assignment.findMany({ where: { ticketId: ticket.id } });
    await removeAssignment(asUser(opener), first!.id);
    await closeTicket(asUser(opener), ticket.id);

    await reopenTicket(asUser(opener), ticket.id);

    const removed = await db.assignment.findUniqueOrThrow({ where: { id: first!.id } });
    expect(removed.status).toBe("REMOVED");
  });

  it("סופר את מספר הפתיחות מחדש", async () => {
    const ticket = await makeTicket();
    await closeTicket(asUser(opener), ticket.id);
    await reopenTicket(asUser(opener), ticket.id);
    await closeTicket(asUser(opener), ticket.id);
    await reopenTicket(asUser(opener), ticket.id);

    const updated = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.reopenCount).toBe(2);
  });

  it("פתיחה מחדש שמורה לאותם אנשים כמו הסגירה", async () => {
    const ticket = await makeTicket();
    await closeTicket(asUser(opener), ticket.id);
    await expect(reopenTicket(asUser(otherManager), ticket.id)).rejects.toThrow(
      he.common.notAllowed,
    );
  });
});

describe("addAssignments", () => {
  it("מוסיף נמען לפנייה קיימת", async () => {
    const ticket = await makeTicket();
    await addAssignments(asUser(opener), ticket.id, [{ kind: "professional", id: plumber }]);

    const assignments = await db.assignment.findMany({ where: { ticketId: ticket.id } });
    expect(assignments).toHaveLength(2);
  });

  it("אינו מוסיף נמען שכבר משויך", async () => {
    const ticket = await makeTicket();
    await addAssignments(asUser(opener), ticket.id, [{ kind: "professional", id: electrician }]);
    expect(await db.assignment.count({ where: { ticketId: ticket.id } })).toBe(1);
  });

  it("החזרת נמען שהוסר משתמשת בשיוך הישן ואינה יוצרת שורה כפולה", async () => {
    const ticket = await makeTicket();
    const assignment = await db.assignment.findFirstOrThrow({ where: { ticketId: ticket.id } });
    await removeAssignment(asUser(opener), assignment.id);

    await addAssignments(asUser(opener), ticket.id, [{ kind: "professional", id: electrician }]);

    const assignments = await db.assignment.findMany({ where: { ticketId: ticket.id } });
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.status).toBe("SENT");
  });

  it("מנהל עבודה מאתר אחר אינו רשאי לשייך", async () => {
    const otherSite = await db.site.create({ data: { name: "אתר אחר" } });
    const ticket = await makeTicket();

    await expect(
      addAssignments({ kind: "user", id: "x", role: "SITE_MANAGER", siteId: otherSite.id }, ticket.id, [
        { kind: "professional", id: plumber },
      ]),
    ).rejects.toThrow(he.common.notAllowed);
  });
});

describe("removeAssignment", () => {
  it("מסמן כמוסר ואינו מוחק — ההיסטוריה נשמרת", async () => {
    const ticket = await makeTicket();
    const assignment = await db.assignment.findFirstOrThrow({ where: { ticketId: ticket.id } });

    await removeAssignment(asUser(opener), assignment.id);

    const updated = await db.assignment.findUniqueOrThrow({ where: { id: assignment.id } });
    expect(updated.status).toBe("REMOVED");
    expect(await db.assignment.count({ where: { ticketId: ticket.id } })).toBe(1);
  });

  it("מוציא את הנמען מחישוב הסטטוס", async () => {
    const ticket = await makeTicket([electrician, plumber]);
    const [first, second] = await db.assignment.findMany({ where: { ticketId: ticket.id } });
    await setAssignmentStatus(second!.id, "DONE");
    expect(await statusOf(ticket.id)).toBe("PARTIAL");

    await removeAssignment(asUser(opener), first!.id);

    // אחרי ההסרה נשאר נמען אחד וסיים — הפנייה ממתינה לאישור.
    expect(await statusOf(ticket.id)).toBe("AWAITING_OPENER_APPROVAL");
  });
});

describe("setAssignmentStatus", () => {
  it("סימון טופל של אחד מתוך שניים משאיר את הפנייה בטיפול חלקי", async () => {
    const ticket = await makeTicket([electrician, plumber]);
    const [first] = await db.assignment.findMany({ where: { ticketId: ticket.id } });
    await setAssignmentStatus(first!.id, "DONE");

    expect(await statusOf(ticket.id)).toBe("PARTIAL");
  });

  it("שאלה של נמען אחד גוברת על טופל של השני", async () => {
    const ticket = await makeTicket([electrician, plumber]);
    const [first, second] = await db.assignment.findMany({ where: { ticketId: ticket.id } });
    await setAssignmentStatus(first!.id, "DONE");
    await setAssignmentStatus(second!.id, "QUESTION");

    expect(await statusOf(ticket.id)).toBe("AWAITING_OPENER_QUESTION");
  });

  it("צפייה אינה נחשבת תנועה לעניין ההסלמה", async () => {
    // זו הנקודה שבגללה כלל ההסלמה שונה מהאפיון המקורי: קבלן שפותח את
    // הקישור ולא עושה דבר אינו מזיז את הפנייה.
    const ticket = await makeTicket();
    await db.ticket.update({ where: { id: ticket.id }, data: { escalated: true } });
    const assignment = await db.assignment.findFirstOrThrow({ where: { ticketId: ticket.id } });

    await setAssignmentStatus(assignment.id, "VIEWED");

    const updated = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.escalated).toBe(true);
  });

  it("סימון טופל כן נחשב תנועה", async () => {
    const ticket = await makeTicket();
    await db.ticket.update({ where: { id: ticket.id }, data: { escalated: true } });
    const assignment = await db.assignment.findFirstOrThrow({ where: { ticketId: ticket.id } });

    await setAssignmentStatus(assignment.id, "DONE");

    const updated = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.escalated).toBe(false);
  });

  it("צפייה אינה מדרדרת סטטוס מתקדם יותר", async () => {
    // קבלן שסימן טופל ואז פתח שוב את הקישור לא אמור לאבד את הדיווח שלו.
    const ticket = await makeTicket();
    const assignment = await db.assignment.findFirstOrThrow({ where: { ticketId: ticket.id } });
    await setAssignmentStatus(assignment.id, "DONE");

    await setAssignmentStatus(assignment.id, "VIEWED");

    const updated = await db.assignment.findUniqueOrThrow({ where: { id: assignment.id } });
    expect(updated.status).toBe("DONE");
  });

  it("נמען אינו יכול לעדכן סטטוס בפנייה סגורה", async () => {
    const ticket = await makeTicket();
    const assignment = await db.assignment.findFirstOrThrow({ where: { ticketId: ticket.id } });
    await closeTicket(asUser(opener), ticket.id);

    await expect(setAssignmentStatus(assignment.id, "DONE")).rejects.toThrow(
      he.notices.closedTicketBlocked,
    );
  });

  it("נמען שהוסר אינו יכול לעדכן סטטוס", async () => {
    const ticket = await makeTicket();
    const assignment = await db.assignment.findFirstOrThrow({ where: { ticketId: ticket.id } });
    await removeAssignment(asUser(opener), assignment.id);

    await expect(setAssignmentStatus(assignment.id, "DONE")).rejects.toThrow(
      he.common.notAllowed,
    );
  });

  it("רושם אירוע בשרשור עם שם הנמען", async () => {
    const ticket = await makeTicket();
    const assignment = await db.assignment.findFirstOrThrow({ where: { ticketId: ticket.id } });
    await setAssignmentStatus(assignment.id, "QUESTION");

    const event = await db.message.findFirstOrThrow({
      where: { ticketId: ticket.id, eventType: "QUESTION" },
    });
    expect(event.eventMeta).toMatchObject({ recipientName: "יוסי" });
  });
});

describe("מחזור חיים מלא", () => {
  it("יצירה → שניים משויכים → אחד סיים ואחד שאל → מענה → סגירה → פתיחה מחדש", async () => {
    const ticket = await makeTicket([electrician, plumber]);
    expect(await statusOf(ticket.id)).toBe("NEW");

    const [a, b] = await db.assignment.findMany({ where: { ticketId: ticket.id } });

    await setAssignmentStatus(a!.id, "VIEWED");
    expect(await statusOf(ticket.id)).toBe("VIEWED");

    await setAssignmentStatus(a!.id, "DONE");
    expect(await statusOf(ticket.id)).toBe("PARTIAL");

    await setAssignmentStatus(b!.id, "QUESTION");
    expect(await statusOf(ticket.id)).toBe("AWAITING_OPENER_QUESTION");

    await addMessage(asUser(opener), ticket.id, "תיאום להיום ב-14:00");
    await setAssignmentStatus(b!.id, "DONE");
    expect(await statusOf(ticket.id)).toBe("AWAITING_OPENER_APPROVAL");

    await closeTicket(asUser(opener), ticket.id);
    expect(await statusOf(ticket.id)).toBe("CLOSED");

    await reopenTicket(asUser(opener), ticket.id);
    expect(await statusOf(ticket.id)).toBe("NEW");
  });
});

describe("deleteTicket — למנהל מערכת בלבד, לכפילות", () => {
  it("מנהל מערכת מוחק פנייה עם כל השרשור והשיוכים", async () => {
    const ticket = await makeTicket();
    await addMessage(asUser(opener), ticket.id, "הערה");

    await deleteTicket(asUser(admin), ticket.id);

    expect(await db.ticket.findUnique({ where: { id: ticket.id } })).toBeNull();
    // ה-cascade ניקה את השיוכים וההודעות.
    expect(await db.assignment.count({ where: { ticketId: ticket.id } })).toBe(0);
    expect(await db.message.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  it("הפותח עצמו אינו מוחק — מחיקה שמורה למנהל המערכת", async () => {
    const ticket = await makeTicket();
    await expect(deleteTicket(asUser(opener), ticket.id)).rejects.toThrow(he.common.notAllowed);
    // הפנייה נשארה.
    expect(await db.ticket.findUnique({ where: { id: ticket.id } })).not.toBeNull();
  });

  it("מבטל את קישור הקבלן אם המחיקה הותירה אותו בלי שיוכים", async () => {
    const ticket = await makeTicket([electrician]);
    const link = await ensurePortalLink(electrician);
    const token = link.split("/p/")[1] as string;
    expect(await resolveToken(token)).not.toBeNull();

    await deleteTicket(asUser(admin), ticket.id);

    // הקבלן היה משויך רק לפנייה שנמחקה — הקישור מת.
    expect(await resolveToken(token)).toBeNull();
  });
});

describe("טיוטה — שיוך וסגירה חסומים", () => {
  async function makeDraft() {
    const { ticket } = await createTicket(opener, {
      siteId,
      ...base,
      description: "אין חשמל",
      recipients: [{ kind: "professional", id: electrician }],
      saveAsDraft: true,
    });
    return ticket;
  }

  it("הוספת נמען לטיוטה נחסמת — ואינה יוצרת ג'וב התראה", async () => {
    const draft = await makeDraft();

    await expect(
      addAssignments(asUser(opener), draft.id, [{ kind: "professional", id: plumber }]),
    ).rejects.toThrow(he.ticket.draftNoRecipientEdit);

    // הכשל הקריטי שהבדיקה מקבעת: טיוטה לא שולחת התראה לאיש.
    expect(await db.job.count()).toBe(0);
    expect(await db.assignment.count({ where: { ticketId: draft.id } })).toBe(0);
  });

  it("סגירת טיוטה נחסמת — משגרים או מוחקים, לא סוגרים", async () => {
    const draft = await makeDraft();
    await expect(closeTicket(asUser(opener), draft.id)).rejects.toThrow(he.ticket.cannotCloseDraft);

    const unchanged = await db.ticket.findUniqueOrThrow({ where: { id: draft.id } });
    expect(unchanged.closedAt).toBeNull();
  });
});

describe("updateTicketFields", () => {
  it("מעדכן תיאור ותחום ורושם אירוע בשרשור עם השדות שהשתנו", async () => {
    const ticket = await makeTicket();
    const newDomain = await db.domain.create({ data: { name: "אינסטלציה" } });

    await updateTicketFields(asUser(opener), ticket.id, {
      description: "התיאור המעודכן",
      domainId: newDomain.id,
    });

    const updated = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.description).toBe("התיאור המעודכן");
    expect(updated.domainId).toBe(newDomain.id);

    const event = await db.message.findFirstOrThrow({
      where: { ticketId: ticket.id, kind: "EVENT", eventType: "FIELDS_EDITED" },
    });
    expect(event.eventMeta).toMatchObject({ fields: `${he.directory.domain}, ${he.ticket.description}` });
  });

  it("לא רושם אירוע כשדבר לא השתנה בפועל", async () => {
    const ticket = await makeTicket();
    await updateTicketFields(asUser(opener), ticket.id, { description: "אין חשמל" });

    const events = await db.message.count({
      where: { ticketId: ticket.id, kind: "EVENT", eventType: "FIELDS_EDITED" },
    });
    expect(events).toBe(0);
  });

  it("מנהל עבודה מאתר אחר אינו רשאי לערוך שדות", async () => {
    const ticket = await makeTicket();
    const otherSite = await db.site.create({ data: { name: "אתר אחר" } });
    const stranger: Viewer = {
      kind: "user",
      id: (
        await db.user.create({
          data: {
            role: "SITE_MANAGER",
            name: "זר",
            phone: "0508888888",
            passwordHash: "x",
            siteId: otherSite.id,
          },
        })
      ).id,
      role: "SITE_MANAGER",
      siteId: otherSite.id,
    };

    await expect(
      updateTicketFields(stranger, ticket.id, { description: "פריצה" }),
    ).rejects.toThrow(he.common.notAllowed);
  });

  it("דוחה בניין ששייך לאתר אחר — אין זיהום חוצה-אתרים", async () => {
    const ticket = await makeTicket();
    const otherSite = await db.site.create({ data: { name: "אתר אחר" } });
    const foreignBuilding = await db.building.create({
      data: { siteId: otherSite.id, name: "בניין זר" },
    });

    await expect(
      updateTicketFields(asUser(opener), ticket.id, { buildingId: foreignBuilding.id }),
    ).rejects.toThrow(he.directory.locationMismatch);
  });
});

describe("updateResidentName", () => {
  it("מעדכן את שם הדייר של הדירה — מתגלגל לכל הפניות של הדירה", async () => {
    const ticket = await makeTicket();
    await updateResidentName(asUser(opener), ticket.id, "משפחת כהן");

    const apartment = await db.apartment.findUniqueOrThrow({ where: { id: base.apartmentId } });
    expect(apartment.residentName).toBe("משפחת כהן");
  });

  it("נמען אינו רשאי לערוך שם דייר", async () => {
    const ticket = await makeTicket();
    await expect(
      updateResidentName({ kind: "professional", id: electrician }, ticket.id, "דייר"),
    ).rejects.toThrow(he.common.notAllowed);
  });
});
