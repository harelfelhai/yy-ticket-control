"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import type { ActionResult } from "@/lib/action-result";
import { useHydrated } from "@/lib/use-hydrated";
import { cardClasses } from "@/components/ui/card";

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
    <div className={cardClasses("flex flex-col gap-2")}>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{label}</span>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          size="compact"
        />
      </label>
      <Button
        onClick={submit}
        disabled={pending || !hydrated || value.trim().length === 0}
        className="self-start"
      >
        {buttonLabel}
      </Button>
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
