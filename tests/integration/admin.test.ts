import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import type { SessionUser } from "@/lib/session";
import {
  AdminError,
  createApartment,
  createBuilding,
  createInternalUser,
  createSite,
  deleteApartment,
  deleteBuilding,
  deleteDomain,
  deleteProfessional,
  deleteSite,
  listDomains,
  listProfessionalsForAdmin,
  listSiteTree,
  listSites,
  listUsers,
  mergeProfessionals,
  renameApartment,
  renameBuilding,
  renameDomain,
  renameSite,
  setProfessionalActive,
  setUserActive,
  updateProfessional,
  updateUser,
} from "@/lib/services/admin";
import { countBlockingReferences } from "@/lib/services/deletion";
import { assertProfessionalsActive, listSiteDirectory } from "@/lib/services/directory";
import { resetDb } from "../helpers/reset-db";

let admin: SessionUser;
let manager: SessionUser;
let siteId: string;

beforeEach(async () => {
  await resetDb();
  siteId = (await db.site.create({ data: { name: "אתר קיים" } })).id;

  const adminUser = await db.user.create({
    data: { role: "ADMIN", name: "מנהל מערכת", phone: "0500000000", passwordHash: "x" },
  });
  admin = { id: adminUser.id, name: adminUser.name, role: adminUser.role, siteId: null };

  const managerUser = await db.user.create({
    data: { role: "SITE_MANAGER", name: "מנהל עבודה", phone: "0500000001", passwordHash: "x", siteId },
  });
  manager = { id: managerUser.id, name: managerUser.name, role: managerUser.role, siteId };
});

afterAll(async () => {
  await db.$disconnect();
});

describe("הרשאה — הכול שמור למנהל המערכת", () => {
  it("מנהל עבודה אינו יכול להקים אתר", async () => {
    await expect(createSite(manager, "אתר חדש")).rejects.toThrow(he.admin.forbidden);
  });

  it("מנהל עבודה אינו יכול להקים משתמש", async () => {
    await expect(
      createInternalUser(manager, {
        name: "x",
        phone: "0501234567",
        role: "OWNER",
        password: "password1",
      }),
    ).rejects.toThrow(AdminError);
  });

  it("מנהל עבודה אינו יכול לקרוא את רשימות הניהול — הבדיקה בשירות, לא רק ב-layout", async () => {
    // ה-layout מגן על התצוגה, אבל אינו רץ מחדש בניווט צד-לקוח בין מסכי
    // אדמין; ההגנה האמיתית על הנתונים היא ב-assertAdmin שבשירות עצמו.
    await expect(listSites(manager)).rejects.toThrow(he.admin.forbidden);
    await expect(listUsers(manager)).rejects.toThrow(he.admin.forbidden);
    await expect(listProfessionalsForAdmin(manager)).rejects.toThrow(he.admin.forbidden);
    await expect(listDomains(manager)).rejects.toThrow(he.admin.forbidden);
  });

  it("מנהל מערכת כן קורא את רשימות הניהול", async () => {
    await expect(listSites(admin)).resolves.toBeDefined();
    await expect(listUsers(admin)).resolves.toBeDefined();
    await expect(listProfessionalsForAdmin(admin)).resolves.toBeDefined();
    await expect(listDomains(admin)).resolves.toBeDefined();
  });
});

describe("createSite", () => {
  it("מקים אתר חדש", async () => {
    const site = await createSite(admin, "  אתר צפון  ");
    expect(site.name).toBe("אתר צפון");
  });

  it("דוחה שם שכבר קיים", async () => {
    await expect(createSite(admin, "אתר קיים")).rejects.toThrow(he.admin.siteExists);
  });
});

describe("createInternalUser", () => {
  it("מקים מנהל עבודה משויך לאתר, עם סיסמה מגובבת", async () => {
    const user = await createInternalUser(admin, {
      name: "יעל",
      phone: "052-1234567",
      role: "SITE_MANAGER",
      siteId,
      password: "sod-chazak-9",
    });

    expect(user.siteId).toBe(siteId);
    expect(user.phone).toBe("0521234567");
    // הסיסמה מגובבת, לא נשמרת כטקסט.
    expect(user.passwordHash).not.toBe("sod-chazak-9");
    expect(await verifyPassword(user.passwordHash, "sod-chazak-9")).toBe(true);
  });

  it("מנהל עבודה בלי אתר נדחה", async () => {
    await expect(
      createInternalUser(admin, {
        name: "יעל",
        phone: "0521234567",
        role: "SITE_MANAGER",
        password: "sod-chazak-9",
      }),
    ).rejects.toThrow(he.admin.siteManagerNeedsSite);
  });

  it("בעלים אינו משויך לאתר גם אם נמסר", async () => {
    const user = await createInternalUser(admin, {
      name: "בעלים",
      phone: "0539999999",
      role: "OWNER",
      siteId,
      password: "sod-chazak-9",
    });
    expect(user.siteId).toBeNull();
  });

  it("סיסמה קצרה מדי נדחית", async () => {
    await expect(
      createInternalUser(admin, { name: "x", phone: "0541111111", role: "OWNER", password: "short" }),
    ).rejects.toThrow(/תווים/);
  });

  it("טלפון כפול נדחה עם הודעה מובנת", async () => {
    await expect(
      createInternalUser(admin, {
        name: "x",
        phone: "0500000000", // כבר בשימוש ע"י המנהל
        role: "OWNER",
        password: "password1",
      }),
    ).rejects.toThrow(he.admin.phoneTaken);
  });
});

describe("setUserActive", () => {
  it("משבית משתמש", async () => {
    const target = await createInternalUser(admin, {
      name: "z",
      phone: "0587777777",
      role: "OWNER",
      password: "password1",
    });
    await setUserActive(admin, target.id, false);
    expect((await db.user.findUniqueOrThrow({ where: { id: target.id } })).active).toBe(false);
  });

  it("אי אפשר להשבית את עצמך", async () => {
    await expect(setUserActive(admin, admin.id, false)).rejects.toThrow(
      he.admin.cannotDeactivateSelf,
    );
  });
});

describe("updateProfessional", () => {
  it("מעדכן שם ופרטי קשר", async () => {
    const p = await db.professional.create({ data: { name: "יוסי", phone: "0501111111" } });
    const updated = await updateProfessional(admin, p.id, { name: "יוסי כהן", phone: "0501111111" });
    expect(updated.name).toBe("יוסי כהן");
  });

  it("דוחה איש מקצוע בלי טלפון ובלי מייל", async () => {
    // הוולידציה משותפת עם directory (`prepareProfessional`), ולכן ההודעה
    // היא אותה הודעה — "לא ניתן לשגר: לנמען אין טלפון ואין מייל".
    const p = await db.professional.create({ data: { name: "יוסי", phone: "0501111111" } });
    await expect(updateProfessional(admin, p.id, { name: "יוסי" })).rejects.toThrow(
      he.notices.cannotSendNoContact,
    );
  });
});

describe("setProfessionalActive — מסלול ההוצאה למי שעזב (0.4)", () => {
  it("משבית ומפעיל בחזרה", async () => {
    const p = await db.professional.create({ data: { name: "יוסי", phone: "0501111111" } });

    await setProfessionalActive(admin, p.id, false);
    expect((await db.professional.findUniqueOrThrow({ where: { id: p.id } })).active).toBe(false);

    await setProfessionalActive(admin, p.id, true);
    expect((await db.professional.findUniqueOrThrow({ where: { id: p.id } })).active).toBe(true);
  });

  it("מנהל עבודה אינו רשאי", async () => {
    const p = await db.professional.create({ data: { name: "יוסי", phone: "0501111111" } });
    await expect(setProfessionalActive(manager, p.id, false)).rejects.toThrow(AdminError);
  });

  it("מושבת יוצא מבורר הנמענים, ופעיל נשאר בו", async () => {
    const gone = await db.professional.create({ data: { name: "עזב", phone: "0501111111" } });
    const stays = await db.professional.create({ data: { name: "נשאר", phone: "0502222222" } });

    await setProfessionalActive(admin, gone.id, false);

    const directory = await listSiteDirectory(siteId);
    const names = directory.professionals.map((x) => x.name);
    expect(names).toContain("נשאר");
    expect(names).not.toContain("עזב");
    expect(stays.active).toBe(true);
  });

  it("נשאר ברשימת הניהול, מסומן כמושבת — אחרת הוא נעלם ואי אפשר להפעילו", async () => {
    const p = await db.professional.create({ data: { name: "עזב", phone: "0501111111" } });
    await setProfessionalActive(admin, p.id, false);

    const rows = await listProfessionalsForAdmin(admin);
    const row = rows.find((r) => r.id === p.id);
    expect(row).toBeDefined();
    expect(row?.active).toBe(false);
  });

  it("השבתה אינה נוגעת בשיוכים קיימים ולא בקישורי הגישה", async () => {
    const p = await db.professional.create({ data: { name: "עזב", phone: "0501111111" } });
    const ticket = await db.ticket.create({
      data: { siteId, createdById: admin.id, channel: "SELF", description: "ד" },
    });
    await db.assignment.create({ data: { ticketId: ticket.id, professionalId: p.id, status: "SENT" } });
    await db.accessToken.create({
      data: { professionalId: p.id, tokenHash: `hash-${p.id}` },
    });

    await setProfessionalActive(admin, p.id, false);

    // ההשבתה מכוונת לעתיד: הפנייה הפתוחה שלו עדיין דורשת שיסמן בה "טופל",
    // וביטול הקישור היה נועל אותה בלי שאיש ישים לב.
    expect(await db.assignment.count({ where: { professionalId: p.id, status: "SENT" } })).toBe(1);
    expect(await db.accessToken.count({ where: { professionalId: p.id, revokedAt: null } })).toBe(1);
  });
});

describe("assertProfessionalsActive — ההשבתה נאכפת בשרת ולא רק בבורר", () => {
  it("דוחה שיוך למושבת, ונוקב בשמו", async () => {
    const p = await db.professional.create({ data: { name: "עזב", phone: "0501111111" } });
    await setProfessionalActive(admin, p.id, false);

    await expect(assertProfessionalsActive([p.id])).rejects.toThrow(/עזב/);
  });

  it("מאפשר שיוך לפעיל, ורשימה ריקה אינה נוגעת ב-DB", async () => {
    const p = await db.professional.create({ data: { name: "פעיל", phone: "0501111111" } });
    await expect(assertProfessionalsActive([p.id])).resolves.toBeUndefined();
    await expect(assertProfessionalsActive([])).resolves.toBeUndefined();
  });
});

describe("mergeProfessionals — איחוד כפילויות", () => {
  it("מעביר שיוכים, הודעות וגישות תגית, ומוחק את הכפילות", async () => {
    const keep = await db.professional.create({ data: { name: "יוסי חשמלאי", phone: "0501111111" } });
    const drop = await db.professional.create({ data: { name: "יוסי", phone: "0502222222" } });

    const t1 = await db.ticket.create({
      data: { siteId, createdById: admin.id, channel: "SELF", description: "א" },
    });
    const t2 = await db.ticket.create({
      data: { siteId, createdById: admin.id, channel: "SELF", description: "ב" },
    });

    // ‏t1: רק drop. t2: גם keep וגם drop (כפילות על אותה פנייה).
    await db.assignment.create({ data: { ticketId: t1.id, professionalId: drop.id, status: "DONE" } });
    await db.assignment.create({ data: { ticketId: t2.id, professionalId: keep.id, status: "SENT" } });
    await db.assignment.create({ data: { ticketId: t2.id, professionalId: drop.id, status: "DONE" } });

    // הודעה שכתב drop.
    await db.message.create({
      data: { ticketId: t1.id, kind: "TEXT", text: "סיימתי", authorProfessionalId: drop.id },
    });

    // תגיות: T לשניהם (כפילות), U ל-drop בלבד.
    const tagT = await db.tag.create({ data: { name: "T", createdById: admin.id } });
    const tagU = await db.tag.create({ data: { name: "U", createdById: admin.id } });
    await db.tagAccess.create({ data: { tagId: tagT.id, professionalId: keep.id } });
    await db.tagAccess.create({ data: { tagId: tagT.id, professionalId: drop.id } });
    await db.tagAccess.create({ data: { tagId: tagU.id, professionalId: drop.id } });

    await mergeProfessionals(admin, keep.id, drop.id);

    // הכפילות נמחקה.
    expect(await db.professional.findUnique({ where: { id: drop.id } })).toBeNull();

    // t1 עבר ל-keep; t2 נשאר עם שיוך אחד בלבד ל-keep (בלי כפילות).
    const keepAssignments = await db.assignment.findMany({ where: { professionalId: keep.id } });
    expect(keepAssignments.map((a) => a.ticketId).sort()).toEqual([t1.id, t2.id].sort());
    expect(await db.assignment.count({ where: { ticketId: t2.id } })).toBe(1);

    // מחבר ההודעה הוסב ל-keep.
    const message = await db.message.findFirstOrThrow({ where: { ticketId: t1.id, kind: "TEXT" } });
    expect(message.authorProfessionalId).toBe(keep.id);

    // גישות התגית: keep מחזיק כעת ב-T וב-U, בלי כפילות.
    const keepTags = await db.tagAccess.findMany({ where: { professionalId: keep.id } });
    expect(keepTags.map((t) => t.tagId).sort()).toEqual([tagT.id, tagU.id].sort());
  });

  it("אי אפשר לאחד איש מקצוע עם עצמו", async () => {
    const p = await db.professional.create({ data: { name: "יוסי", phone: "0501111111" } });
    await expect(mergeProfessionals(admin, p.id, p.id)).rejects.toThrow(he.admin.mergeSame);
  });

  it("מעביר בעלות על קבצים שהכפילות העלתה — אחרת אישור עתידי היה נכשל", async () => {
    const keep = await db.professional.create({ data: { name: "יוסי", phone: "0501111111" } });
    const drop = await db.professional.create({ data: { name: "יוסי כ.", phone: "0502222222" } });
    const media = await db.mediaFile.create({
      data: {
        storageKey: "media/2026/07/x.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 10,
        uploaderProfessionalId: drop.id,
      },
    });

    await mergeProfessionals(admin, keep.id, drop.id);

    const moved = await db.mediaFile.findUniqueOrThrow({ where: { id: media.id } });
    expect(moved.uploaderProfessionalId).toBe(keep.id);
  });
});

describe("renameDomain", () => {
  it("משנה שם תחום", async () => {
    const d = await db.domain.create({ data: { name: "חשמלל" } });
    const renamed = await renameDomain(admin, d.id, "חשמל");
    expect(renamed.name).toBe("חשמל");
  });

  it("דוחה שינוי לשם שכבר קיים", async () => {
    await db.domain.create({ data: { name: "חשמל" } });
    const d = await db.domain.create({ data: { name: "חשמלל" } });
    await expect(renameDomain(admin, d.id, "חשמל")).rejects.toThrow(he.admin.domainExists);
  });
});

// ═══════════════════ בניינים, דירות, ומחיקה חסומה (0.3) ═══════════════════
//
// כל בדיקת מחיקה כאן **יוצרת את הרשומה שלה ומוחקת אותה**, ולעולם אינה נוגעת
// בנתוני ה-seed. מחיקה שנוגעת בנתונים משותפים הייתה מרעילה את ההרצה הבאה.

/** פנייה מינימלית — מספיקה כדי לחסום מחיקה, וזה כל מה שנבדק כאן */
async function ticketAt(where: {
  siteId?: string;
  buildingId?: string;
  apartmentId?: string;
  domainId?: string;
}) {
  return db.ticket.create({
    data: {
      siteId: where.siteId ?? siteId,
      buildingId: where.buildingId,
      apartmentId: where.apartmentId,
      domainId: where.domainId,
      createdById: admin.id,
      channel: "SELF",
      description: "פנייה חוסמת",
    },
  });
}

describe("בניינים ודירות — הזנה מראש (מסך 16)", () => {
  it("מקים בניין ודירה, ומנרמל את הקלט", async () => {
    const building = await createBuilding(admin, siteId, "  בניין א  ");
    expect(building.name).toBe("בניין א");

    // "07" ו-"7" הן אותה דירה — הנרמול יושב ב-`normalizeApartmentNumber`.
    const apartment = await createApartment(admin, building.id, "07");
    expect(apartment.number).toBe("7");
  });

  it("דוחה בניין כפול באותו אתר, ומתיר את אותו שם באתר אחר", async () => {
    await createBuilding(admin, siteId, "בניין א");
    await expect(createBuilding(admin, siteId, "בניין א")).rejects.toThrow(
      he.admin.buildingExists,
    );

    // הייחודיות היא (אתר, שם): "בניין א׳" קיים בכל אתר, וזה תקין.
    const other = await createSite(admin, "אתר שני");
    await expect(createBuilding(admin, other.id, "בניין א")).resolves.toBeDefined();
  });

  it("דוחה דירה כפולה באותו בניין", async () => {
    const building = await createBuilding(admin, siteId, "בניין א");
    await createApartment(admin, building.id, "3");
    await expect(createApartment(admin, building.id, "3")).rejects.toThrow(
      he.admin.apartmentExists,
    );
  });

  it("משנה שם בניין ומספר דירה", async () => {
    const building = await createBuilding(admin, siteId, "בנין א");
    expect((await renameBuilding(admin, building.id, "בניין א")).name).toBe("בניין א");

    const apartment = await createApartment(admin, building.id, "3");
    expect((await renameApartment(admin, apartment.id, "04")).number).toBe("4");
  });

  it("דוחה שינוי שם לבניין שכבר קיים באותו אתר", async () => {
    await createBuilding(admin, siteId, "בניין א");
    const b = await createBuilding(admin, siteId, "בניין ב");
    await expect(renameBuilding(admin, b.id, "בניין א")).rejects.toThrow(he.admin.buildingExists);
  });

  it("עץ האתר מחזיר בניינים, דירות ומוני פניות", async () => {
    const building = await createBuilding(admin, siteId, "בניין א");
    const apartment = await createApartment(admin, building.id, "3");
    await ticketAt({ buildingId: building.id, apartmentId: apartment.id });

    const tree = await listSiteTree(admin, siteId);
    expect(tree.site.name).toBe("אתר קיים");
    expect(tree.buildings).toHaveLength(1);
    expect(tree.buildings[0].ticketCount).toBe(1);
    expect(tree.buildings[0].apartments[0].ticketCount).toBe(1);
  });

  it("אתר שאינו קיים מוחזר כשגיאה מוסברת ולא כקריסה", async () => {
    await expect(listSiteTree(admin, "לא-קיים")).rejects.toThrow(he.admin.siteNotFound);
  });

  it("מנהל עבודה אינו רשאי בשום פעולה של המסך", async () => {
    await expect(listSiteTree(manager, siteId)).rejects.toThrow(he.admin.forbidden);
    await expect(createBuilding(manager, siteId, "בניין")).rejects.toThrow(he.admin.forbidden);
    await expect(deleteBuilding(manager, "x")).rejects.toThrow(he.admin.forbidden);
  });
});

describe("מחיקה — נחסמת כשקיימות הפניות, ומסבירה מה חוסם", () => {
  it("תחום: נמחק כשאין פניות, ונחסם כשיש — עם המונה בהודעה", async () => {
    const free = await db.domain.create({ data: { name: "תחום פנוי" } });
    await deleteDomain(admin, free.id);
    expect(await db.domain.findUnique({ where: { id: free.id } })).toBeNull();

    const used = await db.domain.create({ data: { name: "תחום בשימוש" } });
    await ticketAt({ domainId: used.id });

    await expect(deleteDomain(admin, used.id)).rejects.toThrow(
      he.admin.deleteBlocked(he.admin.blockedBy.tickets(1)),
    );
    expect(await db.domain.findUnique({ where: { id: used.id } })).not.toBeNull();
  });

  it("דירה: נחסמת בפנייה אחת, ונמחקת כשאין", async () => {
    const building = await createBuilding(admin, siteId, "בניין א");
    const used = await createApartment(admin, building.id, "1");
    const free = await createApartment(admin, building.id, "2");
    await ticketAt({ buildingId: building.id, apartmentId: used.id });

    await expect(deleteApartment(admin, used.id)).rejects.toThrow(
      he.admin.deleteBlocked(he.admin.blockedBy.tickets(1)),
    );
    await deleteApartment(admin, free.id);
    expect(await db.apartment.findUnique({ where: { id: free.id } })).toBeNull();
  });

  it("בניין: הדירות שבתוכו חוסמות אותו, וגם פניות", async () => {
    const building = await createBuilding(admin, siteId, "בניין א");
    const apartment = await createApartment(admin, building.id, "1");

    // דירה אחת בלבד — הבניין חסום, ולא נמחק בשרשרת.
    await expect(deleteBuilding(admin, building.id)).rejects.toThrow(
      he.admin.deleteBlocked(he.admin.blockedBy.apartments(1)),
    );

    await ticketAt({ buildingId: building.id });
    const blockers = await countBlockingReferences("building", building.id);
    expect(blockers).toEqual([
      { kind: "tickets", count: 1 },
      { kind: "apartments", count: 1 },
    ]);

    await deleteApartment(admin, apartment.id);
    await db.ticket.deleteMany({ where: { buildingId: building.id } });
    await deleteBuilding(admin, building.id);
    expect(await db.building.findUnique({ where: { id: building.id } })).toBeNull();
  });

  it("אתר: בניין, משתמש משויך ופנייה — כולם חוסמים ומופיעים בהודעה יחד", async () => {
    const site = await createSite(admin, "אתר למחיקה");
    await createBuilding(admin, site.id, "בניין א");
    await createInternalUser(admin, {
      name: "מנהל האתר",
      phone: "0561111111",
      role: "SITE_MANAGER",
      siteId: site.id,
      password: "password1",
    });

    await expect(deleteSite(admin, site.id)).rejects.toThrow(
      he.admin.deleteBlocked(
        `${he.admin.blockedBy.buildings(1)}, ${he.admin.blockedBy.users(1)}`,
      ),
    );
  });

  it("אתר ריק נמחק", async () => {
    const site = await createSite(admin, "אתר ריק");
    await deleteSite(admin, site.id);
    expect(await db.site.findUnique({ where: { id: site.id } })).toBeNull();
  });

  it("איש מקצוע: גם שיוך שהוסר חוסם — ההיסטוריה של ההסרה שייכת לפנייה", async () => {
    const professional = await db.professional.create({
      data: { name: "קבלן שהוסר", phone: "0509999999" },
    });
    const ticket = await ticketAt({});
    await db.assignment.create({
      data: { ticketId: ticket.id, professionalId: professional.id, status: "REMOVED" },
    });

    await expect(deleteProfessional(admin, professional.id)).rejects.toThrow(
      he.admin.deleteBlocked(he.admin.blockedBy.assignments(1)),
    );
  });

  it("איש מקצוע: הודעה בשרשור חוסמת גם בלי שיוך", async () => {
    const professional = await db.professional.create({
      data: { name: "קבלן שכתב", phone: "0508888888" },
    });
    const ticket = await ticketAt({});
    await db.message.create({
      data: { ticketId: ticket.id, kind: "TEXT", text: "בדרך", authorProfessionalId: professional.id },
    });

    await expect(deleteProfessional(admin, professional.id)).rejects.toThrow(
      he.admin.deleteBlocked(he.admin.blockedBy.messages(1)),
    );
  });

  it("איש מקצוע שלא נגע בכלום נמחק, והטוקן שלו יורד איתו", async () => {
    const professional = await db.professional.create({
      data: { name: "קבלן שנוצר בטעות", phone: "0507777777" },
    });
    await db.accessToken.create({
      data: { professionalId: professional.id, tokenHash: "hash-לבדיקה" },
    });

    await deleteProfessional(admin, professional.id);

    expect(await db.professional.findUnique({ where: { id: professional.id } })).toBeNull();
    // ‏Cascade מכוון: קישור אישי חסר משמעות בלי בעליו.
    expect(await db.accessToken.count({ where: { professionalId: professional.id } })).toBe(0);
  });
});

describe("updateUser — עריכה בלבד, בלי מחיקה", () => {
  it("מעדכן שם, טלפון ומייל", async () => {
    const target = await createInternalUser(admin, {
      name: "יעל",
      phone: "0521111111",
      role: "OWNER",
      password: "password1",
    });

    const updated = await updateUser(admin, target.id, {
      name: "יעל כהן",
      phone: "052-1111111",
      email: "yael@example.com",
    });

    expect(updated.name).toBe("יעל כהן");
    expect(updated.phone).toBe("0521111111");
    expect(updated.email).toBe("yael@example.com");
  });

  it("מרוקן מייל שנמחק, ולא שומר מחרוזת ריקה", async () => {
    const target = await createInternalUser(admin, {
      name: "יעל",
      phone: "0522222222",
      email: "yael@example.com",
      role: "OWNER",
      password: "password1",
    });

    expect((await updateUser(admin, target.id, { name: "יעל", phone: "0522222222", email: "" })).email).toBeNull();
  });

  it("דוחה טלפון שכבר שייך למשתמש אחר, ומתיר את הטלפון של עצמו", async () => {
    const target = await createInternalUser(admin, {
      name: "יעל",
      phone: "0523333333",
      role: "OWNER",
      password: "password1",
    });

    await expect(
      updateUser(admin, target.id, { name: "יעל", phone: "0500000000" }),
    ).rejects.toThrow(he.admin.phoneTaken);

    await expect(
      updateUser(admin, target.id, { name: "יעל ל.", phone: "0523333333" }),
    ).resolves.toBeDefined();
  });

  it("דוחה מייל לא תקין", async () => {
    const target = await createInternalUser(admin, {
      name: "יעל",
      phone: "0524444444",
      role: "OWNER",
      password: "password1",
    });

    await expect(
      updateUser(admin, target.id, { name: "יעל", phone: "0524444444", email: "לא-מייל" }),
    ).rejects.toThrow(he.directory.invalidEmail);
  });

  it("מנהל עבודה אינו רשאי לערוך משתמשים", async () => {
    await expect(updateUser(manager, admin.id, { name: "x", phone: "0500000000" })).rejects.toThrow(
      he.admin.forbidden,
    );
  });
});

describe("renameSite", () => {
  it("משנה שם אתר", async () => {
    expect((await renameSite(admin, siteId, "אתר צפון")).name).toBe("אתר צפון");
  });

  it("דוחה שם שכבר תפוס", async () => {
    const other = await createSite(admin, "אתר דרום");
    await expect(renameSite(admin, other.id, "אתר קיים")).rejects.toThrow(he.admin.siteExists);
  });
});
