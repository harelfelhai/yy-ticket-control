"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/he";
import { useHydrated } from "@/lib/use-hydrated";
import { updateResidentNameAction } from "./actions";

/**
 * שם הדייר בכותרת הפנייה (אפיון §3.2 שדה 11).
 *
 * הדייר קשור ל**דירה** ולא לפנייה, ולכן עריכתו כאן מתגלגלת לכל הפניות של
 * אותה דירה — בדיוק כפי שהאפיון מתאר ("מעדכן את הדירה"). לכן היא נגישה רק
 * למי שרשאי לערוך את הפנייה, ולא לצופה בלבד.
 */
interface ResidentNameProps {
  ticketId: string;
  initial: string | null;
  canEdit: boolean;
}

export function ResidentName({ ticketId, initial, canEdit }: ResidentNameProps) {
  const [name, setName] = useState(initial ?? "");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const busy = pending || !hydrated;

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateResidentNameAction(ticketId, name);
      if (result.ok) setEditing(false);
      else setError(result.error);
    });
  }

  // צופה בלבד: מוצג רק כשיש שם, ובלי אפשרות עריכה.
  if (!canEdit) {
    return name ? (
      <span>
        {he.ticket.residentLabel}: {name}
      </span>
    ) : null;
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <span>{name ? `${he.ticket.residentLabel}: ${name}` : he.ticket.residentLabel}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded px-1 font-medium text-brand"
        >
          {he.common.edit}
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label={he.ticket.residentLabel}
        className="min-h-9 rounded-lg border border-border bg-surface px-2 text-sm text-fg"
      />
      {/* היה `min-h-9` (36px) — מתחת לסף המגע המינימלי של 44px. הפרימיטיב
          מעלה אותו ל-`compact`, שהוא הסף הנמוך ביותר שהתקן מתיר. */}
      <Button size="compact" onClick={save} disabled={busy}>
        {he.common.save}
      </Button>
      <button
        type="button"
        onClick={() => {
          setName(initial ?? "");
          setEditing(false);
        }}
        className="min-h-9 rounded-lg border border-border px-2"
      >
        {he.common.cancel}
      </button>
      {error ? (
        <span role="alert" className="text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
