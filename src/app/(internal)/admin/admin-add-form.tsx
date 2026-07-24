"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { useHydrated } from "@/lib/use-hydrated";

interface AdminAddFormProps {
  label: string;
  placeholder?: string;
  buttonLabel: string;
  action: (name: string) => Promise<ActionResult>;
}

/**
 * טופס "הוספת שם" משותף למסכי הניהול הפשוטים (אתר חדש, תחום חדש).
 *
 * ה-Server Action מועברת כ-prop — אותו רכיב משרת שני מסכים בלי לשכפל את
 * הטיפול בטעינה ובשגיאה. הקלט מתאפס בהצלחה, וה-Server Component שמעליו
 * מתרענן ומציג את הרשומה החדשה.
 */
export function AdminAddForm({ label, placeholder, buttonLabel, action }: AdminAddFormProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await action(value);
      if (result.ok) setValue("");
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{label}</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="min-h-11 rounded-xl border border-border px-3 text-base"
        />
      </label>
      <button
        type="button"
        onClick={submit}
        disabled={pending || !hydrated || value.trim().length === 0}
        className="min-h-11 self-start rounded-xl bg-brand px-6 font-medium text-brand-fg disabled:opacity-60"
      >
        {buttonLabel}
      </button>
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
