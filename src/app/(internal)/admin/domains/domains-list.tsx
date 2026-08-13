import { DeleteButton } from "@/components/delete-button";
import { InlineRename } from "@/components/inline-rename";
import { cardClasses } from "@/components/ui/card";
import { deleteDomainAction, renameDomainAction } from "../actions";

interface DomainRow {
  id: string;
  name: string;
}

/**
 * רשימת התחומים: שינוי שם ומחיקה בשורה.
 *
 * שינוי שם קיים כדי לתקן שגיאת הקלדה שיצרה תחום כמעט-כפול; שינוי לשם שכבר
 * קיים נדחה, כי איחוד תחומים אינו בתחולה. מחיקה נחסמת כשקיימות פניות
 * בתחום, וההודעה נוקבת בכמה — תחום שנעשה בו שימוש אינו טעות הקלדה.
 *
 * הרכיב הוא רכיב **שרת**: כל מה שהיה בו מצב לקוח עבר לשני הפקדים המשותפים,
 * והפעולות נמסרות להם קשורות (`bind`) למזהה השורה.
 */
export function DomainsList({ domains }: { domains: DomainRow[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {domains.map((domain) => (
        <li
          key={domain.id}
          className={cardClasses("flex flex-wrap items-center gap-x-3 gap-y-2", {
            padding: "compact",
          })}
        >
          <span className="min-w-0 flex-1 font-medium">{domain.name}</span>
          <InlineRename value={domain.name} action={renameDomainAction.bind(null, domain.id)} />
          <DeleteButton name={domain.name} action={deleteDomainAction.bind(null, domain.id)} />
        </li>
      ))}
    </ul>
  );
}
