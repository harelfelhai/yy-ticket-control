"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/he";
import { useHydrated } from "@/lib/use-hydrated";
import { renameTagAction } from "./actions";

/**
 * שינוי שם תגית בשורה (חלק ממסכי הניהול) — למנהל המערכת בלבד.
 *
 * מוצג כפעולה משנית ("שנה שם") שנפתחת לשדה עריכה, כדי שלא תתחרה בקישור
 * לצ׳אט התגית. שינוי לשם שכבר קיים נדחה — איחוד תגיות אינו בתחולה.
 */
export function TagRename({ id, name }: { id: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const dirty = value.trim() !== name && value.trim().length > 0;

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await renameTagAction(id, value);
      if (result.ok) setEditing(false);
      else setError(result.error);
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="self-start px-1 text-xs font-medium text-brand"
      >
        {he.tag.rename}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={name}
          className="min-h-11 flex-1 rounded-lg border border-border px-3 text-base"
        />
        <Button size="compact" onClick={save} disabled={pending || !hydrated || !dirty}>
          {he.common.save}
        </Button>
        <button
          type="button"
          onClick={() => {
            setValue(name);
            setEditing(false);
          }}
          className="min-h-11 rounded-xl border border-border px-4 text-sm"
        >
          {he.common.cancel}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
