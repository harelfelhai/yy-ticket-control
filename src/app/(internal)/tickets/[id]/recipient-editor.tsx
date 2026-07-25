"use client";

import { useState, useTransition } from "react";
import { AssignmentStatusChip } from "@/components/status-chip";
import { LearnedSelect } from "@/components/learned-select";
import type { AssignmentStatus } from "@/generated/prisma/enums";
import { he } from "@/lib/he";
import { useHydrated } from "@/lib/use-hydrated";
import {
  addRecipientsAction,
  getLinkAction,
  removeRecipientAction,
  rotateLinkAction,
} from "./actions";

export interface AssignmentRow {
  id: string;
  name: string;
  status: AssignmentStatus;
  /** null עבור נמען פנימי — הוא נכנס עם סיסמה ואינו צריך קישור */
  professionalId: string | null;
  /** מצב השליחה האוטומטית אליו, כטקסט מוכן */
  deliveryNote: string;
  /** כתובת wa.me עם ההודעה מוכנה, או null כשאין טלפון */
  waUrl: string | null;
  /** האם יש כתובת מייל שאפשר לשלוח אליה שוב */
  canResendEmail: boolean;
  /** מתי השתנה הסטטוס האישי לאחרונה, כטקסט מוכן */
  statusChangedAt: string;
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
 * רצועת הנמענים: מי משויך, מה הסטטוס האישי שלו, והאם הוא בכלל יודע.
 *
 * ההפרדה בין שני האחרונים היא העיקר. "נשלח" הוא סטטוס השיוך — הוא אומר
 * שהמערכת שייכה אותו, לא שמישהו יידע אותו. שורת השליחה שמתחתיו אומרת את
 * הדבר השני, וההבחנה הזו היא ההבדל בין מנהל שיודע שהקבלן קיבל לבין מנהל
 * שמניח שכן.
 *
 * שיוך שהוסר נשאר מוצג באפור: המידע ההיסטורי חשוב ("שלחתי לו והוא לא
 * הגיב"), אבל ברור שהוא כבר לא בתמונה.
 */
export function RecipientEditor({
  ticketId,
  assignments,
  available,
  canEdit,
}: RecipientEditorProps) {
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ forId: string; url: string; rotated: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const busy = pending || !hydrated;

  const active = assignments.filter((a) => a.status !== "REMOVED");
  const removed = assignments.filter((a) => a.status === "REMOVED");

  function showLink(professionalId: string) {
    setError(null);
    // מנקים את הקישור הקודם **לפני** הבקשה: אחרת, בזמן הטעינה עבור הקבלן
    // השני התיבה עדיין מציגה את הקישור של הראשון, והמנהל עלול להעתיק
    // ולשלוח לאחד את הקישור האישי של האחר.
    setLink(null);
    startTransition(async () => {
      const result = await getLinkAction(ticketId, professionalId);
      if (result.ok) setLink({ forId: professionalId, url: result.data, rotated: false });
      else setError(result.error);
    });
  }

  function rotate(professionalId: string) {
    if (!confirm(he.ticket.confirmRotateLink)) return;
    setError(null);
    setLink(null);
    startTransition(async () => {
      const result = await rotateLinkAction(ticketId, professionalId);
      if (result.ok) setLink({ forId: professionalId, url: result.data, rotated: true });
      else setError(result.error);
    });
  }

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
        <ul aria-label={he.ticket.recipients} className="flex flex-col gap-3">
          {active.map((assignment) => (
            <li key={assignment.id} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                {/* min-w-0 + truncate: שם ארוך מקצר את עצמו במקום למעוך את
                    הכפתור שלצדו. בלי זה הכפתור נמעך ל-16 פיקסלים על מסך
                    טלפון — יעד מגע בלתי אפשרי, ובפועל לחיצות מתפספסות. */}
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
              </div>

              <p className="text-xs text-muted">{assignment.deliveryNote}</p>

              {canEdit && assignment.professionalId ? (
                <div className="flex flex-wrap gap-2">
                  {/* קישור רגיל ולא כפתור: הוא חייב לפתוח את וואטסאפ ישירות
                      מלחיצת המשתמש. פתיחה מתוך תשובה אסינכרונית נחסמת
                      כחלון קופץ — בדיוק בדפדפני המובייל שבהם זה נחוץ. */}
                  {assignment.waUrl ? (
                    <a
                      href={assignment.waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${he.ticket.sendWhatsApp} ${assignment.name}`}
                      className="flex min-h-11 items-center rounded-lg bg-brand px-3 text-sm font-medium text-brand-fg"
                    >
                      {he.ticket.sendWhatsApp}
                    </a>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => showLink(assignment.professionalId as string)}
                    aria-label={`${he.ticket.showLink} ${assignment.name}`}
                    className="min-h-11 rounded-lg border border-border px-3 text-sm font-medium disabled:opacity-60"
                  >
                    {he.ticket.showLink}
                  </button>
                </div>
              ) : null}

              {link !== null && link.forId === assignment.professionalId ? (
                <div className="flex flex-col gap-2 rounded-xl border border-brand/30 bg-brand/5 p-3">
                  <p className="text-sm font-medium">{he.ticket.linkFor(assignment.name)}</p>
                  <p className="text-xs text-muted">
                    {link.rotated ? he.ticket.linkRotated : he.ticket.linkStable}
                  </p>
                  {/* readOnly ולא טקסט רגיל: בחירה והעתקה ידנית עובדות בכל
                      מכשיר, גם כשה-clipboard API חסום או שאינו נתמך. */}
                  <input
                    readOnly
                    dir="ltr"
                    value={link.url}
                    aria-label={he.ticket.showLink}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => rotate(assignment.professionalId as string)}
                    className="min-h-11 self-start px-1 text-sm font-medium text-danger disabled:opacity-60"
                  >
                    {he.ticket.rotateLink}
                  </button>
                </div>
              ) : null}
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
