import { DeleteButton } from "@/components/delete-button";
import { InlineRename } from "@/components/inline-rename";
import { cardClasses } from "@/components/ui/card";
import { deleteDomainAction, renameDomainAction } from "../../actions";
import { RECORD_CARD_GRID, RECORD_NAME } from "@/lib/ui";

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
    <ul className={RECORD_CARD_GRID}>
      {domains.map((domain) => (
        <li
          key={domain.id}
          className={cardClasses("flex flex-wrap items-center gap-x-3 gap-y-2", {
            padding: "compact",
          })}
        >
          {/* פער 33: `flex-1` על ילד יחיד מייצר בדיוק את מה ש-justify-between
              מייצר, ו**חומק מהאוכף** — זו הצורה המוסווית של אותה הפרה.
              `min-w-0` נשאר: הוא מה שמאפשר קיצור שם ארוך. */}
          <span className={`min-w-0 ${RECORD_NAME}`}>{domain.name}</span>
          {/*
           * ‏`ms-auto` על העיפרון מצמיד את זוג הפעולות לקצה הכרטיס, והפח
           * נגרר אחריו. **זהו החריג הצר של § Layout ולא הפרה שלו:** הכלל
           * מנוסח נגד דחיפה לקצה של מיכל **רחב**, וכאן הכרטיס חסום בעמודת
           * גריד של 280-560px — הנזק שהכלל מונע (מאות פיקסלים בין הפעולה
           * למה שהיא פועלת עליו) אינו יכול להתרחש.
           *
           * **מרווח אוטומטי ולא עטיפה, וזה אילוץ מדוד:** ‏`InlineRename`
           * פתוח מרנדר `w-full` שנועד להיות רוחב **השורה**, כדי שהשדה ירד
           * לשורה משלו. בתוך `<div>` עוטף הוא היה נמדד מול העטיפה — כלומר
           * שדה קלט ברוחב שני כפתורים.
           */}
          <InlineRename
            className="ms-auto"
            value={domain.name}
            action={renameDomainAction.bind(null, domain.id)}
          />
          <DeleteButton name={domain.name} action={deleteDomainAction.bind(null, domain.id)} />
        </li>
      ))}
    </ul>
  );
}
