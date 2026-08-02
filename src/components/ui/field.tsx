import type { ComponentProps, ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { FormError } from "@/components/ui/message";

/**
 * פקדי הקלט של המערכת — מקור אמת אחד.
 *
 * לפני החילוץ היו 53 פקדים ב-16 צורות מחלקה שונות: גובה 9/11/12, עיגול
 * `lg`/`xl`, חלקם עם `bg-surface` וחלקם בלי, ו-`disabled` ב-50 או ב-60.
 * ארבעה קבצים אף הגדירו קבוע `inputClass`/`selectClass` מקומי משלהם — אותה
 * אינטואיציה נכונה, מיושמת ארבע פעמים עם ארבעה ערכים.
 *
 * הספציפיקציה: `docs/DESIGN.md` § Components.
 */

/**
 * `default` — 48px. שדה בטופס.
 * `compact` — 44px. פקד בשורה צפופה, למשל מסננים.
 */
export type ControlSize = "default" | "compact";

/**
 * **`text-base` בכל הגדלים, גם ב-`compact`.**
 *
 * זו אינה העדפה אסתטית: ספארי ב-iOS **מגדיל את כל העמוד** כשמתמקדים בפקד
 * שגודל הגופן שלו קטן מ-16px, והמשתמש נשאר עם מסך מוגדל ומוזז אחרי כל
 * הקלדה. המכשיר העיקרי כאן הוא טלפון בשטח, ולכן 14px בפקד הוא באג ולא
 * החלטת עיצוב.
 */
const CONTROL_BASE =
  "w-full border border-border bg-surface text-base disabled:opacity-60";

const CONTROL_SIZES: Record<ControlSize, string> = {
  default: "min-h-12 rounded-xl px-3",
  compact: "min-h-11 rounded-lg px-3",
};

/**
 * מחלקות הפקד, לאלמנט שאינו אחד מהרכיבים כאן (למשל `<input type="date">`
 * בתוך שורת מסננים קיימת). עדיף להשתמש ברכיבים.
 */
export function controlClasses(
  size: ControlSize = "default",
  invalid = false,
  className?: string,
): string {
  return twMerge(CONTROL_BASE, CONTROL_SIZES[size], invalid && "border-danger", className);
}

type ControlExtras = {
  size?: ControlSize;
  /** שדה שגוי — מסגרת אדומה. **הודעת השגיאה עצמה חובה בנוסף**, ראו `Field`. */
  invalid?: boolean;
};

/**
 * ‏`size` מוחרג מתכונות ה-HTML המקוריות.
 *
 * ל-`<input>` ול-`<select>` יש תכונת `size` משלהם (רוחב בתווים), והצטלבות
 * שלה עם `ControlSize` מייצרת `never` — כלומר הטיפוס נשבר בלי הודעה מובנת.
 * התכונה המקורית אינה בשימוש בפרויקט, ו-`size` כאן עקבי עם `Button`.
 */
export type InputProps = ControlExtras & Omit<ComponentProps<"input">, "size">;

export function Input({ size = "default", invalid, className, ...rest }: InputProps) {
  return <input className={controlClasses(size, invalid, className)} {...rest} />;
}

export type SelectProps = ControlExtras & Omit<ComponentProps<"select">, "size">;

/**
 * ‏`control-chevron` (ב-`globals.css`) מחליף את חץ הדפדפן בחץ אחד של המערכת.
 *
 * הוא מוגדר ב-CSS ולא כאן, כי ל-`<select>` אין ילדים — אי אפשר לרנדר לתוכו
 * אלמנט. אותה מחלקה בדיוק יושבת על הכפתור של `LearnedSelect`, וזו הדרך
 * היחידה להבטיח ששני הבוררים נראים זהים בכל מנוע דפדפן.
 */
export function Select({ size = "default", invalid, className, ...rest }: SelectProps) {
  return (
    <select className={controlClasses(size, invalid, twMerge("control-chevron", className))} {...rest} />
  );
}

export type TextareaProps = ControlExtras & ComponentProps<"textarea">;

/**
 * ‏`p-3` ולא `px-3` בלבד: בשדה רב-שורות הטקסט מתחיל בשורה הראשונה, וריפוד
 * אנכי אפס מדביק אותו לגבול העליון. `min-h-12` אינו רלוונטי — הגובה נקבע
 * מ-`rows`.
 */
export function Textarea({ size = "default", invalid, className, ...rest }: TextareaProps) {
  return (
    <textarea
      className={twMerge(
        CONTROL_BASE,
        size === "compact" ? "rounded-lg" : "rounded-xl",
        "p-3",
        invalid && "border-danger",
        className,
      )}
      {...rest}
    />
  );
}

interface FieldProps {
  /** תווית גלויה. **לעולם לא placeholder בלבד** — placeholder נעלם בהקלדה. */
  label: ReactNode;
  /** הסבר קבוע שמופיע מראש, לא רק אחרי כישלון */
  hint?: ReactNode;
  /** הודעת שגיאה. מוצגת **בנוסף** למסגרת האדומה ולא במקומה */
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * תווית + פקד + רמז + שגיאה.
 *
 * **הפקד עטוף ב-`<label>` ולא מקושר ב-`htmlFor`/`id`.** העטיפה יוצרת קישור
 * מרומז שאינו דורש מזהה — כלומר גם רכיב שרת יכול לרנדר אותה, בלי `useId`
 * ובלי להפוך ל-`"use client"` רק בשביל תווית.
 *
 * **הרמז והשגיאה יושבים מחוץ ל-`<label>` בכוונה.** טקסט בתוך התווית נכנס
 * לשם הנגיש של הפקד, כך ש-`getByLabel("טלפון")` היה מוצא "טלפון או מייל —
 * חובה" ונכשל. זה עולה לנו ב-`aria-describedby` שאינו מחווט — פשרה מודעת:
 * הרמז נראה למשתמש ונקרא ברצף הקריאה, אך אינו מוכרז כתיאור הפקד.
 */
export function Field({ label, hint, error, className, children }: FieldProps) {
  return (
    <div className={twMerge("flex flex-col gap-1", className)}>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{label}</span>
        {children}
      </label>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      {/* דרך `FormError` ולא JSX משלו — אחרת `Field` הוא העותק העשרים ותשעה */}
      {error ? <FormError>{error}</FormError> : null}
    </div>
  );
}
