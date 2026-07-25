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
  /** האם יש כתובת מייל שאפשר לשלוח אליה שוב (נמען חיצוני או פנימי) */
  canResendEmail: boolean;
  /** מתי השתנה הסטטוס האישי לאחרונה, כטקסט מוכן */
  statusChangedAt: string;
}

/**
 * `includeLink` שולט אם לחשב את קישור הקסם ואת כתובת הוואטסאפ.
 *
 * זו הגנת אבטחה, לא רק אופטימיזציה: הקישור הוא סוד גישה של הקבלן, והוא
 * מגיע ללקוח בתוך ה-payload של הקומפוננטה — גם אם הכפתור מוסתר ויזואלית.
 * צופה שאינו רשאי לערוך נמענים (למשל בעלים שאינו הפותח) אינו אמור לקבל
 * את הקישור כלל, ולכן הקריאה מדלגת עליו לגמרי במקום להסתיר אותו בממשק.
 */
export async function describeDelivery(
  ticket: TicketDetail,
  assignment: TicketDetail["assignments"][number],
  includeLink: boolean,
): Promise<DeliveryView> {
  const professional = assignment.professional;
  const email = professional?.email ?? assignment.user?.email ?? null;
  const phone = professional?.phone ?? null;

  const note = deliveryNote(
    {
      notifiedAt: assignment.notifiedAt,
      // נמען פנימי: גם בלי מייל הוא נכנס למערכת ורואה את הפנייה בלוח שלו.
      // החיווי נוגע לשליחה החוצה.
      hasEmail: Boolean(email) || assignment.userId !== null,
      hasPhone: Boolean(phone),
    },
    formatDateTime,
  );

  const base = {
    deliveryNote: note,
    canResendEmail: Boolean(email),
    statusChangedAt: formatDateTime(assignment.statusChangedAt),
  };

  if (!includeLink || !professional || !phone) return { ...base, waUrl: null };

  // קריאה בלבד: מסך שנטען אינו אמור לייצר סודות. הטוקן כבר נוצר ברגע
  // השיוך (ראה ensureAccessToken), ולכן הוא נמצא כאן בפועל.
  const link = await readPortalLink(professional.id);
  if (!link) return { ...base, waUrl: null };

  const message = composeNotification({
    event: "ASSIGNED",
    toName: professional.name,
    ticket: toSummary(ticket),
    link,
  });

  return { ...base, waUrl: waShareUrl(phone, message.body) };
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
