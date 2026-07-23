import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import type { Viewer } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";
import {
  TagError,
  addTagMessage,
  addTagToTicket,
  findOrCreateTag,
  getPortalTagChat,
  getTagContractorLink,
  getTagDetail,
  grantTagAccess,
  listPortalTagChats,
  listTagOverviews,
  listTicketTags,
  removeTagFromTicket,
  revokeTagAccess,
} from "@/lib/services/tags";
import { ensureAccessToken } from "@/lib/services/portal";

let siteAId: string;
let siteBId: string;
let adminId: string;
let managerAId: string;
let electricianId: string;
let plumberId: string;

let adminViewer: Viewer;
let managerAViewer: Viewer;
let adminUser: SessionUser;
let managerAUser: SessionUser;

async function makeTicket(siteId: string, createdById: string, closed = false) {
  return db.ticket.create({
    data: {
      siteId,
      createdById,
      channel: "SELF",
      description: "תקלה",
      closedAt: closed ? new Date() : null,
    },
  });
}

beforeEach(async () => {
  const { resetDb } = await import("../helpers/reset-db");
  await resetDb();
  // ‏getTagContractorLink בונה קישור פורטל, שדורש בסיס כתובת.
  process.env.APP_BASE_URL ??= "http://localhost:3100";

  siteAId = (await db.site.create({ data: { name: "אתר א" } })).id;
  siteBId = (await db.site.create({ data: { name: "אתר ב" } })).id;

  adminId = (
    await db.user.create({
      data: { role: "ADMIN", name: "מנהל מערכת", phone: "0500000000", passwordHash: "x" },
    })
  ).id;
  managerAId = (
    await db.user.create({
      data: {
        role: "SITE_MANAGER",
        name: "מנהל א",
        phone: "0500000001",
        passwordHash: "x",
        siteId: siteAId,
      },
    })
  ).id;

  electricianId = (await db.professional.create({ data: { name: "יוסי חשמלאי", phone: "0501111111" } }))
    .id;
  plumberId = (await db.professional.create({ data: { name: "דוד אינסטלטור", phone: "0502222222" } }))
    .id;

  adminViewer = { kind: "user", id: adminId, role: "ADMIN", siteId: null };
  managerAViewer = { kind: "user", id: managerAId, role: "SITE_MANAGER", siteId: siteAId };
  adminUser = { id: adminId, name: "מנהל מערכת", role: "ADMIN", siteId: null };
  managerAUser = { id: managerAId, name: "מנהל א", role: "SITE_MANAGER", siteId: siteAId };
});

afterAll(async () => {
  await db.$disconnect();
});

describe("findOrCreateTag", () => {
  it("יוצר תגית חדשה", async () => {
    const tag = await findOrCreateTag("בדק בית דירה 12", adminId);
    expect(tag.name).toBe("בדק בית דירה 12");
    expect(tag.createdById).toBe(adminId);
  });

  it("מחזיר את הקיימת במקום לשכפל — אותו שם מנורמל", async () => {
    const first = await findOrCreateTag("בדק בית", adminId);
    const second = await findOrCreateTag("  בדק בית  ", managerAId);
    expect(second.id).toBe(first.id);
    expect(await db.tag.count()).toBe(1);
  });

  it("שם ריק נדחה עם הודעה מובנת", async () => {
    await expect(findOrCreateTag("   ", adminId)).rejects.toThrow(he.tag.nameRequired);
  });
});

describe("תיוג פנייה", () => {
  it("מתייג פנייה ויוצר את התגית אם אינה קיימת", async () => {
    const ticket = await makeTicket(siteAId, managerAId);
    const tag = await addTagToTicket(managerAViewer, ticket.id, "דחוף");

    const tags = await listTicketTags(ticket.id);
    expect(tags).toEqual([{ id: tag.id, name: "דחוף" }]);
  });

  it("תיוג חוזר באותה תגית אינו יוצר כפילות", async () => {
    const ticket = await makeTicket(siteAId, managerAId);
    await addTagToTicket(managerAViewer, ticket.id, "דחוף");
    await addTagToTicket(managerAViewer, ticket.id, "דחוף");
    expect(await db.ticketTag.count({ where: { ticketId: ticket.id } })).toBe(1);
  });

  it("מסיר תגית מפנייה בלי לגעת בתגית עצמה", async () => {
    const ticket = await makeTicket(siteAId, managerAId);
    const tag = await addTagToTicket(managerAViewer, ticket.id, "דחוף");
    await removeTagFromTicket(managerAViewer, ticket.id, tag.id);

    expect(await listTicketTags(ticket.id)).toEqual([]);
    // התגית נשארת קיימת — פניות אחרות עשויות להיות מתויגות בה.
    expect(await db.tag.count()).toBe(1);
  });

  it("נמען חיצוני אינו מתייג פנייה", async () => {
    const ticket = await makeTicket(siteAId, managerAId);
    const contractor: Viewer = { kind: "professional", id: electricianId };
    await expect(addTagToTicket(contractor, ticket.id, "דחוף")).rejects.toThrow(TagError);
  });

  it("מנהל עבודה מאתר אחר אינו מתייג", async () => {
    const ticket = await makeTicket(siteBId, adminId);
    await expect(addTagToTicket(managerAViewer, ticket.id, "דחוף")).rejects.toThrow(TagError);
  });
});

describe("listTagOverviews — מונה פתוחות/סגורות ממודר לפי אתר", () => {
  it("סופר פתוחות וסגורות, וממדר לפי הרשאת הצופה", async () => {
    const tag = await findOrCreateTag("בדק בית", adminId);
    const openA = await makeTicket(siteAId, managerAId, false);
    const closedA = await makeTicket(siteAId, managerAId, true);
    const openB = await makeTicket(siteBId, adminId, false);
    for (const t of [openA, closedA, openB]) {
      await db.ticketTag.create({ data: { ticketId: t.id, tagId: tag.id } });
    }

    // מנהל מערכת רואה את שלושתן.
    const adminView = (await listTagOverviews(adminUser)).find((t) => t.id === tag.id);
    expect(adminView).toMatchObject({ openCount: 2, closedCount: 1 });

    // מנהל עבודה של אתר א רואה רק את פניות אתר א.
    const managerView = (await listTagOverviews(managerAUser)).find((t) => t.id === tag.id);
    expect(managerView).toMatchObject({ openCount: 1, closedCount: 1 });
  });

  it("סופר את מספר הקבלנים שנפתחו", async () => {
    const tag = await findOrCreateTag("בדק בית", adminId);
    await grantTagAccess(adminViewer, tag.id, [electricianId, plumberId]);
    const view = (await listTagOverviews(adminUser)).find((t) => t.id === tag.id);
    expect(view?.grantedCount).toBe(2);
  });
});

describe("getTagDetail — רשימת הפניות ממודרת", () => {
  it("מנהל עבודה רואה רק את פניות האתר שלו בתגית", async () => {
    const tag = await findOrCreateTag("בדק בית", adminId);
    const ticketA = await makeTicket(siteAId, managerAId);
    const ticketB = await makeTicket(siteBId, adminId);
    await db.ticketTag.create({ data: { ticketId: ticketA.id, tagId: tag.id } });
    await db.ticketTag.create({ data: { ticketId: ticketB.id, tagId: tag.id } });

    const detail = await getTagDetail(managerAUser, tag.id);
    expect(detail?.tickets.map((t) => t.id)).toEqual([ticketA.id]);
    expect(detail?.openCount).toBe(1);

    const adminDetail = await getTagDetail(adminUser, tag.id);
    expect(adminDetail?.tickets).toHaveLength(2);
  });

  it("מסמן אם הצופה רשאי לפתוח את התגית לקבלנים", async () => {
    const tag = await findOrCreateTag("בדק בית", adminId);
    expect((await getTagDetail(adminUser, tag.id))?.canManageAccess).toBe(true);
    const ownerUser: SessionUser = { id: "u-owner", name: "בעלים", role: "OWNER", siteId: null };
    expect((await getTagDetail(ownerUser, tag.id))?.canManageAccess).toBe(false);
  });

  it("תגית שאינה קיימת מחזירה null", async () => {
    expect(await getTagDetail(adminUser, "no-such-id")).toBeNull();
  });
});

describe("צ׳אט התגית", () => {
  it("משתמש פנימי כותב בצ׳אט", async () => {
    const tag = await findOrCreateTag("בדק בית", adminId);
    const message = await addTagMessage(managerAViewer, tag.id, "מי לוקח את החשמל?");
    expect(message.tagId).toBe(tag.id);
    expect(message.text).toBe("מי לוקח את החשמל?");
    expect(message.authorUserId).toBe(managerAId);
  });

  it("נמען שלא נפתחה לו התגית אינו כותב בצ׳אט", async () => {
    const tag = await findOrCreateTag("בדק בית", adminId);
    const contractor: Viewer = { kind: "professional", id: electricianId };
    await expect(addTagMessage(contractor, tag.id, "שלום")).rejects.toThrow(TagError);
  });

  it("נמען שנפתחה לו התגית כותב בצ׳אט", async () => {
    const tag = await findOrCreateTag("בדק בית", adminId);
    await grantTagAccess(adminViewer, tag.id, [electricianId]);
    const contractor: Viewer = { kind: "professional", id: electricianId };
    const message = await addTagMessage(contractor, tag.id, "אני לוקח");
    expect(message.authorProfessionalId).toBe(electricianId);
  });

  it("הודעה ריקה בלי מדיה נדחית", async () => {
    const tag = await findOrCreateTag("בדק בית", adminId);
    await expect(addTagMessage(managerAViewer, tag.id, "   ")).rejects.toThrow(he.ticket.emptyMessage);
  });

  it("מצרף מדיה שהועלתה להודעת הצ׳אט", async () => {
    const tag = await findOrCreateTag("בדק בית", adminId);
    const media = await db.mediaFile.create({
      data: { storageKey: "k/1.pdf", mimeType: "application/pdf", sizeBytes: 10, uploaded: true },
    });
    const message = await addTagMessage(adminViewer, tag.id, "", [media.id]);

    const updated = await db.mediaFile.findUniqueOrThrow({ where: { id: media.id } });
    expect(updated.messageId).toBe(message.id);
    expect(message.kind).toBe("MEDIA");
  });
});

describe("פתיחת תגית לקבלנים", () => {
  it("יוצרת גישה, מבטיחה קישור, ורושמת אירוע — ומחזירה את השמות", async () => {
    const tag = await findOrCreateTag("בדק בית", adminId);
    const names = await grantTagAccess(adminViewer, tag.id, [electricianId, plumberId]);

    expect(names).toEqual(["יוסי חשמלאי", "דוד אינסטלטור"]);
    expect(await db.tagAccess.count({ where: { tagId: tag.id } })).toBe(2);
    // כל קבלן שנפתח קיבל קישור פורטל פעיל.
    expect(await db.accessToken.count({ where: { professionalId: electricianId, revokedAt: null } }))
      .toBe(1);
    // האירוע נרשם בצ׳אט.
    const event = await db.message.findFirst({ where: { tagId: tag.id, kind: "EVENT" } });
    expect(event?.eventType).toBe("TAG_GRANTED");
  });

  it("אידמפוטנטית — פתיחה חוזרת אינה משכפלת גישה", async () => {
    const tag = await findOrCreateTag("בדק בית", adminId);
    await grantTagAccess(adminViewer, tag.id, [electricianId]);
    await grantTagAccess(adminViewer, tag.id, [electricianId]);
    expect(await db.tagAccess.count({ where: { tagId: tag.id } })).toBe(1);
  });

  it("בעלים אינו רשאי לפתוח תגית", async () => {
    const tag = await findOrCreateTag("בדק בית", adminId);
    const owner: Viewer = { kind: "user", id: "u-owner", role: "OWNER", siteId: null };
    await expect(grantTagAccess(owner, tag.id, [electricianId])).rejects.toThrow(TagError);
  });
});

describe("getTagContractorLink — החוליה שסוגרת את הפתיחה", () => {
  it("מחזיר קישור פורטל לקבלן שנפתחה לו התגית", async () => {
    const tag = await findOrCreateTag("בדק בית", adminId);
    await grantTagAccess(adminViewer, tag.id, [electricianId]);
    const link = await getTagContractorLink(adminViewer, tag.id, electricianId);
    expect(link).toContain("/p/");
  });

  it("מסרב לקבלן שהתגית לא נפתחה לו", async () => {
    const tag = await findOrCreateTag("בדק בית", adminId);
    await expect(getTagContractorLink(adminViewer, tag.id, electricianId)).rejects.toThrow(TagError);
  });

  it("בעלים אינו רשאי לשלוף קישור", async () => {
    const tag = await findOrCreateTag("בדק בית", adminId);
    await grantTagAccess(adminViewer, tag.id, [electricianId]);
    const owner: Viewer = { kind: "user", id: "u-owner", role: "OWNER", siteId: null };
    await expect(getTagContractorLink(owner, tag.id, electricianId)).rejects.toThrow(TagError);
  });
});

describe("ביטול גישת תגית", () => {
  it("מסירה גישה, רושמת אירוע, והורגת את הקישור כשלא נותר דבר", async () => {
    const tag = await findOrCreateTag("בדק בית", adminId);
    await grantTagAccess(adminViewer, tag.id, [electricianId]);

    // בלי שיוכים ובלי תגיות אחרות — הקישור אמור למות.
    const link = await db.accessToken.findFirstOrThrow({ where: { professionalId: electricianId } });
    await revokeTagAccess(adminViewer, tag.id, electricianId);

    expect(await db.tagAccess.count({ where: { tagId: tag.id } })).toBe(0);
    const event = await db.message.findFirst({
      where: { tagId: tag.id, kind: "EVENT", eventType: "TAG_REVOKED" },
    });
    expect(event).not.toBeNull();
    const token = await db.accessToken.findUniqueOrThrow({ where: { id: link.id } });
    expect(token.revokedAt).not.toBeNull();
  });

  it("אינה הורגת את הקישור אם לקבלן נותרה תגית אחרת", async () => {
    const tagA = await findOrCreateTag("בדק בית א", adminId);
    const tagB = await findOrCreateTag("בדק בית ב", adminId);
    await grantTagAccess(adminViewer, tagA.id, [electricianId]);
    await grantTagAccess(adminViewer, tagB.id, [electricianId]);

    await revokeTagAccess(adminViewer, tagA.id, electricianId);

    expect(await db.accessToken.count({ where: { professionalId: electricianId, revokedAt: null } }))
      .toBe(1);
  });
});

describe("הפורטל של הקבלן — צ׳אט בלבד, לעולם לא פניות", () => {
  it("מציג רק תגיות שנפתחו לקבלן", async () => {
    const opened = await findOrCreateTag("נפתחה", adminId);
    await findOrCreateTag("סגורה", adminId);
    await grantTagAccess(adminViewer, opened.id, [electricianId]);

    const chats = await listPortalTagChats(electricianId);
    expect(chats.map((c) => c.name)).toEqual(["נפתחה"]);
  });

  it("צ׳אט בודד נגיש רק אם התגית נפתחה לקבלן", async () => {
    const tag = await findOrCreateTag("בדק בית", adminId);
    await ensureAccessToken(db, electricianId);
    // לפני פתיחה — אין גישה.
    expect(await getPortalTagChat(electricianId, tag.id)).toBeNull();

    await grantTagAccess(adminViewer, tag.id, [electricianId]);
    const chat = await getPortalTagChat(electricianId, tag.id);
    expect(chat?.tag.id).toBe(tag.id);
    // הכלל המרכזי: החזרת הצ׳אט אינה כוללת פניות כלל.
    expect(chat).not.toHaveProperty("tickets");
  });

  it("קבלן אחר אינו רואה צ׳אט שנפתח לעמיתו", async () => {
    const tag = await findOrCreateTag("בדק בית", adminId);
    await grantTagAccess(adminViewer, tag.id, [electricianId]);
    expect(await getPortalTagChat(plumberId, tag.id)).toBeNull();
  });
});
