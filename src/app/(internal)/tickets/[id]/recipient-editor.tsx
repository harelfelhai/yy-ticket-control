"use client";

import { useState, useTransition } from "react";
import { AssignmentStatusChip } from "@/components/status-chip";
import { LearnedSelect } from "@/components/learned-select";
import type { AssignmentStatus } from "@/generated/prisma/enums";
import { he } from "@/lib/he";
import { useHydrated } from "@/lib/use-hydrated";
import { addRecipientsAction, removeRecipientAction } from "./actions";

export interface AssignmentRow {
  id: string;
  name: string;
  status: AssignmentStatus;
}

export interface AvailableRecipient {
  id: string;
  label: string;
  hint?: string;
  kind: "professional" | "user";
}

interface RecipientEditorProps {
  ticketId: string;
  assignments: AssignmentRow[];
  available: AvailableRecipient[];
  canEdit: boolean;
}

/**
 * רצועת הנמענים עם הסטטוס האישי של כל אחד.
 *
 * זו התשובה לשאלה שהמנהל שואל בפועל — "מי כבר טיפל ומי לא". שיוך שהוסר
 * נשאר מוצג באפור: המידע ההיסטורי חשוב ("שלחתי לו והוא לא הגיב"), אבל
 * ברור שהוא כבר לא בתמונה.
 */
export function RecipientEditor({
  ticketId,
  assignments,
  available,
  canEdit,
}: RecipientEditorProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const busy = pending || !hydrated;

  const active = assignments.filter((a) => a.status !== "REMOVED");
  const removed = assignments.filter((a) => a.status === "REMOVED");

  function add(id: string | null) {
    const option = available.find((o) => o.id === id);
    if (!option) return;
    setError(null);
    startTransition(async () => {
      const result = await addRecipientsAction(ticketId, [{ kind: option.kind, id: option.id }]);
      if (!result.ok) setError(result.error);
    });
  }

  function remove(assignmentId: string) {
    setError(null);
    startTransition(async () => {
      const result = await removeRecipientAction(ticketId, assignmentId);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h2 className="mb-2 text-sm font-semibold">{he.ticket.recipients}</h2>

      {active.length === 0 ? (
        <p className="text-sm text-muted">{he.reason.noRecipients}</p>
      ) : (
        <ul aria-label={he.ticket.recipients} className="flex flex-col gap-2">
          {active.map((assignment) => (
            <li key={assignment.id} className="flex items-center justify-between gap-2">
              {/* min-w-0 + truncate: שם ארוך מקצר את עצמו במקום למעוך את
                  הכפתור שלצדו. בלי זה הכפתור נמעך ל-16 פיקסלים על מסך
                  טלפון — יעד מגע בלתי אפשרי, ובפועל לחיצות פשוט מתפספסות. */}
              <span className="min-w-0 flex-1 truncate">{assignment.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <AssignmentStatusChip status={assignment.status} />
                {canEdit ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(assignment.id)}
                    aria-label={`${he.ticket.removeRecipient} ${assignment.name}`}
                    className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-danger disabled:opacity-60"
                  >
                    {he.ticket.removeRecipient}
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      {removed.length > 0 ? (
        <ul aria-label={he.ticket.removedRecipients} className="mt-3 flex flex-col gap-1">
          {removed.map((assignment) => (
            <li key={assignment.id} className="flex items-center justify-between gap-2 text-muted">
              <span className="min-w-0 flex-1 truncate line-through">{assignment.name}</span>
              <span className="shrink-0">
                <AssignmentStatusChip status={assignment.status} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {canEdit ? (
        <div className="mt-3">
          <LearnedSelect
            label={he.ticket.addRecipient}
            options={available}
            value={null}
            onChange={add}
            disabled={busy}
          />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
