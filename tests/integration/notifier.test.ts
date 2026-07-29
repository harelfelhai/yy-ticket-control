import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { JOB_TYPES } from "@/jobs/types";
import { drainJobs } from "@/jobs/worker";
import { db } from "@/lib/db";
import { notificationTarget, sendNotification } from "@/lib/notifier";
import type { EmailMessage, EmailTransport } from "@/lib/notifier/types";
import { readPortalLink } from "@/lib/services/portal";
import {
  addAssignments,
  closeTicket,
  createTicket,
  removeAssignment,
  reopenTicket,
  setAssignmentStatus,
} from "@/lib/services/tickets";
import type { SessionUser } from "@/lib/session";
import { resetDb } from "../helpers/reset-db";

/**
 * המסלול המלא של ההתראות: אירוע במערכת → ג'וב → הודעה שיוצאת לאדם.
 *
 * הערוץ מדומה, וזה בכוונה: מה שנבדק כאן הוא **מי מקבל מה ומתי** — ההחלטות
 * שאפשר לטעות בהן בשקט. השליחה עצמה מול Resend היא קריאת HTTP אחת, והיא
 * מאומתת בהרצה אמיתית ולא בבדיקה שתשלח דואר בכל ריצה.
 */

function fakeTransport(options: { failTimes?: number } = {}) {
  const sent: EmailMessage[] = [];
  let failuresLeft = options.failTimes ?? 0;

  const transport: EmailTransport = {
    name: "fake",
    async send(message) {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error("שרת המייל אינו זמין");
      }
      sent.push(message);
    },
  };

  return { transport, sent };
}

let manager: SessionUser;
let siteId: string;
let base: Record<string, string>;
/** יש לו מייל וגם טלפון */
let electrician: string;
/** טלפון בלבד — המצב השכיח אצל קבלני משנה */
let plumber: string;

beforeEach(async () => {
  await resetDb();
  process.env.APP_BASE_URL ??= "http://localhost:3100";

  siteId = (await db.site.create({ data: { name: "אתר" } })).id;
  const building = await db.building.create({ data: { siteId, name: "בניין א" } });
  const apartment = await db.apartment.create({ data: { buildingId: building.id, number: "3" } });
  const domain = await db.domain.create({ data: { name: "חשמל" } });
  base = { buildingId: building.id, apartmentId: apartment.id, domainId: domain.id };

  electrician = (
    await db.professional.create({
      data: { name: "יוסי", phone: "0501111111", email: "yossi@example.com" },
    })
  ).id;
  plumber = (await db.professional.create({ data: { name: "משה", phone: "0502222222" } })).id;

  const user = await db.user.create({
    data: {
      role: "SITE_MANAGER",
      name: "דוד",
      phone: "0500000001",
      email: "david@example.com",
      passwordHash: "x",
      siteId,
    },
  });
  manager = { id: user.id, name: user.name, role: user.role, siteId: user.siteId };
});

afterAll(async () => {
  await db.$disconnect();
});

async function makeTicket(recipients = [electrician]) {
  const { ticket } = await createTicket(manager, {
    siteId,
    ...base,
    description: "אין חשמל בסלון",
    recipients: recipients.map((id) => ({ kind: "professional" as const, id })),
  });
  return ticket;
}

async function assignmentOf(ticketId: string, professionalId: string) {
  return db.assignment.findFirstOrThrow({ where: { ticketId, professionalId } });
}

describe("notificationTarget", () => {
  it("שיוך ופתיחה מחדש הולכים לנמען, שאלה וטופל חוזרים לפותח", () => {
    // ‏Gate G3: שאלה נשלחת לפותח בלבד. מנהלי האתר רואים אותה בלוח ממילא.
    expect(notificationTarget("ASSIGNED")).toBe("recipient");
    expect(notificationTarget("REOPENED")).toBe("recipient");
    expect(notificationTarget("QUESTION")).toBe("opener");
    expect(notificationTarget("DONE")).toBe("opener");
  });
});

describe("יצירת פנייה מייצרת בקשות שליחה", () => {
  it("ג'וב אחד לכל נמען", async () => {
    await makeTicket([electrician, plumber]);

    const jobs = await db.job.findMany({ where: { type: JOB_TYPES.notify } });
    expect(jobs).toHaveLength(2);
  });

  it("טיוטה אינה מייצרת דבר — היא לא נשלחה לאיש", async () => {
    await createTicket(manager, {
      siteId,
      ...base,
      description: "טיוטה",
      recipients: [{ kind: "professional", id: electrician }],
      saveAsDraft: true,
    });

    expect(await db.job.count()).toBe(0);
  });

  it("שיוך יוצר קישור גישה כבר ברגע השיוך", async () => {
    // כך מסך הפנייה מציג את כפתור הוואטסאפ בטעינה הראשונה, בלי לכתוב
    // לבסיס הנתונים בזמן רינדור.
    await makeTicket([plumber]);
    expect(await readPortalLink(plumber)).not.toBeNull();
  });
});

describe("sendNotification", () => {
  it("שולח לקבלן מייל עם הקישור האישי שלו", async () => {
    const ticket = await makeTicket([electrician]);
    const assignment = await assignmentOf(ticket.id, electrician);
    const { transport, sent } = fakeTransport();

    const outcome = await sendNotification(
      { event: "ASSIGNED", assignmentId: assignment.id },
      transport,
    );

    expect(outcome).toMatchObject({ status: "sent", to: "yossi@example.com" });
    expect(sent[0]?.text).toContain("שלום יוסי");
    expect(sent[0]?.text).toContain(await readPortalLink(electrician));
  });

  it("מסמן את זמן השליחה על השיוך", async () => {
    // זה מה שמאפשר למנהל לראות "נשלח מייל 16:45" ולא רק "נשלח".
    const ticket = await makeTicket([electrician]);
    const assignment = await assignmentOf(ticket.id, electrician);

    await sendNotification({ event: "ASSIGNED", assignmentId: assignment.id }, fakeTransport().transport);

    const updated = await db.assignment.findUniqueOrThrow({ where: { id: assignment.id } });
    expect(updated.notifiedAt).not.toBeNull();
  });

  it("קבלן בלי מייל מדולג — ולא נחשב לכישלון", async () => {
    // הוא יקבל את הפנייה בוואטסאפ. כישלון כאן היה מייצר ג'וב אדום קבוע.
    const ticket = await makeTicket([plumber]);
    const assignment = await assignmentOf(ticket.id, plumber);
    const { transport, sent } = fakeTransport();

    const outcome = await sendNotification(
      { event: "ASSIGNED", assignmentId: assignment.id },
      transport,
    );

    expect(outcome).toEqual({ status: "skipped", reason: "no-address" });
    expect(sent).toHaveLength(0);
  });

  it("אינו שולח לנמען שהוסר בין היצירה לשליחה", async () => {
    // חלון אמיתי: המנהל טעה בקבלן והסיר אותו לפני שהעובד הספיק לרוץ.
    const ticket = await makeTicket([electrician]);
    const assignment = await assignmentOf(ticket.id, electrician);
    await removeAssignment({ kind: "user", ...manager }, assignment.id);

    const { transport, sent } = fakeTransport();
    const outcome = await sendNotification(
      { event: "ASSIGNED", assignmentId: assignment.id },
      transport,
    );

    expect(outcome).toEqual({ status: "skipped", reason: "assignment-removed" });
    expect(sent).toHaveLength(0);
  });

  it("שאלה חוזרת לפותח ונושאת את השאלה עצמה", async () => {
    const ticket = await makeTicket([electrician]);
    const assignment = await assignmentOf(ticket.id, electrician);
    const { transport, sent } = fakeTransport();

    await sendNotification(
      { event: "QUESTION", assignmentId: assignment.id, note: "איפה הכניסה לדירה?" },
      transport,
    );

    expect(sent[0]?.to).toBe("david@example.com");
    expect(sent[0]?.subject).toContain("יוסי שאל שאלה");
    expect(sent[0]?.text).toContain("איפה הכניסה לדירה?");
    // לפותח נשלח קישור לפנייה במערכת, לא קישור קסם — הוא נכנס עם סיסמה.
    expect(sent[0]?.text).toContain(`/tickets/${ticket.id}`);
    expect(sent[0]?.text).not.toContain("/p/");
  });

  it("סימון טופל חוזר לפותח", async () => {
    const ticket = await makeTicket([electrician]);
    const assignment = await assignmentOf(ticket.id, electrician);
    const { transport, sent } = fakeTransport();

    await sendNotification({ event: "DONE", assignmentId: assignment.id }, transport);

    expect(sent[0]?.to).toBe("david@example.com");
    expect(sent[0]?.text).toContain("ממתינה לאישור");
  });

  it("שיוך שנמחק אינו מפיל את השליחה", async () => {
    const outcome = await sendNotification(
      { event: "ASSIGNED", assignmentId: "לא-קיים" },
      fakeTransport().transport,
    );
    expect(outcome).toEqual({ status: "skipped", reason: "missing" });
  });

  it("כשל בעדכון notifiedAt אחרי שליחה מוצלחת אינו גורם לשליחה כפולה", async () => {
    // הבאג: send מצליח, ואז assignment.update זורק → הפונקציה זרקה → הג'וב
    // חזר ושלח שוב, ואחרי 3 ניסיונות סומן FAILED למרות שמיילים יצאו.
    // התיקון: העדכון אינו זורק — המייל יצא פעם אחת והתוצאה "נשלח".
    const ticket = await makeTicket([electrician]);
    const assignment = await assignmentOf(ticket.id, electrician);
    const { transport, sent } = fakeTransport();

    const spy = vi
      .spyOn(db.assignment, "update")
      .mockRejectedValueOnce(new Error("עדכון notifiedAt נכשל"));
    const outcome = await sendNotification(
      { event: "ASSIGNED", assignmentId: assignment.id },
      transport,
    );
    spy.mockRestore();

    expect(sent).toHaveLength(1);
    expect(outcome).toMatchObject({ status: "sent" });
  });
});

describe("המסלול המלא דרך התור", () => {
  it("שיוך → ג'וב → מייל אצל הקבלן", async () => {
    await makeTicket([electrician]);
    const { transport, sent } = fakeTransport();

    await drainJobs({ transport });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("yossi@example.com");
    expect(await db.job.count({ where: { status: "DONE" } })).toBe(1);
  });

  it("כשל זמני חוזר לתור, והניסיון הבא מצליח", async () => {
    // זה כל תפקידו של התור: שרת מייל שנפל לרגע לא אמור לאבד הודעה.
    await makeTicket([electrician]);
    const { transport, sent } = fakeTransport({ failTimes: 1 });

    await drainJobs({ transport });
    expect(sent).toHaveLength(0);

    const failed = await db.job.findFirstOrThrow();
    expect(failed.status).toBe("PENDING");
    expect(failed.attempts).toBe(1);

    // הזמן מתקדם עד אחרי ההשהיה
    await drainJobs({ transport }, new Date(failed.runAt.getTime() + 1000));

    expect(sent).toHaveLength(1);
    expect((await db.job.findFirstOrThrow()).status).toBe("DONE");
  });

  it("פתיחה מחדש מודיעה לכל הנמענים הפעילים", async () => {
    const ticket = await makeTicket([electrician]);
    await closeTicket({ kind: "user", ...manager }, ticket.id);
    await drainJobs({ transport: fakeTransport().transport });

    await reopenTicket({ kind: "user", ...manager }, ticket.id);
    const { transport, sent } = fakeTransport();
    await drainJobs({ transport });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toContain("נפתחה מחדש");
  });

  it("הוספת נמען לפנייה קיימת מודיעה רק לו", async () => {
    const ticket = await makeTicket([plumber]);
    await drainJobs({ transport: fakeTransport().transport });

    await addAssignments({ kind: "user", ...manager }, ticket.id, [
      { kind: "professional", id: electrician },
    ]);

    const { transport, sent } = fakeTransport();
    await drainJobs({ transport });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("yossi@example.com");
  });

  it("שאלה מהקבלן מגיעה לפותח דרך התור", async () => {
    const ticket = await makeTicket([electrician]);
    const assignment = await assignmentOf(ticket.id, electrician);
    await drainJobs({ transport: fakeTransport().transport });

    await setAssignmentStatus(assignment.id, "QUESTION", "צריך מפתח לחדר החשמל");

    const { transport, sent } = fakeTransport();
    await drainJobs({ transport });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("david@example.com");
    expect(sent[0]?.text).toContain("צריך מפתח לחדר החשמל");
  });

  it("צפייה אינה מייצרת הודעה", async () => {
    // אחרת כל פתיחת קישור הייתה מייצרת מייל למנהל. זה רעש, ורעש גורם
    // לאנשים להפסיק לקרוא את ההתראות.
    const ticket = await makeTicket([electrician]);
    const assignment = await assignmentOf(ticket.id, electrician);
    await drainJobs({ transport: fakeTransport().transport });

    await setAssignmentStatus(assignment.id, "VIEWED");

    expect(await db.job.count({ where: { status: "PENDING" } })).toBe(0);
  });
});
