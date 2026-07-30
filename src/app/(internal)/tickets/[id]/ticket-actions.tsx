"use client";

import { useState, useTransition } from "react";
import { type AttachedFile, MediaPicker } from "@/components/media-picker";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { he } from "@/lib/he";
import { useHydrated } from "@/lib/use-hydrated";
import {
  closeTicketAction,
  reopenTicketAction,
  replyAction,
  setHandlerAction,
} from "./actions";

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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const busy = pending || !hydrated;

  // תמונה בלי כיתוב היא הודעה שלמה — ולעיתים המדויקת ביותר.
  const canSend = text.trim().length > 0 || files.length > 0;

  function run(action: () => Promise<ActionResult>, onSuccess?: () => void) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) onSuccess?.();
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {canComment ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">{he.ticket.reply}</span>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
            />
          </label>

          <MediaPicker
            ticketId={ticketId}
            files={files}
            onChange={setFiles}
            disabled={busy}
          />

          <Button
            disabled={busy || !canSend}
            onClick={() =>
              run(
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
        <p className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
          {he.notices.closedTicketBlocked}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {canSetHandler && !hasHandler && !isClosed ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => run(() => setHandlerAction(ticketId))}
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
              run(
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
        <p role="status" className="text-sm font-medium text-success">
          {notice}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
