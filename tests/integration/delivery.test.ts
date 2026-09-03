import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/session";
import {
  claimWhatsAppAutoOpen,
  describeDelivery,
  openWhatsApp,
  pendingWhatsAppRecipients,
} from "@/lib/services/delivery";
import { createTicket, getTicketDetail } from "@/lib/services/tickets";
import { resetDb } from "../helpers/reset-db";

/**
 * חיווי השליחה, ההגנה על קישור הקסם, ומסלול הוואטסאפ.
 *
 * הנקודה הקריטית: `includeLink=false` אינו מסתיר את הכפתור בממשק אלא אינו
 * מחשב אותו כלל. בלי זה, צופה שאינו רשאי לערוך נמענים (בעלים שאינו הפותח)
 * היה מקבל דרך לפעול בשמו של הקבלן.
 *
 * **ההגנה התחזקה במעבר לנתיב הפנימי.** קודם `waUrl` הייתה כתובת `wa.me`
 * מלאה ובתוכה קישור הקסם — כלומר הסוד עצמו נסע ללקוח ב-payload, ו-
 * ‏`includeLink` היה כל מה שעמד בינו לבין צופה זר. היום נוסע מזהה שיוך,
 * והסוד נבנה בשרת ברגע הלחיצה מאחורי `canEditAssignments`.
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
  it("includeLink=true → נתיב פנימי, ולא כתובת wa.me עם הסוד בתוכה", async () => {
    const { detail, assignment } = await ticketForProfessional("0501234567", null);
    const view = await describeDelivery(detail, assignment, true);

    expect(view.waUrl).toBe(`/api/wa/${assignment.id}`);
    // הטענה החשובה כאן היא השלילה: קישור הקסם אינו נמצא במה שנשלח ללקוח.
    expect(view.waUrl).not.toContain("wa.me");
    expect(view.waUrl).not.toContain("/p/");
  });

  it("waPending מסמן בדיוק את מי שלא יקבל שום הודעה", async () => {
    const phoneOnly = await ticketForProfessional("0501234567", null);
    expect((await describeDelivery(phoneOnly.detail, phoneOnly.assignment, true)).waPending).toBe(
      true,
    );

    // יש מייל — ה-worker ייידע אותו, ואין כאן משימה למנהל.
    const withEmail = await ticketForProfessional("0501234567", "yossi@example.com");
    expect((await describeDelivery(withEmail.detail, withEmail.assignment, true)).waPending).toBe(
      false,
    );

    // צופה שאינו רשאי לערוך אינו מקבל משימה שאין לו דרך לבצע.
    expect((await describeDelivery(phoneOnly.detail, phoneOnly.assignment, false)).waPending).toBe(
      false,
    );
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

describe("openWhatsApp", () => {
  it("מחזיר כתובת wa.me עם קישור הקסם, ומתעד את הפתיחה", async () => {
    const { assignment } = await ticketForProfessional("0501234567", null);

    const url = await openWhatsApp({ kind: "user", ...actor }, assignment.id);

    expect(url).toContain("wa.me/972501234567");
    // ההודעה נושאת את קישור הקסם — זה כל מה שהקבלן צריך כדי להיכנס.
    expect(decodeURIComponent(url)).toContain("/p/");

    const after = await db.assignment.findUnique({ where: { id: assignment.id } });
    expect(after?.waOpenedAt).toBeInstanceOf(Date);
    // **ולא** נשלח: המערכת ראתה פתיחה, לא מסירה.
    expect(after?.notifiedAt).toBeNull();
  });

  it("מנהל של אתר אחר אינו יכול להנפיק את הקישור", async () => {
    const { assignment } = await ticketForProfessional("0501234567", null);
    const otherSite = await db.site.create({ data: { name: "אתר ב" } });
    const stranger = await db.user.create({
      data: {
        role: "SITE_MANAGER",
        name: "מנהל ב",
        phone: "0500000009",
        passwordHash: "x",
        siteId: otherSite.id,
      },
    });

    await expect(
      openWhatsApp(
        { kind: "user", id: stranger.id, role: stranger.role, siteId: otherSite.id },
        assignment.id,
      ),
    ).rejects.toThrow();

    // והכי חשוב: כישלון ההרשאה אינו מותיר חותמת שקרית של "טופל".
    const after = await db.assignment.findUnique({ where: { id: assignment.id } });
    expect(after?.waOpenedAt).toBeNull();
  });
});

describe("pendingWhatsAppRecipients", () => {
  it("מחזיר את מי שאין לו מייל, ומפסיק אחרי שהוואטסאפ נפתח", async () => {
    const { assignment } = await ticketForProfessional("0501234567", null);

    expect(await pendingWhatsAppRecipients([assignment.id])).toHaveLength(1);

    await openWhatsApp({ kind: "user", ...actor }, assignment.id);
    expect(await pendingWhatsAppRecipients([assignment.id])).toEqual([]);
  });

  it("אינו כולל נמען עם מייל, ולא נמען שהוסר", async () => {
    const withEmail = await ticketForProfessional("0501234567", "yossi@example.com");
    expect(await pendingWhatsAppRecipients([withEmail.assignment.id])).toEqual([]);

    const removed = await ticketForProfessional("0507654321", null);
    await db.assignment.update({
      where: { id: removed.assignment.id },
      data: { status: "REMOVED" },
    });
    expect(await pendingWhatsAppRecipients([removed.assignment.id])).toEqual([]);
  });
});

/**
 * הסימון המוקדם — מה שמונע את המירוץ בין הלשונית לרינדור המסך.
 *
 * ‏`hasOpenTab` הוא **תנאי ולא רמז**: לשונית שנחסמה פירושה שהמנהל לא ראה
 * דבר, וסימון במקרה כזה היה מסתיר את המשימה היחידה שנשארה — כלומר הופך את
 * התיקון לגרסה גרועה יותר של הבאג המקורי.
 */
describe("claimWhatsAppAutoOpen", () => {
  it("מסמן את הראשון בלבד, ומחזיר את מזההו", async () => {
    const first = await ticketForProfessional("0501111111", null);
    const second = await ticketForProfessional("0502222222", null);
    const ids = [first.assignment.id, second.assignment.id];

    expect(await claimWhatsAppAutoOpen(ids, true)).toBe(first.assignment.id);

    // השני נשאר פתוח — הוא מה שיופיע ב"נותר לשלוח".
    expect(await pendingWhatsAppRecipients(ids)).toEqual([
      { assignmentId: second.assignment.id, name: "יוסי חשמלאי" },
    ]);
  });

  it("לשונית שנחסמה אינה מסמנת דבר", async () => {
    const { assignment } = await ticketForProfessional("0501234567", null);

    expect(await claimWhatsAppAutoOpen([assignment.id], false)).toBeNull();

    const after = await db.assignment.findUnique({ where: { id: assignment.id } });
    expect(after?.waOpenedAt).toBeNull();
    // והמשימה נשארת גלויה — זו הטענה שבאמת חשובה כאן.
    expect(await pendingWhatsAppRecipients([assignment.id])).toHaveLength(1);
  });

  it("אין נמען בלי מייל — אין מה לפתוח", async () => {
    const { assignment } = await ticketForProfessional("0501234567", "yossi@example.com");
    expect(await claimWhatsAppAutoOpen([assignment.id], true)).toBeNull();
  });
});
