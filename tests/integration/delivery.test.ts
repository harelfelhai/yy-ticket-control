import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/session";
import { describeDelivery } from "@/lib/services/delivery";
import { createTicket, getTicketDetail } from "@/lib/services/tickets";
import { resetDb } from "../helpers/reset-db";

/**
 * describeDelivery — חיווי השליחה, וההגנה על קישור הקסם.
 *
 * הנקודה הקריטית: `includeLink=false` אינו מסתיר את הקישור בממשק אלא אינו
 * מחשב אותו כלל, כך שהוא אינו מגיע ל-payload של הקומפוננטה. בלי זה, צופה
 * שאינו רשאי לערוך נמענים (בעלים שאינו הפותח) היה יכול לחלץ מה-payload את
 * הסוד האישי של הקבלן ולהתחזות לו.
 */

let actor: SessionUser;
let siteId: string;
let buildingId: string;
let apartmentId: string;
let domainId: string;

beforeEach(async () => {
  await resetDb();
  siteId = (await db.site.create({ data: { name: "אתר" } })).id;
  buildingId = (await db.building.create({ data: { siteId, name: "בניין א" } })).id;
  apartmentId = (await db.apartment.create({ data: { buildingId, number: "7" } })).id;
  domainId = (await db.domain.create({ data: { name: "חשמל" } })).id;

  const user = await db.user.create({
    data: { role: "SITE_MANAGER", name: "מנהל", phone: "0500000001", passwordHash: "x", siteId },
  });
  actor = { id: user.id, name: user.name, role: user.role, siteId: user.siteId };
});

afterAll(async () => {
  await db.$disconnect();
});

async function ticketForProfessional(phone: string | null, email: string | null) {
  const professional = await db.professional.create({
    data: { name: "יוסי חשמלאי", phone, email },
  });
  const { ticket } = await createTicket(actor, {
    siteId,
    buildingId,
    apartmentId,
    domainId,
    description: "אין חשמל",
    recipients: [{ kind: "professional", id: professional.id }],
  });
  const detail = await getTicketDetail(ticket.id);
  if (!detail) throw new Error("ticket not found");
  return { detail, assignment: detail.assignments[0]! };
}

describe("describeDelivery", () => {
  it("includeLink=true → כתובת wa.me מוכנה לקבלן עם טלפון", async () => {
    const { detail, assignment } = await ticketForProfessional("0501234567", null);
    const view = await describeDelivery(detail, assignment, true);

    expect(view.waUrl).toContain("wa.me/");
  });

  it("includeLink=false → אין waUrl, גם כשקיים טוקן פעיל (חסימת דליפה)", async () => {
    const { detail, assignment } = await ticketForProfessional("0501234567", null);
    // הטוקן נוצר בעת השיוך (ensureAccessToken), ובכל זאת אסור שהקישור ידלוף.
    const view = await describeDelivery(detail, assignment, false);

    expect(view.waUrl).toBeNull();
    // שאר החיווי נשאר זמין — הוא אינו סוד.
    expect(view.deliveryNote).toBeTruthy();
    expect(typeof view.statusChangedAt).toBe("string");
  });

  it("canResendEmail משקף אם יש כתובת מייל לנמען", async () => {
    const withEmail = await ticketForProfessional("0501234567", "yossi@example.com");
    expect((await describeDelivery(withEmail.detail, withEmail.assignment, true)).canResendEmail).toBe(
      true,
    );

    const withoutEmail = await ticketForProfessional("0501234567", null);
    expect(
      (await describeDelivery(withoutEmail.detail, withoutEmail.assignment, true)).canResendEmail,
    ).toBe(false);
  });
});
