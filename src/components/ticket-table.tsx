import Link from "next/link";
import { TicketStatusChip } from "@/components/status-chip";
import type { BoardCard } from "@/lib/board-view";
import { he } from "@/lib/he";

/**
 * תצוגת הטבלה של הלוח (אפיון מסך 1, הכרעת 0.3 §7 שורה 28).
 *
 * **מה זה אינו: `<table>`.** התקן דורש ששורה לחיצה תהיה **קישור אחד על כל
 * השטח** (§ אזורי מגע), ו-`<tr>` אינו יכול להיות `<a>`. חלופה של קישור
 * בתוך תא הייתה מייצרת יעד מגע קטן בתוך שורה גדולה — בדיוק מה שהתקן אוסר.
 *
 * **ומה זה גם אינו: תפקידי ARIA של טבלה.** ‏`role="row"` על `<Link>` **דורס
 * את תפקיד הקישור**, כלומר `getByRole("link")` מפסיק למצוא אותו — וזה מה
 * שכל בדיקות הלוח נשענות עליו. הסמנטיקה האמיתית כאן היא רשימת קישורים,
 * והיישור לעמודות הוא עיצוב בלבד.
 *
 * **הטבלה אינה מוסיפה מידע.** העמודות הן בדיוק מה שהכרטיס כבר מציג; מה
 * שהיא קונה הוא סריקה של עשרים שורות במבט אחד במקום חמש.
 */

/*
 * העמודות ב-`minmax(0,1fr)` ולא ברוחב קבוע: `rtl-mobile.spec.ts` מודד גלישה
 * אופקית בסטייה של עד 2px, ורשת עם עמודות קבועות ושם בניין ארוך היא בדיוק
 * מה שמפיל אותה. שלוש העמודות הגמישות הן היחידות שתוכנן חופשי.
 */
const COLUMNS = "grid-cols-[3rem_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_7rem_5rem]";

export function TicketTable({ cards }: { cards: BoardCard[] }) {
  return (
    <div className="flex flex-col">
      {/* שורת הכותרות אינה קישור ואינה נסרקת כשורה — ולכן `aria-hidden`:
          לקורא מסך כל קישור נושא ממילא את הטקסט המלא של השורה. */}
      <div
        aria-hidden
        className={`grid ${COLUMNS} items-center gap-x-3 border-b border-border px-3 py-2 text-sm font-semibold text-muted`}
      >
        <span dir="ltr" className="text-end">
          #
        </span>
        <span>{he.board.columnLocation}</span>
        <span>{he.board.columnDomain}</span>
        <span>{he.board.columnReason}</span>
        <span>{he.board.columnRecipients}</span>
        <span>{he.board.columnStatus}</span>
      </div>

      <ul className="flex flex-col">
        {cards.map((card) => (
          <li key={card.id}>
            <TicketRow card={card} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function TicketRow({ card }: { card: BoardCard }) {
  const location = he.ticket.location(card.buildingName, card.apartmentNumber);
  const isDraft = card.status === "DRAFT";

  return (
    <Link
      href={`/tickets/${card.id}`}
      // ‏`min-h-12` (48px) ולא 44: שורה בטבלה נסרקת בעין ולא רק נלחצת,
      // וצפיפות של 44 הופכת עשרים שורות לגוש (DESIGN.md § טבלה / רשימה).
      className={`grid ${COLUMNS} min-h-12 items-center gap-x-3 border-b border-border px-3 py-2 text-sm`}
    >
      <span dir="ltr" className="text-end tabular-nums text-muted">
        {card.seq}
      </span>

      <span className="truncate font-medium">{location || he.ticket.noLocation}</span>

      <span className="truncate text-muted">{card.domainName ?? ""}</span>

      {/* הסיבה ולא התיאור: זה מה שמסביר למה הפנייה נמצאת בקבוצה הזו, וזו
          הסיבה שהאפיון מחייב אותה גם בכרטיס. */}
      <span className={`truncate font-medium ${isDraft ? "text-danger" : "text-brand"}`}>
        {card.reason}
      </span>

      <span className="truncate text-muted">{card.recipientNames.join(", ")}</span>

      <span className="flex items-center gap-2">
        <TicketStatusChip status={card.status} />
      </span>
    </Link>
  );
}
