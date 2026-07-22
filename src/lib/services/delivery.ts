import { deliveryNote } from "@/lib/delivery";
import { formatDateTime } from "@/lib/format";
import { composeNotification } from "@/lib/notifier/compose";
import { waShareUrl } from "@/lib/notifier/wa-share";
import type { TicketSummary } from "@/lib/notifier/types";
import { readPortalLink } from "./portal";
import type { TicketDetail } from "./tickets";

/**
 * מה מסך הפנייה צריך לדעת כדי להציג את שורת השליחה ואת כפתור הוואטסאפ.
 *
 * הכל נקרא בשרת ומגיע ללקוח מוכן: הודעת הוואטסאפ מנוסחת מאותה פונקציה
 * שמנסחת את המייל (`composeNotification`), כך שהקבלן מקבל אותו טקסט בשני
 * הערוצים — ואין גרסה שנייה של הנוסח שמתחזקת בנפרד.
 */

export interface DeliveryView {
  /** טקסט מוכן: מתי נשלח, או למה לא */
  deliveryNote: string;
  /** כתובת wa.me עם ההודעה מוכנה, או null כשאין טלפון או קישור */
  waUrl: string | null;
}

export async function describeDelivery(
  ticket: TicketDetail,
  assignment: TicketDetail["assignments"][number],
): Promise<DeliveryView> {
  const professional = assignment.professional;
  const email = professional?.email ?? null;
  const phone = professional?.phone ?? null;

  const note = deliveryNote(
    {
      notifiedAt: assignment.notifiedAt,
      // נמען פנימי: אין לנו כאן את המייל שלו, אבל הוא נכנס למערכת ממילא
      // ורואה את הפנייה בלוח שלו. החיווי נוגע לשליחה החוצה.
      hasEmail: Boolean(email) || assignment.userId !== null,
      hasPhone: Boolean(phone),
    },
    formatDateTime,
  );

  if (!professional || !phone) return { deliveryNote: note, waUrl: null };

  // קריאה בלבד: מסך שנטען אינו אמור לייצר סודות. הטוקן כבר נוצר ברגע
  // השיוך (ראה ensureAccessToken), ולכן הוא נמצא כאן בפועל.
  const link = await readPortalLink(professional.id);
  if (!link) return { deliveryNote: note, waUrl: null };

  const message = composeNotification({
    event: "ASSIGNED",
    toName: professional.name,
    ticket: toSummary(ticket),
    link,
  });

  return { deliveryNote: note, waUrl: waShareUrl(phone, message.body) };
}

function toSummary(ticket: TicketDetail): TicketSummary {
  return {
    seq: ticket.seq,
    description: ticket.description,
    buildingName: ticket.building?.name ?? null,
    apartmentNumber: ticket.apartment?.number ?? null,
    domainName: ticket.domain?.name ?? null,
  };
}
