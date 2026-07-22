"use client";

import { useState, useTransition } from "react";
import type { AssignmentStatus } from "@/generated/prisma/enums";
import type { ActionResult } from "@/lib/action-result";
import { he } from "@/lib/he";
import { useHydrated } from "@/lib/use-hydrated";
import { askQuestionAction, markDoneAction, replyAction } from "./actions";

interface PortalActionsProps {
  token: string;
  ticketId: string;
  status: AssignmentStatus;
  isClosed: boolean;
}

/**
 * הפעולות שהנמען רשאי לבצע: תגובה, "סיימתי — טופל", ו"יש לי שאלה".
 *
 * **הנמען אינו סוגר** (אפיון §5.א). "טופל" ממנו הוא דיווח, לא אימות, ולכן
 * הכפתור אומר "סיימתי — טופל" ולא "סגור", וההודעה שאחריו מבהירה שהמנהל
 * הוא זה שסוגר. הבהרה כאן חוסכת טלפון של "סגרתי, למה זה עדיין פתוח?".
 *
 * "יש לי שאלה" דורש טקסט: שאלה בלי תוכן היא רק דגל אדום שמנהל העבודה לא
 * יודע מה לעשות איתו.
 */
export function PortalActions({ token, ticketId, status, isClosed }: PortalActionsProps) {
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

  if (isClosed) {
    return (
      <p className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
        {he.notices.closedTicketBlocked}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {status === "DONE" ? (
        <p className="rounded-xl bg-success/10 p-3 text-sm font-medium text-success">
          {he.portal.doneNotice}
        </p>
      ) : null}
      {status === "QUESTION" ? (
        <p className="rounded-xl bg-warning/10 p-3 text-sm font-medium text-warning">
          {he.portal.questionNotice}
        </p>
      ) : null}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">{he.ticket.reply}</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="rounded-xl border border-border bg-surface p-3 text-base"
        />
      </label>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={busy || text.trim().length === 0}
          onClick={() => run(() => replyAction(token, ticketId, text), () => setText(""))}
          className="min-h-12 rounded-xl border border-border bg-surface px-4 font-medium disabled:opacity-60"
        >
          {he.ticket.send}
        </button>

        <button
          type="button"
          disabled={busy || text.trim().length === 0}
          onClick={() =>
            run(() => askQuestionAction(token, ticketId, text), () => setText(""))
          }
          className="min-h-12 rounded-xl border border-warning bg-warning/10 px-4 font-semibold text-warning disabled:opacity-60"
        >
          {he.portal.askQuestion}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => markDoneAction(token, ticketId))}
          className="min-h-14 rounded-xl bg-success px-4 text-base font-semibold text-brand-fg disabled:opacity-60"
        >
          {he.portal.markDone}
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
