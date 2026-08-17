import { Textarea } from "yy-ticket-control";

/** ‏`p-3` ולא `px-3` בלבד — בשדה רב-שורות הטקסט מתחיל בשורה הראשונה. */
export function Default() {
  return (
    <div className="max-w-sm">
      <Textarea
        rows={4}
        defaultValue="נזילה מתחת לכיור במטבח בדירה 4. המים מגיעים למסדרון ויש חשש להצפה בקומה שמתחת."
      />
    </div>
  );
}

export function States() {
  return (
    <div className="flex max-w-sm flex-col gap-3">
      <Textarea rows={2} placeholder="מה לא עובד, ואיפה בדיוק" />
      <Textarea rows={2} invalid defaultValue="קצר מדי" />
      <Textarea rows={2} disabled defaultValue="הפנייה כבר שוגרה — התיאור נעול." />
    </div>
  );
}
