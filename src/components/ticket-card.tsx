import Link from "next/link";
import { TicketStatusChip } from "@/components/status-chip";
import type { BoardCard } from "@/lib/board-view";
import { he } from "@/lib/he";

/**
 * כרטיס פנייה ברשימת הלוח.
 *
 * **טקסט הסיבה הוא החלק החשוב בכרטיס.** האפיון מדגיש שבלי הסבר במילים,
 * פנייה קופצת בין קבוצות בלי שהמשתמש עשה דבר — וזה שוחק אמון במערכת. לכן
 * הוא מוצג בשורה נפרדת ובולטת, ולא כסמל או כצבע בלבד.
 *
 * הכרטיס כולו הוא קישור אחד: אצבע בכפפה על מסך בשמש לא מכוונת לאזור קטן.
 */
export function TicketCard({ card }: { card: BoardCard }) {
  const location = [
    card.buildingName,
    card.apartmentNumber && `${he.directory.apartment} ${card.apartmentNumber}`,
  ]
    .filter(Boolean)
    .join(" · ");

  // טיוטה מסומנת באדום (אפיון מסך 7): מסגרת אדומה ושורת סיבה אדומה, כדי
  // שתיקרא מיד כ"דורש השלמה" ולא כפנייה רגילה.
  const isDraft = card.status === "DRAFT";

  return (
    <Link
      href={`/tickets/${card.id}`}
      className={`flex flex-col gap-1.5 rounded-2xl border bg-surface p-4 ${
        isDraft ? "border-danger" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 font-semibold">
          {location || he.ticket.noLocation}
          {card.domainName ? (
            <span className="font-normal text-muted"> · {card.domainName}</span>
          ) : null}
        </span>
        <span className="shrink-0">
          <TicketStatusChip status={card.status} />
        </span>
      </div>

      {card.descriptionLine ? (
        <p className="truncate text-sm">{card.descriptionLine}</p>
      ) : null}

      <p className={`text-sm font-medium ${isDraft ? "text-danger" : "text-brand"}`}>
        {card.reason}
      </p>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        {card.recipientNames.length > 0 ? <span>{card.recipientNames.join(", ")}</span> : null}
        <span>· {he.board.ageDays(card.ageDays)}</span>
        <span>· {he.channel[card.channel]}</span>
        {card.reopened ? (
          <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-warning">
            {he.ticket.reopenedBadge}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
