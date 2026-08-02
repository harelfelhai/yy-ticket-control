"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { he } from "@/lib/he";
import { useAction } from "@/lib/use-action";
import { renameTagAction } from "./actions";
import { FormError } from "@/components/ui/message";

/**
 * שינוי שם תגית בשורה (חלק ממסכי הניהול) — למנהל המערכת בלבד.
 *
 * מוצג כפעולה משנית ("שנה שם") שנפתחת לשדה עריכה, כדי שלא תתחרה בקישור
 * לצ׳אט התגית. שינוי לשם שכבר קיים נדחה — איחוד תגיות אינו בתחולה.
 */
export function TagRename({ id, name }: { id: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const { busy, error, run } = useAction();
  const dirty = value.trim() !== name && value.trim().length > 0;

  function save() {
    run(
      () => renameTagAction(id, value),
      () => setEditing(false),
    );
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
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={name}
          size="compact"
          className="flex-1"
        />
        <Button size="compact" onClick={save} disabled={busy || !dirty}>
          {he.common.save}
        </Button>
        <Button
          variant="secondary"
          size="compact"
          onClick={() => {
            setValue(name);
            setEditing(false);
          }}
        >
          {he.common.cancel}
        </Button>
      </div>
      {error ? (
        <FormError>
          {error}
        </FormError>
      ) : null}
    </div>
  );
}
