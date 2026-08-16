import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getBoard } from "@/lib/services/board";
import {
  addMessage,
  closeTicket,
  createTicket,
  setAssignmentStatus,
} from "@/lib/services/tickets";
import type { SessionUser } from "@/lib/session";
import { resetDb } from "../helpers/reset-db";

const NOW = new Date("2026-03-15T09:00:00Z");

let manager: SessionUser;
let otherSiteManager: SessionUser;
let admin: SessionUser;
let siteA: string;
let siteB: string;
let base: Record<string, string>;
let electrician: string;
let plumber: string;

const asUser = (u: SessionUser) => u;

beforeEach(async () => {
  await resetDb();

  siteA = (await db.site.create({ data: { name: "אתר א" } })).id;
  siteB = (await db.site.create({ data: { name: "אתר ב" } })).id;

  const building = await db.building.create({ data: { siteId: siteA, name: "בניין א" } });
  const apartment = await db.apartment.create({ data: { buildingId: building.id, number: "1" } });
  const domain = await db.domain.create({ data: { name: "חשמל" } });
  base = { buildingId: building.id, apartmentId: apartment.id, domainId: domain.id };

  electrician = (await db.professional.create({ data: { name: "יוסי", phone: "0501111111" } })).id;
  plumber = (await db.professional.create({ data: { name: "משה", phone: "0502222222" } })).id;

  const mk = async (name: string, phone: string, role: "SITE_MANAGER" | "ADMIN", site?: string) => {
    const user = await db.user.create({
      data: { role, name, phone, passwordHash: "x", siteId: site ?? null },
    });
    return { id: user.id, name: user.name, role: user.role, siteId: user.siteId };
  };

  manager = await mk("דוד", "0500000001", "SITE_MANAGER", siteA);
  otherSiteManager = await mk("רון", "0500000002", "SITE_MANAGER", siteB);
  admin = await mk("מנהל", "0500000003", "ADMIN");
});

afterAll(async () => {
  await db.$disconnect();
});

async function makeTicket(
  actor: SessionUser,
  overrides: Partial<Parameters<typeof createTicket>[1]> = {},
) {
  const { ticket } = await createTicket(actor, {
    siteId: siteA,
    ...base,
    description: "אין חשמל בסלון\nשורה שנייה שלא אמורה להופיע בכרטיס",
    recipients: [{ kind: "professional", id: electrician }],
    ...overrides,
  });
  return ticket;
}

describe("getBoard — קיבוץ לפי אצל מי הכדור", () => {
  it("פנייה חדשה נמצאת אצל הנמענים", async () => {
    await makeTicket(manager);
    const board = await getBoard(asUser(manager), {}, NOW);

    expect(board.sections.WITH_RECIPIENTS).toHaveLength(1);
    expect(board.sections.ACTION_REQUIRED).toHaveLength(0);
  });

  /**
   * המסלול שהחליף את "יש לי שאלה".
   *
   * שאלה מגיעה מעתה כהודעה רגילה בשרשור, ולכן הלוח חייב לזהות אותה לבד —
   * אחרת קבלן היה כותב "צריך מפתח לחדר החשמל" והפנייה הייתה נשארת ב"אצל
   * הנמענים", המקום שמנהל אינו סורק כי לכאורה מישהו אחר מטפל בה.
   */
  it("הודעה של נמען מעבירה את הפנייה ל'דורש ממך' עם שמו", async () => {
    const ticket = await makeTicket(manager);
    await addMessage(
      { kind: "professional", id: electrician },
      ticket.id,
      "צריך מפתח לחדר החשמל",
    );

    const board = await getBoard(asUser(manager), {}, NOW);

    expect(board.sections.ACTION_REQUIRED).toHaveLength(1);
    expect(board.sections.ACTION_REQUIRED[0]?.reason).toBe("יוסי כתב הודעה");
  });

  it("תשובת המנהל מחזירה את הפנייה לנמענים", async () => {
    // הדגל נגזר מההודעה האחרונה ואינו שדה שמור, ולכן הוא נופל מעצמו ברגע
    // שמישהו מהצוות עונה — בלי "סימון כנקרא" שצריך לזכור לבצע.
    const ticket = await makeTicket(manager);
    await addMessage({ kind: "professional", id: electrician }, ticket.id, "צריך מפתח");
    await addMessage({ kind: "user", ...manager }, ticket.id, "המפתח אצל השומר");

    const board = await getBoard(asUser(manager), {}, NOW);

    expect(board.sections.ACTION_REQUIRED).toHaveLength(0);
    expect(board.sections.WITH_RECIPIENTS).toHaveLength(1);
  });

  it("שיוך אינו נחשב להודעה שממתינה למענה", async () => {
    // "שויך ליוסי" הוא אירוע מערכת. בלי הסינון כל פנייה חדשה הייתה נוחתת
    // מיד ב"דורש ממך", וההבחנה בין שתי הקבוצות הייתה מתאיינת.
    await makeTicket(manager);
    const board = await getBoard(asUser(manager), {}, NOW);

    expect(board.sections.ACTION_REQUIRED).toHaveLength(0);
  });

  it("טיוטה נמצאת ב'דורש ממך'", async () => {
    await makeTicket(manager, { saveAsDraft: true });
    const board = await getBoard(asUser(manager), {}, NOW);

    expect(board.sections.ACTION_REQUIRED[0]?.status).toBe("DRAFT");
  });

  it("טיוטות מוצמדות לראש 'דורש ממך', לפני פניות אחרות שדורשות טיפול", async () => {
    // קודם פנייה שתעבור ל"דורש ממך" (כולם סיימו), ואז טיוטה — הטיוטה
    // חייבת לקפוץ לראש.
    const ticket = await makeTicket(manager);
    const assignment = await db.assignment.findFirstOrThrow({ where: { ticketId: ticket.id } });
    await setAssignmentStatus(assignment.id, "DONE");
    await makeTicket(manager, { saveAsDraft: true });

    const board = await getBoard(asUser(manager), {}, NOW);
    expect(board.sections.ACTION_REQUIRED).toHaveLength(2);
    // הטיוטה ראשונה, למרות שנוצרה אחרי — היא לא נדחפת אל מחוץ למסך.
    expect(board.sections.ACTION_REQUIRED[0]?.status).toBe("DRAFT");
    expect(board.sections.ACTION_REQUIRED[1]?.status).toBe("AWAITING_OPENER_APPROVAL");
  });

  it("פנייה סגורה עוברת לארכיון", async () => {
    const ticket = await makeTicket(manager);
    await closeTicket({ kind: "user", ...manager }, ticket.id);

    const board = await getBoard(asUser(manager), {}, NOW);
    expect(board.sections.ARCHIVE).toHaveLength(1);
    expect(board.sections.WITH_RECIPIENTS).toHaveLength(0);
  });

  it("פנייה מוסלמת עוברת ל'דורש ממך' עם מספר הימים", async () => {
    const ticket = await makeTicket(manager);
    await db.ticket.update({
      where: { id: ticket.id },
      data: { escalated: true, lastActivityAt: new Date(NOW.getTime() - 9 * 86_400_000) },
    });

    const board = await getBoard(asUser(manager), {}, NOW);
    expect(board.sections.ACTION_REQUIRED[0]?.reason).toBe("ללא תנועה 9 ימים");
  });

  it("טיפול חלקי מציג את היחס", async () => {
    const ticket = await makeTicket(manager, {
      recipients: [
        { kind: "professional", id: electrician },
        { kind: "professional", id: plumber },
      ],
    });
    const [first] = await db.assignment.findMany({ where: { ticketId: ticket.id } });
    await setAssignmentStatus(first!.id, "DONE");

    const board = await getBoard(asUser(manager), {}, NOW);
    expect(board.sections.WITH_RECIPIENTS[0]?.reason).toBe("1 מתוך 2 סיימו");
  });
});

describe("getBoard — הרשאות", () => {
  it("מנהל עבודה רואה את כל הפניות באתר שלו, גם כאלה שלא פתח", async () => {
    await makeTicket(admin);
    const board = await getBoard(asUser(manager), {}, NOW);
    expect(board.sections.WITH_RECIPIENTS).toHaveLength(1);
  });

  it("מנהל עבודה אינו רואה פניות מאתר אחר", async () => {
    await makeTicket(manager);
    const board = await getBoard(asUser(otherSiteManager), {}, NOW);
    expect(board.sections.WITH_RECIPIENTS).toHaveLength(0);
  });

  it("מנהל מערכת רואה את כל האתרים", async () => {
    await makeTicket(manager);
    await createTicket(admin, {
      siteId: siteB,
      description: "תקלה באתר ב",
      recipients: [{ kind: "professional", id: plumber }],
    });

    const board = await getBoard(asUser(admin), {}, NOW);
    const all = [...board.sections.ACTION_REQUIRED, ...board.sections.WITH_RECIPIENTS];
    expect(all).toHaveLength(2);
  });
});

describe("getBoard — מסננים", () => {
  it("'הפניתי' מציג רק פניות שהמשתמש פתח", async () => {
    await makeTicket(manager);
    await makeTicket(admin);

    const board = await getBoard(asUser(admin), { direction: "opened" }, NOW);
    const all = [...board.sections.ACTION_REQUIRED, ...board.sections.WITH_RECIPIENTS];
    expect(all).toHaveLength(1);
  });

  it("'קיבלתי' מציג רק פניות שהמשתמש משויך אליהן", async () => {
    await makeTicket(manager);
    await makeTicket(admin, { recipients: [{ kind: "user", id: manager.id }] });

    const board = await getBoard(asUser(manager), { direction: "received" }, NOW);
    const all = [...board.sections.ACTION_REQUIRED, ...board.sections.WITH_RECIPIENTS];
    expect(all).toHaveLength(1);
  });

  it("מסנן לפי נמען", async () => {
    await makeTicket(manager);
    await makeTicket(manager, { recipients: [{ kind: "professional", id: plumber }] });

    const board = await getBoard(asUser(manager), { recipientId: plumber }, NOW);
    expect(board.sections.WITH_RECIPIENTS).toHaveLength(1);
    expect(board.sections.WITH_RECIPIENTS[0]?.recipientNames).toEqual(["משה"]);
  });

  it("מסנן לפי בניין", async () => {
    await makeTicket(manager);
    const other = await db.building.create({ data: { siteId: siteA, name: "בניין ב" } });
    const apartment = await db.apartment.create({ data: { buildingId: other.id, number: "5" } });
    await makeTicket(manager, { buildingId: other.id, apartmentId: apartment.id });

    const board = await getBoard(asUser(manager), { buildingId: other.id }, NOW);
    expect(board.sections.WITH_RECIPIENTS).toHaveLength(1);
    expect(board.sections.WITH_RECIPIENTS[0]?.buildingName).toBe("בניין ב");
  });

  it("מנהל מערכת מסנן לאתר יחיד — הצלילה מתצוגת הבעלים", async () => {
    await makeTicket(manager); // אתר א
    await createTicket(admin, {
      siteId: siteB,
      description: "תקלה באתר ב",
      recipients: [{ kind: "professional", id: plumber }],
    });

    const board = await getBoard(asUser(admin), { siteId: siteB }, NOW);
    const all = [...board.sections.ACTION_REQUIRED, ...board.sections.WITH_RECIPIENTS];
    expect(all).toHaveLength(1);
    expect(all[0]?.descriptionLine).toBe("תקלה באתר ב");
    // מנהל מערכת מקבל את רשימת האתרים לבורר.
    expect(board.sites.map((s) => s.name)).toEqual(["אתר א", "אתר ב"]);
  });

  it("מנהל עבודה מקובע לאתרו — מסנן אתר אחר אינו עוקף אותו", async () => {
    await makeTicket(manager); // אתר א
    // ניסיון לסנן לאתר ב (למשל דרך URL) מתעלם, כי מנהל העבודה מקובע לאתרו.
    const board = await getBoard(asUser(manager), { siteId: siteB }, NOW);
    expect(board.sections.WITH_RECIPIENTS).toHaveLength(1);
    // ואין לו בורר אתרים — הרשימה ריקה.
    expect(board.sites).toEqual([]);
  });

  it("'קיבלתי' ומסנן נמען מצטברים ולא דורסים זה את זה", async () => {
    // הפנייה שויכה לחשמלאי, והמנהל הוא הפותח — לא נמען בה.
    await makeTicket(manager);
    // 'קיבלתי' = פניות שהמנהל נמען בהן. הוא אינו נמען, ולכן ריק — גם אם
    // מסנן הנמען לבדו (חשמלאי) היה מתאים. לפני התיקון, spread היה גורם
    // למסנן הנמען לדרוס את 'קיבלתי' ולהחזיר את הפנייה בטעות.
    const board = await getBoard(
      asUser(manager),
      { direction: "received", recipientId: electrician },
      NOW,
    );
    const all = [...board.sections.ACTION_REQUIRED, ...board.sections.WITH_RECIPIENTS];
    expect(all).toHaveLength(0);
  });

  it("מנהל עבודה ללא אתר — fail-closed: מסך ריק ולא כל האתרים", async () => {
    await makeTicket(manager); // קיימת פנייה באתר א
    // מצב לא-תקין (נחסם ביצירה) — אבל אם יגיע לכאן, עדיף ריק על חשיפה.
    const noSite: SessionUser = { id: "x", name: "תקול", role: "SITE_MANAGER", siteId: null };
    const board = await getBoard(noSite, {}, NOW);

    expect(board.sections.ACTION_REQUIRED).toEqual([]);
    expect(board.sections.WITH_RECIPIENTS).toEqual([]);
    expect(board.sections.ARCHIVE).toEqual([]);
    expect(board.sites).toEqual([]);
  });
});

describe("getBoard — תוכן הכרטיס", () => {
  it("מציג רק את השורה הראשונה מהתיאור", async () => {
    // הכרטיס אינו מקום לקרוא בו תיאור מלא; שורה שנייה מסיטה את העין
    // מטקסט הסיבה, שהוא המידע החשוב.
    await makeTicket(manager);
    const board = await getBoard(asUser(manager), {}, NOW);
    expect(board.sections.WITH_RECIPIENTS[0]?.descriptionLine).toBe("אין חשמל בסלון");
  });

  it("אינו מציג נמענים שהוסרו", async () => {
    const ticket = await makeTicket(manager, {
      recipients: [
        { kind: "professional", id: electrician },
        { kind: "professional", id: plumber },
      ],
    });
    const [first] = await db.assignment.findMany({ where: { ticketId: ticket.id } });
    await db.assignment.update({ where: { id: first!.id }, data: { status: "REMOVED" } });

    const board = await getBoard(asUser(manager), {}, NOW);
    expect(board.sections.WITH_RECIPIENTS[0]?.recipientNames).toEqual(["משה"]);
  });

  it("מחשב את גיל הפנייה בימים", async () => {
    const ticket = await makeTicket(manager);
    await db.ticket.update({
      where: { id: ticket.id },
      data: { createdAt: new Date(NOW.getTime() - 3 * 86_400_000) },
    });

    const board = await getBoard(asUser(manager), {}, NOW);
    expect(board.sections.WITH_RECIPIENTS[0]?.ageDays).toBe(3);
  });
});
