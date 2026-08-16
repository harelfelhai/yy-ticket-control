"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, guard } from "@/lib/action-result";
import { he } from "@/lib/he";
import { logInfo } from "@/lib/observability/log";
import { allowPortalAction, resolveToken } from "@/lib/services/portal";
import { TicketError, addMessage, setAssignmentStatus } from "@/lib/services/tickets";
import { db } from "@/lib/db";

/**
 * הפעולות של פורטל הנמען.
 *
 * כל פעולה מאמתת מחדש את הטוקן **ואת השיוך הפעיל**, ואינה סומכת על כך
 * שהמסך נטען בהצלחה. Server Action היא נקודת כניסה ציבורית: מי שמחזיק
 * קישור ישן יכול לקרוא לה ישירות, גם אחרי שהוסר מהפנייה.
 */

const inputSchema = z.object({
  token: z.string().min(1),
  ticketId: z.string().min(1),
});

/** מחזיר את השיוך הפעיל של בעל הטוקן לפנייה, או זורק */
async function requireActiveAssignment(token: string, ticketId: string) {
  const identity = await resolveToken(token);
  if (!identity) throw new TicketError(he.portal.expired);

  const assignment = await db.assignment.findFirst({
    where: { professionalId: identity.professionalId, ticketId, status: { not: "REMOVED" } },
  });
  if (!assignment) throw new TicketError(he.common.notAllowed);

  // הגבלת קצב אחרי אימות הזהות והשיוך: חלה על כל פעולות הכתיבה (תגובה,
  // שאלה, סימון טופל), שכולן עוברות דרך כאן. קבלן שהוסר כבר נחסם למעלה.
  if (!(await allowPortalAction(identity.professionalId))) {
    throw new TicketError(he.portal.tooManyActions);
  }

  return { identity, assignment };
}

export async function markDoneAction(
  token: string,
  ticketId: string,
): Promise<ActionResult> {
  return guard(async () => {
    const parsed = inputSchema.parse({ token, ticketId });
    const { identity, assignment } = await requireActiveAssignment(parsed.token, parsed.ticketId);
    await setAssignmentStatus(assignment.id, "DONE");
    logInfo("portal.action", {
      action: "done",
      ticketId: parsed.ticketId,
      professionalId: identity.professionalId,
    });
    revalidatePath(`/p/${parsed.token}/${parsed.ticketId}`);
    revalidatePath(`/p/${parsed.token}`);
  });
}

const mediaIdsSchema = z.array(z.string().min(1)).max(20).optional();

export async function replyAction(
  token: string,
  ticketId: string,
  text: string,
  mediaIds?: string[],
): Promise<ActionResult> {
  return guard(async () => {
    const parsed = inputSchema.parse({ token, ticketId });
    const files = mediaIdsSchema.parse(mediaIds) ?? [];
    const { identity } = await requireActiveAssignment(parsed.token, parsed.ticketId);

    await addMessage(
      { kind: "professional", id: identity.professionalId },
      parsed.ticketId,
      text,
      files,
    );
    logInfo("portal.action", {
      action: "reply",
      ticketId: parsed.ticketId,
      professionalId: identity.professionalId,
    });
    revalidatePath(`/p/${parsed.token}/${parsed.ticketId}`);
  });
}
