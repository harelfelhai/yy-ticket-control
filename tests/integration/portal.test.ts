import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  getPortalBoard,
  getPortalTicket,
  issuePortalLink,
  markViewed,
  resolveToken,
} from "@/lib/services/portal";
import {
  closeTicket,
  createTicket,
  removeAssignment,
  setAssignmentStatus,
} from "@/lib/services/tickets";
import type { SessionUser } from "@/lib/session";
import { resetDb } from "../helpers/reset-db";

let manager: SessionUser;
let siteId: string;
let base: Record<string, string>;
let electrician: string;
let plumber: string;

beforeEach(async () => {
  await resetDb();
  process.env.APP_BASE_URL ??= "http://localhost:3100";

  siteId = (await db.site.create({ data: { name: "אתר" } })).id;
  const building = await db.building.create({ data: { siteId, name: "בניין א" } });
  const apartment = await db.apartment.create({ data: { buildingId: building.id, number: "1" } });
  const domain = await db.domain.create({ data: { name: "חשמל" } });
  base = { buildingId: building.id, apartmentId: apartment.id, domainId: domain.id };

  electrician = (await db.professional.create({ data: { name: "יוסי", phone: "0501111111" } })).id;
  plumber = (await db.professional.create({ data: { name: "משה", phone: "0502222222" } })).id;

  const user = await db.user.create({
    data: { role: "SITE_MANAGER", name: "דוד", phone: "0500000001", passwordHash: "x", siteId },
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
    description: "אין חשמל",
    recipients: recipients.map((id) => ({ kind: "professional" as const, id })),
  });
  return ticket;
}

function tokenFrom(url: string): string {
  return url.split("/p/")[1] ?? "";
}

describe("issuePortalLink", () => {
  it("מנפיק קישור ושומר רק את הגיבוב", async () => {
    const url = await issuePortalLink(electrician);
    const token = tokenFrom(url);

    const stored = await db.accessToken.findFirstOrThrow({
      where: { professionalId: electrician },
    });
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.tokenHash).toHaveLength(64);
  });

  it("הנפקה חוזרת מבטלת את הקישור הקודם", async () => {
    // קישור נטוש שממשיך לעבוד הוא בדיוק מה שהופך "ללא תפוגה" לסיכון.
    const first = await issuePortalLink(electrician);
    const second = await issuePortalLink(electrician);

    expect(await resolveToken(tokenFrom(first))).toBeNull();
    expect(await resolveToken(tokenFrom(second))).not.toBeNull();
  });
});

describe("resolveToken", () => {
  it("מזהה את איש המקצוע", async () => {
    const url = await issuePortalLink(electrician);
    const identity = await resolveToken(tokenFrom(url));
    expect(identity?.professionalId).toBe(electrician);
    expect(identity?.name).toBe("יוסי");
  });

  it("דוחה טוקן שאינו קיים ואינו קורס", async () => {
    expect(await resolveToken("לא-קיים")).toBeNull();
    expect(await resolveToken("")).toBeNull();
  });

  it("מעדכן את זמן השימוש האחרון", async () => {
    const url = await issuePortalLink(electrician);
    await resolveToken(tokenFrom(url));

    const stored = await db.accessToken.findFirstOrThrow({
      where: { professionalId: electrician, revokedAt: null },
    });
    expect(stored.lastUsedAt).not.toBeNull();
  });
});

describe("getPortalBoard", () => {
  it("מציג רק את הפניות של אותו קבלן", async () => {
    await makeTicket([electrician]);
    await makeTicket([plumber]);

    const board = await getPortalBoard(electrician);
    expect(board.active).toHaveLength(1);
  });

  it("מפריד בין פעילות לארכיון", async () => {
    const first = await makeTicket();
    await makeTicket();
    await closeTicket({ kind: "user", ...manager }, first.id);

    const board = await getPortalBoard(electrician);
    expect(board.active).toHaveLength(1);
    expect(board.archived).toHaveLength(1);
  });

  it("פנייה שהקבלן הוסר ממנה נעלמת מהרשימה שלו", async () => {
    const ticket = await makeTicket();
    const assignment = await db.assignment.findFirstOrThrow({ where: { ticketId: ticket.id } });
    await removeAssignment({ kind: "user", ...manager }, assignment.id);

    const board = await getPortalBoard(electrician);
    expect(board.active).toHaveLength(0);
    expect(board.archived).toHaveLength(0);
  });
});

describe("getPortalTicket — הטוקן מזהה, השיוכים קובעים", () => {
  it("מחזיר פנייה משויכת", async () => {
    const ticket = await makeTicket();
    const result = await getPortalTicket(electrician, ticket.id);
    expect(result?.ticket.id).toBe(ticket.id);
  });

  it("אינו מחזיר פנייה שהקבלן אינו משויך אליה", async () => {
    const ticket = await makeTicket([plumber]);
    expect(await getPortalTicket(electrician, ticket.id)).toBeNull();
  });

  it("אינו מחזיר פנייה שהקבלן הוסר ממנה, גם עם קישור תקף", async () => {
    // זהו הכלל שמאפשר קישורים ללא תפוגה: ההרשאה נבדקת בכל בקשה.
    const ticket = await makeTicket();
    const assignment = await db.assignment.findFirstOrThrow({ where: { ticketId: ticket.id } });
    await removeAssignment({ kind: "user", ...manager }, assignment.id);

    expect(await getPortalTicket(electrician, ticket.id)).toBeNull();
  });

  it("מחזיר את השרשור המלא, כולל מה שנכתב לפני שהקבלן צורף", async () => {
    const ticket = await makeTicket([plumber]);
    await db.message.create({
      data: { ticketId: ticket.id, kind: "TEXT", text: "בדקנו, זה לא הלוח" },
    });
    await db.assignment.create({ data: { ticketId: ticket.id, professionalId: electrician } });

    const result = await getPortalTicket(electrician, ticket.id);
    expect(result?.ticket.messages.some((m) => m.text === "בדקנו, זה לא הלוח")).toBe(true);
  });
});

describe("markViewed", () => {
  it("מסמן נצפה בפתיחה ראשונה", async () => {
    const ticket = await makeTicket();
    const assignment = await db.assignment.findFirstOrThrow({ where: { ticketId: ticket.id } });

    await markViewed(assignment.id);

    const updated = await db.assignment.findUniqueOrThrow({ where: { id: assignment.id } });
    expect(updated.status).toBe("VIEWED");
    expect(updated.viewedAt).not.toBeNull();
  });

  it("אינו מדרדר סטטוס מתקדם יותר", async () => {
    const ticket = await makeTicket();
    const assignment = await db.assignment.findFirstOrThrow({ where: { ticketId: ticket.id } });
    await setAssignmentStatus(assignment.id, "DONE");

    await markViewed(assignment.id);

    const updated = await db.assignment.findUniqueOrThrow({ where: { id: assignment.id } });
    expect(updated.status).toBe("DONE");
  });
});
