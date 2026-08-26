"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/message";
import type { ActionResult } from "@/lib/action-result";
import { he } from "@/lib/he";
import { useAction } from "@/lib/use-action";

/**
 * מחיקת רשומת עזר מתוך שורה ברשימת ניהול (DESIGN.md § מחיקה — כלל אחיד).
 *
 * **מה חולץ לכאן ומה לא.** שש רשימות ניהול מקבלות את אותה פעולה, אבל התקן
 * אוסר במפורש על "רכיב עם תשעה מתגים" — ולכן מה שמשותף כאן הוא **זוג
 * הפעולה והאישור** בלבד: כפתור `dangerQuiet`, אישור שנוקב בשם, והצגת
 * החסימה כשהמחיקה נדחית. הפריסה של השורה נשארת של כל מסך.
 *
 * **הכפתור אינו מושבת כשהמחיקה חסומה, וזו הנקודה.** המסך אינו יודע מראש מה
 * חוסם — הספירה יושבת בשרת (`services/deletion.ts`) — והצגת כפתור עמום
 * הייתה נקראת כתקלה. הלחיצה מחזירה הסבר שנוקב במה חוסם ובכמה.
 */
export function DeleteButton({
  name,
  action,
  disabled,
}: {
  /** מה נמחק — נכנס לנוסח האישור, כדי שלחיצה בטעות לא תעבור בשקט */
  name: string;
  action: () => Promise<ActionResult>;
  disabled?: boolean;
}) {
  const { busy, error, run } = useAction();

  function remove() {
    if (!window.confirm(he.admin.deleteConfirm(name))) return;
    run(action);
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="dangerQuiet"
        size="compact"
        onClick={remove}
        disabled={disabled || busy}
        aria-label={`${he.admin.delete} ${name}`}
      >
        {/*
         * **‏`Trash2` ולא `X`, וזו הכרעה מנומקת** (§ אייקונים): `X` נושא
         * במערכת שלוש משמעויות לא-הרסניות — הסרת קובץ, ניקוי חיפוש,
         * סגירת דיאלוג — ואותו סמל ל"צא בלי לעשות כלום" ול"מחק לתמיד"
         * הוא נשא מידע שמשמעותו אינה עקבית.
         *
         * ‏`aria-label` נשאר `מחק {name}` בדיוק — אותה מחרוזת שהייתה
         * התווית הגלויה, ולכן כל חבילות ה-e2e ממשיכות לאתר את הכפתור.
         * ‏`window.confirm` הוא שממשיך לנקוב בשם בפועל.
         */}
        <Trash2 className="size-3" aria-hidden="true" />
      </Button>
      {error ? <FormError>{error}</FormError> : null}
    </div>
  );
}
