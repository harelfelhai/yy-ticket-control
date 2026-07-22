import type { Prisma } from "@/generated/prisma/client";
import type { BoardCard } from "@/lib/board-view";
import { db } from "@/lib/db";
import { normalizeName } from "@/lib/normalize";
import type { SessionUser } from "@/lib/session";
import {
  type DerivedTicketStatus,
  deriveBoardSection,
  deriveTicketStatus,
  reasonText,
} from "@/lib/ticket-status";

/**
 * חיפוש (מסך 9 באפיון).
 *
 * מה שמייחד אותו: הוא חוצה **גם את התמלול ואת הטקסט המחולץ** (§3.6). זו
 * הסיבה שהעיבוד ב-AI קיים בכלל — הקלטה שאי אפשר לחפש בה היא קובץ שמישהו
 * צריך לזכור שהוא קיים, וטקסט מתוך דוח בדק בית שאינו נגיש לחיפוש הוא
 * תמונה שצריך לפתוח ולקרוא.
 *
 * ההיקף מוגבל להרשאה **בשאילתה**, כמו בלוח: מנהל עבודה מחפש בתוך האתר
 * שלו בלבד, ואין טעם לשלוף מה-DB פניות שייזרקו.
 */

export interface SearchFilters {
  /** הטקסט החופשי. ריק = כל הפניות שעונות למסננים */
  query?: string;
  direction?: "opened" | "received";
  buildingId?: string;
  domainId?: string;
  recipientId?: string;
  status?: DerivedTicketStatus;
  /** טווח תאריכי פתיחה, כולל */
  from?: Date;
  to?: Date;
}

/**
 * תקרת המועמדים שנשלפים לפני סינון הסטטוס.
 *
 * סטטוס הפנייה נגזר מהשיוכים ואינו שמור, ולכן אי אפשר לסנן לפיו ב-SQL.
 * הפשרה: שולפים עד התקרה, גוזרים בזיכרון, ואז מסננים. בקנה המידה כאן
 * (אלפי פניות לכל היותר) זה זול, והחלופה — לשמור סטטוס מחושב בטבלה —
 * הייתה מייצרת שדה שיכול לסתור את השיוכים.
 */
const CANDIDATE_LIMIT = 300;

/** כמה תוצאות מוצגות בפועל */
export const RESULT_LIMIT = 50;

export interface SearchResult {
  cards: BoardCard[];
  /** האם נחתכו תוצאות — הממשק אומר זאת במפורש במקום להעמיד פנים */
  truncated: boolean;
}

export async function searchTickets(
  user: SessionUser,
  filters: SearchFilters,
  now: Date = new Date(),
): Promise<SearchResult> {
  const query = normalizeName(filters.query ?? "");

  const tickets = await db.ticket.findMany({
    where: {
      AND: [scope(user, filters), ...(query ? [textMatch(query)] : [])],
    },
    orderBy: { lastActivityAt: "desc" },
    take: CANDIDATE_LIMIT,
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

  const cards: BoardCard[] = [];

  for (const ticket of tickets) {
    const assignmentViews = ticket.assignments.map((a) => ({
      status: a.status,
      recipientName: a.professional?.name ?? a.user?.name ?? "",
    }));
    const view = { ...ticket, handlerName: ticket.handler?.name ?? null };
    const status = deriveTicketStatus(view, assignmentViews);

    if (filters.status && status !== filters.status) continue;

    cards.push({
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
      createdAt: ticket.createdAt,
    });
  }

  return {
    cards: cards.slice(0, RESULT_LIMIT),
    truncated: cards.length > RESULT_LIMIT || tickets.length === CANDIDATE_LIMIT,
  };
}

/** הרשאה ומסננים מבניים — כל מה שאפשר לבטא ב-SQL */
function scope(user: SessionUser, filters: SearchFilters): Prisma.TicketWhereInput {
  return {
    // מנהל עבודה מוגבל לאתר שלו; מנהל מערכת ובעלים רואים הכול (אפיון §5.ז).
    ...(user.role === "SITE_MANAGER" && user.siteId ? { siteId: user.siteId } : {}),
    ...(filters.direction === "opened" ? { createdById: user.id } : {}),
    ...(filters.direction === "received"
      ? { assignments: { some: { userId: user.id, status: { not: "REMOVED" } } } }
      : {}),
    ...(filters.buildingId ? { buildingId: filters.buildingId } : {}),
    ...(filters.domainId ? { domainId: filters.domainId } : {}),
    ...(filters.recipientId
      ? {
          assignments: {
            some: {
              status: { not: "REMOVED" },
              OR: [{ professionalId: filters.recipientId }, { userId: filters.recipientId }],
            },
          },
        }
      : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            // עד סוף היום שנבחר: משתמש שבוחר "עד 22.7" מתכוון לכלול את
            // כל אותו יום, ולא רק את חצות שלו.
            ...(filters.to ? { lte: endOfDay(filters.to) } : {}),
          },
        }
      : {}),
  };
}

/**
 * ארבעת המקומות שבהם טקסט של פנייה יכול לחיות.
 *
 * ‏`insensitive` נדרש גם בעברית: העברית אינה מבחינה ברישיות, אבל השאילתה
 * חוצה גם טקסט באנגלית — שמות מוצרים, קודים, ומה שחולץ מדוח.
 */
function textMatch(query: string): Prisma.TicketWhereInput {
  const contains = { contains: query, mode: "insensitive" as const };

  return {
    OR: [
      { description: contains },
      { messages: { some: { text: contains } } },
      { messages: { some: { media: { some: { transcription: contains } } } } },
      { messages: { some: { media: { some: { extractedText: contains } } } } },
    ],
  };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function endOfDay(value: Date): Date {
  const end = new Date(value);
  end.setHours(23, 59, 59, 999);
  return end;
}

function firstLine(text: string): string {
  const line = text.split("\n")[0]?.trim() ?? "";
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}
