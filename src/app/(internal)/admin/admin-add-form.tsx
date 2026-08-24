"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import type { ActionResult } from "@/lib/action-result";
import { useAction } from "@/lib/use-action";
import { cardClasses } from "@/components/ui/card";
import { FormError } from "@/components/ui/message";
import { FORM_PANEL_WIDTH } from "@/lib/ui";

interface AdminAddFormProps {
  label: string;
  placeholder?: string;
  buttonLabel: string;
  action: (name: string) => Promise<ActionResult>;
  /**
   * ‏`plain` מוותר על הכרטיס. נדרש כשהטופס יושב **בתוך** כרטיס — הוספת דירה
   * לבניין — ששם כרטיס בתוך כרטיס קורא כשתי רמות היררכיה שאינן קיימות.
   */
  surface?: "card" | "plain";
  inputMode?: "text" | "numeric";
}

/**
 * טופס "הוספת שם" משותף למסכי הניהול הפשוטים (אתר, תחום, בניין, דירה).
 *
 * ה-Server Action מועברת כ-prop — אותו רכיב משרת ארבעה מסכים בלי לשכפל את
 * הטיפול בטעינה ובשגיאה. הקלט מתאפס בהצלחה, וה-Server Component שמעליו
 * מתרענן ומציג את הרשומה החדשה.
 */
export function AdminAddForm({
  label,
  placeholder,
  buttonLabel,
  action,
  surface = "card",
  inputMode,
}: AdminAddFormProps) {
  const [value, setValue] = useState("");
  const { busy, error, run } = useAction();

  function submit() {
    run(
      () => action(value),
      () => setValue(""),
    );
  }

  /**
   * ‏`FORM_PANEL_WIDTH` כאן, בטופס עצמו, ולא בכל עמוד בנפרד.
   *
   * מסכי הניהול עברו לרוחב מלא, ובלעדיו שדה "שם אתר" נמתח על 1400px כדי
   * לקלוט מילה אחת — ומעליו, בטלפון, הוא דוחק את הרשימה שהוא מוסיף אליה
   * מתחת לקו הקיפול. הרוחב הוא תכונה של הטופס ("פאנל הזנה"), ולכן חמשת
   * העמודים שמרנדרים אותו מקבלים אותו ממנו ולא חוזרים עליו.
   *
   * ‏`lg:shrink-0` משלים אותו: בשורה שבה הטופס יושב לצד הרשימה, בלעדיו
   * ה-flex היה מכווץ אותו מתחת ל-320px כשהרשימה רחבה.
   */
  const layout = `flex flex-col gap-2 ${FORM_PANEL_WIDTH} lg:shrink-0`;

  return (
    <div className={surface === "card" ? cardClasses(layout) : layout}>
      <Field label={label}>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          size="compact"
        />
      </Field>
      {/*
       * ‏`compact` כמו השדה שמעליו. קודם השדה היה 32px והכפתור 36px — שני
       * פקדים בערימה אחת בשני גבהים, שנקראים כשתי מערכות ולא כטופס אחד.
       * הרצפה במגע נשמרת בשני המקרים (`touch:min-h-11`).
       */}
      <Button
        size="compact"
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
