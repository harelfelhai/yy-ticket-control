import type { Channel, Room } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import { normalizeName } from "@/lib/normalize";
import type { SessionUser } from "@/lib/session";

/**
 * יצירה ושיגור של פניות.
 *
 * הכלל שמנחה את הקובץ: **פנייה לא הולכת לאיבוד** (אפיון §5.ב). לכן פנייה
 * שחסרים בה שדות חובה אינה נדחית עם שגיאה אלא נשמרת כטיוטה — מנהל עבודה
 * בשטח, מול דירה, לא אמור לאבד את מה שהקליד רק משום ששכח לבחור תחום.
 */

export class TicketError extends Error {}

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
  if (!normalizeName(input.description ?? "")) missing.push(he.ticket.description);
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
        description: normalizeName(input.description ?? ""),
        channel: input.channel ?? "SELF",
        isDraft,
        createdById: actor.id,
        // טיוטה אינה משויכת לאיש עד לשיגור: שיוך פירושו שמישהו קיבל את
        // הפנייה, וטיוטה במפורש לא נשלחה לאיש (אפיון §2.5).
        assignments: isDraft ? undefined : { create: toAssignmentData(recipients) },
      },
      include: { assignments: true },
    });

    if (!isDraft) {
      await recordAssignmentEvents(tx, ticket.id, recipients);
    }

    return { ticket, isDraft, missing };
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
    await recordAssignmentEvents(tx, ticketId, unique);
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
