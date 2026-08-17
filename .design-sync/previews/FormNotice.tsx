import { Button, FormNotice } from "yy-ticket-control";

/**
 * אישור פעולה שהצליחה. ‏`role="status"` — אינו קוטע; הצלחה אינה דחופה.
 * התאום החיובי של `FormError`, ובאותה תבנית בדיוק.
 */
export function Default() {
  return <FormNotice>הפנייה נשלחה לאיש מקצוע אחד.</FormNotice>;
}

/** אחרי פעולה בטופס. */
export function AfterAction() {
  return (
    <div className="flex max-w-sm flex-col gap-3">
      <Button variant="secondary">שלח שוב במייל</Button>
      <FormNotice>נשלח שוב במייל אל avi@example.com.</FormNotice>
    </div>
  );
}
