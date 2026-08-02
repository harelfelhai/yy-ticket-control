"use client";

import { useState } from "react";
import { type AttachedFile, MediaPicker } from "@/components/media-picker";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/he";
import { useAction } from "@/lib/use-action";
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
    <div className="flex flex-col gap-3">
      {canComment ? (
        <div className={cardClasses("flex flex-col gap-2")}>
          <ReplyField value={text} onChange={setText} />

          <MediaPicker
            ticketId={ticketId}
            files={files}
            onChange={setFiles}
            disabled={busy}
          />

          {/* `self-start` כמו בצ׳אט התגית — כפתור שנמתח לכל הרוחב נראה
              כפעולה ראשית של המסך, וזו רק שליחת תגובה. */}
          <Button
            className="self-start"
            disabled={busy || !canSend}
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
            {he.ticket.send}
          </Button>
        </div>
      ) : (
        <p className={cardClasses("text-sm text-muted")}>
          {he.notices.closedTicketBlocked}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {canSetHandler && !hasHandler && !isClosed ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => act(() => setHandlerAction(ticketId))}
          >
            {he.ticket.setHandler}
          </Button>
        ) : null}

        {canClose ? (
          <Button
            variant="secondary"
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
