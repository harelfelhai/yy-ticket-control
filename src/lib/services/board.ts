import type { Prisma } from "@/generated/prisma/client";
import type { BoardCard } from "@/lib/board-view";
import { db } from "@/lib/db";
import { firstLine } from "@/lib/format";
import type { SessionUser } from "@/lib/session";
import { compareApartmentNumbers } from "@/lib/normalize";
import { tagChatTextMatch } from "@/lib/services/tags";
import type { DerivedTicketStatus } from "@/lib/ticket-status";
import {
  type BoardSection,
  deriveAwaitingReply,
  deriveBoardSection,
  deriveTicketStatus,
  reasonText,
  toLastMessageView,
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
  /**
   * טקסט חופשי. כשהוא קיים הלוח עובר למצב תוצאות: רשימה שטוחה במקום שלוש
   * הקבוצות. ראו `BoardData.search`.
   */
  query?: string;
  /** "הפניתי" מול "קיבלתי" — החיתוך המרכזי באפיון §3.6 */
  direction?: "opened" | "received";
  /** סינון לאתר — רלוונטי רק למי שרואה יותר מאחד (בעלים, מנהל מערכת) */
  siteId?: string;
  buildingId?: string;
  apartmentId?: string;
  domainId?: string;
  /** מזהה איש מקצוע או משתמש פנימי */
  recipientId?: string;
  tagId?: string;
  /**
   * מצב הפנייה כפי שהוא **נגזר** מהשיוכים.
   *
   * מסונן בזיכרון ולא ב-SQL, ואין ברירה: הסטטוס אינו עמודה אלא תוצאה של
   * `deriveTicketStatus`, והחלופה — לשמור אותו בטבלה — הייתה מייצרת שדה
   * שיכול לסתור את השיוכים שהוא נגזר מהם.
   */
  status?: DerivedTicketStatus;
  /** טווח תאריכי פתיחה, כולל */
  from?: Date;
  to?: Date;
}

export interface BoardData {
  sections: Record<BoardSection, BoardCard[]>;
  /**
   * תוצאות חיפוש — קיים רק כשנמסר `query`, ואז הוא מה שהמסך מציג.
   *
   * **למה רשימה שטוחה ולא הקבוצות הרגילות.** הקיבוץ של הלוח עונה על "אצל
   * מי הכדור", ובחיפוש השאלה אחרת לגמרי — "איפה ראיתי את זה". פנייה סגורה
   * שתואמת את החיפוש הייתה נוחתת בארכיון, שמקופל כברירת מחדל: המשתמש מחפש,
   * מקבל התאמה, ורואה מסך ריק עם "אין כאן כלום". זה בדיוק הכשל שהמסך הנפרד
   * לא סבל ממנו, ואין סיבה לרשת אותו יחד עם האיחוד.
   */
  search: { cards: BoardCard[]; truncated: boolean } | null;
  /**
   * האם יש בארכיון פניות מעבר למה שנטען (`ARCHIVE_LIMIT`).
   *
   * נאמר למשתמש במפורש ואינו נבלע: קטיעה שקטה היא בדיוק מה שהופך רשימה
   * ל"מה שיש" בעיני הקורא. כשהוא true המסך מפנה לחיפוש, שסורק את הארכיון
   * כולו ואינו מוגבל לחלון הזה.
   */
  archiveTruncated: boolean;
  /** האתרים שהצופה רשאי לסנן לפיהם — ריק למנהל עבודה (מקובע לאתרו) */
  sites: { id: string; name: string }[];
  buildings: { id: string; name: string }[];
  /** דירות הבניין שנבחר — ריק כשלא נבחר בניין */
  apartments: { id: string; name: string }[];
  domains: { id: string; name: string }[];
  recipients: { id: string; name: string }[];
  tags: { id: string; name: string }[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * כמה פניות סגורות נטענות ללוח.
 *
 * הארכיון מקופל כברירת מחדל ומשמש לצפייה אחורה, לא לסריקה יומית — מי שמחפש
 * פנייה מסוימת משתמש בחיפוש הטקסט, שסורק את הארכיון כולו. חמישים הן יותר
 * ממה שנגללים בפועל, וקטנות מספיק כדי שמשקל המסך יישאר קבוע גם אחרי שנים
 * של פניות שנסגרו ולא נמחקו.
 */
const ARCHIVE_LIMIT = 50;

/**
 * מה נטען לכל כרטיס בלוח. מוגדר פעם אחת ונצרך בשתי השאילתות (פעילות
 * וארכיון), כדי ששתיהן לא תוכלנה להיפרד בשקט ולהחזיר צורות שונות.
 */
const TICKET_INCLUDE = {
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
  /*
   * ההודעה האחרונה בלבד — לחישוב "ממתין למענה" (`deriveAwaitingReply`).
   *
   * ‏`take: 1` ולא שליפת השרשור: הלוח מציג עשרות פניות, וטעינת כל
   * ההודעות שלהן רק כדי לקרוא את האחרונה הייתה מכפילה את המשקל של
   * המסך הנפתח ביותר במערכת. אירועי מערכת מסוננים כאן ולא אחר כך —
   * ‏"שויך לרונית" אינו הודעה של אדם, ואילו נכלל היה כל שיוך מסמן
   * את הפנייה כממתינה למענה.
   */
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
} satisfies Prisma.TicketInclude;

/** פנייה כפי שהיא נשלפת ללוח, על כל מה ש-`TICKET_INCLUDE` מביא איתה */
type BoardTicket = Prisma.TicketGetPayload<{ include: typeof TICKET_INCLUDE }>;

/** לוח ריק לחלוטין — לתרחיש ה-fail-closed של מנהל עבודה ללא אתר */
function emptyBoard(): BoardData {
  return {
    sections: { ACTION_REQUIRED: [], WITH_RECIPIENTS: [], ARCHIVE: [] },
    search: null,
    archiveTruncated: false,
    sites: [],
    buildings: [],
    apartments: [],
    domains: [],
    recipients: [],
    tags: [],
  };
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

  /**
   * מנהל עבודה מוגבל לאתר שלו; מנהל מערכת ובעלים רואים הכול (אפיון §5.ז).
   *
   * ה-OR משקף את `canViewTicket` בדיוק: §5.ז מעניק לאותו אדם שני כובעים —
   * האתר שלו, ופניות ששויכו אליו **מכל האתרים**. שאילתה שמסננת לפי
   * אתר בלבד הייתה משאירה פנייה שהמשתמש **רשאי** לראות מחוץ ללוח שלו
   * ומחוץ למסנן "קיבלתי" — נגישה דרך קישור במייל בלבד, והפרדה בין
   * מה שנראה למה שמותר היא בדיוק הסוג של פער שאיש אינו מדווח עליו.
   */
  if (user.role === "SITE_MANAGER" && user.siteId) {
    conditions.push({
      OR: [
        { siteId: user.siteId },
        { assignments: { some: { userId: user.id, status: { not: "REMOVED" } } } },
      ],
    });
  }
  // סינון אתר מפורש חל רק על מי שאינו מקובע לאתר — כך אינו עוקף את המידור.
  if (!user.siteId && filters.siteId) conditions.push({ siteId: filters.siteId });

  if (filters.direction === "opened") conditions.push({ createdById: user.id });
  if (filters.direction === "received") {
    conditions.push({ assignments: { some: { userId: user.id, status: { not: "REMOVED" } } } });
  }
  if (filters.buildingId) conditions.push({ buildingId: filters.buildingId });
  if (filters.apartmentId) conditions.push({ apartmentId: filters.apartmentId });
  if (filters.domainId) conditions.push({ domainId: filters.domainId });
  if (filters.from || filters.to) {
    conditions.push({
      createdAt: {
        ...(filters.from ? { gte: filters.from } : {}),
        // עד סוף היום שנבחר: "עד 22.7" מתכוון לכלול את כל אותו יום.
        ...(filters.to ? { lte: endOfDay(filters.to) } : {}),
      },
    });
  }
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

  /**
   * הטקסט החופשי נכנס כתנאי נוסף באותו `AND`, ולא כמסלול שאילתה נפרד.
   *
   * זה מה שאפשר לאחד את מסך החיפוש לתוך הלוח: ההרשאה, המידור לפי אתר וכל
   * ששת המסננים כבר בנויים כאן, ומסך החיפוש שכפל אותם שורה בשורה. מה שהיה
   * ייחודי לו הוא `textMatch` בלבד — ארבעה מקורות טקסט ועוד צ׳אט התגית.
   */
  const query = filters.query?.trim();
  if (query) conditions.push(textMatch(query));

  /**
   * **הפניות הפעילות ללא תקרה, הארכיון עם תקרה.**
   *
   * קודם לא הייתה כאן שום תקרה כשאין חיפוש, והנימוק היה נכון למחצה: קטיעה
   * של הלוח אכן הייתה מסתירה פניות שדורשות טיפול בלי שאיש ידע. אבל הוא
   * חל על שתי הקבוצות הפעילות בלבד — **לא על הארכיון**, והארכיון הוא כל
   * מה שגדל: פנייה אמיתית אינה נמחקת לעולם (ראה `schema.prisma`), ולכן
   * מספר הפניות הפתוחות נשאר קבוע בעוד הסגורות מצטברות לאורך שנים. המסך
   * הנפתח ביותר במערכת היה שולף את כולן, על כל שיוכיהן, בכל טעינה — כדי
   * להציג קבוצה שמקופלת ממילא כברירת מחדל.
   *
   * ‏`ARCHIVE` הוא בדיוק `closedAt !== null` (ראה `deriveBoardSection`
   * ו-`deriveTicketStatus`), ולכן ההפרדה ניתנת לביטוי בשאילתה ואינה דורשת
   * לנחש. הקטיעה נאמרת למשתמש במפורש ואינה נבלעת — ראה `archiveTruncated`.
   *
   * במצב חיפוש אין הפרדה: החיפוש חייב להגיע גם לארכיון, ולכן נשארת תקרת
   * המועמדים האחת על פני שתי הקבוצות.
   */
  const [activeTickets, archiveTickets] = await Promise.all([
    db.ticket.findMany({
      where: { AND: query ? conditions : [...conditions, { closedAt: null }] },
      orderBy: { lastActivityAt: "desc" },
      ...(query ? { take: SEARCH_CANDIDATE_LIMIT } : {}),
      include: TICKET_INCLUDE,
    }),
    query
      ? Promise.resolve([] as BoardTicket[])
      : db.ticket.findMany({
          where: { AND: [...conditions, { closedAt: { not: null } }] },
          orderBy: { lastActivityAt: "desc" },
          take: ARCHIVE_LIMIT + 1,
          include: TICKET_INCLUDE,
        }),
  ]);

  // שולפים אחד מעבר לתקרה כדי לדעת אם יש עוד, בלי ספירה נוספת.
  const archiveTruncated = archiveTickets.length > ARCHIVE_LIMIT;
  const tickets = [...activeTickets, ...archiveTickets.slice(0, ARCHIVE_LIMIT)];

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
    const activeRecipientIds = ticket.assignments
      .filter((a) => a.status !== "REMOVED")
      .map((a) => a.professionalId ?? a.userId)
      .filter((id): id is string => id !== null);

    const awaitingReply = deriveAwaitingReply(
      toLastMessageView(ticket.messages),
      activeRecipientIds,
    );

    const view = { ...ticket, handlerName: ticket.handler?.name ?? null, awaitingReply };
    const status = deriveTicketStatus(view, assignmentViews);
    // סינון הסטטוס כאן ולא ב-SQL — ראו `BoardFilters.status`.
    if (filters.status && status !== filters.status) continue;
    const section = deriveBoardSection(status, ticket.escalated, Boolean(awaitingReply));

    sections[section].push({
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
      section,
      reason: reasonText(view, assignmentViews, now),
      ageDays: Math.floor((now.getTime() - ticket.createdAt.getTime()) / MS_PER_DAY),
      reopened: ticket.reopenCount > 0,
      escalated: ticket.escalated,
      createdAt: ticket.createdAt,
    });
  }

  // במצב חיפוש הסדר הוא סדר ה-DB (תנועה אחרונה) ולא הקיבוץ, ולכן הרשימה
  // השטוחה נבנית מהפניות עצמן ולא משרשור שלוש הקבוצות.
  const searchCards = query
    ? [...sections.ACTION_REQUIRED, ...sections.WITH_RECIPIENTS, ...sections.ARCHIVE].sort(
        (a, b) => tickets.findIndex((t) => t.id === a.id) - tickets.findIndex((t) => t.id === b.id),
      )
    : null;

  // טיוטות מוצמדות לראש "דורש ממך": הן דורשות השלמה ידנית לפני שאפשר לשגר,
  // ואסור שפניות אחרות ידחפו אותן אל מחוץ למסך (אפיון מסך 7). המיון יציב,
  // ולכן הסדר לפי lastActivityAt נשמר בתוך כל קבוצה.
  sections.ACTION_REQUIRED.sort(
    (a, b) => (a.status === "DRAFT" ? 0 : 1) - (b.status === "DRAFT" ? 0 : 1),
  );

  const [sites, buildings, apartments, domains, professionals, tags] = await Promise.all([
    // רשימת האתרים לבורר — ריקה למנהל עבודה, שכן אין לו מה לסנן.
    user.siteId
      ? Promise.resolve([] as { id: string; name: string }[])
      : db.site.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.building.findMany({
      where: user.siteId ? { siteId: user.siteId } : {},
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    /**
     * הדירות של הבניין שנבחר בלבד.
     *
     * בורר דירה שמציג את כל הדירות בכל האתרים הוא רשימה של מאה פריטים בלי
     * הקשר — ובאתר אמיתי, מאות. הוא מופיע רק אחרי בחירת בניין, וזה גם הסדר
     * שבו מנהל עבודה חושב: קודם איפה, אחר כך איזו.
     */
    filters.buildingId
      ? db.apartment.findMany({
          where: { buildingId: filters.buildingId },
          select: { id: true, number: true },
        })
      : Promise.resolve([] as { id: string; number: string }[]),
    db.domain.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.professional.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return {
    sections,
    search: searchCards
      ? {
          cards: searchCards.slice(0, SEARCH_RESULT_LIMIT),
          truncated:
            searchCards.length > SEARCH_RESULT_LIMIT || tickets.length === SEARCH_CANDIDATE_LIMIT,
        }
      : null,
    archiveTruncated,
    sites,
    buildings,
    apartments: sortApartments(apartments),
    domains,
    recipients: professionals,
    tags,
  };
}

/**
 * סוף היום שנבחר: "עד 22.7" מתכוון לכלול את כל אותו יום, ולא את חצות שלו.
 */
/**
 * סדר טבעי למספרי דירה: 2 לפני 10. הבורר משתמש באותה השוואה שמסך הניהול
 * משתמש בה — בבניין עם 50 דירות, רשימה שמציגה 1, 10, 11, 2 מאלצת לחפש כל
 * בחירה מחדש.
 */
function sortApartments(rows: { id: string; number: string }[]) {
  return [...rows]
    .sort((a, b) => compareApartmentNumbers(a.number, b.number))
    .map((row) => ({ id: row.id, name: row.number }));
}

function endOfDay(value: Date): Date {
  const end = new Date(value);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * תקרת המועמדים שנשלפים לחיפוש טקסט, וכמה מהם מוצגים.
 *
 * שני ערכים ולא אחד: הקטיעה שהמשתמש רואה ("יש עוד") חייבת להיות מובחנת
 * מהקטיעה של השאילתה. אם `tickets.length` הגיע לתקרת המועמדים, ייתכן שיש
 * התאמות שכלל לא נשלפו — וזה מידע אחר מ"נשלפו 120 ומוצגות 50".
 */
const SEARCH_CANDIDATE_LIMIT = 300;
const SEARCH_RESULT_LIMIT = 50;

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

