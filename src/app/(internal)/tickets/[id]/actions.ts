"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, guard } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { canEditAssignments } from "@/lib/permissions";
import { toViewer } from "@/lib/session";
import { issuePortalLink } from "@/lib/services/portal";
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
 * מנפיק קישור גישה חדש לאיש מקצוע ומחזיר אותו למנהל להעתקה.
 *
 * הקישור מוצג פעם אחת בלבד — במסד נשמר רק הגיבוב. עד שתיכנס השליחה
 * האוטומטית (M2), זו הדרך שבה קבלן מקבל גישה: המנהל מעתיק ושולח בעצמו.
 */
export async function issueLinkAction(
  ticketId: string,
  professionalId: string,
): Promise<ActionResult<string>> {
  return guard(async () => {
    const current = await viewer();
    const ticket = await getTicketDetail(ticketId);
    if (!ticket) throw new TicketError(he.ticket.notFound);
    if (!canEditAssignments(current, ticket)) throw new TicketError(he.common.notAllowed);

    // רק למי שמשויך לפנייה הזו בפועל: הנפקת קישור למי שאינו משויך הייתה
    // הופכת את המסך למנוע גישה לכל איש מקצוע במערכת.
    const assigned = ticket.assignments.some(
      (a) => a.professionalId === professionalId && a.status !== "REMOVED",
    );
    if (!assigned) throw new TicketError(he.common.notAllowed);

    return issuePortalLink(professionalId);
  });
}
