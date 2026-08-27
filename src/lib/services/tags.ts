import type { Prisma } from "@/generated/prisma/client";
import { UserFacingError } from "@/lib/action-result";
import { db } from "@/lib/db";
import { firstLine } from "@/lib/format";
import { he } from "@/lib/he";
import { normalizeName } from "@/lib/normalize";
import {
  type Viewer,
  canManageAdmin,
  canManageTagAccess,
  canPostTagChat,
  canRevealPortalLink,
  canTagTicket,
  isUser,
} from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";
import { toViewer } from "@/lib/session";
import { assertDeletable } from "./deletion";
import { ensureAccessToken, ensurePortalLink, revokeAccessIfOrphaned } from "./portal";

/**
 * תגיות: קיבוץ פניות + צ׳אט קבוצתי (אפיון §3.1, מסך 6).
 *
 * שני כללים מנחים את הקובץ:
 *
 * 1. **פתיחת תגית חושפת את הצ׳אט בלבד.** נמען שתגית נפתחה לו רואה את
 *    ההודעות הקבוצתיות — ולעולם לא את רשימת הפניות שבתגית. זו הנקודה
 *    הרגישה ביותר במודל ההרשאות, ולכן שכבת הפורטל כאן אינה יודעת כלל
 *    לשלוף פניות של תגית.
 * 2. **רשימת הפניות ממודרת לפי אתר.** מנהל עבודה רואה בתגית רק את פניות
 *    האתר שלו, גם אם התגית חוצה אתרים — בדיוק כמו בלוח (אפיון §5.ז).
 */

export class TagError extends UserFacingError {}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/** שם הנמען של שיוך/מחבר, בלי קשר לסוגו */
function denyUnless(allowed: boolean): void {
  if (!allowed) throw new TagError(he.common.notAllowed);
}

/**
 * מוצא תגית קיימת לפי שם או יוצר חדשה.
 *
 * ‏upsert על השם הייחודי הופך את הפעולה לאטומית: בהזנה מרוכזת נוצרות עשרות
 * פניות ברצף תחת אותה תגית, ושני מסלולים שמנסים ליצור אותה במקביל מקבלים
 * את אותה רשומה ולא כפילות. היוצר הראשון "מחזיק" אותה; שימוש חוזר רק מפנה.
 */
export async function findOrCreateTag(rawName: string, createdById: string) {
  const name = normalizeName(rawName);
  if (!name) throw new TagError(he.tag.nameRequired);

  return db.tag.upsert({
    where: { name },
    update: {},
    create: { name, createdById },
  });
}

/**
 * משנה שם תגית — לתיקון שגיאת הקלדה שיצרה תגית כמעט-כפולה (אפיון מסכים 11–15).
 *
 * שמור למנהל המערכת, כמו שאר ניהול הרשומות: שינוי שם תגית משפיע על כל
 * הפניות המקובצות תחתיה. אם השם החדש כבר קיים הפעולה נדחית — איחוד תגיות
 * אינו בתחולה, והמנהל צריך לתייג מחדש את הפניות במקום.
 */
export async function renameTag(actor: SessionUser, id: string, rawName: string) {
  denyUnless(canManageAdmin(toViewer(actor)));
  const name = normalizeName(rawName);
  if (!name) throw new TagError(he.tag.nameRequired);

  const clash = await db.tag.findUnique({ where: { name } });
  if (clash && clash.id !== id) throw new TagError(he.tag.tagExists);

  return db.tag.update({ where: { id }, data: { name } });
}

/**
 * מוחק תגית ריקה. **הישות המסוכנת ביותר מבין השש.**
 *
 * ל-`Tag` יש שלושה יחסי Cascade — `TicketTag`, `TagAccess` ו-`Message` —
 * כלומר `db.tag.delete` הייתה עוברת בשקט ומשמידה צ׳אט קבוצתי שלם ואת
 * הקיבוץ של כל הפניות שתחתיה. ה-DB לא יעצור כאן דבר; `assertDeletable`
 * הוא כל ההגנה, ולכן היא נקראת לפני כל נגיעה ברשומה.
 *
 * גישות הקבלנים לתגית כן נמחקות איתה — הרשאה על תגית שאינה קיימת חסרת
 * משמעות — ולכן מי שנשאר בלי שום סיבה אחרת לקישור פורטל מאבד אותו.
 */
export async function deleteTag(actor: SessionUser, id: string): Promise<void> {
  denyUnless(canManageAdmin(toViewer(actor)));

  const tag = await db.tag.findUnique({ where: { id }, select: { id: true } });
  if (!tag) throw new TagError(he.tag.notFound);

  await assertDeletable("tag", id);

  const granted = await grantedProfessionalIds(id);
  await db.tag.delete({ where: { id } });

  for (const professionalId of granted) {
    await revokeAccessIfOrphaned(professionalId);
  }
}

/** פרטי הפנייה המינימליים לבדיקת הרשאת תיוג */
async function loadTicketForTag(ticketId: string) {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, siteId: true, createdById: true, closedAt: true },
  });
  if (!ticket) throw new TagError(he.ticket.notFound);
  return ticket;
}

/**
 * מוסיף תגית לפנייה (אפיון §3.2 שדה 12: "הפותח או כל מנהל, בכל עת").
 * מקבל שם ולא מזהה: התגית נלמדת, ולכן תיוג בשם שאינו קיים יוצר אותה.
 */
export async function addTagToTicket(viewer: Viewer, ticketId: string, rawName: string) {
  const ticket = await loadTicketForTag(ticketId);
  denyUnless(canTagTicket(viewer, ticket));
  if (!isUser(viewer)) throw new TagError(he.common.notAllowed);

  const tag = await findOrCreateTag(rawName, viewer.id);
  // ‏upsert ולא create: תיוג חוזר באותה תגית אינו שגיאה ואינו יוצר כפילות.
  await db.ticketTag.upsert({
    where: { ticketId_tagId: { ticketId, tagId: tag.id } },
    update: {},
    create: { ticketId, tagId: tag.id },
  });

  return { id: tag.id, name: tag.name };
}

/** מסיר תגית מפנייה. הצ׳אט של התגית והפניות האחרות שבה אינם מושפעים. */
export async function removeTagFromTicket(viewer: Viewer, ticketId: string, tagId: string) {
  const ticket = await loadTicketForTag(ticketId);
  denyUnless(canTagTicket(viewer, ticket));

  // ‏deleteMany ולא delete: הסרה של תגית שכבר אינה מחוברת אינה שגיאה.
  await db.ticketTag.deleteMany({ where: { ticketId, tagId } });
}

/** תגיות הפנייה, לתצוגה במסך הפנייה */
export async function listTicketTags(ticketId: string): Promise<{ id: string; name: string }[]> {
  const rows = await db.ticketTag.findMany({
    where: { ticketId },
    include: { tag: { select: { id: true, name: true } } },
    orderBy: { tag: { name: "asc" } },
  });
  return rows.map((r) => r.tag);
}

/** כל התגיות, לבוררים ולמסנן הלוח */
export async function listTags(): Promise<{ id: string; name: string }[]> {
  return db.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
}

export interface TagOverview {
  id: string;
  name: string;
  openCount: number;
  closedCount: number;
  grantedCount: number;
}

/**
 * סקירת כל התגיות עם מוני פתוחות/סגורות ומספר הקבלנים שנפתחו — למסך הרשימה.
 *
 * המונים ממודרים לפי הרשאת הצופה: מנהל עבודה סופר רק את פניות האתר שלו,
 * כדי שהמספר יתאים לרשימה שהוא רואה במסך התגית ולא יסתור אותה.
 */
export async function listTagOverviews(user: SessionUser): Promise<TagOverview[]> {
  const tags = await db.tag.findMany({
    orderBy: { name: "asc" },
    include: {
      tickets: { include: { ticket: { select: { siteId: true, closedAt: true } } } },
      _count: { select: { access: true } },
    },
  });

  return tags.map((tag) => {
    const visible = tag.tickets.filter((t) => ticketInScope(user, t.ticket.siteId));
    return {
      id: tag.id,
      name: tag.name,
      openCount: visible.filter((t) => t.ticket.closedAt === null).length,
      closedCount: visible.filter((t) => t.ticket.closedAt !== null).length,
      grantedCount: tag._count.access,
    };
  });
}

/** מנהל עבודה רואה רק את אתרו; מנהל מערכת ובעלים רואים הכול (אפיון §5.ז) */
function ticketInScope(user: SessionUser, siteId: string): boolean {
  if (user.role === "SITE_MANAGER") return user.siteId === siteId;
  return true;
}

/** ההודעות בצ׳אט התגית, בצורה זהה לשרשור פנייה (אותם רכיבי תצוגה) */
async function loadTagMessages(tagId: string) {
  return db.message.findMany({
    where: { tagId },
    orderBy: { createdAt: "asc" },
    include: {
      authorUser: { select: { name: true } },
      authorProfessional: { select: { name: true } },
      media: { where: { uploaded: true }, orderBy: { createdAt: "asc" } },
    },
  });
}

export type TagMessage = Awaited<ReturnType<typeof loadTagMessages>>[number];

/** מזהי הקבלנים שהתגית נפתחה להם — הבסיס לכל בדיקת הרשאה על הצ׳אט */
async function grantedProfessionalIds(tagId: string): Promise<string[]> {
  const rows = await db.tagAccess.findMany({ where: { tagId }, select: { professionalId: true } });
  return rows.map((r) => r.professionalId);
}

export interface TagDetail {
  tag: { id: string; name: string };
  tickets: {
    id: string;
    buildingName: string | null;
    apartmentNumber: string | null;
    domainName: string | null;
    /**
     * השורה הראשונה מהתיאור — **מה שמבדיל בין השורות**.
     *
     * תגית מקבצת בדרך כלל את ליקויי אותה דירה, ולכן מיקום ותחום חוזרים על
     * עצמם: ברשימה של ארבע פניות מבדק בית, כולן "בניין א · דירה 1 · חשמל".
     * עד 0.5 המספר היה ההבדל היחיד, וכשהוא ירד נשארו ארבע שורות זהות.
     */
    descriptionLine: string;
    closed: boolean;
  }[];
  openCount: number;
  closedCount: number;
  granted: { id: string; name: string }[];
  messages: TagMessage[];
  canManageAccess: boolean;
}

/**
 * מסך התגית (מסך 6): רשימת הפניות (ממודרת), מונה, קבלנים שנפתחו, והצ׳אט.
 *
 * מיועד למשתמשים פנימיים בלבד — נמען חיצוני מגיע לצ׳אט דרך `getPortalTagChat`,
 * שאינו יודע כלל לשלוף פניות.
 */
export async function getTagDetail(
  user: SessionUser,
  tagId: string,
): Promise<TagDetail | null> {
  const tag = await db.tag.findUnique({ where: { id: tagId }, select: { id: true, name: true } });
  if (!tag) return null;

  const [ticketTags, granted, messages] = await Promise.all([
    db.ticketTag.findMany({
      where: { tagId },
      include: {
        ticket: {
          select: {
            id: true,
            siteId: true,
            description: true,
            closedAt: true,
            building: { select: { name: true } },
            apartment: { select: { number: true } },
            domain: { select: { name: true } },
          },
        },
      },
      // ‏`seq` נשאר כמפתח מיון אף שאינו מוצג יותר (0.5): הוא סדר היצירה,
      // וזה הסדר הנכון לרשימת פניות של תגית אחת.
      orderBy: { ticket: { seq: "asc" } },
    }),
    db.tagAccess.findMany({
      where: { tagId },
      include: { professional: { select: { id: true, name: true } } },
      orderBy: { grantedAt: "asc" },
    }),
    loadTagMessages(tagId),
  ]);

  const visible = ticketTags.filter((t) => ticketInScope(user, t.ticket.siteId));

  return {
    tag,
    tickets: visible.map((t) => ({
      id: t.ticket.id,
      buildingName: t.ticket.building?.name ?? null,
      apartmentNumber: t.ticket.apartment?.number ?? null,
      domainName: t.ticket.domain?.name ?? null,
      descriptionLine: firstLine(t.ticket.description),
      closed: t.ticket.closedAt !== null,
    })),
    openCount: visible.filter((t) => t.ticket.closedAt === null).length,
    closedCount: visible.filter((t) => t.ticket.closedAt !== null).length,
    granted: granted.map((g) => g.professional),
    messages,
    canManageAccess: canManageTagAccess(toViewer(user)),
  };
}

/**
 * מוסיף הודעה לצ׳אט התגית.
 *
 * ההרשאה זהה לצפייה: מי שרואה את הצ׳אט רשאי לכתוב בו. נמען חיצוני יכול
 * לכתוב רק בתגית שנפתחה לו — זו כל הנקודה של הצ׳אט הקבוצתי (אפיון §2.3).
 */
export async function addTagMessage(
  viewer: Viewer,
  tagId: string,
  rawText: string,
  mediaIds: string[] = [],
) {
  const text = rawText.trim();
  if (!text && mediaIds.length === 0) throw new TagError(he.ticket.emptyMessage);

  const tag = await db.tag.findUnique({ where: { id: tagId }, select: { id: true } });
  if (!tag) throw new TagError(he.common.notAllowed);

  denyUnless(canPostTagChat(viewer, await grantedProfessionalIds(tagId)));

  return db.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        tagId,
        kind: mediaIds.length > 0 ? "MEDIA" : "TEXT",
        text: text || null,
        authorUserId: viewer.kind === "user" ? viewer.id : null,
        authorProfessionalId: viewer.kind === "professional" ? viewer.id : null,
      },
    });

    if (mediaIds.length > 0) {
      // רק קבצים שהועלו במלואם וטרם שויכו — אותו תנאי כמו בשרשור פנייה,
      // כדי שלא ניתן יהיה לצרף קובץ ששייך למקום אחר ולעקוף בדיקת הרשאה.
      await tx.mediaFile.updateMany({
        where: { id: { in: mediaIds }, uploaded: true, messageId: null },
        data: { messageId: message.id },
      });
    }

    return message;
  });
}

/**
 * פותח תגית לקבלנים — הפעולה הרגישה של מסך 6.
 *
 * לכל קבלן שנבחר: נוצרת גישה לצ׳אט (idempotent), ומובטח לו קישור פורטל
 * פעיל — קבלן שנפתחה לו תגית בלי שהוא משויך לאף פנייה עדיין צריך דרך
 * להיכנס. אירוע נרשם בצ׳אט כדי שההיסטוריה תהיה שקופה.
 *
 * מחזיר את שמות הקבלנים שנפתחו בפועל, לנוסח האישור מהאפיון.
 */
export async function grantTagAccess(
  viewer: Viewer,
  tagId: string,
  professionalIds: string[],
): Promise<string[]> {
  denyUnless(canManageTagAccess(viewer));

  const tag = await db.tag.findUnique({ where: { id: tagId }, select: { id: true } });
  if (!tag) throw new TagError(he.common.notAllowed);

  const unique = [...new Set(professionalIds)];
  // מושבת אינו נפתח לתגית חדשה (0.4) — אותו כלל כמו בבורר הנמענים.
  // גישות שכבר ניתנו אינן נוגעות: ההשבתה מכוונת לעתיד.
  const professionals = await db.professional.findMany({
    where: { id: { in: unique }, active: true },
    select: { id: true, name: true },
  });
  if (professionals.length === 0) return [];

  await db.$transaction(async (tx) => {
    for (const professional of professionals) {
      await tx.tagAccess.upsert({
        where: { tagId_professionalId: { tagId, professionalId: professional.id } },
        update: {},
        create: { tagId, professionalId: professional.id },
      });
      await ensureAccessToken(tx, professional.id);
    }

    await recordTagEvent(tx, tagId, "TAG_GRANTED", {
      names: professionals.map((p) => p.name).join(", "),
    });
  });

  return professionals.map((p) => p.name);
}

/**
 * מבטל את גישת הקבלן לצ׳אט התגית.
 * ביטול הגישה אינו הורג את הקישור מיד: אם לקבלן נותרו שיוכים פעילים או
 * תגיות אחרות שנפתחו לו, הקישור נשאר חי. רק קבלן שנשאר בלי כלום מאבד אותו
 * (`revokeAccessIfOrphaned`).
 */
export async function revokeTagAccess(
  viewer: Viewer,
  tagId: string,
  professionalId: string,
): Promise<void> {
  denyUnless(canManageTagAccess(viewer));

  const professional = await db.professional.findUnique({
    where: { id: professionalId },
    select: { name: true },
  });

  await db.$transaction(async (tx) => {
    const { count } = await tx.tagAccess.deleteMany({ where: { tagId, professionalId } });
    if (count === 0) return;
    await recordTagEvent(tx, tagId, "TAG_REVOKED", { name: professional?.name ?? "" });
  });

  await revokeAccessIfOrphaned(professionalId);
}

/**
 * מחזיר את קישור הפורטל של קבלן שנפתחה לו התגית, כדי שהמנהל ישלח לו אותו.
 *
 * זהו החוליה שסוגרת את "פתח לקבלנים": קבלן שנפתחה לו תגית בלבד (בלי שיוך
 * לאף פנייה) קיבל טוקן ב-`grantTagAccess`, אבל בלי הקישור אין למנהל מה
 * לשלוח. מחזיר את הקישור **הקיים** ואינו מבטל דבר — כמו במסך הפנייה.
 */
export async function getTagContractorLink(
  viewer: Viewer,
  tagId: string,
  professionalId: string,
): Promise<string> {
  denyUnless(canManageTagAccess(viewer));

  const grant = await db.tagAccess.findUnique({
    where: { tagId_professionalId: { tagId, professionalId } },
  });
  if (!grant) throw new TagError(he.common.notAllowed);

  // ההרשאה לפתוח תגית אינה ההרשאה לחשוף את קישור הקסם — ראה
  // `canRevealPortalLink`. הבדיקה כאן ולא ב-`grantTagAccess`: פתיחת התגית
  // עצמה נשארת פתוחה למנהל עבודה, ומה שהוגבל הוא חשיפת הסוד הגלובלי.
  denyUnless(canRevealPortalLink(viewer, await hasSiteWorkWith(viewer, professionalId)));

  return ensurePortalLink(professionalId);
}

/**
 * האם לצופה יש קשר עבודה ממשי עם הקבלן — שיוך פעיל לפנייה **באתר שלו**.
 *
 * זהו התנאי שמחליף את "כל קבלן ברשימה" עבור מנהל עבודה. הוא נבחר מפני שהוא
 * בדיוק מה שהמנהל כבר רואה ומנהל בפועל: קבלן שמשויך לפנייה באתר שלו הוא
 * קבלן שהוא ממילא מתאם מולו, ושהקישור שלו היה מגיע אליו דרך מסך הפנייה.
 *
 * מדלג על השאילתה למי שאינו מנהל עבודה — מנהל מערכת רשאי בלי קשר, ולבעלים
 * אין גישה לפעולה מלכתחילה.
 */
async function hasSiteWorkWith(viewer: Viewer, professionalId: string): Promise<boolean> {
  if (!isUser(viewer) || viewer.role !== "SITE_MANAGER" || !viewer.siteId) return false;

  const count = await db.assignment.count({
    where: {
      professionalId,
      status: { not: "REMOVED" },
      ticket: { siteId: viewer.siteId },
    },
  });
  return count > 0;
}

/** רושם אירוע מערכת בצ׳אט התגית (נפתחה/בוטלה גישה) */
async function recordTagEvent(
  tx: Tx,
  tagId: string,
  eventType: string,
  eventMeta: Record<string, string>,
) {
  await tx.message.create({ data: { tagId, kind: "EVENT", eventType, eventMeta } });
}

// ────────────────────────── הפורטל של הקבלן ──────────────────────────

/**
 * הצ׳אטים הקבוצתיים שנפתחו לקבלן — לרשימה בלוח הפורטל שלו.
 * מחזיר תגיות בלבד; רשימת הפניות שבתגית אינה נגישה לו לעולם.
 */
export async function listPortalTagChats(
  professionalId: string,
): Promise<{ id: string; name: string }[]> {
  const grants = await db.tagAccess.findMany({
    where: { professionalId },
    include: { tag: { select: { id: true, name: true } } },
    orderBy: { grantedAt: "desc" },
  });
  return grants.map((g) => g.tag);
}

/**
 * צ׳אט תגית בודד בפורטל, אם ורק אם התגית נפתחה לקבלן במפורש.
 * לא מחזיר פניות — הפרדה זו היא הכלל המרכזי של התגית (אפיון §5.ה).
 */
export async function getPortalTagChat(professionalId: string, tagId: string) {
  const grant = await db.tagAccess.findUnique({
    where: { tagId_professionalId: { tagId, professionalId } },
  });
  if (!grant) return null;

  const tag = await db.tag.findUnique({ where: { id: tagId }, select: { id: true, name: true } });
  if (!tag) return null;

  return { tag, messages: await loadTagMessages(tagId) };
}

/** משמש את שירות החיפוש כדי לצרף את טקסט צ׳אט התגית לחיפוש הפניות */
export function tagChatTextMatch(query: string): Prisma.TicketWhereInput {
  const contains = { contains: query, mode: "insensitive" as const };
  return {
    tags: {
      some: {
        tag: {
          messages: {
            some: {
              OR: [
                { text: contains },
                { media: { some: { transcription: contains } } },
                { media: { some: { extractedText: contains } } },
              ],
            },
          },
        },
      },
    },
  };
}
