import { readFile, rm } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { MediaError, confirmUpload, getViewableMedia, registerMedia } from "@/lib/services/media";
import { addMessage, closeTicket, createTicket, removeAssignment } from "@/lib/services/tickets";
import type { SessionUser } from "@/lib/session";
import { resolveKey, writeLocalObject } from "@/lib/storage/local";
import type { Viewer } from "@/lib/permissions";
import { resetDb } from "../helpers/reset-db";

/**
 * מסלול המדיה: רישום, העלאה, אישור, וצירוף להודעה.
 *
 * מה שנבדק כאן הוא מי רשאי לצרף ומי רשאי לראות. אלה השאלות שאפשר לטעות
 * בהן בשקט — קובץ שמוצג למי שאסור לו לראות אותו לא מייצר שום שגיאה.
 */

let manager: SessionUser;
let managerViewer: Viewer;
let siteId: string;
let base: Record<string, string>;
let contractor: string;
let stranger: string;

beforeEach(async () => {
  await resetDb();
  process.env.APP_BASE_URL ??= "http://localhost:3100";

  siteId = (await db.site.create({ data: { name: "אתר" } })).id;
  const building = await db.building.create({ data: { siteId, name: "בניין א" } });
  const apartment = await db.apartment.create({ data: { buildingId: building.id, number: "1" } });
  const domain = await db.domain.create({ data: { name: "חשמל" } });
  base = { buildingId: building.id, apartmentId: apartment.id, domainId: domain.id };

  contractor = (await db.professional.create({ data: { name: "יוסי", phone: "0501111111" } })).id;
  stranger = (await db.professional.create({ data: { name: "משה", phone: "0502222222" } })).id;

  const user = await db.user.create({
    data: { role: "SITE_MANAGER", name: "דוד", phone: "0500000001", passwordHash: "x", siteId },
  });
  manager = { id: user.id, name: user.name, role: user.role, siteId: user.siteId };
  managerViewer = { kind: "user", ...manager };
});

afterAll(async () => {
  await db.$disconnect();
});

async function makeTicket() {
  const { ticket } = await createTicket(manager, {
    siteId,
    ...base,
    description: "אין חשמל",
    recipients: [{ kind: "professional", id: contractor }],
  });
  return ticket;
}

const photo = { mimeType: "image/jpeg", sizeBytes: 1024, originalName: "IMG_0001.jpg" };

describe("registerMedia", () => {
  it("יוצר רשומה לא-מאושרת ומחזיר יעד העלאה", async () => {
    const ticket = await makeTicket();

    const { mediaId, upload } = await registerMedia(managerViewer, { ticketId: ticket.id, ...photo });

    const stored = await db.mediaFile.findUniqueOrThrow({ where: { id: mediaId } });
    expect(stored.uploaded).toBe(false);
    expect(stored.storageKey).toMatch(/^media\/\d{4}\/\d{2}\/.+\.jpg$/);
    expect(upload.url).toContain(stored.storageKey);
  });

  it("דוחה סוג קובץ שאינו ברשימת ההיתר", async () => {
    const ticket = await makeTicket();

    await expect(
      registerMedia(managerViewer, {
        ticketId: ticket.id,
        mimeType: "application/x-msdownload",
        sizeBytes: 10,
      }),
    ).rejects.toThrow(MediaError);
  });

  it("דוחה קובץ מעל התקרה, ואינו יוצר רשומה", async () => {
    const ticket = await makeTicket();

    await expect(
      registerMedia(managerViewer, { ticketId: ticket.id, ...photo, sizeBytes: 200 * 1024 * 1024 }),
    ).rejects.toThrow(MediaError);

    expect(await db.mediaFile.count()).toBe(0);
  });

  it("דורש הרשאת כתיבה, לא רק צפייה", async () => {
    // הכלל: מי שאינו רשאי להגיב אינו רשאי לצרף. בלעדיו הפנייה הסגורה
    // ממשיכה לצבור קבצים.
    const ticket = await makeTicket();
    await closeTicket(managerViewer, ticket.id);

    await expect(
      registerMedia({ kind: "professional", id: contractor }, { ticketId: ticket.id, ...photo }),
    ).rejects.toThrow(MediaError);
  });

  it("דוחה קבלן שאינו משויך לפנייה", async () => {
    const ticket = await makeTicket();

    await expect(
      registerMedia({ kind: "professional", id: stranger }, { ticketId: ticket.id, ...photo }),
    ).rejects.toThrow(MediaError);
  });
});

describe("confirmUpload", () => {
  it("מסמן שההעלאה הושלמה, ואידמפוטנטי", async () => {
    const ticket = await makeTicket();
    const { mediaId } = await registerMedia(managerViewer, { ticketId: ticket.id, ...photo });

    expect((await confirmUpload(mediaId)).uploaded).toBe(true);
    expect((await confirmUpload(mediaId)).uploaded).toBe(true);
  });
});

describe("צירוף להודעה", () => {
  it("קובץ מאושר נכנס לשרשור", async () => {
    const ticket = await makeTicket();
    const { mediaId } = await registerMedia(managerViewer, { ticketId: ticket.id, ...photo });
    await confirmUpload(mediaId);

    const message = await addMessage(managerViewer, ticket.id, "הנה התמונה", [mediaId]);

    const stored = await db.mediaFile.findUniqueOrThrow({ where: { id: mediaId } });
    expect(stored.messageId).toBe(message.id);
    expect(message.kind).toBe("MEDIA");
  });

  it("תמונה בלי טקסט היא הודעה תקינה", async () => {
    // ולעיתים ההודעה המדויקת ביותר: קבלן מצלם את מה שתיקן.
    const ticket = await makeTicket();
    const { mediaId } = await registerMedia(managerViewer, { ticketId: ticket.id, ...photo });
    await confirmUpload(mediaId);

    const message = await addMessage(managerViewer, ticket.id, "", [mediaId]);
    expect(message.text).toBeNull();
  });

  it("הודעה בלי טקסט ובלי קבצים נדחית", async () => {
    const ticket = await makeTicket();
    await expect(addMessage(managerViewer, ticket.id, "   ")).rejects.toThrow();
  });

  it("קובץ שלא אושר אינו מצורף", async () => {
    // העלאה שנקטעה. הצגתה בשרשור הייתה מייצרת תמונה שבורה.
    const ticket = await makeTicket();
    const { mediaId } = await registerMedia(managerViewer, { ticketId: ticket.id, ...photo });

    await addMessage(managerViewer, ticket.id, "טקסט", [mediaId]);

    expect((await db.mediaFile.findUniqueOrThrow({ where: { id: mediaId } })).messageId).toBeNull();
  });

  it("קובץ ששויך כבר להודעה אחרת אינו נגנב לפנייה שנייה", async () => {
    // בלי התנאי הזה אפשר היה לצרף לפנייה שלי קובץ ששייך לפנייה של מישהו
    // אחר, ולעקוף את בדיקת ההרשאה שנעשית בעת ההגשה.
    const first = await makeTicket();
    const second = await makeTicket();
    const { mediaId } = await registerMedia(managerViewer, { ticketId: first.id, ...photo });
    await confirmUpload(mediaId);

    const original = await addMessage(managerViewer, first.id, "ראשונה", [mediaId]);
    await addMessage(managerViewer, second.id, "שנייה", [mediaId]);

    expect((await db.mediaFile.findUniqueOrThrow({ where: { id: mediaId } })).messageId).toBe(
      original.id,
    );
  });
});

describe("getViewableMedia", () => {
  async function attachedMedia() {
    const ticket = await makeTicket();
    const { mediaId } = await registerMedia(managerViewer, { ticketId: ticket.id, ...photo });
    await confirmUpload(mediaId);
    await addMessage(managerViewer, ticket.id, "תמונה", [mediaId]);
    return { ticket, mediaId };
  }

  it("מחזיר קובץ למי שרשאי לראות את הפנייה", async () => {
    const { mediaId } = await attachedMedia();

    expect(await getViewableMedia(managerViewer, mediaId)).not.toBeNull();
    expect(await getViewableMedia({ kind: "professional", id: contractor }, mediaId)).not.toBeNull();
  });

  it("אינו מחזיר קובץ למי שאינו משויך", async () => {
    const { mediaId } = await attachedMedia();
    expect(await getViewableMedia({ kind: "professional", id: stranger }, mediaId)).toBeNull();
  });

  it("קבלן שהוסר מהפנייה מאבד גם את הקבצים שלה", async () => {
    // אותו כלל בדיוק כמו בפנייה עצמה: ההרשאה נבדקת בכל בקשה.
    const { ticket, mediaId } = await attachedMedia();
    const assignment = await db.assignment.findFirstOrThrow({ where: { ticketId: ticket.id } });
    await removeAssignment(managerViewer, assignment.id);

    expect(await getViewableMedia({ kind: "professional", id: contractor }, mediaId)).toBeNull();
  });

  it("אינו מחזיר קובץ שטרם צורף להודעה", async () => {
    const ticket = await makeTicket();
    const { mediaId } = await registerMedia(managerViewer, { ticketId: ticket.id, ...photo });
    await confirmUpload(mediaId);

    expect(await getViewableMedia(managerViewer, mediaId)).toBeNull();
  });
});

describe("מדיה במסך היצירה — לפני שהפנייה קיימת", () => {
  it("משתמש פנימי רשאי להעלות בלי פנייה", async () => {
    // זהו המסלול בשטח: מצלמים מול הדירה, וממלאים את השדות אחר כך.
    const { mediaId } = await registerMedia(managerViewer, photo);
    expect(await db.mediaFile.findUniqueOrThrow({ where: { id: mediaId } })).toBeTruthy();
  });

  it("נמען חיצוני אינו רשאי — הוא חייב פנייה שהוא משויך אליה", async () => {
    // בלי פנייה אין מול מה לבדוק הרשאה. קבלן אינו פותח פניות ממילא.
    await expect(
      registerMedia({ kind: "professional", id: contractor }, photo),
    ).rejects.toThrow(MediaError);
  });

  it("הקבצים נכנסים לשרשור של הפנייה שנוצרת", async () => {
    const { mediaId } = await registerMedia(managerViewer, photo);
    await confirmUpload(mediaId);

    const { ticket } = await createTicket(manager, {
      siteId,
      ...base,
      description: "סדק בקיר",
      recipients: [{ kind: "professional", id: contractor }],
      mediaIds: [mediaId],
    });

    const stored = await db.mediaFile.findUniqueOrThrow({
      where: { id: mediaId },
      include: { message: true },
    });
    expect(stored.message?.ticketId).toBe(ticket.id);
    expect(stored.message?.kind).toBe("MEDIA");
  });

  it("כמה קבצים נכנסים להודעה אחת ולא לארבע", async () => {
    // מנהל שצילם ארבע תמונות של אותה תקלה תיאר אירוע אחד.
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const { mediaId } = await registerMedia(managerViewer, photo);
      await confirmUpload(mediaId);
      ids.push(mediaId);
    }

    const { ticket } = await createTicket(manager, {
      siteId,
      ...base,
      description: "כמה תמונות",
      recipients: [{ kind: "professional", id: contractor }],
      mediaIds: ids,
    });

    const messages = await db.message.findMany({
      where: { ticketId: ticket.id, kind: "MEDIA" },
      include: { media: true },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.media).toHaveLength(3);
  });

  it("גם טיוטה שומרת את הצילום", async () => {
    // הצילום נעשה לפני שהשדות מולאו, והוא המידע שהכי קשה לשחזר — אי אפשר
    // לחזור לדירה ולצלם שוב אחרי שהקבלן תיקן.
    const { mediaId } = await registerMedia(managerViewer, photo);
    await confirmUpload(mediaId);

    const { ticket, isDraft } = await createTicket(manager, {
      siteId,
      description: "",
      mediaIds: [mediaId],
    });

    expect(isDraft).toBe(true);
    const stored = await db.mediaFile.findUniqueOrThrow({
      where: { id: mediaId },
      include: { message: true },
    });
    expect(stored.message?.ticketId).toBe(ticket.id);
  });
});

describe("אחסון מקומי", () => {
  it("כותב וקורא את הבתים בפועל", async () => {
    // הדרייבר המקומי אינו מימוש מדומה: הוא כותב קבצים אמיתיים, ולכן כל
    // מסלול המדיה ניתן להרצה מלאה בלי חשבון בענן.
    const key = `media/2026/07/${crypto.randomUUID()}.jpg`;
    const body = Buffer.from("בדיקה", "utf8");

    await writeLocalObject(key, body);
    expect(await readFile(resolveKey(key))).toEqual(body);

    await rm(resolveKey(key), { force: true });
  });
});
