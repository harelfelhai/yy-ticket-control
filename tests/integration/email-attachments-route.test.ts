import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/email-attachments/[id]/route";
import { db } from "@/lib/db";
import type { Viewer } from "@/lib/permissions";
import { createTicket, removeAssignment } from "@/lib/services/tickets";
import { ensurePortalLink } from "@/lib/services/portal";
import * as viewerService from "@/lib/services/viewer";
import type { SessionUser } from "@/lib/session";
import { writeLocalObject } from "@/lib/storage/local";
import { resetDb } from "../helpers/reset-db";

/**
 * `GET /api/email-attachments/[id]` — הגשת קובץ מצורף מהתכתבות מייל.
 *
 * הבדיקה קוראת ל-`GET` ישירות (כמו `tests/integration/auth-gate.test.ts`
 * עושה ל-Route Handler בלי פרמטרים), ולא דרך שרת HTTP חי: אין כאן רשת, ואין
 * הבדל תפקודי בין קריאה ישירה לפונקציה לבין קריאה מעל HTTP — שתיהן מריצות
 * בדיוק את אותו קוד. המשתמש הפנימי נבדק עם `resolveViewer` מדומה (אין כאן
 * עוגיית סשן); קבלן — בטוקן פורטל אמיתי, בלי מוק, כמו ב-`e2e/media.spec.ts`.
 *
 * **מ-S8 קבלן אינו מקבל קובץ מההתכתבות, גם כשהוא משויך**: ההתכתבות הייתה עם
 * השולח ולא עם הנמענים, והיא כוללת גם את מה שהוסר בכוונה מהטיוטה לפני
 * השיגור (`canViewCorrespondence`).
 */

let manager: SessionUser;
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

/** קובץ מהתכתבות מייל, משויך לשרשור של הפנייה, עם בתים באחסון המקומי */
async function attachedFile(
  ticketId: string,
  overrides: {
    filename?: string;
    mimeType?: string;
    bytes?: Buffer;
    withThread?: boolean;
    skippedReason?: string;
    storageKey?: string | null;
  } = {},
) {
  const thread = await db.mailThread.create({
    data: { ticketId: overrides.withThread === false ? null : ticketId },
  });
  const message = await db.mailboxMessage.create({
    data: {
      direction: "INBOUND",
      threadId: overrides.withThread === false ? null : thread.id,
      fromAddress: "kablan@example.com",
    },
  });

  const bytes = overrides.bytes ?? Buffer.from("בתים של תמונה", "utf8");
  const mimeType = overrides.mimeType ?? "image/png";
  const filename = overrides.filename ?? "תמונה.png";

  let storageKey: string | null;
  if ("storageKey" in overrides) {
    storageKey = overrides.storageKey ?? null;
  } else {
    storageKey = `media/mail/${message.id}/0.png`;
    await writeLocalObject(storageKey, bytes);
  }

  const attachment = await db.mailboxAttachment.create({
    data: {
      messageId: message.id,
      partIndex: 0,
      filename,
      mimeType,
      sizeBytes: bytes.byteLength,
      isMedia: true,
      storageKey,
      skippedReason: overrides.skippedReason ?? null,
    },
  });

  return { thread, message, attachment, bytes };
}

/** מקבל טוקן פורטל אמיתי לקבלן, ומבצע בקשה כאילו זו לחיצה על קישור מהמייל */
async function requestAs(professionalId: string, attachmentId: string) {
  const link = await ensurePortalLink(professionalId);
  const token = new URL(link).pathname.replace("/p/", "");
  return request(attachmentId, token);
}

function request(attachmentId: string, token?: string) {
  const url = new URL(`http://localhost:3100/api/email-attachments/${attachmentId}`);
  if (token) url.searchParams.set("t", token);
  return GET(new Request(url), { params: Promise.resolve({ id: attachmentId }) });
}

/** בקשה כמשתמש פנימי — מנהל האתר של הפנייה */
async function requestAsManager(attachmentId: string) {
  const spy = vi.spyOn(viewerService, "resolveViewer").mockResolvedValueOnce({ kind: "user", ...manager });
  try {
    return await request(attachmentId, "any-token-ignored-by-mock");
  } finally {
    spy.mockRestore();
  }
}

describe("הגשת קובץ — מנהל האתר", () => {
  it("EM-M01 — מגיש את הבתים בפועל, עם כותרות תוכן נכונות", async () => {
    const ticket = await makeTicket();
    const { attachment, bytes } = await attachedFile(ticket.id, { filename: "קיר.png" });

    const response = await requestAsManager(attachment.id);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Length")).toBe(String(bytes.byteLength));
    expect(response.headers.get("Content-Disposition")).toBe(
      `inline; filename*=UTF-8''${encodeURIComponent("קיר.png")}`,
    );
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  it("EM-M01 — שם קובץ ריק נופל ל-'file'", async () => {
    const ticket = await makeTicket();
    const { attachment } = await attachedFile(ticket.id);
    await db.mailboxAttachment.update({ where: { id: attachment.id }, data: { filename: null } });

    const response = await requestAsManager(attachment.id);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe("inline; filename*=UTF-8''file");
  });
});

describe("הגשת קובץ — הרשאה", () => {
  it("S8 — קבלן משויך לפנייה מקבל 404: ההתכתבות אינה חלק ממה שהנמען רואה", async () => {
    const ticket = await makeTicket();
    const { attachment } = await attachedFile(ticket.id);

    const response = await requestAs(contractor, attachment.id);
    expect(response.status).toBe(404);
  });

  it("EM-M01 — קבלן שאינו משויך לפנייה מקבל 404", async () => {
    const ticket = await makeTicket();
    const { attachment } = await attachedFile(ticket.id);

    const response = await requestAs(stranger, attachment.id);
    expect(response.status).toBe(404);
  });

  it("EM-M01 — קבלן שהוסר מהשיוך מאבד גישה, כמו במדיה", async () => {
    const ticket = await makeTicket();
    const { attachment } = await attachedFile(ticket.id);
    const assignment = await db.assignment.findFirstOrThrow({ where: { ticketId: ticket.id } });
    await removeAssignment({ kind: "user", ...manager }, assignment.id);

    const response = await requestAs(contractor, attachment.id);
    expect(response.status).toBe(404);
  });

  it("EM-M01 — טוקן לא תקף מקבל 404, ולא חריגה", async () => {
    const ticket = await makeTicket();
    const { attachment } = await attachedFile(ticket.id);

    const response = await request(attachment.id, "token-שלא-קיים-במערכת");
    expect(response.status).toBe(404);
  });

  it("EM-M01 — מזהה קובץ שאינו קיים מקבל 404, אותה תשובה כמו חוסר הרשאה", async () => {
    const response = await requestAs(contractor, "no-such-attachment");
    expect(response.status).toBe(404);
  });
});

describe("הגשת קובץ — מצבי שרשור (§2.6 שלב 6, §7)", () => {
  it("EM-M01 — קובץ בלי שרשור (threadId ריק) אינו נגיש, נחשב לא נמצא", async () => {
    const ticket = await makeTicket();
    const { attachment } = await attachedFile(ticket.id, { withThread: false });

    const response = await requestAs(contractor, attachment.id);
    expect(response.status).toBe(404);
  });

  it("EM-M01 — קובץ בלי שרשור: גם מנהל מערכת מקבל 404, לא רק קבלן לא-משויך", async () => {
    // הבדיקה הקודמת משתמשת בקבלן, שאצלו "לא נמצא" ו"אין הרשאה" (בלי
    // שיוכים) מסתיימים באותה תוצאה — ולכן לא הייתה מבחינה בין ticket חסר
    // לבין assignments ריקים. מנהל מערכת עוקף את בדיקת השיוכים לגמרי
    // (`canViewTicket` מחזיר true לכל ticket כש-role===ADMIN), ולכן 404 כאן
    // מוכיח בפועל שהיעדר ticket נבדק בפני עצמו ולפני ההרשאה.
    const ticket = await makeTicket();
    const { attachment } = await attachedFile(ticket.id, { withThread: false });

    const admin: Viewer = { kind: "user", id: "admin-2", role: "ADMIN", siteId: null };
    const spy = vi.spyOn(viewerService, "resolveViewer").mockResolvedValueOnce(admin);
    try {
      const response = await request(attachment.id, "any-token-ignored-by-mock");
      expect(response.status).toBe(404);
    } finally {
      spy.mockRestore();
    }
  });

  it("EM-18 — תשובה אחרי שהטיוטה נמחקה: השרשור נשאר, ticketId מתאפס ל-null, והקובץ 404", async () => {
    // בדיוק המנגנון שהאפיון מתאר: "תשובה במייל אחרי שהטיוטה נמחקה: אינה
    // נקלטת". SetNull על MailThread.ticketId הוא מה שמנקה JOIN בפועל —
    // לא מחיקה ידנית של שדה.
    const ticket = await makeTicket();
    const { attachment, thread } = await attachedFile(ticket.id);

    await db.ticket.delete({ where: { id: ticket.id } });
    expect((await db.mailThread.findUniqueOrThrow({ where: { id: thread.id } })).ticketId).toBeNull();

    const response = await requestAs(contractor, attachment.id);
    expect(response.status).toBe(404);
  });

  it("EM-18 — טיוטה שנמחקה: גם מנהל מערכת מקבל 404 על הקובץ (אותו נימוק כמו למעלה)", async () => {
    const ticket = await makeTicket();
    const { attachment, thread } = await attachedFile(ticket.id);
    await db.ticket.delete({ where: { id: ticket.id } });
    expect((await db.mailThread.findUniqueOrThrow({ where: { id: thread.id } })).ticketId).toBeNull();

    const admin: Viewer = { kind: "user", id: "admin-3", role: "ADMIN", siteId: null };
    const spy = vi.spyOn(viewerService, "resolveViewer").mockResolvedValueOnce(admin);
    try {
      const response = await request(attachment.id, "any-token-ignored-by-mock");
      expect(response.status).toBe(404);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("הגשת קובץ — בלי בתים באחסון", () => {
  it("EM-06a — קובץ שנשמר בהתכתבות בלבד (storageKey null) מקבל 404, גם למי שרשאי", async () => {
    // §2.6 שלב 3 / EM-06a: "נשמר בהתכתבות בלבד" — קובץ גדול מדי, כפילות, או
    // סוג שאינו מדיה. אין לו בתים להגיש, ולכן "לא נמצא" הוא נכון ולא באג.
    const ticket = await makeTicket();
    const { attachment } = await attachedFile(ticket.id, {
      storageKey: null,
      skippedReason: "too-large",
    });

    const response = await requestAs(contractor, attachment.id);
    expect(response.status).toBe(404);
  });
});

describe("הגשת קובץ — משתמש פנימי", () => {
  it("EM-M01 — מנהל מערכת רואה קובץ גם בלי להיות משויך לפנייה", async () => {
    const ticket = await makeTicket();
    const { attachment, bytes } = await attachedFile(ticket.id);

    const admin: Viewer = { kind: "user", id: "admin-1", role: "ADMIN", siteId: null };
    const spy = vi.spyOn(viewerService, "resolveViewer").mockResolvedValueOnce(admin);
    try {
      const response = await request(attachment.id, "any-token-ignored-by-mock");
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    } finally {
      spy.mockRestore();
    }
  });

  it("EM-M01 — מנהל עבודה של אתר אחר, בלי שיוך, מקבל 404", async () => {
    const ticket = await makeTicket();
    const { attachment } = await attachedFile(ticket.id);

    const otherSiteManager: Viewer = {
      kind: "user",
      id: "mgr-other",
      role: "SITE_MANAGER",
      siteId: "site-not-this-one",
    };
    const spy = vi.spyOn(viewerService, "resolveViewer").mockResolvedValueOnce(otherSiteManager);
    try {
      const response = await request(attachment.id, "any-token-ignored-by-mock");
      expect(response.status).toBe(404);
    } finally {
      spy.mockRestore();
    }
  });
});
