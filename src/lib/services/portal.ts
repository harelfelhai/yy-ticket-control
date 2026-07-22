import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { generateToken, hashToken, portalUrl } from "@/lib/tokens";

/**
 * גישת הנמען החיצוני לפורטל.
 *
 * הכלל היחיד שקובע כאן: **הטוקן מזהה מי אתה, השיוכים קובעים מה אתה רואה.**
 * הטוקן לעולם אינו נושא הרשאות בעצמו. לכן קבלן שהוסר מפנייה מאבד אליה
 * גישה מיידית, גם אם הקישור שבידיו תקף לחלוטין — וזו הסיבה שאין צורך
 * בתפוגה לקישור.
 */

/**
 * מנפיק קישור גישה חדש לאיש מקצוע ומבטל את הקודמים.
 *
 * הקישור מוחזר **פעם אחת בלבד**: במסד נשמר רק הגיבוב שלו, ואי אפשר
 * לשחזר אותו. זו הסיבה שהפעולה מנוסחת בממשק כ"צור קישור חדש" ולא
 * כ"העתק קישור" — מנהל שילחץ פעמיים יגלה שהקישור הקודם הפסיק לעבוד,
 * ועדיף שיֵדע את זה מראש.
 *
 * ביטול הישן הוא ברירת המחדל ולא אופציה: קישור נטוש שממשיך לעבוד הוא
 * בדיוק מה שהופך "קישור ללא תפוגה" לסיכון.
 */
export async function issuePortalLink(professionalId: string): Promise<string> {
  const token = generateToken();

  await db.$transaction(async (tx) => {
    await tx.accessToken.updateMany({
      where: { professionalId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.accessToken.create({ data: { professionalId, tokenHash: hashToken(token) } });
  });

  return portalUrl(env.appBaseUrl(), token);
}

export interface PortalIdentity {
  professionalId: string;
  name: string;
  tokenId: string;
}

/**
 * מאמת טוקן ומחזיר את זהות איש המקצוע, או null.
 * מעדכן `lastUsedAt` כדי שיהיה אפשר לזהות קישורים נטושים בעתיד.
 */
export async function resolveToken(token: string): Promise<PortalIdentity | null> {
  if (!token) return null;

  const record = await db.accessToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { professional: { select: { id: true, name: true } } },
  });

  if (!record || record.revokedAt !== null) return null;

  await db.accessToken.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    professionalId: record.professional.id,
    name: record.professional.name,
    tokenId: record.id,
  };
}

/**
 * הלוח האישי של הקבלן: הפניות הפעילות שלו והארכיון שלו.
 *
 * מכל האתרים ולא רק מאחד — לקבלן משנה אין "אתר משלו", והוא עובד בכמה
 * פרויקטים במקביל (אפיון §5.ז).
 */
export async function getPortalBoard(professionalId: string) {
  const assignments = await db.assignment.findMany({
    where: { professionalId, status: { not: "REMOVED" } },
    orderBy: { ticket: { lastActivityAt: "desc" } },
    include: {
      ticket: {
        include: {
          building: { select: { name: true } },
          apartment: { select: { number: true } },
          domain: { select: { name: true } },
        },
      },
    },
  });

  return {
    active: assignments.filter((a) => a.ticket.closedAt === null),
    archived: assignments.filter((a) => a.ticket.closedAt !== null),
  };
}

/**
 * פנייה בודדת בפורטל, אם ורק אם יש לקבלן שיוך פעיל אליה.
 *
 * מחזיר גם את השרשור המלא: נמען שצורף לפנייה קיימת מקבל גישה לכל
 * ההיסטוריה שקדמה לו, כדי שיבין את ההקשר (מסמך המקור §4.2).
 */
export async function getPortalTicket(professionalId: string, ticketId: string) {
  const assignment = await db.assignment.findFirst({
    where: { professionalId, ticketId, status: { not: "REMOVED" } },
  });
  if (!assignment) return null;

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: {
      building: { select: { name: true } },
      apartment: { select: { number: true } },
      domain: { select: { name: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          authorUser: { select: { name: true } },
          authorProfessional: { select: { name: true } },
        },
      },
    },
  });
  if (!ticket) return null;

  return { ticket, assignment };
}

/**
 * מסמן את הפנייה כנצפית בפתיחה ראשונה.
 * רק מ-SENT: קבלן שכבר סימן "טופל" ופותח שוב את הקישור לא אמור לאבד את
 * הדיווח שלו.
 */
export async function markViewed(assignmentId: string): Promise<void> {
  await db.assignment.updateMany({
    where: { id: assignmentId, status: "SENT" },
    data: { status: "VIEWED", statusChangedAt: new Date(), viewedAt: new Date() },
  });
}
