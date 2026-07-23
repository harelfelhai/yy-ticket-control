import { db } from "@/lib/db";
import { deriveBoardSection, deriveTicketStatus } from "@/lib/ticket-status";

/**
 * תצוגת הבעלים (מסך 10): סיכום חוצה-אתרים.
 *
 * לכל אתר שלושה מספרים שהבעלים שואל עליהם: כמה פתוחות, כמה מהן ממתינות
 * להחלטה של המנהל, וכמה תקועות בלי תנועה. המספרים נגזרים מאותה לוגיקה
 * שמפעילה את הלוח (`ticket-status.ts`) — כדי שצלילה ממספר תגיע בדיוק
 * לאותן פניות, בלי ספירה שנייה שיכולה לסתור.
 */

export interface SiteOverview {
  siteId: string;
  siteName: string;
  /** פניות שלא נסגרו */
  open: number;
  /** הכדור אצל צוות החברה — שאלה, אישור, טיוטה, או הסלמה (ACTION_REQUIRED) */
  awaitingManager: number;
  /** ללא תנועה מעל הסף — סומנו על ידי הג'וב היומי */
  stale: number;
}

export async function getOwnerOverview(): Promise<SiteOverview[]> {
  const sites = await db.site.findMany({
    orderBy: { name: "asc" },
    include: {
      // רק פניות פתוחות: הסיכום עוסק בעבודה שעדיין פעילה, לא בארכיון.
      tickets: {
        where: { closedAt: null },
        select: {
          isDraft: true,
          escalated: true,
          lastActivityAt: true,
          assignments: { select: { status: true } },
        },
      },
    },
  });

  return sites.map((site) => {
    let awaitingManager = 0;
    let stale = 0;

    for (const ticket of site.tickets) {
      const status = deriveTicketStatus(
        { isDraft: ticket.isDraft, closedAt: null, escalated: ticket.escalated, lastActivityAt: ticket.lastActivityAt },
        // שם הנמען אינו נדרש לספירה — רק הסטטוס קובע את הקבוצה.
        ticket.assignments.map((a) => ({ status: a.status, recipientName: "" })),
      );
      if (deriveBoardSection(status, ticket.escalated) === "ACTION_REQUIRED") awaitingManager += 1;
      if (ticket.escalated) stale += 1;
    }

    return {
      siteId: site.id,
      siteName: site.name,
      open: site.tickets.length,
      awaitingManager,
      stale,
    };
  });
}
