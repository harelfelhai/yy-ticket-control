import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ensurePortalLink } from "@/lib/services/portal";
import { composeNotification, renderEmailHtml } from "./compose";
import type { EmailTransport, NotificationEvent, TicketSummary } from "./types";

/**
 * שכבת השליחה: מאירוע במערכת להודעה שיוצאת לאדם.
 *
 * שני כללים מנחים אותה:
 *
 * 1. **שליחה לעולם אינה מפילה פעולה.** מנהל שמשייך קבלן חייב לראות שהשיוך
 *    נשמר, גם אם שרת המייל למטה. לכן אף אחת מהפונקציות כאן אינה נקראת
 *    מתוך הפעולה עצמה אלא מתוך ג'וב, ובפעולה נרשם רק "יש מה לשלוח".
 * 2. **מי מקבל מה נקבע במקום אחד** — `notificationTarget`. פיזור הכלל הזה
 *    בין קוראים היה מייצר מצב שבו אירוע חדש שולח למי שלא צריך.
 */

/** למי מיועדת ההודעה על האירוע */
export type NotificationTarget = "recipient" | "opener";

/**
 * שיוך ופתיחה מחדש נשלחים לנמען — הוא זה שצריך לצאת לעבודה.
 * שאלה וסימון טופל חוזרים לפותח, כי אצלו הכדור (Gate G3: לפותח בלבד).
 */
export function notificationTarget(event: NotificationEvent): NotificationTarget {
  return event === "ASSIGNED" || event === "REOPENED" ? "recipient" : "opener";
}

/** למה לא יצאה הודעה — מידע שנשמר בלוג ומוצג למנהל */
export type DeliveryOutcome =
  | { status: "sent"; to: string; via: string }
  | { status: "skipped"; reason: "no-address" | "assignment-removed" | "missing" };

export interface NotifyInput {
  event: NotificationEvent;
  assignmentId: string;
  /** תוכן נלווה — טקסט השאלה שנשאלה */
  note?: string;
}

/**
 * שולח את ההודעה על אירוע יחיד.
 *
 * הערוץ מוזרק ואינו נבחר כאן, כדי שבדיקה תוכל להריץ את המסלול המלא מול
 * ערוץ מדומה: אחרת האימות היחיד האפשרי היה לשלוח מייל אמיתי, וזו בדיקה
 * שאיש לא מריץ.
 */
export async function sendNotification(
  input: NotifyInput,
  transport: EmailTransport,
): Promise<DeliveryOutcome> {
  const assignment = await db.assignment.findUnique({
    where: { id: input.assignmentId },
    include: {
      professional: { select: { id: true, name: true, email: true } },
      user: { select: { name: true, email: true } },
      ticket: {
        include: {
          building: { select: { name: true } },
          apartment: { select: { number: true } },
          domain: { select: { name: true } },
          createdBy: { select: { name: true, email: true } },
        },
      },
    },
  });

  if (!assignment) return { status: "skipped", reason: "missing" };

  // בין הרגע שהג'וב נוצר לרגע שהוא רץ המנהל עשוי היה להסיר את הנמען.
  // שליחה עכשיו הייתה מזמינה לעבודה מישהו שכבר אינו משויך.
  if (assignment.status === "REMOVED") {
    return { status: "skipped", reason: "assignment-removed" };
  }

  const target = notificationTarget(input.event);
  const recipientName = assignment.professional?.name ?? assignment.user?.name ?? "";

  const toName =
    target === "recipient" ? recipientName : (assignment.ticket.createdBy.name ?? "");
  const address =
    target === "recipient"
      ? (assignment.professional?.email ?? assignment.user?.email ?? null)
      : assignment.ticket.createdBy.email;

  // קישור הקסם רק לקבלן חיצוני. משתמש פנימי נכנס עם סיסמה, ושליחת סוד
  // גישה למי שכבר יש לו חשבון היא סוד מיותר שיכול לדלוף.
  const link =
    target === "recipient" && assignment.professional
      ? await ensurePortalLink(assignment.professional.id)
      : `${env.appBaseUrl().replace(/\/+$/, "")}/tickets/${assignment.ticketId}`;

  const message = composeNotification({
    event: input.event,
    toName,
    actorName: recipientName,
    ticket: toTicketSummary(assignment.ticket),
    link,
    note: input.note,
  });

  // אין כתובת — לא כישלון. קבלן בלי מייל מקבל את הפנייה בוואטסאפ, וזו
  // הסיבה שהכפתור קיים בממשק. הקישור כבר הונפק לו למעלה.
  if (!address) return { status: "skipped", reason: "no-address" };

  await transport.send({
    to: address,
    subject: message.subject,
    text: message.body,
    html: renderEmailHtml(message),
  });

  if (target === "recipient") {
    await db.assignment.update({
      where: { id: assignment.id },
      data: { notifiedAt: new Date() },
    });
  }

  return { status: "sent", to: address, via: transport.name };
}

/** ממיר את הפנייה כפי שהיא במסד לצורה שהניסוח מכיר */
function toTicketSummary(ticket: {
  seq: number;
  description: string;
  building: { name: string } | null;
  apartment: { number: string } | null;
  domain: { name: string } | null;
}): TicketSummary {
  return {
    seq: ticket.seq,
    description: ticket.description,
    buildingName: ticket.building?.name ?? null,
    apartmentNumber: ticket.apartment?.number ?? null,
    domainName: ticket.domain?.name ?? null,
  };
}
