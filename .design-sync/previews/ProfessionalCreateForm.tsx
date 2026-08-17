import { ProfessionalCreateForm } from "yy-ticket-control";

/**
 * הוספת איש מקצוע חדש מתוך זרימת יצירת הפנייה, בלי לעזוב את הטופס.
 * ‏`onCreate` מקבל שם, טלפון ומייל; `onCancel` מחזיר לבחירה מהרשימה.
 */
export function Default() {
  return (
    <div className="max-w-sm">
      <ProfessionalCreateForm onCreate={async () => {}} onCancel={() => {}} />
    </div>
  );
}

/** בתוך כרטיס, כפי שהוא יושב בטופס הפנייה. */
export function InPanel() {
  return (
    <div className="max-w-sm rounded-2xl border border-border bg-surface p-4">
      <p className="mb-3 text-lg font-bold">איש מקצוע חדש</p>
      <ProfessionalCreateForm onCreate={async () => {}} onCancel={() => {}} />
    </div>
  );
}
