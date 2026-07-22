import type { AssignmentStatus } from "@/generated/prisma/enums";
import { he } from "@/lib/he";
import type { DerivedTicketStatus } from "@/lib/ticket-status";

/**
 * תגי סטטוס.
 *
 * הצבע נגזר ממשמעות ולא מאסתטיקה: אדום שמור למצב שבו נמען חסום ועבודה
 * בשטח עצורה ("שאלה"), ירוק לסיום, וכתום למה שממתין להכרעה. מנהל עבודה
 * סורק את הלוח בשמש ובמהירות, והצבע הוא מה שהוא קולט לפני הטקסט.
 */

const ASSIGNMENT_STYLES: Record<AssignmentStatus, string> = {
  SENT: "bg-surface text-muted border-border",
  VIEWED: "bg-surface text-fg border-border",
  DONE: "bg-success/10 text-success border-success/30",
  QUESTION: "bg-danger/10 text-danger border-danger/30",
  REMOVED: "bg-surface text-muted border-border line-through",
};

const TICKET_STYLES: Record<DerivedTicketStatus, string> = {
  CLOSED: "bg-surface text-muted border-border",
  DRAFT: "bg-warning/10 text-warning border-warning/30",
  AWAITING_OPENER_QUESTION: "bg-danger/10 text-danger border-danger/30",
  AWAITING_OPENER_APPROVAL: "bg-success/10 text-success border-success/30",
  PARTIAL: "bg-warning/10 text-warning border-warning/30",
  VIEWED: "bg-surface text-fg border-border",
  NEW: "bg-brand/10 text-brand border-brand/30",
};

const BASE = "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium";

export function AssignmentStatusChip({ status }: { status: AssignmentStatus }) {
  return (
    <span className={`${BASE} ${ASSIGNMENT_STYLES[status]}`}>{he.assignmentStatus[status]}</span>
  );
}

export function TicketStatusChip({ status }: { status: DerivedTicketStatus }) {
  return <span className={`${BASE} ${TICKET_STYLES[status]}`}>{he.ticketStatus[status]}</span>;
}
