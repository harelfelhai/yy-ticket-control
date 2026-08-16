import type { Prisma } from "@/generated/prisma/client";
import type { BoardCard } from "@/lib/board-view";
import { db } from "@/lib/db";
import { normalizeName } from "@/lib/normalize";
import type { SessionUser } from "@/lib/session";
import {
  type DerivedTicketStatus,
  deriveAwaitingReply,
  deriveBoardSection,
  deriveTicketStatus,
  reasonText,
  toLastMessageView,
} from "@/lib/ticket-status";
import { tagChatTextMatch } from "./tags";

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
  /** סינון אתר — רלוונטי רק למי שרואה יותר מאחד (בעלים, מנהל מערכת) */
  siteId?: string;
  buildingId?: string;
  apartmentId?: string;
  domainId?: string;
  recipientId?: string;
  tagId?: string;
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
  // fail-closed: מנהל עבודה חייב אתר. בלי אתר — תוצאה ריקה, לא כל האתרים.
  if (user.role === "SITE_MANAGER" && !user.siteId) return { cards: [], truncated: false };

  const query = normalizeName(filters.query ?? "");

  const tickets = await db.ticket.findMany({
    where: {
      AND: [...scope(user, filters), ...(query ? [textMatch(query)] : [])],
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
      // ההודעה האחרונה בלבד, לחישוב "ממתין למענה" — כמו בלוח. תוצאות
      // החיפוש מציגות את אותו כרטיס, וכרטיס שאומר דבר אחר משהלוח אומר על
      // אותה פנייה הוא בדיוק מה ששוחק את האמון במיון.
      messages: {
        where: { kind: { not: "EVENT" } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          authorUserId: true,
          authorProfessionalId: true,
          authorUser: { select: { name: true } },
          authorProfessional: { select: { name: true } },
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
    const awaitingReply = deriveAwaitingReply(
      toLastMessageView(ticket.messages),
      ticket.assignments
        .filter((a) => a.status !== "REMOVED")
        .map((a) => a.professionalId ?? a.userId)
        .filter((assignedId): assignedId is string => assignedId !== null),
    );

    const view = { ...ticket, handlerName: ticket.handler?.name ?? null, awaitingReply };
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
      section: deriveBoardSection(status, ticket.escalated, Boolean(awaitingReply)),
      reason: reasonText(view, assignmentViews, now),
      ageDays: Math.floor((now.getTime() - ticket.createdAt.getTime()) / MS_PER_DAY),
      reopened: ticket.reopenCount > 0,
      escalated: ticket.escalated,
      createdAt: ticket.createdAt,
    });
  }

  return {
    cards: cards.slice(0, RESULT_LIMIT),
    truncated: cards.length > RESULT_LIMIT || tickets.length === CANDIDATE_LIMIT,
  };
}

/**
 * הרשאה ומסננים מבניים — כל מה שאפשר לבטא ב-SQL, כמערך תנאים ל-AND.
 *
 * מערך ולא spread לתוך אובייקט אחד: כששני תנאים נשענים על `assignments`
 * (למשל "קיבלתי" יחד עם סינון נמען), spread היה גורם לשני לדרוס את הראשון
 * ולאבד תנאי בשקט — בדיוק כמו בלוח.
 */
function scope(user: SessionUser, filters: SearchFilters): Prisma.TicketWhereInput[] {
  const conditions: Prisma.TicketWhereInput[] = [];

  // מנהל עבודה מוגבל לאתר שלו; מנהל מערכת ובעלים רואים הכול (אפיון §5.ז).
  if (user.role === "SITE_MANAGER" && user.siteId) conditions.push({ siteId: user.siteId });
  // סינון אתר מפורש חל רק על מי שאינו מקובע לאתר.
  if (!user.siteId && filters.siteId) conditions.push({ siteId: filters.siteId });

  if (filters.direction === "opened") conditions.push({ createdById: user.id });
  if (filters.direction === "received") {
    conditions.push({ assignments: { some: { userId: user.id, status: { not: "REMOVED" } } } });
  }
  if (filters.buildingId) conditions.push({ buildingId: filters.buildingId });
  if (filters.apartmentId) conditions.push({ apartmentId: filters.apartmentId });
  if (filters.domainId) conditions.push({ domainId: filters.domainId });
  if (filters.tagId) conditions.push({ tags: { some: { tagId: filters.tagId } } });
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
  if (filters.from || filters.to) {
    conditions.push({
      createdAt: {
        ...(filters.from ? { gte: filters.from } : {}),
        // עד סוף היום שנבחר: "עד 22.7" מתכוון לכלול את כל אותו יום.
        ...(filters.to ? { lte: endOfDay(filters.to) } : {}),
      },
    });
  }

  return conditions;
}

/**
 * המקומות שבהם טקסט שקשור לפנייה יכול לחיות.
 *
 * ‏`insensitive` נדרש גם בעברית: העברית אינה מבחינה ברישיות, אבל השאילתה
 * חוצה גם טקסט באנגלית — שמות מוצרים, קודים, ומה שחולץ מדוח.
 *
 * הענף האחרון חוצה את **צ׳אט התגית**: דוח בדק בית שהועלה בהזנה המרוכזת
 * יושב כהודעה בצ׳אט התגית המשותפת (מסך 5, אזור א׳), והטקסט שחולץ ממנו
 * חייב להיות "זמין לחיפוש" (האפיון). כך חיפוש מילה מהדוח מעלה את כל פניות
 * הבדק בית של אותה דירה, ולא רק את זו שבמקרה כתובה בתיאורה.
 */
function textMatch(query: string): Prisma.TicketWhereInput {
  const contains = { contains: query, mode: "insensitive" as const };

  return {
    OR: [
      { description: contains },
      { messages: { some: { text: contains } } },
      { messages: { some: { media: { some: { transcription: contains } } } } },
      { messages: { some: { media: { some: { extractedText: contains } } } } },
      tagChatTextMatch(query),
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
