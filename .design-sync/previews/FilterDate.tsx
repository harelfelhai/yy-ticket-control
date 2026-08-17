import { FilterDate } from "yy-ticket-control";

/**
 * שדה תאריך ברצועת המסננים. הפקד נייטיב בהחלטה: המכשיר העיקרי הוא טלפון
 * בשטח, וגלגלת מערכת עם אצבע בכפפה עדיפה על כל לוח שנה שנכתב ב-React.
 *
 * התווית גלויה, בשונה מהבוררים שלצדו — שדה תאריך ריק מציג מסכת פורמט בלבד,
 * ואי אפשר לדעת ממנה מי "מתאריך" ומי "עד תאריך".
 */
export function Range() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <FilterDate label="מתאריך" defaultValue="2026-08-01" />
      <FilterDate label="עד תאריך" defaultValue="2026-08-17" />
    </div>
  );
}

/** ריק — כאן נראה למה התווית חייבת להיות גלויה. */
export function Empty() {
  return <FilterDate label="מתאריך" />;
}
