import { TicketStatusChip } from "yy-ticket-control";

/**
 * מצב הפנייה כולה, נגזר משיוכיה. ‏`DRAFT` הוא `danger` ולא `warning`:
 * התקן מונה טיוטה תחת "עבודה בשטח עצורה", והכרטיס עצמו כבר נושא מסגרת
 * אדומה — צ׳יפ כתום עליה היה משדר שני מצבים שונים על אותו אובייקט.
 */
export function AllStatuses() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <TicketStatusChip status="NEW" />
      <TicketStatusChip status="VIEWED" />
      <TicketStatusChip status="PARTIAL" />
      <TicketStatusChip status="AWAITING_OPENER_APPROVAL" />
      <TicketStatusChip status="DRAFT" />
      <TicketStatusChip status="CLOSED" />
    </div>
  );
}

/** בכותרת מסך הפנייה — שם הצ׳יפ הוא המידע ולא חזרה עליו. */
export function InTicketHeader() {
  return (
    <div className="flex max-w-md flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-bold">רמת השרון, בן גוריון 14 דירה 4</span>
        <TicketStatusChip status="PARTIAL" />
      </div>
      <p className="text-sm text-muted">אינסטלציה · נפתחה לפני 3 ימים</p>
    </div>
  );
}
