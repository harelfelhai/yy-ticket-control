import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Viewer } from "@/lib/permissions";
import { confirmUpload, registerMedia } from "@/lib/services/media";
import { writeLocalObject } from "@/lib/storage/local";
import { RESULT_LIMIT, searchTickets } from "@/lib/services/search";
import { addTagMessage, addTagToTicket, findOrCreateTag } from "@/lib/services/tags";
import { addMessage, closeTicket, createTicket } from "@/lib/services/tickets";
import type { SessionUser } from "@/lib/session";
import { resetDb } from "../helpers/reset-db";

/**
 * החיפוש (מסך 9).
 *
 * מה שנבדק כאן במיוחד: שהחיפוש באמת חוצה **את התמלול ואת הטקסט המחולץ**
 * (אפיון §3.6). זו הסיבה שעיבוד ה-AI קיים — הקלטה שאי אפשר לחפש בה היא
 * קובץ שמישהו צריך לזכור שהוא קיים.
 */

let admin: SessionUser;
let manager: SessionUser;
let adminViewer: Viewer;
let siteA: string;
let siteB: string;
let base: Record<string, string>;
let contractor: string;

beforeEach(async () => {
  await resetDb();
  process.env.APP_BASE_URL ??= "http://localhost:3100";

  siteA = (await db.site.create({ data: { name: "אתר א" } })).id;
  siteB = (await db.site.create({ data: { name: "אתר ב" } })).id;

  const building = await db.building.create({ data: { siteId: siteA, name: "בניין א" } });
  const apartment = await db.apartment.create({ data: { buildingId: building.id, number: "1" } });
  const domain = await db.domain.create({ data: { name: "חשמל" } });
  base = { buildingId: building.id, apartmentId: apartment.id, domainId: domain.id };

  contractor = (await db.professional.create({ data: { name: "יוסי", phone: "0501111111" } })).id;

  const adminUser = await db.user.create({
    data: { role: "ADMIN", name: "רון", phone: "0500000000", passwordHash: "x" },
  });
  admin = { id: adminUser.id, name: adminUser.name, role: adminUser.role, siteId: null };
  adminViewer = { kind: "user", ...admin };

  const managerUser = await db.user.create({
    data: {
      role: "SITE_MANAGER",
      name: "דוד",
      phone: "0500000001",
      passwordHash: "x",
      siteId: siteA,
    },
  });
  manager = {
    id: managerUser.id,
    name: managerUser.name,
    role: managerUser.role,
    siteId: managerUser.siteId,
  };
});

afterAll(async () => {
  await db.$disconnect();
});

async function makeTicket(description: string, overrides: Record<string, unknown> = {}) {
  const { ticket } = await createTicket(admin, {
    siteId: siteA,
    ...base,
    description,
    recipients: [{ kind: "professional", id: contractor }],
    ...overrides,
  });
  return ticket;
}

/** מצרף קובץ להודעה ומזין לו תוצר AI, כאילו העיבוד הסתיים */
async function attachProcessedMedia(
  ticketId: string,
  mimeType: string,
  aiFields: { transcription?: string; extractedText?: string },
) {
  const { mediaId } = await registerMedia(adminViewer, {
    ticketId,
    mimeType,
    sizeBytes: 100,
  });
  // confirmUpload מאמת שהבתים נחתו — כותבים אותם כמו ב-PUT מהדפדפן.
  const stored = await db.mediaFile.findUniqueOrThrow({
    where: { id: mediaId },
    select: { storageKey: true },
  });
  await writeLocalObject(stored.storageKey, Buffer.from("bytes"));
  await confirmUpload(adminViewer, mediaId);
  await addMessage(adminViewer, ticketId, "", [mediaId]);
  await db.mediaFile.update({
    where: { id: mediaId },
    data: { ...aiFields, aiStatus: "DONE" },
  });
}

describe("חיפוש חופשי", () => {
  it("מוצא לפי תיאור הפנייה", async () => {
    await makeTicket("יש נזילה מתחת לכיור");
    await makeTicket("החשמל בסלון לא עובד");

    const { cards } = await searchTickets(admin, { query: "נזילה" });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.descriptionLine).toContain("נזילה");
  });

  it("מוצא לפי הודעה בשרשור", async () => {
    const ticket = await makeTicket("תקלה כללית");
    await addMessage(adminViewer, ticket.id, "בדקתי, הבעיה בלוח החשמל בקומה שנייה");

    const { cards } = await searchTickets(admin, { query: "לוח החשמל" });
    expect(cards).toHaveLength(1);
  });

  it("מוצא לפי תמלול הקלטה", async () => {
    // זה מה שהופך הקלטה קולית לנכס ולא לקובץ שצריך לזכור שהוא קיים.
    const ticket = await makeTicket("תקלה");
    await attachProcessedMedia(ticket.id, "audio/webm", {
      transcription: "הדוד על הגג לא מחמם מים",
    });

    const { cards } = await searchTickets(admin, { query: "הדוד על הגג" });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.id).toBe(ticket.id);
  });

  it("מוצא לפי טקסט שחולץ מתמונה או מ-PDF", async () => {
    const ticket = await makeTicket("דוח בדק בית");
    await attachProcessedMedia(ticket.id, "image/png", {
      extractedText: "ליקוי 12: רטיבות בקיר המערבי",
    });

    const { cards } = await searchTickets(admin, { query: "רטיבות" });
    expect(cards).toHaveLength(1);
  });

  it("אינו רגיש לרישיות באנגלית", async () => {
    await makeTicket("החלפת דוד SOLAR 150");

    expect((await searchTickets(admin, { query: "solar" })).cards).toHaveLength(1);
  });

  it("מתעלם מרווחים מיותרים סביב המונח", async () => {
    await makeTicket("יש נזילה");
    expect((await searchTickets(admin, { query: "  נזילה  " })).cards).toHaveLength(1);
  });

  it("מחזיר ריק כשאין התאמה", async () => {
    await makeTicket("משהו אחר");
    expect((await searchTickets(admin, { query: "אלומיניום" })).cards).toHaveLength(0);
  });

  it("מוצא פנייה לפי טקסט בצ׳אט התגית המשותפת", async () => {
    // דוח בדק בית יושב בצ׳אט התגית (מסך 5, אזור א׳), והאפיון דורש שהטקסט
    // שלו יהיה "זמין לחיפוש". חיפוש מילה מהדוח מעלה את כל פניות התגית —
    // גם אחת שהמילה אינה מופיעה בתיאורה כלל.
    const ticket = await makeTicket("החלפת שקע בסלון");
    const tag = await findOrCreateTag("בדק בית דירה 12", admin.id);
    await addTagToTicket(adminViewer, ticket.id, tag.name);
    await addTagMessage(adminViewer, tag.id, "מצורף דוח: ליקוי איטום במרפסת השירות");

    const { cards } = await searchTickets(admin, { query: "איטום במרפסת" });
    expect(cards.map((c) => c.id)).toContain(ticket.id);
  });
});

describe("הרשאות", () => {
  it("מנהל עבודה מוגבל לאתר שלו", async () => {
    await makeTicket("נזילה באתר א");
    await createTicket(admin, {
      siteId: siteB,
      description: "נזילה באתר ב",
      recipients: [{ kind: "professional", id: contractor }],
    });

    expect((await searchTickets(manager, { query: "נזילה" })).cards).toHaveLength(1);
    expect((await searchTickets(admin, { query: "נזילה" })).cards).toHaveLength(2);
  });

  it("מנהל עבודה ללא אתר — fail-closed: תוצאה ריקה ולא כל האתרים", async () => {
    await makeTicket("נזילה באתר א");
    const noSite: SessionUser = { id: "x", name: "תקול", role: "SITE_MANAGER", siteId: null };
    const result = await searchTickets(noSite, { query: "נזילה" });
    expect(result.cards).toEqual([]);
  });
});

describe("מסננים", () => {
  it("מסנן לפי תחום", async () => {
    const other = await db.domain.create({ data: { name: "אינסטלציה" } });
    await makeTicket("תקלה חשמל");
    await makeTicket("תקלה מים", { domainId: other.id });

    const { cards } = await searchTickets(admin, { query: "תקלה", domainId: other.id });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.domainName).toBe("אינסטלציה");
  });

  it("מסנן לפי סטטוס נגזר", async () => {
    // הסטטוס אינו שמור בטבלה אלא נגזר מהשיוכים, ולכן הסינון נעשה בזיכרון
    // אחרי השליפה. הבדיקה מוודאת שהוא בכל זאת עובד מקצה לקצה.
    const open = await makeTicket("תקלה פתוחה");
    const closed = await makeTicket("תקלה סגורה");
    await closeTicket(adminViewer, closed.id);

    const { cards } = await searchTickets(admin, { query: "תקלה", status: "CLOSED" });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.id).toBe(closed.id);
    expect(cards[0]?.id).not.toBe(open.id);
  });

  it("מסנן לפי טווח תאריכים, כולל היום האחרון במלואו", async () => {
    // משתמש שבוחר "עד 22.7" מתכוון לכלול את כל אותו יום ולא רק את חצות.
    const ticket = await makeTicket("תקלה ישנה");
    const day = new Date("2026-03-15T14:30:00Z");
    await db.ticket.update({ where: { id: ticket.id }, data: { createdAt: day } });

    const inside = await searchTickets(admin, {
      query: "תקלה",
      from: new Date("2026-03-15T00:00:00Z"),
      to: new Date("2026-03-15T00:00:00Z"),
    });
    expect(inside.cards).toHaveLength(1);

    const outside = await searchTickets(admin, {
      query: "תקלה",
      to: new Date("2026-03-14T00:00:00Z"),
    });
    expect(outside.cards).toHaveLength(0);
  });

  it("מסננים בלי מונח חיפוש מחזירים את כל מה שתואם", async () => {
    await makeTicket("ראשונה");
    await makeTicket("שנייה");

    expect((await searchTickets(admin, { domainId: base.domainId })).cards).toHaveLength(2);
  });
});

describe("חיתוך תוצאות", () => {
  it("מסמן במפורש שהרשימה נחתכה", async () => {
    // רשימה חתוכה שנראית מלאה היא הטעיה: המנהל יסיק שהפנייה שהוא מחפש
    // אינה קיימת.
    for (let i = 0; i < RESULT_LIMIT + 5; i += 1) {
      await makeTicket(`תקלה חוזרת ${i}`);
    }

    const result = await searchTickets(admin, { query: "תקלה חוזרת" });

    expect(result.cards).toHaveLength(RESULT_LIMIT);
    expect(result.truncated).toBe(true);
  });
});

describe("מסננים חדשים — אתר, תגית, דירה (§3.6)", () => {
  it("מנהל מערכת מסנן לאתר", async () => {
    await makeTicket("תקלה באתר א");
    await createTicket(admin, {
      siteId: siteB,
      description: "תקלה באתר ב",
      recipients: [{ kind: "professional", id: contractor }],
    });

    const result = await searchTickets(admin, { siteId: siteB });
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.descriptionLine).toBe("תקלה באתר ב");
  });

  it("מסנן לפי תגית", async () => {
    const tagged = await makeTicket("פנייה עם תגית");
    await makeTicket("פנייה בלי תגית");
    const tag = await addTagToTicket(adminViewer, tagged.id, "בדק בית");

    const result = await searchTickets(admin, { tagId: tag.id });
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.descriptionLine).toBe("פנייה עם תגית");
  });

  it("מסנן לפי דירה", async () => {
    await makeTicket("בדירה הראשונה");
    const otherApt = await db.apartment.create({
      data: { buildingId: base.buildingId, number: "9" },
    });
    await makeTicket("בדירה התשיעית", { apartmentId: otherApt.id });

    const result = await searchTickets(admin, { apartmentId: otherApt.id });
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.descriptionLine).toBe("בדירה התשיעית");
  });
});
