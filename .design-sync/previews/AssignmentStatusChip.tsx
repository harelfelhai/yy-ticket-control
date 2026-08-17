import { AssignmentStatusChip } from "yy-ticket-control";

/**
 * מצב השיוך של נמען יחיד. הקובץ מחזיק מיפוי בלבד — סטטוס לגוון סמנטי;
 * המראה יושב ב-`Chip`.
 *
 * ‏"נצפה" אינו `neutral` כמו "נשלח": הוא אומר שהקבלן באמת פתח, וזה שונה
 * מ"שלחתי". שיוך שהוסר נשאר מוצג עם קו חוצה — המידע ההיסטורי חשוב.
 */
export function AllStatuses() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <AssignmentStatusChip status="SENT" />
      <AssignmentStatusChip status="VIEWED" />
      <AssignmentStatusChip status="DONE" />
      <AssignmentStatusChip status="REMOVED" />
    </div>
  );
}

/** בשורת נמען, כפי שהוא מופיע במסך הפנייה. */
export function InRecipientRow() {
  return (
    <ul className="flex max-w-sm flex-col gap-2">
      <li className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2">
        <span className="text-sm font-medium">מוסא דיאב — אינסטלציה</span>
        <AssignmentStatusChip status="VIEWED" />
      </li>
      <li className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2">
        <span className="text-sm font-medium">אבי כהן — חשמל</span>
        <AssignmentStatusChip status="DONE" />
      </li>
      <li className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2">
        <span className="text-sm font-medium">רונן לוי — מיזוג</span>
        <AssignmentStatusChip status="REMOVED" />
      </li>
    </ul>
  );
}
