"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionResult, guard } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { canEditAssignments } from "@/lib/permissions";
import { ROOMS } from "@/lib/rooms";
import { toViewer } from "@/lib/session";
import type { SelectOption } from "@/lib/options";
import { ensurePortalLink, rotatePortalLink } from "@/lib/services/portal";
import { addTagToTicket, removeTagFromTicket } from "@/lib/services/tags";
import { TicketError, getTicketDetail } from "@/lib/services/tickets";
import {
  addAssignments,
  addMessage,
  closeTicket,
  deleteDraft,
  deleteTicket,
  removeAssignment,
  reopenTicket,
  resendAssignmentNotification,
  setHandler,
  submitDraft,
  updateResidentName,
  updateTicketFields,
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

const mediaIdsSchema = z.array(z.string().min(1)).max(20).optional();

export async function replyAction(
  ticketId: string,
  text: string,
  mediaIds?: string[],
): Promise<ActionResult> {
  return guard(async () => {
    // בלי `min(1)` על הטקסט: תגובה יכולה להיות תמונה בלבד. הכלל "לא הודעה
    // ריקה" נאכף בשירות, שם הוא רואה גם את הקבצים.
    await addMessage(
      await viewer(),
      ticketId,
      z.string().parse(text),
      mediaIdsSchema.parse(mediaIds) ?? [],
    );
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

/**
 * מוחק פנייה (מנהל מערכת בלבד) ומעביר ללוח — מסך הפנייה כבר לא קיים.
 *
 * ‏redirect בהצלחה ולא החזרת ערך: ה-`redirect` זורק חריגה מיוחדת ב-Next
 * ולכן הוא מחוץ ל-`guard`, אחרת היא הייתה נתפסת ומדווחת כשגיאה.
 *
 * הטיפוס נשאר `ActionResult` אף שהמסלול המוצלח אינו מחזיר דבר: **צורת
 * התשובה של Server Action היא אחת** (`action-result.ts`), ו-`{ error }`
 * שהיה כאן קודם היה צורה שנייה שנולדה מהניווט. `redirect` מוחזר כ-`never`,
 * ולכן הטיפוס נכון גם בלי ערך.
 */
export async function deleteTicketAction(ticketId: string): Promise<ActionResult> {
  const result = await guard(async () => {
    await deleteTicket(await viewer(), z.string().min(1).parse(ticketId));
  });

  if (!result.ok) return result;
  revalidatePath("/board");
  redirect("/board");
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

// ── עריכת שדות, השלמת טיוטה, ומחיקתה ──────────────────────────────────

const ticketFieldsSchema = z.object({
  buildingId: z.string().min(1).nullable().optional(),
  apartmentId: z.string().min(1).nullable().optional(),
  domainId: z.string().min(1).nullable().optional(),
  room: z.enum(ROOMS).nullable().optional(),
  description: z.string().optional(),
});

export async function updateTicketFieldsAction(
  ticketId: string,
  fields: z.infer<typeof ticketFieldsSchema>,
): Promise<ActionResult> {
  return guard(async () => {
    await updateTicketFields(await viewer(), ticketId, ticketFieldsSchema.parse(fields));
    refresh(ticketId);
  });
}

export async function submitDraftAction(
  ticketId: string,
  recipients: z.infer<typeof recipientsSchema>,
): Promise<ActionResult> {
  return guard(async () => {
    await submitDraft(await viewer(), ticketId, recipientsSchema.parse(recipients));
    refresh(ticketId);
  });
}

/**
 * מוחק טיוטה ומעביר ללוח — מסך הפנייה כבר לא קיים.
 * ‏redirect מחוץ ל-guard, כמו ב-deleteTicketAction.
 */
export async function deleteDraftAction(ticketId: string): Promise<ActionResult> {
  const result = await guard(async () => {
    await deleteDraft(await viewer(), z.string().min(1).parse(ticketId));
  });

  if (!result.ok) return result;
  revalidatePath("/board");
  redirect("/board");
}

export async function updateResidentNameAction(
  ticketId: string,
  name: string,
): Promise<ActionResult> {
  return guard(async () => {
    await updateResidentName(await viewer(), ticketId, z.string().parse(name));
    refresh(ticketId);
  });
}

/**
 * מתייג פנייה. מקבל שם ולא מזהה: התגית נלמדת, ותיוג בשם שאינו קיים יוצר
 * אותה. מחזיר את התגית כדי שהממשק יוסיף אותה מיד בלי סבב רענון.
 */
export async function addTicketTagAction(
  ticketId: string,
  name: string,
): Promise<ActionResult<SelectOption>> {
  return guard(async () => {
    const tag = await addTagToTicket(await viewer(), ticketId, z.string().parse(name));
    refresh(ticketId);
    return { id: tag.id, label: tag.name };
  });
}

export async function removeTicketTagAction(
  ticketId: string,
  tagId: string,
): Promise<ActionResult> {
  return guard(async () => {
    await removeTagFromTicket(await viewer(), ticketId, z.string().min(1).parse(tagId));
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

/**
 * שולח שוב את ההתראה במייל לנמען שנבחר (אפיון מסך 2, פעולה 4).
 * בשונה מ-getLink/rotateLink, כאן באמת יוצא מייל חוזר — הקישור עצמו יציב.
 */
export async function resendEmailAction(
  ticketId: string,
  assignmentId: string,
): Promise<ActionResult> {
  return guard(async () => {
    await resendAssignmentNotification(
      await viewer(),
      ticketId,
      z.string().min(1).parse(assignmentId),
    );
    refresh(ticketId);
  });
}
