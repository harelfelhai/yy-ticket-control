import { Button, FilterBar, FilterDate, FilterSelect } from "yy-ticket-control";

/**
 * רצועת מסננים. במסך רחב היא גלויה; בנייד היא מקופלת מאחורי מתג שנושא את
 * מספר המסננים הפעילים — קיפול אינו הסתרה, ולוח מסונן שנראה חסר נקרא
 * כאובדן נתונים.
 */
export function Active() {
  return (
    <FilterBar
      activeCount={2}
      trailing={
        <Button variant="quiet" size="compact">
          נקה מסננים
        </Button>
      }
    >
      <FilterSelect defaultValue="1" aria-label="אתר">
        <option value="">כל האתרים</option>
        <option value="1">רמת השרון, בן גוריון 14</option>
      </FilterSelect>
      <FilterSelect defaultValue="2" aria-label="איש מקצוע">
        <option value="">כל אנשי המקצוע</option>
        <option value="2">מוסא דיאב — אינסטלציה</option>
      </FilterSelect>
      <FilterDate label="מתאריך" defaultValue="2026-08-01" />
    </FilterBar>
  );
}

/** בלי מסננים פעילים — המתג נקי מהמונה. */
export function Empty() {
  return (
    <FilterBar activeCount={0}>
      <FilterSelect defaultValue="" aria-label="אתר">
        <option value="">כל האתרים</option>
        <option value="1">רמת השרון, בן גוריון 14</option>
      </FilterSelect>
      <FilterSelect defaultValue="" aria-label="סטטוס">
        <option value="">כל הסטטוסים</option>
        <option value="open">פתוחות</option>
      </FilterSelect>
    </FilterBar>
  );
}
