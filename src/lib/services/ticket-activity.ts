import { db } from "@/lib/db";
import type { Viewer } from "@/lib/permissions";

/**
 * מה שכל פעולה על פנייה רושמת: תנועה (להסלמה) ואירוע בשרשור.
 *
 * יושב בקובץ משלו כדי שגם `tickets.ts` וגם שירות הטיוטה (`draft-fields.ts`)
 * ירשמו תנועה ואירועים באותה דרך, בלי ששני השירותים ייבאו זה את זה.
 */

/** לקוח הטרנזאקציה של Prisma */
export type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/**
 * מסמן תנועה בפנייה.
 *
 * זהו הלב של מנגנון ההסלמה: הסלמה נמדדת לפי היעדר תנועה בשרשור, ולא לפי
 * "לא נצפה". באפיון המקורי די היה בקבלן אחד שפותח את הקישור כדי שההסלמה
 * לא תופעל לעולם — גם אם השאר התעלמו חודש.
 *
 * הסימון `escalated` מתאפס יחד, כי פנייה שקרה בה משהו כבר אינה תקועה.
 */
export function touchData() {
  return { lastActivityAt: new Date(), escalated: false };
}

/**
 * רושם אירוע מערכת בשרשור.
 * ה-meta מוגבל למחרוזות בכוונה: הוא נועד להצגה בלבד, ושמירת אובייקטים
 * מקוננים שם הייתה מזמינה תלות בצורת נתונים שתשתנה.
 */
export async function recordEvent(
  tx: Tx,
  ticketId: string,
  eventType: string,
  eventMeta: Record<string, string>,
) {
  await tx.message.create({
    data: { ticketId, kind: "EVENT", eventType, eventMeta },
  });
}

/** שם מי שביצע את הפעולה, לאירוע בשרשור */
export async function actorName(tx: Tx, viewer: Viewer): Promise<string> {
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
