import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import type { SessionUser } from "@/lib/session";
import {
  AdminError,
  createInternalUser,
  createSite,
  listDomains,
  listProfessionalsForAdmin,
  listSites,
  listUsers,
  mergeProfessionals,
  renameDomain,
  setUserActive,
  updateProfessional,
} from "@/lib/services/admin";
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
