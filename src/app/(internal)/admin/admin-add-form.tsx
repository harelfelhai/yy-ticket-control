"use client";

import { Plus } from "lucide-react";
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
  /**
   * ‏`icon` מרנדר את הכפתור כ-`+` בלבד, בשורה אחת עם השדה.
   *
   * נדרש במסך התחומים, שבו ההוספה היא הקלדת שם ותו לא — כלומר תווית
   * מלאה ("הוסף תחום") מתחת לשדה בן מילה אחת גוזלת שורה שלמה בלי להוסיף
   * מידע. **‏`buttonLabel` נשאר חובה גם במצב הזה** והופך ל-`aria-label`:
   * השם הנגיש אינו יורד יחד עם התווית הגלויה (§ אייקונים), ולכן גם
   * `getByRole("button", { name: "הוסף תחום" })` ממשיך לפתור.
   */
  buttonStyle?: "label" | "icon";
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
  buttonStyle = "label",
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

  /** במצב `icon` השדה והכפתור יושבים בשורה אחת; במצב `label` — בטור. */
  const iconMode = buttonStyle === "icon";

  const field = (
    /*
     * ‏`min-w-0 flex-1` נדרש בשורה בלבד: בלעדיו ה-`Field` מתכווץ לרוחב
     * התווית ומשאיר את השדה צר מהערך שמקלידים בו. הוא לא מוחל על המצב
     * הטורי כדי שהשדה לא יימתח מעבר ל-`FORM_PANEL_WIDTH`.
     */
    <Field label={label} className={iconMode ? "min-w-0 flex-1" : undefined}>
      {/*
       * **‏`disabled={busy}` על השדה, ולא רק על הכפתור.**
       *
       * זה תיקון של באג אמיתי ולא הקשחה תיאורטית: `busy` כולל
       * `!hydrated`, ועד כאן השדה היה פתוח בזמן שהמטפלים טרם חוברו. מי
       * שהקליד לפני ההידרציה קיבל את הטקסט על המסך לרגע — ואז React
       * איפס אותו ברינדור העוקב, כלומר **ההקלדה נמחקה**. הכפתור, שמושבת
       * גם על `value.trim().length === 0`, נשאר מושבת לנצח: מסך מת.
       *
       * החלון הזה נמדד בפועל בניסוי (עיכוב מלאכותי של ה-chunks): הערך
       * נכתב, ואחרי ההידרציה הוא ריק והכפתור מושבת.
       *
       * הרכיב הזה מגבה **חמישה** מסכי ניהול (אתר · בניין · דירה · תחום ·
       * תגית), ולכן השורה הזו סוגרת את אותו באג בכולם. הערה בקובץ אחר
       * כבר טענה שכל פקדי הקלט במערכת מושבתים עד ההידרציה "כמו כל פקד
       * קלט במערכת" — והטענה הזו פשוט לא הייתה נכונה כאן.
       */}
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        size="compact"
        disabled={busy}
      />
    </Field>
  );

  const button = (
    /*
     * ‏`compact` כמו השדה שלצדו או שמעליו. קודם השדה היה 32px והכפתור
     * ‏36px — שני פקדים בערימה אחת בשני גבהים, שנקראים כשתי מערכות ולא
     * כטופס אחד. מ-0.7 זהו גם הגובה בטלפון: רצפת המגע בוטלה (§ אזורי מגע).
     */
    <Button
      size="compact"
      onClick={submit}
      disabled={busy || value.trim().length === 0}
      className={iconMode ? "shrink-0" : "self-start"}
      aria-label={iconMode ? buttonLabel : undefined}
    >
      {iconMode ? <Plus className="size-3" aria-hidden="true" /> : buttonLabel}
    </Button>
  );

  return (
    <div className={surface === "card" ? cardClasses(layout) : layout}>
      {iconMode ? (
        // ‏`items-end` ולא `items-center`: התווית מוסיפה גובה מעל השדה,
        // ומרכוז היה מיישר את הכפתור לאמצע הזוג ולא לפקד שלצדו.
        <div className="flex items-end gap-2">
          {field}
          {button}
        </div>
      ) : (
        <>
          {field}
          {button}
        </>
      )}
      {error ? <FormError>{error}</FormError> : null}
    </div>
  );
}
