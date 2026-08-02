"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/he";
import { useAction } from "@/lib/use-action";
import { deleteTicketAction } from "./actions";
import { cardClasses } from "@/components/ui/card";
import { FormError } from "@/components/ui/message";

/**
 * מחיקת פנייה — מנהל מערכת בלבד, מאחורי **אישור כפול** (אפיון §5.ז).
 *
 * המחיקה היא הדלת האחורית היחידה של הכלל "פנייה לא נעלמת", ולכן היא לא
 * כפתור בודד: לחיצה ראשונה רק חושפת אזהרה, ורק לחיצה שנייה על כפתור אדום
 * נפרד מוחקת. המרחק הזה מכוון — הוא מונע מחיקה של פנייה אמיתית בטעות.
 */
export function DeleteTicket({ ticketId }: { ticketId: string }) {
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run } = useAction();

  function remove() {
    // בהצלחה ה-action מבצע redirect ואינו חוזר; `run` מפרש תשובה חסרה
    // כהצלחה, ורק כשל מחזיר ערך.
    run(() => deleteTicketAction(ticketId));
  }

  if (!confirming) {
    return (
      <div className="flex flex-col gap-1 border-t border-border pt-4">
        <Button
          variant="dangerQuiet"
          size="compact"
          onClick={() => setConfirming(true)}
          className="self-start px-0"
        >
          {he.ticket.delete}
        </Button>
        <p className="text-xs text-muted">{he.ticket.deleteWarning}</p>
      </div>
    );
  }

  return (
    <div className={cardClasses("flex flex-col gap-2", { tone: "dangerQuiet" })}>
      <p className="text-sm font-medium text-danger">{he.ticket.confirmDelete}</p>
      <div className="flex gap-2">
        <Button
          variant="danger"
          size="compact"
          onClick={remove}
          disabled={busy}
        >
          {he.ticket.confirmDeleteButton}
        </Button>
        <Button variant="secondary" size="compact" onClick={() => setConfirming(false)} disabled={busy}>
          {he.common.cancel}
        </Button>
      </div>
      {error ? (
        <FormError>
          {error}
        </FormError>
      ) : null}
    </div>
  );
}
