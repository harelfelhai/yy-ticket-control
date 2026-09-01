"use client";

import { useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { FormError, FormNotice } from "@/components/ui/message";
import { he } from "@/lib/he";
import { useAction } from "@/lib/use-action";
import { closeTicketAction, reopenTicketAction, setHandlerAction } from "./actions";

interface TicketHeaderActionsProps {
  ticketId: string;
  isClosed: boolean;
  canClose: boolean;
  canSetHandler: boolean;
  /** הצופה **הוא** המטפל הרשום — ורק לו הכפתור מיותר. ראה `showHandler`. */
  isHandler: boolean;
}

/**
 * פעולות הפנייה — בפס העליון, לצד "פרטים".
 *
 * **הן ירדו מהקומפוזר ועלו לכאן ב-0.6** (אפיון §7 שורה 35). הנימוק שהיה
 * כתוב במקומן הקודם — "הן על הפנייה כולה, בעוד שהקומפוזר מוסיף לה הודעה;
 * הסמיכות לתיבת הכתיבה קראה אותן כחלק ממנה" — **הוא בדיוק מה שהוליד את
 * המעבר**: הוא נכון, והמסקנה שנגזרה ממנו (רצועה נפרדת מעל התיבה) הייתה
 * המקום השגוי לקיים אותו.
 *
 * **הכלל שהאפיון באמת קובע נשמר במלואו:** הן גלויות בלי לפתוח דבר, ואינן
 * נכנסות לא לפאנל ולא לדיאלוג — סגירת פנייה היא התוצאה של המסך, לא פרט
 * מנהלי. מה שהתחלף הוא המקום שבו הכלל מתקיים.
 *
 * הסגירה והפתיחה מחדש דורשות אישור: הן משנות את מיקום הפנייה בלוח של כל
 * מנהלי האתר, ולחיצה בטעות במובייל היא תרחיש ממשי.
 */
export function TicketHeaderActions({
  ticketId,
  isClosed,
  canClose,
  canSetHandler,
  isHandler,
}: TicketHeaderActionsProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  /**
   * ‏`run` בתוספת ניקוי ההודעה החיובית.
   *
   * ‏`useAction` מנקה שגיאה בלבד, ובכוונה: `notice` הוא טקסט של המסך הזה —
   * "הפנייה נסגרה" — ולא מצב של הפעולה. הוא מנוקה כאן מפני ש**כאן** ידוע
   * שהודעה מלפני שתי לחיצות כבר אינה מתארת את מה שקורה עכשיו.
   */
  function act(action: () => Promise<ActionResult>, onSuccess?: () => void) {
    setNotice(null);
    run(action, onSuccess);
  }

  /**
   * **הכפתור נעלם רק מהמטפל עצמו** (אפיון §5.ד, הכרעת 0.2).
   *
   * עד כאן התנאי היה `!hasHandler` — כלומר ברגע שנקבע מטפל ראשון, בין אם
   * ידנית ובין אם אוטומטית מתגובה, הכפתור נעלם **מכולם** ולא נותרה שום דרך
   * להחליף מטפל. זה בדיוק המצב שהסייג של 0.2 נכתב כדי למנוע: הוא מנע ממנהל
   * שני "לגנוב" את הסימון בכל תגובה, מתוך הנחה שהמנגנון המפורש — הכפתור —
   * קיים במקומו. הצד האוטומטי מומש; הידני לא.
   *
   * למנהל שאינו המטפל הכפתור נשאר גלוי ולוקח את הסימון אליו. הוא **אינו
   * נועל** את הפנייה ומעולם לא נעל — לכן אין כאן אישור: זה סימון תיאום בין
   * מנהלים, לא פעולה הרסנית. למטפל הרשום עצמו הכפתור הוא no-op, ולכן ירד.
   */
  const showHandler = canSetHandler && !isHandler && !isClosed;
  if (!showHandler && !canClose) return null;

  return (
    // ההודעה יורדת מתחת לכפתורים ואינה נדחסת לשורה איתם: היא משפט, והם תגים.
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {showHandler ? (
          <Button
            variant="secondary"
            size="compact"
            disabled={busy}
            onClick={() => act(() => setHandlerAction(ticketId))}
          >
            {he.ticket.setHandler}
          </Button>
        ) : null}

        {canClose ? (
          <Button
            variant="secondary"
            size="compact"
            disabled={busy}
            onClick={() => {
              const closing = !isClosed;
              const question = closing ? he.ticket.confirmClose : he.ticket.confirmReopen;
              if (!window.confirm(question)) return;
              act(
                () => (closing ? closeTicketAction(ticketId) : reopenTicketAction(ticketId)),
                () => setNotice(closing ? he.ticket.closedNotice : he.ticket.reopenedNotice),
              );
            }}
          >
            {isClosed ? he.ticket.reopen : he.ticket.close}
          </Button>
        ) : null}
      </div>

      {notice ? <FormNotice>{notice}</FormNotice> : null}
      {error ? <FormError>{error}</FormError> : null}
    </div>
  );
}
