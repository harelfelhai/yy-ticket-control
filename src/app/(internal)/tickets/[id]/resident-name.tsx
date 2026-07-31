"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
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
        {/* "ערוך" הוא קישור-בשורה בתוך משפט ולא כפתור עצמאי: `Button` היה
            מקבל 44px ושובר את שורת הכותרת שהוא יושב בתוכה. אזור הלחיצה
            מורחב בריפוד אנכי במקום בגובה מינימלי. */}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded px-1 py-2 font-medium text-brand"
        >
          {he.common.edit}
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label={he.ticket.residentLabel}
        size="compact"
      />
      {/* היה `min-h-9` (36px) — מתחת לסף המגע המינימלי של 44px. הפרימיטיב
          מעלה אותו ל-`compact`, שהוא הסף הנמוך ביותר שהתקן מתיר. */}
      <Button size="compact" onClick={save} disabled={busy}>
        {he.common.save}
      </Button>
      {/* היה `min-h-9` (36px) — ובאותה הגירה שהעלתה את "שמור" שלידו ל-44px
          הוא נשאר מאחור, כך ששני כפתורים צמודים קיבלו גבהים שונים. */}
      <Button
        variant="secondary"
        size="compact"
        onClick={() => {
          setName(initial ?? "");
          setEditing(false);
        }}
      >
        {he.common.cancel}
      </Button>
      {error ? (
        <span role="alert" className="text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
