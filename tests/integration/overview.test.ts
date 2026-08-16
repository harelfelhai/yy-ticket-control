import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getOwnerOverview } from "@/lib/services/overview";
import { resetDb } from "../helpers/reset-db";

let siteAId: string;
let siteBId: string;
let managerId: string;
let professionalId: string;

async function ticket(siteId: string, extra: Record<string, unknown> = {}) {
  return db.ticket.create({
    data: { siteId, createdById: managerId, channel: "SELF", description: "תקלה", ...extra },
  });
}

async function assign(ticketId: string, status: "SENT" | "VIEWED" | "DONE") {
  await db.assignment.create({ data: { ticketId, professionalId, status } });
}

beforeEach(async () => {
  await resetDb();
  siteAId = (await db.site.create({ data: { name: "אתר א" } })).id;
  siteBId = (await db.site.create({ data: { name: "אתר ב" } })).id;
  managerId = (
    await db.user.create({
      data: { role: "SITE_MANAGER", name: "מנהל", phone: "0500000001", passwordHash: "x", siteId: siteAId },
    })
  ).id;
  professionalId = (await db.professional.create({ data: { name: "יוסי", phone: "0501111111" } })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("getOwnerOverview", () => {
  it("סופר לכל אתר: פתוחות, ממתינות למנהל, וללא תנועה", async () => {
    // אתר א: אחת חדשה (אצל הנמען), אחת מוסלמת, אחת שהושלמה וממתינה
    // לאישור, ואחת סגורה.
    const fresh = await ticket(siteAId);
    await assign(fresh.id, "SENT");

    const stale = await ticket(siteAId, { escalated: true });
    await assign(stale.id, "SENT");

    const done = await ticket(siteAId);
    await assign(done.id, "DONE");

    const closed = await ticket(siteAId, { closedAt: new Date() });
    await assign(closed.id, "DONE");

    // אתר ב: טיוטה אחת.
    await ticket(siteBId, { isDraft: true });

    const overview = await getOwnerOverview();
    const a = overview.find((s) => s.siteId === siteAId);
    const b = overview.find((s) => s.siteId === siteBId);

    // סגורה אינה נספרת בפתוחות.
    expect(a).toMatchObject({ open: 3, awaitingManager: 2, stale: 1 });
    // טיוטה נכנסת ל"ממתינות למנהל" (דורש השלמה) ואינה מוסלמת.
    expect(b).toMatchObject({ open: 1, awaitingManager: 1, stale: 0 });
  });

  it("מחזיר את כל האתרים, גם ריקים, ובסדר אלפביתי", async () => {
    const overview = await getOwnerOverview();
    expect(overview.map((s) => s.siteName)).toEqual(["אתר א", "אתר ב"]);
    expect(overview.every((s) => s.open === 0)).toBe(true);
  });
});
