import type { Prisma } from "@/generated/prisma/client";
import type { BoardCard } from "@/lib/board-view";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/session";
import {
  type BoardSection,
  deriveBoardSection,
  deriveTicketStatus,
  reasonText,
} from "@/lib/ticket-status";

/**
 * שליפת הלוח הראשי (מסך 1 באפיון) והכנתו לתצוגה.
 *
 * הסינון לפי הרשאה נעשה **בשאילתה** ולא אחריה: מנהל עבודה רואה רק את
 * האתר שלו, ואין טעם לשלוף מה-DB פניות שייזרקו. הקיבוץ לסקשנים, לעומת
 * זאת, נעשה בזיכרון — הוא נגזר מסטטוסי השיוכים, ולוגיקת הגזירה חיה
 * במקום אחד (`ticket-status.ts`) ולא משוכפלת ל-SQL.
 */

export interface BoardFilters {
  /** "הפניתי" מול "קיבלתי" — החיתוך המרכזי באפיון §3.6 */
  direction?: "opened" | "received";
  /** סינון לאתר — רלוונטי רק למי שרואה יותר מאחד (בעלים, מנהל מערכת) */
  siteId?: string;
  buildingId?: string;
  domainId?: string;
  /** מזהה איש מקצוע או משתמש פנימי */
  recipientId?: string;
  tagId?: string;
}

export interface BoardData {
  sections: Record<BoardSection, BoardCard[]>;
  /** האתרים שהצופה רשאי לסנן לפיהם — ריק למנהל עבודה (מקובע לאתרו) */
  sites: { id: string; name: string }[];
  buildings: { id: string; name: string }[];
  domains: { id: string; name: string }[];
  recipients: { id: string; name: string }[];
  tags: { id: string; name: string }[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** לוח ריק לחלוטין — לתרחיש ה-fail-closed של מנהל עבודה ללא אתר */
function emptyBoard(): BoardData {
  return {
    sections: { ACTION_REQUIRED: [], WITH_RECIPIENTS: [], ARCHIVE: [] },
    sites: [],
    buildings: [],
    domains: [],
    recipients: [],
    tags: [],
  };
}

function firstLine(text: string): string {
  const line = text.split("\n")[0]?.trim() ?? "";
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

export async function getBoard(
  user: SessionUser,
  filters: BoardFilters,
  now: Date,
): Promise<BoardData> {
  // ‏fail-closed: מנהל עבודה חייב אתר (נאכף ביצירה). אם איכשהו הגיע לכאן
  // בלי אתר — מצב לא-תקין — עדיף מסך ריק על חשיפת כל האתרים בשקט.
  if (user.role === "SITE_MANAGER" && !user.siteId) return emptyBoard();

  // כל תנאי הוא איבר עצמאי ב-AND, ולא spread לתוך אובייקט אחד: כששניים
  // מהם נשענים על `assignments` (למשל "קיבלתי" יחד עם סינון נמען), spread
  // היה גורם למפתח השני לדרוס את הראשון ולאבד תנאי בשקט.
  const conditions: Prisma.TicketWhereInput[] = [];

  // מנהל עבודה מוגבל לאתר שלו; מנהל מערכת ובעלים רואים הכול (אפיון §5.ז).
  if (user.role === "SITE_MANAGER" && user.siteId) conditions.push({ siteId: user.siteId });
  // סינון אתר מפורש חל רק על מי שאינו מקובע לאתר — כך אינו עוקף את המידור.
  if (!user.siteId && filters.siteId) conditions.push({ siteId: filters.siteId });

  if (filters.direction === "opened") conditions.push({ createdById: user.id });
  if (filters.direction === "received") {
    conditions.push({ assignments: { some: { userId: user.id, status: { not: "REMOVED" } } } });
  }
  if (filters.buildingId) conditions.push({ buildingId: filters.buildingId });
  if (filters.domainId) conditions.push({ domainId: filters.domainId });
  if (filters.recipientId) {
    conditions.push({
      assignments: {
        some: {
          status: { not: "REMOVED" },
          OR: [{ professionalId: filters.recipientId }, { userId: filters.recipientId }],
        },
      },
    });
  }
  if (filters.tagId) conditions.push({ tags: { some: { tagId: filters.tagId } } });

  const tickets = await db.ticket.findMany({
    where: { AND: conditions },
    orderBy: { lastActivityAt: "desc" },
    include: {
      building: { select: { name: true } },
      apartment: { select: { number: true } },
      domain: { select: { name: true } },
      handler: { select: { name: true } },
      assignments: {
        include: {
          professional: { select: { name: true } },
          user: { select: { name: true } },
        },
      },
    },
  });

  const sections: Record<BoardSection, BoardCard[]> = {
    ACTION_REQUIRED: [],
    WITH_RECIPIENTS: [],
    ARCHIVE: [],
  };

  for (const ticket of tickets) {
    const assignmentViews = ticket.assignments.map((a) => ({
      status: a.status,
      recipientName: a.professional?.name ?? a.user?.name ?? "",
    }));
    const view = { ...ticket, handlerName: ticket.handler?.name ?? null };
    const status = deriveTicketStatus(view, assignmentViews);

    sections[deriveBoardSection(status, ticket.escalated)].push({
      id: ticket.id,
      seq: ticket.seq,
      buildingName: ticket.building?.name ?? null,
      apartmentNumber: ticket.apartment?.number ?? null,
      domainName: ticket.domain?.name ?? null,
      descriptionLine: firstLine(ticket.description),
      channel: ticket.channel,
      recipientNames: assignmentViews
        .filter((a) => a.status !== "REMOVED")
        .map((a) => a.recipientName),
      status,
      section: deriveBoardSection(status, ticket.escalated),
      reason: reasonText(view, assignmentViews, now),
      ageDays: Math.floor((now.getTime() - ticket.createdAt.getTime()) / MS_PER_DAY),
      reopened: ticket.reopenCount > 0,
      escalated: ticket.escalated,
      createdAt: ticket.createdAt,
    });
  }

  // טיוטות מוצמדות לראש "דורש ממך": הן דורשות השלמה ידנית לפני שאפשר לשגר,
  // ואסור שפניות אחרות ידחפו אותן אל מחוץ למסך (אפיון מסך 7). המיון יציב,
  // ולכן הסדר לפי lastActivityAt נשמר בתוך כל קבוצה.
  sections.ACTION_REQUIRED.sort(
    (a, b) => (a.status === "DRAFT" ? 0 : 1) - (b.status === "DRAFT" ? 0 : 1),
  );

  const [sites, buildings, domains, professionals, tags] = await Promise.all([
    // רשימת האתרים לבורר — ריקה למנהל עבודה, שכן אין לו מה לסנן.
    user.siteId
      ? Promise.resolve([] as { id: string; name: string }[])
      : db.site.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.building.findMany({
      where: user.siteId ? { siteId: user.siteId } : {},
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.domain.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.professional.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return { sections, sites, buildings, domains, recipients: professionals, tags };
}

