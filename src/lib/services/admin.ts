import type { Role } from "@/generated/prisma/enums";
import { UserFacingError } from "@/lib/action-result";
import { hashPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import {
  compareApartmentNumbers,
  looksLikeEmail,
  normalizeApartmentNumber,
  normalizeEmail,
  normalizeName,
  normalizePhone,
} from "@/lib/normalize";
import { canManageAdmin } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";
import { toViewer } from "@/lib/session";
import { assertDeletable } from "./deletion";
import { findOrCreateApartment, findOrCreateBuilding, prepareProfessional } from "./directory";

/**
 * מסכי הניהול (11–15): אתרים, משתמשים, אנשי מקצוע ותחומים.
 *
 * כל הפעולות כאן שמורות למנהל המערכת הראשי (אפיון §5.ז), והבדיקה יושבת
 * בשירות ולא רק ב-route — כך אי אפשר לעקוף אותה בטעות דרך נתיב חדש. הפעולה
 * הרגישה ביותר היא **איחוד כפילויות אנשי מקצוע**: היא מזיזה היסטוריה שלמה
 * ולכן חייבת להיות אטומית.
 */

export class AdminError extends UserFacingError {}

/** אורך מינימלי לסיסמה ראשונית שמנהל קובע למשתמש */
const MIN_PASSWORD_LENGTH = 8;

function assertAdmin(actor: SessionUser): void {
  if (!canManageAdmin(toViewer(actor))) throw new AdminError(he.admin.forbidden);
}

// ────────────────────────────── אתרים ──────────────────────────────

export async function createSite(actor: SessionUser, rawName: string) {
  assertAdmin(actor);
  const name = normalizeName(rawName);
  if (!name) throw new AdminError(he.admin.siteNameRequired);

  const existing = await db.site.findUnique({ where: { name } });
  if (existing) throw new AdminError(he.admin.siteExists);

  return db.site.create({ data: { name } });
}

/**
 * אתרים עם מנהלי העבודה המשויכים להם, לרשימת הניהול.
 *
 * מקבל actor ובודק הרשאה כמו כל מוטציה: ה-layout מגן על התצוגה, אבל הוא
 * אינו רץ מחדש בניווט צד-לקוח בין מסכי אדמין, וקריאה ישירה ל-RSC של אחד
 * המסכים עוקפת אותו. הבדיקה כאן היא ההגנה האמיתית על הנתונים.
 */
export async function listSites(actor: SessionUser) {
  assertAdmin(actor);
  return db.site.findMany({
    orderBy: { name: "asc" },
    include: {
      users: {
        where: { role: "SITE_MANAGER", active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      },
    },
  });
}

/**
 * משנה שם אתר. שם תפוס נדחה ואינו מאחד — איחוד אתרים אינו בתחולה, והוא
 * היה מזיז פניות בין אתרים ובכך שובר את מודל ההרשאות של מנהל העבודה.
 */
export async function renameSite(actor: SessionUser, id: string, rawName: string) {
  assertAdmin(actor);
  const name = normalizeName(rawName);
  if (!name) throw new AdminError(he.admin.siteNameRequired);

  const clash = await db.site.findUnique({ where: { name } });
  if (clash && clash.id !== id) throw new AdminError(he.admin.siteExists);

  return db.site.update({ where: { id }, data: { name } });
}

export async function deleteSite(actor: SessionUser, id: string): Promise<void> {
  assertAdmin(actor);
  const site = await db.site.findUnique({ where: { id }, select: { id: true } });
  if (!site) throw new AdminError(he.admin.siteNotFound);

  await assertDeletable("site", id);
  await db.site.delete({ where: { id } });
}

// ──────────────────────── בניינים ודירות (מסך 16) ────────────────────────

/**
 * עץ האתר: בניינים, הדירות שבהם, ומונה פניות לכל רמה.
 *
 * המונים אינם קישוט — הם הסיבה שאפשר להחליט מה למחוק. מנהל שרואה "0 פניות"
 * יודע שהשורה בטוחה למחיקה בלי לנסות ולקבל שגיאה.
 */
export async function listSiteTree(actor: SessionUser, siteId: string) {
  assertAdmin(actor);

  const site = await db.site.findUnique({ where: { id: siteId }, select: { id: true, name: true } });
  if (!site) throw new AdminError(he.admin.siteNotFound);

  const buildings = await db.building.findMany({
    where: { siteId },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { tickets: true } },
      apartments: {
        orderBy: { number: "asc" },
        include: { _count: { select: { tickets: true } } },
      },
    },
  });

  return {
    site,
    buildings: buildings.map((building) => ({
      id: building.id,
      name: building.name,
      ticketCount: building._count.tickets,
      apartments: building.apartments
        .map((apartment) => ({
          id: apartment.id,
          number: apartment.number,
          residentName: apartment.residentName,
          ticketCount: apartment._count.tickets,
        }))
        // המיון בקוד ולא ב-`orderBy`: ראה `compareApartmentNumbers`.
        .sort((a, b) => compareApartmentNumbers(a.number, b.number)),
    })),
  };
}

/**
 * מוסיף בניין מהמסך הניהולי.
 *
 * בדיקת הקיום מפורשת ורק אחריה `findOrCreateBuilding`: הפונקציה ההיא
 * אידמפוטנטית בכוונה (הזנה מרוכזת יוצרת עשרות פניות ברצף ואסור לה להיכשל
 * על בניין שכבר קיים), אבל במסך ניהול "הוסף" שלא מוסיף דבר ולא אומר כלום
 * נראה כתקלה. הנרמול והאטומיות נשארים במקום אחד — שם.
 */
export async function createBuilding(actor: SessionUser, siteId: string, rawName: string) {
  assertAdmin(actor);

  const site = await db.site.findUnique({ where: { id: siteId }, select: { id: true } });
  if (!site) throw new AdminError(he.admin.siteNotFound);

  const name = normalizeName(rawName);
  if (!name) throw new AdminError(he.directory.buildingNameRequired);

  const existing = await db.building.findUnique({ where: { siteId_name: { siteId, name } } });
  if (existing) throw new AdminError(he.admin.buildingExists);

  return findOrCreateBuilding(siteId, name);
}

export async function renameBuilding(actor: SessionUser, id: string, rawName: string) {
  assertAdmin(actor);
  const name = normalizeName(rawName);
  if (!name) throw new AdminError(he.directory.buildingNameRequired);

  const building = await db.building.findUnique({ where: { id }, select: { siteId: true } });
  if (!building) throw new AdminError(he.admin.buildingNotFound);

  // הייחודיות היא (אתר, שם) ולא השם לבדו — "בניין א׳" קיים בכל אתר.
  const clash = await db.building.findUnique({
    where: { siteId_name: { siteId: building.siteId, name } },
  });
  if (clash && clash.id !== id) throw new AdminError(he.admin.buildingExists);

  return db.building.update({ where: { id }, data: { name } });
}

export async function deleteBuilding(actor: SessionUser, id: string): Promise<void> {
  assertAdmin(actor);
  const building = await db.building.findUnique({ where: { id }, select: { id: true } });
  if (!building) throw new AdminError(he.admin.buildingNotFound);

  await assertDeletable("building", id);
  await db.building.delete({ where: { id } });
}

export async function createApartment(actor: SessionUser, buildingId: string, rawNumber: string) {
  assertAdmin(actor);

  const building = await db.building.findUnique({ where: { id: buildingId }, select: { id: true } });
  if (!building) throw new AdminError(he.admin.buildingNotFound);

  const number = normalizeApartmentNumber(rawNumber);
  if (!number) throw new AdminError(he.directory.apartmentNumberRequired);

  const existing = await db.apartment.findUnique({
    where: { buildingId_number: { buildingId, number } },
  });
  if (existing) throw new AdminError(he.admin.apartmentExists);

  return findOrCreateApartment(buildingId, number);
}

export async function renameApartment(actor: SessionUser, id: string, rawNumber: string) {
  assertAdmin(actor);
  const number = normalizeApartmentNumber(rawNumber);
  if (!number) throw new AdminError(he.directory.apartmentNumberRequired);

  const apartment = await db.apartment.findUnique({ where: { id }, select: { buildingId: true } });
  if (!apartment) throw new AdminError(he.admin.apartmentNotFound);

  const clash = await db.apartment.findUnique({
    where: { buildingId_number: { buildingId: apartment.buildingId, number } },
  });
  if (clash && clash.id !== id) throw new AdminError(he.admin.apartmentExists);

  return db.apartment.update({ where: { id }, data: { number } });
}

/**
 * מוחק דירה. ⚠️ `residentName` הוא הבית היחיד של שם הדייר (אפיון §3.2 שדה 11),
 * ולכן דירה בלי פניות נמחקת יחד עם השם. זו הסיבה שהאישור בממשק נוקב במספר
 * הדירה ומציג את שם הדייר לצדה.
 */
export async function deleteApartment(actor: SessionUser, id: string): Promise<void> {
  assertAdmin(actor);
  const apartment = await db.apartment.findUnique({ where: { id }, select: { id: true } });
  if (!apartment) throw new AdminError(he.admin.apartmentNotFound);

  await assertDeletable("apartment", id);
  await db.apartment.delete({ where: { id } });
}

// ────────────────────────────── משתמשים ──────────────────────────────

export interface CreateUserInput {
  name: string;
  phone: string;
  email?: string | null;
  role: Role;
  siteId?: string | null;
  password: string;
}

/**
 * מקים משתמש פנימי. מנהל עבודה חייב אתר; בעלים ומנהל מערכת אינם משויכים
 * לאתר — האילוץ תלוי בתפקיד, ולכן נאכף כאן ולא ב-DB.
 */
export async function createInternalUser(actor: SessionUser, input: CreateUserInput) {
  assertAdmin(actor);

  const name = normalizeName(input.name);
  if (!name) throw new AdminError(he.admin.userNameRequired);

  const phone = normalizePhone(input.phone);
  if (!phone) throw new AdminError(he.directory.phone);

  const email = normalizeEmail(input.email ?? "");
  if (email && !looksLikeEmail(email)) throw new AdminError(he.directory.invalidEmail);

  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new AdminError(he.admin.passwordTooShort(MIN_PASSWORD_LENGTH));
  }

  // מנהל עבודה מחייב אתר; שאר התפקידים לא משויכים לאף אתר.
  const siteId = input.role === "SITE_MANAGER" ? (input.siteId ?? null) : null;
  if (input.role === "SITE_MANAGER" && !siteId) {
    throw new AdminError(he.admin.siteManagerNeedsSite);
  }

  // כפילות טלפון/מייל נבדקת מראש כדי להחזיר הודעה מובנת ולא כשל אילוץ גולמי.
  if (await db.user.findUnique({ where: { phone } })) throw new AdminError(he.admin.phoneTaken);
  if (email && (await db.user.findUnique({ where: { email } }))) {
    throw new AdminError(he.admin.emailTaken);
  }

  return db.user.create({
    data: {
      name,
      phone,
      email: email || null,
      role: input.role,
      siteId,
      passwordHash: await hashPassword(input.password),
    },
  });
}

export async function listUsers(actor: SessionUser) {
  assertAdmin(actor);
  return db.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { site: { select: { name: true } } },
  });
}

/**
 * מפעיל או משבית משתמש. השבתה מנתקת אותו בבקשה הבאה (`requireUser` מרענן
 * מול ה-DB), ולכן אינה דורשת מחיקה — פנייה שפתח נשארת שלו בהיסטוריה.
 *
 * אי אפשר להשבית את עצמך: מנהל שינעל את עצמו בטעות יישאר בלי דרך פנימה.
 */
/**
 * עורך פרטי קשר של משתמש. **מחיקת משתמש אינה קיימת בכוונה** (אפיון §7
 * שורה 25): לשלוש ההפניות אליו יש `SetNull` — `Ticket.handlerId`,
 * `Ticket.closedById` ו-`MediaFile.uploaderUserId` — כלומר מחיקה הייתה מוחקת
 * בשקט את "מי מטפל" ואת "מי סגר" מכל פנייה שנגע בה. זו מחיקת היסטוריה דרך
 * הדלת האחורית, ולא ניקוי רשימה. מסלול ההוצאה הוא `setUserActive`.
 *
 * התפקיד והאתר אינם נערכים כאן: הם כפופים לכללי §5.ג (מנהל עבודה חייב אתר,
 * בעלים ומנהל מערכת אינם משויכים), ושינוי שלהם מזיז הרשאות על פניות קיימות.
 */
export async function updateUser(
  actor: SessionUser,
  id: string,
  input: { name: string; phone: string; email?: string | null },
) {
  assertAdmin(actor);

  const name = normalizeName(input.name);
  if (!name) throw new AdminError(he.admin.userNameRequired);

  const phone = normalizePhone(input.phone);
  if (!phone) throw new AdminError(he.directory.phone);

  const email = normalizeEmail(input.email ?? "");
  if (email && !looksLikeEmail(email)) throw new AdminError(he.directory.invalidEmail);

  const existing = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new AdminError(he.admin.userNotFound);

  // התנגשות `@unique` נבדקת מראש כדי להחזיר הודעה מובנת ולא כשל אילוץ גולמי.
  const phoneClash = await db.user.findUnique({ where: { phone }, select: { id: true } });
  if (phoneClash && phoneClash.id !== id) throw new AdminError(he.admin.phoneTaken);

  if (email) {
    const emailClash = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (emailClash && emailClash.id !== id) throw new AdminError(he.admin.emailTaken);
  }

  return db.user.update({ where: { id }, data: { name, phone, email: email || null } });
}

export async function setUserActive(actor: SessionUser, userId: string, active: boolean) {
  assertAdmin(actor);
  if (userId === actor.id && !active) throw new AdminError(he.admin.cannotDeactivateSelf);

  return db.user.update({ where: { id: userId }, data: { active } });
}

// ────────────────────────────── אנשי מקצוע ──────────────────────────────

/** אנשי מקצוע עם מספר הפניות הפעילות של כל אחד — עוזר לזהות כפילויות */
export async function listProfessionalsForAdmin(actor: SessionUser) {
  assertAdmin(actor);
  const professionals = await db.professional.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { assignments: { where: { status: { not: "REMOVED" } } } } },
    },
  });

  return professionals.map((p) => ({
    id: p.id,
    name: p.name,
    phone: p.phone,
    email: p.email,
    active: p.active,
    activeAssignments: p._count.assignments,
  }));
}

/**
 * משבית או מפעיל איש מקצוע (0.4).
 *
 * **המקבילה המדויקת ל-`setUserActive`, ומאותו נימוק.** מחיקה חסומה לאיש
 * מקצוע שקיבל ולו פנייה אחת — נכון, כי היא הייתה משמידה שיוכים והודעות —
 * אבל בלי מסלול הוצאה הוא נשאר ברשימת הנמענים לנצח. מסלול ההוצאה שהיה
 * קיים, `mergeProfessionals`, מתאר מציאות אחרת לגמרי (שתי רשומות לאותו
 * אדם) ואינו מתאים למי שפשוט עזב.
 *
 * **מה שההשבתה במפורש אינה עושה: אינה נוגעת ב-`AccessToken`.** קבלן
 * שמושבת עדיין מחזיק פניות פתוחות שהוא היחיד שיכול לסמן בהן "טופל",
 * וביטול הקישור היה נועל אותן בלי שאיש ישים לב. ההשבתה מכוונת לעתיד.
 */
export async function setProfessionalActive(actor: SessionUser, id: string, active: boolean) {
  assertAdmin(actor);

  const existing = await db.professional.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new AdminError(he.admin.professionalNotFound);

  return db.professional.update({ where: { id }, data: { active } });
}

export async function updateProfessional(
  actor: SessionUser,
  id: string,
  input: { name: string; phone?: string | null; email?: string | null },
) {
  assertAdmin(actor);
  const prepared = prepareProfessional(input);

  const existing = await db.professional.findUnique({ where: { id } });
  if (!existing) throw new AdminError(he.admin.professionalNotFound);

  return db.professional.update({ where: { id }, data: prepared });
}

/**
 * מוחק איש מקצוע שאין אליו שום הפניה — כלומר רשומה שנוצרה בטעות הקלדה
 * ומעולם לא שימשה. איש מקצוע שקיבל ולו פנייה אחת חסום לנצח, ומסלול ההוצאה
 * שלו הוא `mergeProfessionals` (איחוד לתוך הרשומה הנכונה).
 *
 * הטוקנים שלו נמחקים ב-cascade, וזה נכון: קישור אישי חסר משמעות בלי בעליו.
 */
export async function deleteProfessional(actor: SessionUser, id: string): Promise<void> {
  assertAdmin(actor);
  const professional = await db.professional.findUnique({ where: { id }, select: { id: true } });
  if (!professional) throw new AdminError(he.admin.professionalNotFound);

  await assertDeletable("professional", id);
  await db.professional.delete({ where: { id } });
}

/**
 * מאחד שני אנשי מקצוע: כל מה ששייך ל-`dropId` עובר ל-`keepId`, ו-`dropId`
 * נמחק. אטומי לחלוטין — איחוד חלקי היה משאיר קבלן "רפאים" עם חצי היסטוריה.
 *
 * שלושה סוגי הפניות מטופלים:
 * - **שיוכים:** מועברים ל-keepId, אלא אם keepId כבר משויך לאותה פנייה —
 *   ואז שיוך ה-drop נמחק, כדי לא ליצור שני שיוכים לאותו אדם על פנייה אחת.
 * - **הודעות בשרשור:** המחבר מוסב ל-keepId, כדי שההיסטוריה תישאר קריאה.
 * - **גישות תגית:** מועברות ל-keepId (בלי כפילות), והשאר נמחק עם הרשומה.
 *
 * הטוקנים של drop נמחקים ב-cascade — הזהות שלו נעלמת, ונכון שקישורו ימות.
 */
export async function mergeProfessionals(actor: SessionUser, keepId: string, dropId: string) {
  assertAdmin(actor);
  if (keepId === dropId) throw new AdminError(he.admin.mergeSame);

  const [keep, drop] = await Promise.all([
    db.professional.findUnique({ where: { id: keepId } }),
    db.professional.findUnique({ where: { id: dropId } }),
  ]);
  if (!keep || !drop) throw new AdminError(he.admin.professionalNotFound);

  await db.$transaction(async (tx) => {
    // פניות ש-keep כבר משויך אליהן — שיוך ה-drop עליהן נמחק במקום להיכפל.
    const keepTicketIds = (
      await tx.assignment.findMany({ where: { professionalId: keepId }, select: { ticketId: true } })
    ).map((a) => a.ticketId);

    await tx.assignment.deleteMany({
      where: { professionalId: dropId, ticketId: { in: keepTicketIds } },
    });
    await tx.assignment.updateMany({
      where: { professionalId: dropId },
      data: { professionalId: keepId },
    });

    // מחבר ההודעות מוסב ל-keep.
    await tx.message.updateMany({
      where: { authorProfessionalId: dropId },
      data: { authorProfessionalId: keepId },
    });

    // בעלות על קבצים שהקבלן העלה מוסבת ל-keep, אחרת confirmUpload עתידי
    // עליהם היה נכשל אחרי שהזהות של drop נמחקה.
    await tx.mediaFile.updateMany({
      where: { uploaderProfessionalId: dropId },
      data: { uploaderProfessionalId: keepId },
    });

    // גישות תגית: מה שאין ל-keep מועבר אליו; השאר יימחק עם הרשומה.
    const keepTagIds = new Set(
      (await tx.tagAccess.findMany({ where: { professionalId: keepId }, select: { tagId: true } })).map(
        (t) => t.tagId,
      ),
    );
    const dropTags = await tx.tagAccess.findMany({ where: { professionalId: dropId } });
    for (const grant of dropTags) {
      if (!keepTagIds.has(grant.tagId)) {
        await tx.tagAccess.create({ data: { tagId: grant.tagId, professionalId: keepId } });
      }
    }

    // מוחקים את הכפילות. tagAccess והטוקנים שנותרו נמחקים ב-cascade.
    await tx.professional.delete({ where: { id: dropId } });
  });

  return keep;
}

// ────────────────────────────── תחומים ──────────────────────────────

export async function createDomain(actor: SessionUser, rawName: string) {
  assertAdmin(actor);
  const name = normalizeName(rawName);
  if (!name) throw new AdminError(he.directory.domainNameRequired);

  const existing = await db.domain.findUnique({ where: { name } });
  if (existing) throw new AdminError(he.admin.domainExists);

  return db.domain.create({ data: { name } });
}

export async function listDomains(actor: SessionUser) {
  assertAdmin(actor);
  return db.domain.findMany({ orderBy: { name: "asc" } });
}

/**
 * משנה שם תחום — לתיקון שגיאת הקלדה שיצרה תחום כמעט-כפול.
 * אם השם החדש כבר קיים, הפעולה נדחית: איחוד תחומים אינו בתחולת גרסה זו,
 * והמנהל צריך לתייג מחדש את הפניות המעטות במקום.
 */
export async function renameDomain(actor: SessionUser, id: string, rawName: string) {
  assertAdmin(actor);
  const name = normalizeName(rawName);
  if (!name) throw new AdminError(he.directory.domainNameRequired);

  const clash = await db.domain.findUnique({ where: { name } });
  if (clash && clash.id !== id) throw new AdminError(he.admin.domainExists);

  return db.domain.update({ where: { id }, data: { name } });
}

/**
 * מוחק תחום שאין עליו פניות. זהו הדפוס הפשוט ביותר מבין השישה — הפניה אחת
 * בלבד חוסמת אותו — ולכן הוא נכתב ראשון ושימש מודל לשאר.
 */
export async function deleteDomain(actor: SessionUser, id: string): Promise<void> {
  assertAdmin(actor);
  const domain = await db.domain.findUnique({ where: { id }, select: { id: true } });
  if (!domain) throw new AdminError(he.admin.domainNotFound);

  await assertDeletable("domain", id);
  await db.domain.delete({ where: { id } });
}
