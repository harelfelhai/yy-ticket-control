import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import type { SessionUser } from "@/lib/session";
import {
  TicketError,
  createTicket,
  dedupeRecipients,
  missingRequiredFields,
  submitDraft,
} from "@/lib/services/tickets";
import { resetDb } from "../helpers/reset-db";

let actor: SessionUser;
let siteId: string;
let buildingId: string;
let apartmentId: string;
let domainId: string;
let professionalId: string;

beforeEach(async () => {
  await resetDb();

  const site = await db.site.create({ data: { name: "אתר" } });
  siteId = site.id;

  const building = await db.building.create({ data: { siteId, name: "בניין א" } });
  buildingId = building.id;
  apartmentId = (await db.apartment.create({ data: { buildingId, number: "7" } })).id;
  domainId = (await db.domain.create({ data: { name: "חשמל" } })).id;
  professionalId = (
    await db.professional.create({ data: { name: "יוסי חשמלאי", phone: "0501234567" } })
  ).id;

  const user = await db.user.create({
    data: { role: "SITE_MANAGER", name: "מנהל", phone: "0500000001", passwordHash: "x", siteId },
  });
  actor = { id: user.id, name: user.name, role: user.role, siteId: user.siteId };
});

afterAll(async () => {
  await db.$disconnect();
});

function fullInput(overrides = {}) {
  return {
    siteId,
    buildingId,
    apartmentId,
    domainId,
    description: "אין חשמל בסלון",
    recipients: [{ kind: "professional" as const, id: professionalId }],
    ...overrides,
  };
}

describe("missingRequiredFields", () => {
  it("פנייה מלאה אינה חסרה דבר", () => {
    expect(missingRequiredFields(fullInput())).toEqual([]);
  });

  it("מדווח בשמות מה חסר, כדי שהממשק יוכל לומר למשתמש", () => {
    expect(missingRequiredFields({ siteId })).toEqual([
      he.directory.building,
      he.directory.apartment,
      he.directory.domain,
      he.ticket.description,
      he.ticket.recipients,
    ]);
  });

  it("תיאור של רווחים בלבד נחשב חסר", () => {
    expect(missingRequiredFields(fullInput({ description: "   " }))).toEqual([
      he.ticket.description,
    ]);
  });

  it("רשימת נמענים ריקה נחשבת חסרה", () => {
    expect(missingRequiredFields(fullInput({ recipients: [] }))).toEqual([he.ticket.recipients]);
  });
});

describe("dedupeRecipients", () => {
  it("מסיר בחירה כפולה של אותו נמען", () => {
    // בלי זה "2 מתוך 3 סיימו" היה סופר את אותו אדם פעמיים.
    const result = dedupeRecipients([
      { kind: "professional", id: "a" },
      { kind: "professional", id: "a" },
      { kind: "user", id: "a" },
    ]);
    expect(result).toHaveLength(2);
  });
});

describe("createTicket", () => {
  it("יוצר פנייה משוגרת עם שיוך לכל נמען", async () => {
    const { ticket, isDraft } = await createTicket(actor, fullInput());

    expect(isDraft).toBe(false);
    expect(ticket.assignments).toHaveLength(1);
    expect(ticket.assignments[0]?.status).toBe("SENT");
    expect(ticket.assignments[0]?.professionalId).toBe(professionalId);
  });

  it("רושם אירוע שיוך בשרשור עם שם הנמען", async () => {
    const { ticket } = await createTicket(actor, fullInput());

    const events = await db.message.findMany({ where: { ticketId: ticket.id, kind: "EVENT" } });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("ASSIGNED");
    expect(events[0]?.eventMeta).toMatchObject({ recipientName: "יוסי חשמלאי" });
  });

  it("שומר כטיוטה במקום להיכשל כשחסרים שדות — פנייה לא הולכת לאיבוד", async () => {
    const { ticket, isDraft, missing } = await createTicket(actor, {
      siteId,
      description: "משהו לא עובד",
    });

    expect(isDraft).toBe(true);
    expect(missing).toContain(he.directory.building);
    expect(ticket.description).toBe("משהו לא עובד");
  });

  it("טיוטה אינה משויכת לאיש, גם כשנבחרו נמענים", async () => {
    // שיוך פירושו שמישהו קיבל את הפנייה. טיוטה במפורש לא נשלחה לאיש.
    const { ticket } = await createTicket(actor, fullInput({ saveAsDraft: true }));

    expect(ticket.isDraft).toBe(true);
    expect(ticket.assignments).toHaveLength(0);
    expect(await db.message.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  it("שיוך לנמען פנימי עובד — זהו התזכורן", async () => {
    const { ticket } = await createTicket(
      actor,
      fullInput({ recipients: [{ kind: "user", id: actor.id }] }),
    );

    expect(ticket.assignments[0]?.userId).toBe(actor.id);
    expect(ticket.assignments[0]?.professionalId).toBeNull();
  });

  it("מסיר בחירה כפולה של אותו נמען לפני היצירה", async () => {
    const { ticket } = await createTicket(
      actor,
      fullInput({
        recipients: [
          { kind: "professional", id: professionalId },
          { kind: "professional", id: professionalId },
        ],
      }),
    );

    expect(ticket.assignments).toHaveLength(1);
  });

  it("מספרר פניות ברצף", async () => {
    const first = await createTicket(actor, fullInput());
    const second = await createTicket(actor, fullInput());
    expect(second.ticket.seq).toBe(first.ticket.seq + 1);
  });
});

describe("submitDraft", () => {
  it("משגר טיוטה מלאה: יוצר שיוכים ומסיר את סימון הטיוטה", async () => {
    const { ticket } = await createTicket(actor, fullInput({ saveAsDraft: true }));

    await submitDraft(ticket.id, [{ kind: "professional", id: professionalId }]);

    const updated = await db.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      include: { assignments: true },
    });
    expect(updated.isDraft).toBe(false);
    expect(updated.assignments).toHaveLength(1);
  });

  it("מסרב לשגר טיוטה שחסרים בה שדות, ואומר מה חסר", async () => {
    const { ticket } = await createTicket(actor, { siteId, description: "משהו" });

    await expect(
      submitDraft(ticket.id, [{ kind: "professional", id: professionalId }]),
    ).rejects.toThrow(TicketError);

    const unchanged = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(unchanged.isDraft).toBe(true);
  });

  it("מסרב לשגר בלי נמענים", async () => {
    const { ticket } = await createTicket(actor, fullInput({ saveAsDraft: true }));
    await expect(submitDraft(ticket.id, [])).rejects.toThrow(he.ticket.recipients);
  });

  it("פנייה שאינה קיימת מחזירה שגיאה מובנת", async () => {
    await expect(submitDraft("no-such-id", [])).rejects.toThrow(he.ticket.notFound);
  });
});
