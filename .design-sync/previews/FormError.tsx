import { Button, Field, FormError, Input } from "yy-ticket-control";

/**
 * שגיאת פעולה. ‏`role="alert"` — קוטע, כי המשתמש לחץ וממתין.
 * צבע לבדו אינו נגיש ואינו נראה בשמש, ולכן ההודעה היא תמיד גם טקסט.
 */
export function Default() {
  return <FormError>שליחת הפנייה נכשלה. אין חיבור לרשת.</FormError>;
}

/** מתחת לטופס — המקום שבו הוא באמת מופיע. */
export function InForm() {
  return (
    <div className="flex max-w-sm flex-col gap-3">
      <Field label="טלפון">
        <Input invalid defaultValue="050-12" />
      </Field>
      <Button>שגר פנייה</Button>
      <FormError>שליחת הפנייה נכשלה. יש לתקן את מספר הטלפון ולנסות שוב.</FormError>
    </div>
  );
}
