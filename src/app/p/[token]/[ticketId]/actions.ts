"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, guard } from "@/lib/action-result";
import { he } from "@/lib/he";
import { resolveToken } from "@/lib/services/portal";
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

  return { identity, assignment };
}

export async function markDoneAction(
  token: string,
  ticketId: string,
): Promise<ActionResult> {
  return guard(async () => {
    const parsed = inputSchema.parse({ token, ticketId });
    const { assignment } = await requireActiveAssignment(parsed.token, parsed.ticketId);
    await setAssignmentStatus(assignment.id, "DONE");
    revalidatePath(`/p/${parsed.token}/${parsed.ticketId}`);
    revalidatePath(`/p/${parsed.token}`);
  });
}

export async function askQuestionAction(
  token: string,
  ticketId: string,
  text: string,
): Promise<ActionResult> {
  return guard(async () => {
    const parsed = inputSchema.parse({ token, ticketId });
    const { identity, assignment } = await requireActiveAssignment(parsed.token, parsed.ticketId);

    // ההודעה נשמרת לפני שינוי הסטטוס: שאלה בלי תוכן היא רק דגל אדום
    // שמנהל העבודה לא יודע מה לעשות איתו.
    await addMessage({ kind: "professional", id: identity.professionalId }, parsed.ticketId, text);
    // הטקסט מועבר גם לסטטוס, כדי שההודעה לפותח תכיל את השאלה עצמה. מייל
    // שאומר רק "יש שאלה" מאלץ אותו להיכנס למערכת כדי לדעת על מה מדובר.
    await setAssignmentStatus(assignment.id, "QUESTION", text);

    revalidatePath(`/p/${parsed.token}/${parsed.ticketId}`);
    revalidatePath(`/p/${parsed.token}`);
  });
}

export async function replyAction(
  token: string,
  ticketId: string,
  text: string,
): Promise<ActionResult> {
  return guard(async () => {
    const parsed = inputSchema.parse({ token, ticketId });
    const { identity } = await requireActiveAssignment(parsed.token, parsed.ticketId);
    await addMessage({ kind: "professional", id: identity.professionalId }, parsed.ticketId, text);
    revalidatePath(`/p/${parsed.token}/${parsed.ticketId}`);
  });
}
