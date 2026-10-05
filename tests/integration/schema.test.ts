import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers/reset-db";

/**
 * מאמת שהחוקים שהוגדרו בסכימה נאכפים בבסיס הנתונים עצמו ולא רק בקוד.
 * זהו ההבדל בין "השירות שלנו לא מנסה למחוק אתר עם בניינים" לבין
 * "אי אפשר למחוק אתר עם בניינים" — רק השני שורד באג עתידי.
 */
describe("אילוצי מודל הנתונים", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("שומר וקורא היררכיה של אתר → בניין → דירה", async () => {
    await db.site.create({
      data: {
        name: "רמת השרון",
        buildings: {
          create: { name: "בניין א", apartments: { create: [{ number: "1" }, { number: "2" }] } },
        },
      },
    });

    const apartment = await db.apartment.findFirst({
      where: { number: "2" },
      include: { building: { include: { site: true } } },
    });

    expect(apartment?.building.site.name).toBe("רמת השרון");
    expect(apartment?.building.name).toBe("בניין א");
  });

  it("מונע שתי דירות באותו מספר באותו בניין", async () => {
    const site = await db.site.create({ data: { name: "אתר" } });
    const building = await db.building.create({ data: { siteId: site.id, name: "א" } });

    await db.apartment.create({ data: { buildingId: building.id, number: "5" } });

    await expect(
      db.apartment.create({ data: { buildingId: building.id, number: "5" } }),
    ).rejects.toThrow();
  });

  it("מתיר אותו מספר דירה בשני בניינים שונים", async () => {
    const site = await db.site.create({ data: { name: "אתר" } });
    const a = await db.building.create({ data: { siteId: site.id, name: "א" } });
    const b = await db.building.create({ data: { siteId: site.id, name: "ב" } });

    await db.apartment.create({ data: { buildingId: a.id, number: "5" } });
    await db.apartment.create({ data: { buildingId: b.id, number: "5" } });

    expect(await db.apartment.count({ where: { number: "5" } })).toBe(2);
  });

  it("חוסם מחיקת אתר שיש בו בניינים", async () => {
    const site = await db.site.create({
      data: { name: "אתר", buildings: { create: { name: "א" } } },
    });

    await expect(db.site.delete({ where: { id: site.id } })).rejects.toThrow();
  });

  it("מוחק שיוכים והודעות יחד עם הפנייה, אך לא את הנמענים", async () => {
    const site = await db.site.create({ data: { name: "אתר" } });
    const manager = await db.user.create({
      data: {
        role: "SITE_MANAGER",
        name: "מנהל",
        phone: "0500000001",
        passwordHash: "x",
        siteId: site.id,
      },
    });
    const professional = await db.professional.create({
      data: { name: "חשמלאי", phone: "0500000002" },
    });

    const ticket = await db.ticket.create({
      data: {
        siteId: site.id,
        channel: "SELF",
        createdById: manager.id,
        description: "תקלה",
        assignments: { create: { professionalId: professional.id } },
        messages: { create: { kind: "TEXT", text: "שלום", authorUserId: manager.id } },
      },
    });

    await db.ticket.delete({ where: { id: ticket.id } });

    expect(await db.assignment.count()).toBe(0);
    expect(await db.message.count()).toBe(0);
    // איש המקצוע והמנהל הם ישויות עצמאיות — מחיקת פנייה לא מוחקת אותם.
    expect(await db.professional.count()).toBe(1);
    expect(await db.user.count()).toBe(1);
  });

  /**
   * EM-M02 (אפיון §3.2 שדה 3): אתר חובה **למעט** טיוטה ממייל שלא זוהה בה
   * אתר. האילוץ הוא CHECK שנכתב במיגרציה `email_intake` והוחלף ב-
   * `whatsapp_intake` (ראו WA-M03) — Prisma אינו מבטא CHECK, ולכן רק הבדיקות
   * האלה מבטיחות שהוא קיים ושלא נמחק במיגרציה עתידית.
   */
  it("EM-M02 — פנייה בלי אתר נדחית במסד, למעט טיוטה ממייל", async () => {
    const admin = await db.user.create({
      data: { role: "ADMIN", name: "מנהל", phone: "0500000004", passwordHash: "x" },
    });
    const base = { createdById: admin.id, description: "תקלה" };

    // פנייה משוגרת בלי אתר — הייתה נעלמת מכל מנהל עבודה.
    await expect(
      db.ticket.create({ data: { ...base, siteId: null, channel: "EMAIL", isDraft: false } }),
    ).rejects.toThrow();
    // טיוטה שנפתחה במערכת חייבת אתר — הטופס תמיד בוחר אחד.
    await expect(
      db.ticket.create({ data: { ...base, siteId: null, channel: "SELF", isDraft: true } }),
    ).rejects.toThrow();

    const draft = await db.ticket.create({
      data: { ...base, siteId: null, channel: "EMAIL", isDraft: true },
    });
    expect(draft.siteId).toBeNull();

    // ושיגור שלה בלי לקבוע אתר נחסם באותו אילוץ.
    await expect(
      db.ticket.update({ where: { id: draft.id }, data: { isDraft: false } }),
    ).rejects.toThrow();
  });

  /**
   * WA-M03 (אפיון §2.7 שלב 3, §3.2 שדה 3): טיוטה מוואטסאפ של מנהל מערכת שלא
   * זוהה בה אתר נשמרת בלי אתר, בדיוק כמו במייל. האילוץ הקודם התיר זאת לערוץ
   * `EMAIL` בלבד; המיגרציה `whatsapp_intake` החליפה אותו.
   */
  it("WA-M03 — טיוטה מוואטסאפ בלי אתר מתקבלת במסד, ושיגור שלה בלי אתר נחסם", async () => {
    const admin = await db.user.create({
      data: { role: "ADMIN", name: "מנהל", phone: "0500000004", passwordHash: "x" },
    });
    const base = { createdById: admin.id, description: "תקלה" };

    await expect(
      db.ticket.create({ data: { ...base, siteId: null, channel: "WHATSAPP", isDraft: false } }),
    ).rejects.toThrow();

    const draft = await db.ticket.create({
      data: { ...base, siteId: null, channel: "WHATSAPP", isDraft: true },
    });
    expect(draft.siteId).toBeNull();

    await expect(
      db.ticket.update({ where: { id: draft.id }, data: { isDraft: false } }),
    ).rejects.toThrow();
  });

  /** המספר העסקי ושיחה אחת עם הודעה נכנסת — הבסיס לבדיקות של יומן הוואטסאפ */
  async function waConversation() {
    const admin = await db.user.create({
      data: { role: "ADMIN", name: "מנהל", phone: "0500000005", passwordHash: "x" },
    });
    const number = await db.waNumber.create({
      data: {
        phoneNumberId: "300000000000001",
        wabaId: "200000000000001",
        displayPhone: "15550001234",
        tokenCipher: "cipher",
        activatedAt: new Date(),
      },
    });
    return { admin, number };
  }

  it("WA-13 — אותו wamid נרשם פעם אחת: משלוח כפול של Meta נדחה במסד", async () => {
    const { number } = await waConversation();
    const message = { direction: "INBOUND" as const, numberId: number.id, type: "text", wamid: "wamid.A" };

    await db.waMessage.create({ data: message });
    await expect(db.waMessage.create({ data: message })).rejects.toThrow();
    expect(await db.waMessage.count()).toBe(1);
  });

  it("WA-M01 — מחיקת הטיוטה משאירה את שיחת הוואטסאפ, בלי פנייה", async () => {
    const { admin, number } = await waConversation();
    const ticket = await db.ticket.create({
      data: { createdById: admin.id, siteId: null, channel: "WHATSAPP", isDraft: true, description: "" },
    });
    const thread = await db.waThread.create({ data: { ticketId: ticket.id } });
    await db.waMessage.create({
      data: { direction: "INBOUND", numberId: number.id, type: "text", wamid: "wamid.B", threadId: thread.id },
    });

    await db.ticket.delete({ where: { id: ticket.id } });

    const kept = await db.waThread.findUniqueOrThrow({ where: { id: thread.id }, include: { messages: true } });
    expect(kept.ticketId).toBeNull();
    expect(kept.messages).toHaveLength(1);
  });

  it("WA-21 — המזהה שוואטסאפ מצמידה למשתמש שייך למשתמש אחד בלבד", async () => {
    await db.user.create({
      data: { role: "ADMIN", name: "א", phone: "0500000006", passwordHash: "x", whatsappUserId: "IL.1" },
    });
    await expect(
      db.user.create({
        data: { role: "ADMIN", name: "ב", phone: "0500000007", passwordHash: "x", whatsappUserId: "IL.1" },
      }),
    ).rejects.toThrow();
  });

  it("מספרר פניות ברצף עולה לצורך זיהוי בשיחה", async () => {
    const site = await db.site.create({ data: { name: "אתר" } });
    const manager = await db.user.create({
      data: { role: "ADMIN", name: "מנהל", phone: "0500000003", passwordHash: "x" },
    });

    const first = await db.ticket.create({
      data: { siteId: site.id, channel: "SELF", createdById: manager.id },
    });
    const second = await db.ticket.create({
      data: { siteId: site.id, channel: "SELF", createdById: manager.id },
    });

    expect(second.seq).toBe(first.seq + 1);
  });
});
