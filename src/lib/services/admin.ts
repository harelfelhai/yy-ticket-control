import type { Role } from "@/generated/prisma/enums";
import { UserFacingError } from "@/lib/action-result";
import { hashPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import {
  looksLikeEmail,
  normalizeEmail,
  normalizeName,
  normalizePhone,
} from "@/lib/normalize";
import { canManageAdmin } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";
import { toViewer } from "@/lib/session";
import { prepareProfessional } from "./directory";

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
    activeAssignments: p._count.assignments,
  }));
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
