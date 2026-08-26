"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { FormError } from "@/components/ui/message";
import type { ActionResult } from "@/lib/action-result";
import { he } from "@/lib/he";
import { useAction } from "@/lib/use-action";

/**
 * שינוי שם של רשומת עזר בתוך שורה ברשימת ניהול.
 *
 * **למה חשיפה ולא שדה גלוי תמיד.** שתי הצורות היו בקוד: מסך התחומים החזיק
 * שדה פתוח בכל שורה, ומסך התגיות כפתור שנפתח לשדה. עם הוספת המחיקה השורה
 * מחזיקה שם, מונים, שינוי שם ומחיקה — ושדה קלט פתוח בכל שורה הופך רשימה
 * לקריאה לטופס. החשיפה נבחרה כצורה האחת, והשדה נפתח רק כשמתכוונים לערוך.
 *
 * הערך אינו מנוקה בביטול אלא מוחזר למקור: משתמש שהקליד ונסוג מצפה למצוא
 * את השם הקיים, לא שדה ריק.
 */
export function InlineRename({
  value,
  name = value,
  action,
  disabled,
  inputMode,
}: {
  /** הערך הנערך עצמו — מה שיישלח לפעולה ומה שמשמש כתווית הנגישה של השדה */
  value: string;
  /**
   * כיצד לקרוא לרשומה בתוויות הנגישות, כשהערך לבדו אינו מזהה אותה.
   * מספר דירה הוא המקרה: "שנה שם 5" עמום, "שנה שם דירה 5" אינו.
   */
  name?: string;
  action: (next: string) => Promise<ActionResult>;
  disabled?: boolean;
  inputMode?: "text" | "numeric";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const { busy, error, run } = useAction();

  const dirty = draft.trim() !== value && draft.trim().length > 0;

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  if (!editing) {
    return (
      <Button
        variant="quiet"
        size="compact"
        onClick={() => setEditing(true)}
        disabled={disabled}
        aria-label={`${he.common.rename} ${name}`}
      >
        {/*
         * **הסמל החליף את התווית ב-0.7, והשם הנגיש לא זז.**
         *
         * ‏`aria-label` נשאר בדיוק `שנה שם {name}` — אותה מחרוזת שהייתה
         * התווית הגלויה (§ אייקונים). זה אינו נימוס: חמש חבילות בדיקה
         * מאתרות את הכפתור הזה בשמו, וסטייה של תו אחד שוברת את כולן.
         *
         * הכפתור נשאר `quiet`, והקו התחתון של `LINK` פשוט אינו מצויר —
         * ‏`inline-flex` אינו מוריש `text-decoration` לילד SVG. מתועד
         * ב-DESIGN.md § אייקונים.
         */}
        <Pencil className="size-3" aria-hidden="true" />
      </Button>
    );
  }

  return (
    // ‏`w-full` בכוונה: בתוך שורת רשימה עמוסה השדה תופס שורה משלו במקום
    // להידחס לצד המונים, ובשורה קצרה זה נראה זהה.
    <div className="flex w-full flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={value}
          inputMode={inputMode}
          size="compact"
          className="min-w-0 flex-1"
        />
        <Button
          size="compact"
          onClick={() => run(() => action(draft), () => setEditing(false))}
          disabled={busy || !dirty}
        >
          {he.common.save}
        </Button>
        <Button variant="secondary" size="compact" onClick={cancel} disabled={busy}>
          {he.common.cancel}
        </Button>
      </div>
      {error ? <FormError>{error}</FormError> : null}
    </div>
  );
}
