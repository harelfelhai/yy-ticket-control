import type { Prisma } from "@/generated/prisma/client";
import type { AssignmentStatus, Channel, Room } from "@/generated/prisma/enums";
import { enqueue } from "@/jobs/queue";
import { JOB_TYPES, type NotifyJobPayload } from "@/jobs/types";
import { UserFacingError } from "@/lib/action-result";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import { normalizeText } from "@/lib/normalize";
import {
  type Viewer,
  canCloseTicket,
  canCommentOnTicket,
  canEditAssignments,
  canReopenTicket,
  canSetHandler,
  isUser,
} from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";
import { ensureAccessToken, revokeAccessIfOrphaned } from "./portal";

/**
 * יצירה ושיגור של פניות.
 *
 * הכלל שמנחה את הקובץ: **פנייה לא הולכת לאיבוד** (אפיון §5.ב). לכן פנייה
 * שחסרים בה שדות חובה אינה נדחית עם שגיאה אלא נשמרת כטיוטה — מנהל עבודה
 * בשטח, מול דירה, לא אמור לאבד את מה שהקליד רק משום ששכח לבחור תחום.
 */

/** שגיאות מחזור חיי הפנייה נועדו להיראות על ידי המשתמש, בעברית */
export class TicketError extends UserFacingError {}

/** נמען: קבלן חיצוני, או משתמש פנימי (כולל תזכורן — הפותח משייך לעצמו) */
export type RecipientRef =
  | { kind: "professional"; id: string }
  | { kind: "user"; id: string };

export interface CreateTicketInput {
  siteId: string;
  buildingId?: string | null;
  apartmentId?: string | null;
  domainId?: string | null;
  room?: Room | null;
  description?: string;
  channel?: Channel;
  recipients?: RecipientRef[];
  /** קבצים שהועלו לפני שהפנייה נוצרה — צילום מהשטח, הקלטה קולית */
  mediaIds?: string[];
  /** שמירה מפורשת כטיוטה, גם כשכל השדות מלאים */
  saveAsDraft?: boolean;
}

/**
 * שדות החובה לשיגור, לפי §3.2 באפיון.
 * מוחזרים כרשימה ולא כבוליאני, כדי שהממשק יוכל לומר למשתמש מה בדיוק חסר
 * במקום "לא ניתן לשגר".
 */
export function missingRequiredFields(input: CreateTicketInput): string[] {
  const missing: string[] = [];
  if (!input.buildingId) missing.push(he.directory.building);
  if (!input.apartmentId) missing.push(he.directory.apartment);
  if (!input.domainId) missing.push(he.directory.domain);
  if (!normalizeText(input.description ?? "")) missing.push(he.ticket.description);
  if (!input.recipients?.length) missing.push(he.ticket.recipients);
  return missing;
}

/** מפריד רשימת נמענים לצורה שבה Prisma יוצר שיוכים */
function toAssignmentData(recipients: RecipientRef[]) {
  return recipients.map((r) =>
    r.kind === "professional" ? { professionalId: r.id } : { userId: r.id },
  );
}

/**
 * יוצר פנייה. אם חסרים שדות חובה — נשמרת כטיוטה במקום להיכשל.
 *
 * הכול בטרנזאקציה אחת: פנייה שנוצרה בלי השיוכים שלה היא פנייה שאיש לא
 * יקבל, וזה בדיוק כישלון השקט שהמערכת נועדה למנוע.
 */
export async function createTicket(actor: SessionUser, input: CreateTicketInput) {
  const recipients = dedupeRecipients(input.recipients ?? []);
  const missing = missingRequiredFields({ ...input, recipients });
  const isDraft = input.saveAsDraft === true || missing.length > 0;

  return db.$transaction(async (tx) => {
    const ticket = await tx.ticket.create({
      data: {
        siteId: input.siteId,
        buildingId: input.buildingId ?? null,
        apartmentId: input.apartmentId ?? null,
        domainId: input.domainId ?? null,
        room: input.room ?? null,
        description: normalizeText(input.description ?? ""),
        channel: input.channel ?? "SELF",
        isDraft,
        createdById: actor.id,
        // טיוטה אינה משויכת לאיש עד לשיגור: שיוך פירושו שמישהו קיבל את
        // הפנייה, וטיוטה במפורש לא נשלחה לאיש (אפיון §2.5).
        assignments: isDraft ? undefined : { create: toAssignmentData(recipients) },
      },
      include: { assignments: true },
    });

    // המדיה מצורפת גם לטיוטה: הצילום נעשה לפני שהשדות מולאו, והוא המידע
    // שהכי קשה לשחזר — אי אפשר לחזור לדירה ולצלם שוב אחרי שהקבלן תיקן.
    await attachInitialMedia(tx, ticket.id, actor.id, input.mediaIds ?? []);

    if (!isDraft) {
      await applyNewAssignments(
        tx,
        ticket.id,
        recipients,
        ticket.assignments.map((a) => a.id),
      );
    }

    return { ticket, isDraft, missing };
  });
}

/**
 * מצרף לפנייה חדשה את הקבצים שהועלו לפני שנוצרה.
 *
 * הודעה אחת עם כל הקבצים ולא הודעה לכל קובץ: מנהל שצילם ארבע תמונות של
 * אותה תקלה תיאר אירוע אחד, ופיצול לארבע הודעות היה קובר את התיאור שכתב.
 */
async function attachInitialMedia(
  tx: Tx,
  ticketId: string,
  authorUserId: string,
  mediaIds: string[],
): Promise<void> {
  if (mediaIds.length === 0) return;

  const message = await tx.message.create({
    data: { ticketId, kind: "MEDIA", authorUserId },
  });

  // רק קבצים שהועלו במלואם וטרם שויכו — אותו תנאי כמו בתגובה רגילה.
  await tx.mediaFile.updateMany({
    where: { id: { in: mediaIds }, uploaded: true, messageId: null },
    data: { messageId: message.id },
  });
}

/**
 * משגר טיוטה: יוצר את השיוכים ומסיר את סימון הטיוטה.
 * נכשל אם עדיין חסרים שדות — שיגור הוא הרגע שבו אנשים אמיתיים מקבלים
 * התראה, ואין טעם לשלוח פנייה חסרה.
 */
export async function submitDraft(
  ticketId: string,
  recipients: RecipientRef[],
): Promise<void> {
  const ticket = await db.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new TicketError(he.ticket.notFound);

  const unique = dedupeRecipients(recipients);
  const missing = missingRequiredFields({
    siteId: ticket.siteId,
    buildingId: ticket.buildingId,
    apartmentId: ticket.apartmentId,
    domainId: ticket.domainId,
    description: ticket.description,
    recipients: unique,
  });

  if (missing.length > 0) {
    throw new TicketError(he.ticket.cannotSubmitMissing(missing));
  }

  await db.$transaction(async (tx) => {
    await tx.assignment.createMany({
      data: unique.map((r) => ({ ticketId, ...toAssignmentData([r])[0] })),
    });
    await tx.ticket.update({
      where: { id: ticketId },
      data: { isDraft: false, lastActivityAt: new Date() },
    });
    // ‏createMany אינו מחזיר מזהים, ולכן קוראים אותם מיד אחריו. השיוכים
    // האלה הם היחידים בפנייה — טיוטה אינה משויכת לאיש עד לשיגור.
    const created = await tx.assignment.findMany({ where: { ticketId }, select: { id: true } });
    await applyNewAssignments(
      tx,
      ticketId,
      unique,
      created.map((a) => a.id),
    );
  });
}

/**
 * מסיר כפילויות ברשימת הנמענים.
 * מנהל שבוחר את אותו קבלן פעמיים (למשל אחרי חיפוש חוזר) היה מייצר שני
 * שיוכים לאותו אדם — ואז "2 מתוך 3 סיימו" סופר אותו פעמיים.
 */
export function dedupeRecipients(recipients: RecipientRef[]): RecipientRef[] {
  const seen = new Set<string>();
  return recipients.filter((r) => {
    const key = `${r.kind}:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * שולף פנייה עם כל מה שנדרש להצגתה: נמענים, שרשור, ומי מטפל.
 *
 * שאילתה אחת עם include ולא כמה שאילתות: מסך הפנייה הוא המסך שנפתח הכי
 * הרבה פעמים ביום, ו-round trip נוסף מורגש ברשת סלולרית באתר בנייה.
 */
export async function getTicketDetail(ticketId: string) {
  return db.ticket.findUnique({
    where: { id: ticketId },
    include: {
      site: true,
      building: true,
      apartment: true,
      domain: true,
      createdBy: { select: { id: true, name: true } },
      handler: { select: { id: true, name: true } },
      assignments: {
        orderBy: { createdAt: "asc" },
        include: {
          professional: { select: { id: true, name: true, phone: true, email: true } },
          user: { select: { id: true, name: true } },
        },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          authorUser: { select: { id: true, name: true } },
          authorProfessional: { select: { id: true, name: true } },
          // רק קבצים שהעלאתם הושלמה: העלאה שנקטעה אינה קובץ, והצגתה
          // בשרשור הייתה מייצרת תמונה שבורה במקום לא־כלום.
          media: { where: { uploaded: true }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
}

export type TicketDetail = NonNullable<Awaited<ReturnType<typeof getTicketDetail>>>;

/** שם הנמען של שיוך, בלי קשר לסוגו */
export function recipientName(assignment: TicketDetail["assignments"][number]): string {
  return assignment.professional?.name ?? assignment.user?.name ?? "";
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/**
 * מכניס לתור בקשה להודיע על אירוע בפנייה.
 *
 * **תמיד בתוך הטרנזאקציה של הפעולה עצמה.** זו הנקודה שכל מנגנון ההתראות
 * נשען עליה: אם השיוך התגלגל אחורה, גם ההודעה עליו נעלמת; ואם השיוך נשמר,
 * הבקשה להודיע שמורה יחד איתו ואינה תלויה בכך שהשליחה תצליח עכשיו.
 *
 * הפעולה עצמה לעולם אינה שולחת בעצמה: שרת מייל איטי היה מקפיא את המסך של
 * מנהל שעומד מול דירה, ושרת מייל שנפל היה מפיל את השיוך.
 */
async function enqueueNotification(tx: Tx, payload: NotifyJobPayload): Promise<void> {
  await enqueue(tx, JOB_TYPES.notify, payload as unknown as Prisma.InputJsonValue);
}

/**
 * כל מה שקורה כשנמענים חדשים נכנסים לפנייה, במקום אחד.
 *
 * שלושת השלבים חייבים לקרות יחד ובאותה טרנזאקציה, ולכן הם אינם מפוזרים
 * בין הקוראים: שיוך בלי אירוע נעלם מההיסטוריה, שיוך בלי קישור גישה הוא
 * קבלן שאי אפשר לשלוח לו, ושיוך בלי ג'וב הוא בדיוק "פנייה שאיש לא ידע
 * עליה" — הכשל שהמערכת נבנתה כדי למנוע.
 */
async function applyNewAssignments(
  tx: Tx,
  ticketId: string,
  recipients: RecipientRef[],
  assignmentIds: string[],
): Promise<void> {
  await recordAssignmentEvents(tx, ticketId, recipients);

  for (const recipient of recipients) {
    if (recipient.kind === "professional") await ensureAccessToken(tx, recipient.id);
  }

  for (const assignmentId of assignmentIds) {
    await enqueueNotification(tx, { event: "ASSIGNED", assignmentId });
  }
}

// ────────────────────── פעולות על פנייה קיימת ──────────────────────

/**
 * שולף את המידע המינימלי הדרוש לבדיקת הרשאה, ומוודא שהפנייה קיימת.
 * בדיקת ההרשאה נעשית **בשירות** ולא רק ב-route handler: כך כל קורא עתידי
 * מקבל אותה בדיקה, ואי אפשר לעקוף אותה בטעות דרך נתיב חדש.
 */
async function loadForAction(ticketId: string) {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: { assignments: true },
  });
  if (!ticket) throw new TicketError(he.ticket.notFound);
  return ticket;
}

function denyUnless(allowed: boolean): void {
  if (!allowed) throw new TicketError(he.common.notAllowed);
}

/**
 * מסמן תנועה בפנייה.
 *
 * זהו הלב של מנגנון ההסלמה: הסלמה נמדדת לפי היעדר תנועה בשרשור, ולא לפי
 * "לא נצפה". באפיון המקורי די היה בקבלן אחד שפותח את הקישור כדי שההסלמה
 * לא תופעל לעולם — גם אם השאר התעלמו חודש.
 *
 * הסימון `escalated` מתאפס יחד, כי פנייה שקרה בה משהו כבר אינה תקועה.
 */
function touchData() {
  return { lastActivityAt: new Date(), escalated: false };
}

/**
 * רושם אירוע מערכת בשרשור.
 * ה-meta מוגבל למחרוזות בכוונה: הוא נועד להצגה בלבד, ושמירת אובייקטים
 * מקוננים שם הייתה מזמינה תלות בצורת נתונים שתשתנה.
 */
async function recordEvent(
  tx: Tx,
  ticketId: string,
  eventType: string,
  eventMeta: Record<string, string>,
) {
  await tx.message.create({
    data: { ticketId, kind: "EVENT", eventType, eventMeta },
  });
}

/**
 * מוסיף תגובה לשרשור.
 *
 * מנהל שכותב מסומן אוטומטית כמטפל (אפיון §5.ד): בתור משותף לשני מנהלי
 * עבודה קיים סיכון ששניהם יטפלו באותה פנייה או שאף אחד לא. הסימון אינו
 * נועל את הפנייה ואינו מונע ממנהל אחר לפעול — הוא רק מידע.
 */
export async function addMessage(
  viewer: Viewer,
  ticketId: string,
  rawText: string,
  mediaIds: string[] = [],
) {
  const text = rawText.trim();
  // תמונה בלי כיתוב היא הודעה לגיטימית לחלוטין — ולעיתים ההודעה המלאה
  // ביותר. מה שאסור הוא הודעה בלי כלום.
  if (!text && mediaIds.length === 0) throw new TicketError(he.ticket.emptyMessage);

  const ticket = await loadForAction(ticketId);
  denyUnless(canCommentOnTicket(viewer, ticket, ticket.assignments));

  return db.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        ticketId,
        kind: mediaIds.length > 0 ? "MEDIA" : "TEXT",
        text: text || null,
        authorUserId: viewer.kind === "user" ? viewer.id : null,
        authorProfessionalId: viewer.kind === "professional" ? viewer.id : null,
      },
    });

    if (mediaIds.length > 0) {
      // רק קבצים שהועלו במלואם וטרם שויכו להודעה אחרת. בלי התנאי הזה
      // אפשר היה לצרף להודעה בפנייה אחת קובץ ששייך לפנייה אחרת, ולעקוף
      // את בדיקת ההרשאה שנעשית בעת ההגשה.
      await tx.mediaFile.updateMany({
        where: { id: { in: mediaIds }, uploaded: true, messageId: null },
        data: { messageId: message.id },
      });
    }

    // מסמנים מטפל רק אם אין כזה עדיין: החלפה אוטומטית בכל הודעה הייתה
    // גורמת לשני מנהלים ל"גנוב" את הסימון זה מזה בכל תגובה.
    const setHandlerToo = isUser(viewer) && ticket.handlerId === null;

    await tx.ticket.update({
      where: { id: ticketId },
      data: { ...touchData(), ...(setHandlerToo ? { handlerId: viewer.id } : {}) },
    });

    if (setHandlerToo) {
      const user = await tx.user.findUnique({ where: { id: viewer.id }, select: { name: true } });
      await recordEvent(tx, ticketId, "HANDLER_SET", { userName: user?.name ?? "" });
    }

    return message;
  });
}

/** סימון ידני של "אני מטפל", לפעולה שנעשתה מחוץ למערכת */
export async function setHandler(viewer: Viewer, ticketId: string) {
  const ticket = await loadForAction(ticketId);
  denyUnless(canSetHandler(viewer, ticket, ticket.assignments));
  if (!isUser(viewer)) throw new TicketError(he.common.notAllowed);

  await db.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id: ticketId }, data: { handlerId: viewer.id } });
    const user = await tx.user.findUnique({ where: { id: viewer.id }, select: { name: true } });
    await recordEvent(tx, ticketId, "HANDLER_SET", { userName: user?.name ?? "" });
  });
}

/**
 * סוגר פנייה.
 * אין סגירה אוטומטית בשום תנאי (אפיון §5.ב) — הפונקציה הזו נקראת רק
 * מפעולה מפורשת של אדם, ולעולם לא מג'וב או מטריגר.
 */
export async function closeTicket(viewer: Viewer, ticketId: string) {
  const ticket = await loadForAction(ticketId);
  denyUnless(canCloseTicket(viewer, ticket));
  if (ticket.closedAt) return;

  await db.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id: ticketId },
      data: { closedAt: new Date(), closedById: isUser(viewer) ? viewer.id : null, ...touchData() },
    });
    await recordEvent(tx, ticketId, "CLOSED", { userName: await actorName(tx, viewer) });
  });
}

/**
 * פותח פנייה מחדש.
 *
 * כל השיוכים הפעילים חוזרים ל"נשלח": פתיחה מחדש פירושה שהעבודה לא הושלמה,
 * ו"טופל" ישן שנשאר על שיוך היה גורם לפנייה להיראות מיד כ"ממתין לאישור".
 * שיוך שהוסר נשאר מוסר — הסרתו הייתה החלטה נפרדת.
 */
export async function reopenTicket(viewer: Viewer, ticketId: string) {
  const ticket = await loadForAction(ticketId);
  denyUnless(canReopenTicket(viewer, ticket));
  if (!ticket.closedAt) return;

  await db.$transaction(async (tx) => {
    await tx.assignment.updateMany({
      where: { ticketId, status: { not: "REMOVED" } },
      data: { status: "SENT", statusChangedAt: new Date(), viewedAt: null },
    });
    await tx.ticket.update({
      where: { id: ticketId },
      data: {
        closedAt: null,
        closedById: null,
        reopenCount: { increment: 1 },
        ...touchData(),
      },
    });
    await recordEvent(tx, ticketId, "REOPENED", { userName: await actorName(tx, viewer) });

    // כל נמען פעיל מקבל הודעה חוזרת. בלעדיה פתיחה מחדש היא פעולה שקטה
    // אצל המנהל בלבד, והקבלן ממשיך להאמין שסיים.
    const active = await tx.assignment.findMany({
      where: { ticketId, status: { not: "REMOVED" } },
      select: { id: true },
    });
    for (const assignment of active) {
      await enqueueNotification(tx, { event: "REOPENED", assignmentId: assignment.id });
    }
  });
}

/** מוסיף נמענים לפנייה קיימת. הנמען החדש רואה את כל השרשור שקדם לו. */
export async function addAssignments(
  viewer: Viewer,
  ticketId: string,
  recipients: RecipientRef[],
) {
  const ticket = await loadForAction(ticketId);
  denyUnless(canEditAssignments(viewer, ticket));

  const existing = new Set(
    ticket.assignments
      .filter((a) => a.status !== "REMOVED")
      .map((a) => `${a.professionalId ? "professional" : "user"}:${a.professionalId ?? a.userId}`),
  );
  const fresh = dedupeRecipients(recipients).filter((r) => !existing.has(`${r.kind}:${r.id}`));
  if (fresh.length === 0) return;

  await db.$transaction(async (tx) => {
    const affected: string[] = [];

    for (const recipient of fresh) {
      // ‏upsert ולא createMany: נמען שהוסר בעבר מקבל את השיוך הישן בחזרה
      // במקום שורה כפולה, וכך ההיסטוריה שלו נשמרת.
      const previous = ticket.assignments.find(
        (a) =>
          (recipient.kind === "professional"
            ? a.professionalId === recipient.id
            : a.userId === recipient.id) && a.status === "REMOVED",
      );

      if (previous) {
        await tx.assignment.update({
          where: { id: previous.id },
          data: { status: "SENT", statusChangedAt: new Date(), viewedAt: null },
        });
        affected.push(previous.id);
      } else {
        const created = await tx.assignment.create({
          data: {
            ticketId,
            ...(recipient.kind === "professional"
              ? { professionalId: recipient.id }
              : { userId: recipient.id }),
          },
        });
        affected.push(created.id);
      }
    }

    await tx.ticket.update({ where: { id: ticketId }, data: touchData() });
    await applyNewAssignments(tx, ticketId, fresh, affected);
  });
}

/**
 * מסיר נמען מהפנייה.
 * הסטטוס משתנה ל-REMOVED ולא נמחק: ההיסטוריה נשמרת, אבל הפנייה נעלמת
 * מהפורטל שלו והוא מאבד הרשאת כתיבה מיידית — גם עם קישור תקף בידיו.
 */
export async function removeAssignment(viewer: Viewer, assignmentId: string) {
  const assignment = await db.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      ticket: true,
      professional: { select: { name: true } },
      user: { select: { name: true } },
    },
  });
  if (!assignment) throw new TicketError(he.ticket.assignmentNotFound);
  denyUnless(canEditAssignments(viewer, assignment.ticket));
  if (assignment.status === "REMOVED") return;

  await db.$transaction(async (tx) => {
    await tx.assignment.update({
      where: { id: assignmentId },
      data: { status: "REMOVED", statusChangedAt: new Date() },
    });
    await tx.ticket.update({ where: { id: assignment.ticketId }, data: touchData() });
    await recordEvent(tx, assignment.ticketId, "REMOVED", {
      recipientName: assignment.professional?.name ?? assignment.user?.name ?? "",
    });
  });

  // מחוץ לטרנזאקציה בכוונה: ההסרה עצמה היא מה שחייב להצליח, וביטול הגישה
  // הוא ניקוי שאין טעם שיגרור אחריו rollback אם ייכשל.
  if (assignment.professionalId) {
    await revokeAccessIfOrphaned(assignment.professionalId);
  }
}

/**
 * מעדכן את סטטוס השיוך של נמען (נצפה / טופל / שאלה).
 *
 * זהו המפלס שבו נרשמת המציאות: כל נמען מתקדם בקצב שלו, וסטטוס הפנייה
 * נגזר מהם. הנמען לעולם אינו סוגר — "טופל" ממנו הוא דיווח, לא אימות.
 */
export async function setAssignmentStatus(
  assignmentId: string,
  status: Extract<AssignmentStatus, "VIEWED" | "DONE" | "QUESTION">,
  /** טקסט השאלה, כדי שהפותח יראה אותה בהודעה ולא רק "יש שאלה" */
  note?: string,
) {
  const assignment = await db.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      ticket: { select: { id: true, closedAt: true } },
      professional: { select: { name: true } },
      user: { select: { name: true } },
    },
  });
  if (!assignment) throw new TicketError(he.ticket.assignmentNotFound);
  if (assignment.status === "REMOVED") throw new TicketError(he.common.notAllowed);
  if (assignment.ticket.closedAt) throw new TicketError(he.notices.closedTicketBlocked);

  // "נצפה" אינו מדרדר מצב מתקדם יותר: קבלן שסימן "טופל" ואז פתח שוב את
  // הקישור לא אמור לחזור ל"נצפה" ולהעלים את הדיווח שלו.
  if (status === "VIEWED" && assignment.status !== "SENT") return;

  const name = assignment.professional?.name ?? assignment.user?.name ?? "";

  await db.$transaction(async (tx) => {
    await tx.assignment.update({
      where: { id: assignmentId },
      data: {
        status,
        statusChangedAt: new Date(),
        ...(status === "VIEWED" ? { viewedAt: new Date() } : {}),
      },
    });

    // צפייה בלבד אינה "תנועה" לעניין ההסלמה — זו בדיוק הנקודה שבגללה
    // הכלל שונה מהאפיון המקורי. סימון טופל או שאלה כן.
    if (status !== "VIEWED") {
      await tx.ticket.update({ where: { id: assignment.ticket.id }, data: touchData() });
      // הכדור חזר לפותח, והוא אינו יושב מול המסך. בלי ההודעה הזו שאלה של
      // קבלן ממתינה עד שמישהו במקרה ייכנס לפנייה.
      await enqueueNotification(tx, { event: status, assignmentId, note });
    }

    await recordEvent(tx, assignment.ticket.id, status, { recipientName: name });
  });
}

async function actorName(tx: Tx, viewer: Viewer): Promise<string> {
  if (viewer.kind === "user") {
    const user = await tx.user.findUnique({ where: { id: viewer.id }, select: { name: true } });
    return user?.name ?? "";
  }
  const professional = await tx.professional.findUnique({
    where: { id: viewer.id },
    select: { name: true },
  });
  return professional?.name ?? "";
}

/**
 * רושם אירוע מערכת בשרשור לכל נמען ששויך.
 * האירועים הם מה שהופך את השרשור להיסטוריה קריאה: מנהל שנכנס לפנייה אחרי
 * שבוע צריך לראות מי צורף ומתי, ולא רק את ההודעות.
 */
async function recordAssignmentEvents(tx: Tx, ticketId: string, recipients: RecipientRef[]) {
  if (recipients.length === 0) return;

  const [professionals, users] = await Promise.all([
    tx.professional.findMany({
      where: { id: { in: recipients.filter((r) => r.kind === "professional").map((r) => r.id) } },
      select: { id: true, name: true },
    }),
    tx.user.findMany({
      where: { id: { in: recipients.filter((r) => r.kind === "user").map((r) => r.id) } },
      select: { id: true, name: true },
    }),
  ]);

  const names = new Map([...professionals, ...users].map((p) => [p.id, p.name]));

  await tx.message.createMany({
    data: recipients.map((r) => ({
      ticketId,
      kind: "EVENT" as const,
      eventType: "ASSIGNED",
      // שומרים את השם ולא רק את המזהה, כדי שהשרשור יישאר קריא גם אם
      // איש המקצוע שונה או מוזג עם כפילות מאוחר יותר.
      eventMeta: { recipientName: names.get(r.id) ?? "", recipientKind: r.kind },
    })),
  });
}
