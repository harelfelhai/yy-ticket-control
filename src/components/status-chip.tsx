import { Chip, type ChipTone } from "@/components/ui/chip";
import type { AssignmentStatus } from "@/generated/prisma/enums";
import { he } from "@/lib/he";
import type { DerivedTicketStatus } from "@/lib/ticket-status";

/**
 * תגי סטטוס.
 *
 * הקובץ מחזיק **מיפוי בלבד** — סטטוס לגוון סמנטי. המראה יושב
 * ב-`@/components/ui/chip`, כי אותה צורה משמשת גם תגיות וגם תגי התראה;
 * לפני האיחוד היו כאן `px-2.5 py-0.5` ובתגיות `px-3 py-1.5`, בלי שההבדל
 * ייצג החלטה.
 *
 * הצבע נגזר ממשמעות ולא מאסתטיקה: אדום שמור למצב שבו נמען חסום ועבודה
 * בשטח עצורה ("שאלה"), ירוק לסיום, וכתום למה שממתין להכרעה. מנהל עבודה
 * סורק את הלוח בשמש ובמהירות, והצבע הוא מה שהוא קולט לפני הטקסט.
 */

const ASSIGNMENT_TONES: Record<AssignmentStatus, ChipTone> = {
  SENT: "neutral",
  // לא `neutral`: "נצפה" אומר שהקבלן באמת פתח, וזה שונה מ"שלחתי".
  VIEWED: "neutralStrong",
  DONE: "success",
  REMOVED: "neutral",
};

const TICKET_TONES: Record<DerivedTicketStatus, ChipTone> = {
  CLOSED: "neutral",
  // ‏`danger` ולא `warning` — התקן (§ Colors) מונה טיוטה תחת "עבודה בשטח
  // עצורה", והכרטיס עצמו כבר נושא מסגרת `danger`. צ׳יפ כתום על כרטיס אדום
  // שידר שני מצבים שונים על אותו אובייקט. נמצא בסבב הביקורת הראשון.
  DRAFT: "danger",
  AWAITING_OPENER_APPROVAL: "success",
  PARTIAL: "warning",
  VIEWED: "neutralStrong",
  // ‏`info` ולא `brand`: מאז המעבר לגרפיט, `brand` הוא הדיו של המערכת ואינו
  // מובחן מטקסט רגיל. "חדשה" הוא מצב, ולכן הוא צריך צבע מצב.
  NEW: "info",
};

export function AssignmentStatusChip({ status }: { status: AssignmentStatus }) {
  return (
    <Chip
      tone={ASSIGNMENT_TONES[status]}
      // שיוך שהוסר נשאר מוצג: המידע ההיסטורי חשוב ("שלחתי לו והוא לא הגיב"),
      // והקו החוצה אומר שהוא כבר לא בתמונה בלי למחוק אותו.
      className={status === "REMOVED" ? "line-through" : undefined}
    >
      {he.assignmentStatus[status]}
    </Chip>
  );
}

export function TicketStatusChip({ status }: { status: DerivedTicketStatus }) {
  return <Chip tone={TICKET_TONES[status]}>{he.ticketStatus[status]}</Chip>;
}
