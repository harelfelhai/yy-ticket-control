"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, guard } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { canEditAssignments } from "@/lib/permissions";
import { toViewer } from "@/lib/session";
import { ensurePortalLink, rotatePortalLink } from "@/lib/services/portal";
import { TicketError, getTicketDetail } from "@/lib/services/tickets";
import {
  addAssignments,
  addMessage,
  closeTicket,
  removeAssignment,
  reopenTicket,
  setHandler,
} from "@/lib/services/tickets";

/**
 * הפעולות של מסך הפנייה.
 *
 * בדיקות ההרשאה יושבות בשכבת השירות (`services/tickets.ts`) ולא כאן, כדי
 * שכל קורא עתידי — פורטל הקבלן, ג'וב, סקריפט — יקבל את אותה בדיקה. כאן
 * נותרת רק זהות המשתמש והמרת השגיאה להודעה.
 *
 * `revalidatePath` אחרי כל פעולה: המסך הוא Server Component, ובלי רענון
 * מפורש המשתמש היה רואה את המצב הישן אחרי שלחץ.
 */

async function viewer() {
  return toViewer(await requireUser());
}

function refresh(ticketId: string) {
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/board");
}

const textSchema = z.string().min(1);

export async function replyAction(ticketId: string, text: string): Promise<ActionResult> {
  return guard(async () => {
    await addMessage(await viewer(), ticketId, textSchema.parse(text));
    refresh(ticketId);
  });
}

export async function closeTicketAction(ticketId: string): Promise<ActionResult> {
  return guard(async () => {
    await closeTicket(await viewer(), ticketId);
    refresh(ticketId);
  });
}

export async function reopenTicketAction(ticketId: string): Promise<ActionResult> {
  return guard(async () => {
    await reopenTicket(await viewer(), ticketId);
    refresh(ticketId);
  });
}

export async function setHandlerAction(ticketId: string): Promise<ActionResult> {
  return guard(async () => {
    await setHandler(await viewer(), ticketId);
    refresh(ticketId);
  });
}

const recipientsSchema = z.array(
  z.object({ kind: z.enum(["professional", "user"]), id: z.string().min(1) }),
);

export async function addRecipientsAction(
  ticketId: string,
  recipients: z.infer<typeof recipientsSchema>,
): Promise<ActionResult> {
  return guard(async () => {
    await addAssignments(await viewer(), ticketId, recipientsSchema.parse(recipients));
    refresh(ticketId);
  });
}

export async function removeRecipientAction(
  ticketId: string,
  assignmentId: string,
): Promise<ActionResult> {
  return guard(async () => {
    await removeAssignment(await viewer(), assignmentId);
    refresh(ticketId);
  });
}

/**
 * מוודא שהמנהל רשאי לטפל בקישור של איש המקצוע הזה, בהקשר הפנייה הזו.
 *
 * רק למי שמשויך לפנייה בפועל: בלי הבדיקה הזו מסך פנייה כלשהו היה הופך
 * למנוע שמנפיק גישה לכל איש מקצוע במערכת.
 */
async function requireLinkPermission(ticketId: string, professionalId: string): Promise<void> {
  const current = await viewer();
  const ticket = await getTicketDetail(ticketId);
  if (!ticket) throw new TicketError(he.ticket.notFound);
  if (!canEditAssignments(current, ticket)) throw new TicketError(he.common.notAllowed);

  const assigned = ticket.assignments.some(
    (a) => a.professionalId === professionalId && a.status !== "REMOVED",
  );
  if (!assigned) throw new TicketError(he.common.notAllowed);
}

/**
 * מחזיר את קישור הגישה של הקבלן — הקיים, או חדש אם אין לו.
 *
 * זו הפעולה שמאחורי "שלח שוב את הקישור", והיא **אינה** הורגת את הקישור
 * שכבר אצלו בוואטסאפ. ההפרדה מ-`rotateLinkAction` היא כל העניין.
 */
export async function getLinkAction(
  ticketId: string,
  professionalId: string,
): Promise<ActionResult<string>> {
  return guard(async () => {
    await requireLinkPermission(ticketId, professionalId);
    return ensurePortalLink(professionalId);
  });
}

/**
 * מנפיק קישור חדש ומבטל את הקודם — לשימוש כשקישור הגיע לאדם הלא נכון.
 * הכפתור בממשק מבקש אישור מפורש, כי הפעולה מנתקת את הקבלן עד שיקבל את
 * הקישור החדש.
 */
export async function rotateLinkAction(
  ticketId: string,
  professionalId: string,
): Promise<ActionResult<string>> {
  return guard(async () => {
    await requireLinkPermission(ticketId, professionalId);
    return rotatePortalLink(professionalId);
  });
}
