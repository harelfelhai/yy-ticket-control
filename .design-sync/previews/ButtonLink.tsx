import { ButtonLink } from "yy-ticket-control";

/**
 * כפתור שהוא ניווט. רכיב נפרד מ-`Button` ולא prop בשם `href`, כי `<button>`
 * ו-`<a>` נבדלים בסמנטיקה, בניווט מקלדת ובמה שקורא מסך מכריז.
 */
export function Primary() {
  return <ButtonLink href="/tickets/new">+ פנייה חדשה</ButtonLink>;
}

/** אותם וריאנטים בדיוק כמו `Button` — אוצר מילים אחד לשני הרכיבים. */
export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ButtonLink href="/tickets/new" variant="primary">
        + פנייה חדשה
      </ButtonLink>
      <ButtonLink href="/board" variant="secondary">
        חזרה ללוח
      </ButtonLink>
      <ButtonLink href="/tickets/12" variant="quiet" size="compact">
        פתח פנייה
      </ButtonLink>
    </div>
  );
}
