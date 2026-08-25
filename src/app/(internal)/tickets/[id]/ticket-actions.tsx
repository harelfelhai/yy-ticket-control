"use client";

import { Send } from "lucide-react";
import { useState } from "react";
import { type AttachedFile, MediaPicker } from "@/components/media-picker";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/he";
import { useAction } from "@/lib/use-action";
import { PAGE_BLEED, PAGE_X } from "@/lib/ui";
import { cardClasses } from "@/components/ui/card";
import {
  closeTicketAction,
  reopenTicketAction,
  replyAction,
  setHandlerAction,
} from "./actions";
import { FormError, FormNotice } from "@/components/ui/message";
import { ReplyField } from "@/components/reply-field";

interface TicketActionsProps {
  ticketId: string;
  isClosed: boolean;
  canClose: boolean;
  canComment: boolean;
  canSetHandler: boolean;
  hasHandler: boolean;
}

/**
 * תיבת התגובה ופעולות הפנייה.
 *
 * הסגירה והפתיחה מחדש דורשות אישור: הן משנות את מיקום הפנייה בלוח של כל
 * מנהלי האתר, ולחיצה בטעות במובייל היא תרחיש ממשי — שני הכפתורים יושבים
 * זה לצד זה על מסך קטן.
 */
export function TicketActions({
  ticketId,
  isClosed,
  canClose,
  canComment,
  canSetHandler,
  hasHandler,
}: TicketActionsProps) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  // תמונה בלי כיתוב היא הודעה שלמה — ולעיתים המדויקת ביותר.
  const canSend = text.trim().length > 0 || files.length > 0;

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

  return (
    /*
     * צמוד לתחתית (אפיון מסך 2 אזור ד׳, DESIGN.md § אלמנט דביק).
     *
     * בשרשור ארוך התיבה הייתה נופלת מתחת לקיפול, והמשתמש נאלץ לגלול לסוף
     * כדי לענות — בדיוק ההפך ממה שצ׳אט אמור לעשות. ‏`PAGE_BLEED` + `PAGE_X`
     * מותחים את הרצועה לקצה המסך, אחרת ההודעות זולגות בצדדים מתחתיה.
     *
     * **הבליטה מגיעה מהקבוע ולא מ-`-mx-4` כתוב ביד**, ומאותה סיבה שהכותרת
     * הדביקה במסך הפנייה עברה אליו: שתי הרצועות חייבות להסכים עם ריפוד
     * העמוד, ומספר שנכתב פעמיים כבר סטה כאן פעם אחת (הריפוד ירד ל-12px
     * והבליטה נשארה 16px, כלומר 4px שהתוכן זולג דרכם משני הצדדים).
     *
     * **פעולות הפנייה נשארות ברצועה ולא בפאנל**: תוכן של `<details>` סגור
     * מוסר מעץ הנגישות, וסגירת פנייה אינה פרט מנהלי אלא התוצאה של המסך.
     */
    <div
      className={`sticky bottom-0 z-[1] ${PAGE_BLEED} flex flex-col gap-3 border-t border-border bg-bg ${PAGE_X} py-3`}
    >
      {/* פעולות הפנייה **מעל** הקומפוזר: הן על הפנייה כולה, בעוד שהקומפוזר
          מוסיף לה הודעה. הסמיכות לתיבת הכתיבה הייתה קוראת אותן כחלק ממנה. */}
      <div className="flex flex-wrap gap-2">
        {canSetHandler && !hasHandler && !isClosed ? (
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

      {canComment ? (
        /*
         * **שורת הקלטה אחת** (סבב הצ׳אט).
         *
         * קודם ישבו כאן ארבע שכבות זו מעל זו — תווית, תיבה בת שלוש שורות
         * קבועות, שורת שלושה כפתורי מדיה בטקסט, וכפתור "שלח" מתחתם — כלומר
         * הקומפוזר גזל מהשרשור יותר גובה מכפי שהשרשור נותן להודעות. עכשיו
         * הכול בשורה אחת, כמו בכל אפליקציית שיחה.
         *
         * ‏`items-end` ולא `items-center`: התיבה גדלה כלפי מעלה עם התוכן,
         * והאייקונים חייבים להישאר מיושרים לתחתיתה — במרכוז הם היו נודדים
         * למעלה עם כל שורה שנוספת.
         *
         * ‏`MediaPicker` מחזיק בתוכו גם את התצוגות המקדימות של הקבצים,
         * שנפרשות מעליו כשיש קבצים — ולכן הוא כאן ולא מפוצל.
         */
        <div className={cardClasses("flex items-end gap-2")}>
          <MediaPicker
            variant="composer"
            // המיקרופון וכפתור השליחה חולקים את הקצה, כמו בווצאפ.
            showRecorder={!canSend}
            ticketId={ticketId}
            files={files}
            onChange={setFiles}
            disabled={busy}
          />

          {/* `flex-1` על עטיפה ולא על השדה: `Textarea` נושא `w-full` משלו,
              וההתמתחות היא תפקיד של התא בשורה. */}
          <div className="flex-1">
            <ReplyField value={text} onChange={setText} />
          </div>

          {/*
           * מוצג רק כשיש מה לשלוח — ובמקומו יושב המיקרופון.
           *
           * **הסתרה ולא `disabled`, ובכוונה.** כפתור מושבת תופס את מקומו
           * ברוחב בלי לתת דבר, וארבעה פקדים בשורה של 393px הותירו לתיבה
           * ‏15 תווים. שני המצבים מוציאים זה את זה ממילא: אין רגע שבו
           * המשתמש רוצה גם להקליט וגם לשלוח את מה שכתב.
           */}
          {canSend ? (
            <Button
              size="compact"
              disabled={busy}
              aria-label={he.ticket.send}
              onClick={() =>
                act(
                  () => replyAction(ticketId, text, files.map((f) => f.mediaId)),
                  () => {
                    setText("");
                    setFiles([]);
                  },
                )
              }
            >
              <Send className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ) : (
        <p className={cardClasses("text-sm text-muted")}>
          {he.notices.closedTicketBlocked}
        </p>
      )}

      {notice ? (
        <FormNotice>
          {notice}
        </FormNotice>
      ) : null}

      {error ? (
        <FormError>
          {error}
        </FormError>
      ) : null}
    </div>
  );
}
