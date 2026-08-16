import Link from "next/link";
import type { BoardCard, SortDirection, SortKey } from "@/lib/board-view";
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
 *
 * **ארבע עמודות ולא שש (0.5).** "#" הציג את `Ticket.seq` — מזהה גלובלי במסד
 * שאינו רציף ואינו אומר דבר למי שסורק; "סטטוס" נגזר מאותה חלוקה לשלוש
 * קבוצות שכותרות הלוח כבר מבטאות; ו"סיבה" הוחלפה ב"תיאור", כי בטבלה השאלה
 * היא **מה** התקלה. שורת הסיבה נשארת על הכרטיס, שם האפיון מחייב אותה.
 */

/*
 * העמודות ב-`minmax(0,1fr)` ולא ברוחב קבוע: `rtl-mobile.spec.ts` מודד גלישה
 * אופקית בסטייה של עד 2px, ורשת עם עמודות קבועות ושם בניין ארוך היא בדיוק
 * מה שמפיל אותה. התיאור מקבל את החלק הרחב — הוא המשפט היחיד כאן.
 */
const COLUMNS = "grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.8fr)_minmax(0,1fr)]";

export interface SortState {
  key: SortKey;
  direction: SortDirection;
}

interface TicketTableProps {
  cards: BoardCard[];
  /** המיון הפעיל, או `null` כשהלוח בסדר המערכת */
  sort: SortState | null;
  /** הכתובת שאליה מובילה לחיצה על כותרת — המצב הבא במחזור */
  sortHref: (key: SortKey) => string;
}

const HEADERS: { key: SortKey; label: string }[] = [
  { key: "location", label: he.board.columnLocation },
  { key: "domain", label: he.board.columnDomain },
  { key: "description", label: he.board.columnDescription },
  { key: "recipients", label: he.board.columnRecipients },
];

export function TicketTable({ cards, sort, sortHref }: TicketTableProps) {
  return (
    <div className="flex flex-col">
      {/*
       * שורת הכותרות **אינה `aria-hidden` יותר** (0.4). כל עוד היא הייתה
       * תוויות בלבד היא הוסתרה מעץ הנגישות, כי כל שורה היא קישור שנושא
       * ממילא את הטקסט המלא. מרגע שהיא ממיינת היא פקד — והסתרתה הייתה
       * מוציאה יכולת שלמה ממשתמשי מקלדת וקורא מסך.
       */}
      <div className={`grid ${COLUMNS} items-center gap-x-3 border-b border-border px-3`}>
        {HEADERS.map((header) => (
          <SortHeader
            key={header.key}
            header={header}
            state={sort?.key === header.key ? sort.direction : null}
            href={sortHref(header.key)}
          />
        ))}
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

/**
 * כותרת עמודה שממיינת — קישור, לא כפתור.
 *
 * המיון משנה את הכתובת, כלומר זו ניווט: הקישור שומר על הטבלה כרכיב שרת,
 * עובד בלי JS, ותומך בפתיחה בלשונית ובכפתור "אחורה".
 *
 * **בלי `aria-sort`.** התכונה חוקית רק על `columnheader`, ולטבלה הזו אין
 * תפקידי טבלה כלל — `role="row"` היה דורס את תפקיד הקישור בשורות. ‏`aria-sort`
 * בלי `columnheader` הוא ARIA שמשקר, וזה גרוע מ-ARIA שחסר. המצב נמסר בטקסט
 * ‏`sr-only`: מה שנכון עכשיו וגם מה שהלחיצה תעשה.
 */
function SortHeader({
  header,
  state,
  href,
}: {
  header: (typeof HEADERS)[number];
  state: SortDirection | null;
  href: string;
}) {
  const caret = state === "asc" ? "▲" : state === "desc" ? "▼" : "";
  const spoken =
    state === "asc" ? he.board.sortedAsc : state === "desc" ? he.board.sortedDesc : he.board.sortNone;

  return (
    <Link
      href={href}
      // ‏`min-h-11` ככל דבר לחיץ. שורת הכותרות מתגבהת בהתאם, וזה נכון:
      // היא הפכה לשורת פקדים ולא תוויות.
      className="flex min-h-11 items-center gap-1 text-sm font-semibold text-muted"
    >
      <span>{header.label}</span>
      <span aria-hidden>{caret}</span>
      <span className="sr-only">{spoken}</span>
    </Link>
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
      //
      // הקו האדום בהתחלה הוא המקבילה הטבלאית ל-`dangerOutline` של הכרטיס:
      // עד 0.5 הטיוטה זוהתה בטבלה דרך שורת הסיבה האדומה, ובלי תחליף היא
      // הייתה הופכת לשורה כמעט ריקה (לטיוטה לרוב אין עדיין תיאור) — כלומר
      // המצב היחיד שדורש טיפול היה הופך לבלתי-נראה.
      //
      // ‏`border-b-border` ולא `border-border`: הצבע הכללי היה קובע גם את
      // צבע ההתחלה, ואז הקו של הטיוטה תלוי בסדר שבו Tailwind פולט את שתי
      // המחלקות — כלומר אדום שעלול לצאת אפור בלי שאיש יבחין.
      className={`grid ${COLUMNS} min-h-12 items-center gap-x-3 border-b border-b-border px-3 py-2 text-sm ${
        isDraft ? "border-s-2 border-s-danger" : ""
      }`}
    >
      <span className="truncate font-medium">{location || he.ticket.noLocation}</span>

      <span className="truncate text-muted">{card.domainName ?? ""}</span>

      <span className="truncate">{card.descriptionLine}</span>

      <span className="truncate text-muted">{card.recipientNames.join(", ")}</span>
    </Link>
  );
}
