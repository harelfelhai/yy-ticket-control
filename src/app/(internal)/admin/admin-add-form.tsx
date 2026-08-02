"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import type { ActionResult } from "@/lib/action-result";
import { useAction } from "@/lib/use-action";
import { cardClasses } from "@/components/ui/card";
import { FormError } from "@/components/ui/message";

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
  const { busy, error, run } = useAction();

  function submit() {
    run(
      () => action(value),
      () => setValue(""),
    );
  }

  return (
    <div className={cardClasses("flex flex-col gap-2")}>
      <Field label={label}>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          size="compact"
        />
      </Field>
      <Button
        onClick={submit}
        disabled={busy || value.trim().length === 0}
        className="self-start"
      >
        {buttonLabel}
      </Button>
      {error ? (
        <FormError>
          {error}
        </FormError>
      ) : null}
    </div>
  );
}
