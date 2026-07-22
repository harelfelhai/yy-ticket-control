"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const busy = pending || !hydrated;

  function run(action: () => Promise<ActionResult>, onSuccess?: () => void) {
    setError(null);
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
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              className="rounded-xl border border-border p-3 text-base"
            />
          </label>
          <button
            type="button"
            disabled={busy || text.trim().length === 0}
            onClick={() => run(() => replyAction(ticketId, text), () => setText(""))}
            className="min-h-12 rounded-xl bg-brand px-4 font-semibold text-brand-fg disabled:opacity-60"
          >
            {he.ticket.send}
          </button>
        </div>
      ) : (
        <p className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
          {he.notices.closedTicketBlocked}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {canSetHandler && !hasHandler && !isClosed ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => setHandlerAction(ticketId))}
            className="min-h-12 rounded-xl border border-border bg-surface px-4 font-medium disabled:opacity-60"
          >
            {he.ticket.setHandler}
          </button>
        ) : null}

        {canClose ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const question = isClosed ? he.ticket.confirmReopen : he.ticket.confirmClose;
              if (!window.confirm(question)) return;
              run(() => (isClosed ? reopenTicketAction(ticketId) : closeTicketAction(ticketId)));
            }}
            className="min-h-12 rounded-xl border border-border bg-surface px-4 font-medium disabled:opacity-60"
          >
            {isClosed ? he.ticket.reopen : he.ticket.close}
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
