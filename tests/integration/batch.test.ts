import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import type { SessionUser } from "@/lib/session";
import { BatchError, type BatchRow, createTicketBatch } from "@/lib/services/batch";
import { resetDb } from "../helpers/reset-db";

let actor: SessionUser;
let siteId: string;
let buildingId: string;
let apartmentId: string;
let domainId: string;
let electricianId: string;
let plumberId: string;

beforeEach(async () => {
  await resetDb();
  process.env.APP_BASE_URL ??= "http://localhost:3100";

  siteId = (await db.site.create({ data: { name: "אתר" } })).id;
  buildingId = (await db.building.create({ data: { siteId, name: "בניין א" } })).id;
  apartmentId = (await db.apartment.create({ data: { buildingId, number: "12" } })).id;
  domainId = (await db.domain.create({ data: { name: "חשמל" } })).id;
  electricianId = (await db.professional.create({ data: { name: "יוסי", phone: "0501111111" } })).id;
  plumberId = (await db.professional.create({ data: { name: "דוד", phone: "0502222222" } })).id;

  const user = await db.user.create({
    data: { role: "SITE_MANAGER", name: "מנהל", phone: "0500000001", passwordHash: "x", siteId },
  });
  actor = { id: user.id, name: user.name, role: user.role, siteId: user.siteId };
});

afterAll(async () => {
  await db.$disconnect();
});

function row(overrides: Partial<BatchRow> = {}): BatchRow {
  return {
    description: "ליקוי",
    domainId,
    room: null,
    recipient: { kind: "professional", id: electricianId },
    ...overrides,
  };
}

function baseInput(rows: BatchRow[], dispatch = true) {
  return { siteId, buildingId, apartmentId, tagName: "בדק בית דירה 12", rows, dispatch };
}

describe("createTicketBatch", () => {
  it("יוצר פנייה לכל שורה, כולן מקובצות תחת התגית המשותפת", async () => {
    const result = await createTicketBatch(
      actor,
      baseInput([
        row({ description: "אין חשמל בסלון" }),
        row({ description: "שקע שרוף במטבח", recipient: { kind: "professional", id: plumberId } }),
      ]),
    );

    expect(result.created).toBe(2);
    expect(result.drafts).toBe(0);
    expect(result.professionals).toBe(2);

    const tagged = await db.ticketTag.count({ where: { tagId: result.tagId } });
    expect(tagged).toBe(2);
    // כולן באותה דירה ובניין.
    const tickets = await db.ticket.findMany({ where: { apartmentId } });
    expect(tickets).toHaveLength(2);
    expect(tickets.every((t) => t.buildingId === buildingId)).toBe(true);
  });

  it("שורה בלי נמען נשמרת כטיוטה — פנייה לא הולכת לאיבוד", async () => {
    const result = await createTicketBatch(
      actor,
      baseInput([
        row({ description: "עם נמען" }),
        row({ description: "בלי נמען", recipient: null }),
      ]),
    );

    expect(result.created).toBe(1);
    expect(result.drafts).toBe(1);

    // הטיוטה נוצרה, מתויגת, אך בלי שיוך.
    const drafts = await db.ticket.findMany({ where: { isDraft: true }, include: { assignments: true } });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.assignments).toHaveLength(0);
    expect(await db.ticketTag.count({ where: { ticketId: drafts[0]?.id } })).toBe(1);
  });

  it("סופר אנשי מקצוע שונים, בלי לספור פעמיים את אותו קבלן", async () => {
    const result = await createTicketBatch(
      actor,
      baseInput([
        row({ recipient: { kind: "professional", id: electricianId } }),
        row({ recipient: { kind: "professional", id: electricianId } }),
        row({ recipient: { kind: "professional", id: plumberId } }),
      ]),
    );
    expect(result.created).toBe(3);
    expect(result.professionals).toBe(2);
  });

  it("'שמור הכל כטיוטה' הופך את כולן לטיוטות, גם עם נמען", async () => {
    const result = await createTicketBatch(actor, baseInput([row(), row()], false));
    expect(result.created).toBe(0);
    expect(result.drafts).toBe(2);
    expect(await db.assignment.count()).toBe(0);
  });

  it("שורה ריקה (בלי תיאור או תחום) נשמטת ואינה נספרת", async () => {
    const result = await createTicketBatch(
      actor,
      baseInput([row(), { description: "  ", domainId: null, room: null, recipient: null }]),
    );
    expect(result.created).toBe(1);
    expect(result.drafts).toBe(0);
  });

  it("דוח המקור נכנס כהודעה פותחת בצ׳אט התגית", async () => {
    const media = await db.mediaFile.create({
      data: { storageKey: "k/report.pdf", mimeType: "application/pdf", sizeBytes: 100, uploaded: true },
    });

    const result = await createTicketBatch(actor, {
      ...baseInput([row()]),
      sourceMediaIds: [media.id],
    });

    const message = await db.message.findFirst({
      where: { tagId: result.tagId, kind: "MEDIA" },
      include: { media: true },
    });
    expect(message?.media.map((m) => m.id)).toContain(media.id);
  });

  it("מסרב בלי בניין ודירה", async () => {
    await expect(
      createTicketBatch(actor, { ...baseInput([row()]), buildingId: "" }),
    ).rejects.toThrow(he.batch.needLocation);
  });

  it("מסרב בלי תגית משותפת", async () => {
    await expect(
      createTicketBatch(actor, { ...baseInput([row()]), tagName: "   " }),
    ).rejects.toThrow(he.batch.needTag);
  });

  it("מסרב בלי אף שורה משמעותית", async () => {
    await expect(createTicketBatch(actor, baseInput([]))).rejects.toThrow(BatchError);
  });
});
