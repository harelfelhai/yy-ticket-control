import { Button } from "yy-ticket-control";

/** הפעולה הראשית של המסך — אחת לכל מסך, לכל היותר. */
export function Primary() {
  return <Button variant="primary">שגר פנייה</Button>;
}

/** ששת הווריאנטים, בזוגות שמסבירים את ההבחנה ביניהם. */
export function Variants() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary">שגר פנייה</Button>
        <Button variant="secondary">שמור טיוטה</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="danger">מחק פנייה</Button>
        <Button variant="dangerOutline">מחק טיוטה</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="dangerQuiet">הסר נמען</Button>
        <Button variant="quiet">נקה מסננים</Button>
      </div>
    </div>
  );
}

/** ‏48px לפעולה ראשית, 44px בתוך שורה או כרטיס. */
export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="default">שגר פנייה</Button>
      <Button size="compact">ערוך</Button>
    </div>
  );
}

/** מצב מושבת — `opacity-60`, זהה בכל וריאנט. */
export function Disabled() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" disabled>
        שגר פנייה
      </Button>
      <Button variant="secondary" disabled>
        שמור טיוטה
      </Button>
    </div>
  );
}
