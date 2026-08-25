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
 * `default` — שדה בטופס.
 * `compact` — פקד בשורה צפופה, למשל מסננים.
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
/**
 * **‏`block` אינו קישוט.** ‏`<input>` ו-`<textarea>` הם `inline-block` עם
 * ‏`vertical-align: baseline` כברירת מחדל, כלומר הדפדפן משאיר מתחתיהם
 * מרווח של קו-בסיס. כשפקד כזה יושב בשורה לצד כפתורים, העטיפה שלו מיושרת
 * לתחתית — **והפקד עצמו יושב מעל תחתיתה**.
 *
 * נמדד בקומפוזר: שלושת האלמנטים בגובה 44.0px **זהה**, ותחתית התיבה
 * ב-357 מול 364 של הכפתורים — הפרש של 7px שנראה כמו "לא באותו גובה"
 * ואינו הפרש גובה כלל. אף בדיקה לא רואה את זה: הן מודדות `height`.
 */
const CONTROL_BASE =
  "block w-full rounded-sm border border-border bg-surface text-base disabled:opacity-60";

/**
 * **הגובה תלוי במכשיר, ה-radius אינו תלוי בכלום.**
 *
 * ‏36px/32px בעכבר ו-44px במגע, מאותו נימוק שבכפתור: רצפת המגע מדברת על
 * אצבע, לא על סמן. ה-radius ירד ל-4px בכל הגדלים — שדה ופקד מסנן שיושבים
 * זה לצד זה נבדלו קודם גם בעיגול, וזו הבחנה שאיש לא התכוון אליה.
 */
const CONTROL_SIZES: Record<ControlSize, string> = {
  default: "min-h-8 px-2 touch:min-h-11 touch:px-3",
  compact: "min-h-7 px-2 touch:min-h-11 touch:px-3",
};

/**
 * גדלי `Textarea` — **טבלה נפרדת, ולא `p-2` בבסיס פלוס דריסה.**
 *
 * ‏`p-2` ו-`py-0` אינן דורסות זו את זו: `twMerge` משאיר את שתיהן, והמנצח
 * נקבע לפי סדר הפליטה של Tailwind ולא לפי סדר הכתיבה. זה עובד היום ונשבר
 * בשקט ביום שהסדר ישתנה — ולכן כל גודל מחזיק את הריפוד המלא שלו.
 *
 * **‏`py-0` בעכבר ו-`touch:py-2` במגע, וזו מדידה ולא טעם.** שורת `text-base`
 * היא 25.6px (גובה שורה 1.6, ‏`globals.css`), ועם `p-2` קבוע התיבה יוצאת
 * ‏≈43.6px — כלומר **‏11px גבוהה מהכפתור הקומפקטי שלצדה בקומפוזר**, וזה
 * בדיוק הפער שדווח. ‏`py-0` מחזיר אותה ל-28px; במגע `py-0` היה מדביק את
 * הטקסט לראש קופסה של 44px, מפני ש-`<textarea>` מיישר לראש ולא למרכז.
 */
const TEXTAREA_SIZES: Record<ControlSize, string> = {
  default: "p-2",
  compact: "min-h-7 px-2 py-0 touch:min-h-11 touch:px-3 touch:py-2",
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
 * ‏`p-2` ולא `px-2` בלבד: בשדה רב-שורות הטקסט מתחיל בשורה הראשונה, וריפוד
 * אנכי אפס מדביק אותו לגבול העליון.
 *
 * **‏`size` כן משפיע כאן מ-0.6, בניגוד למה שנכתב קודם.** ההנחה הייתה
 * ש"הגובה נקבע מ-`rows`" ולכן הגודל אינו רלוונטי — והיא נכונה רק כשאיש
 * אינו צריך שהתיבה תסכים בגובהה עם משהו אחר. בקומפוזר היא חייבת: התיבה
 * והכפתורים שלצדה הם שורה אחת. ראו `TEXTAREA_SIZES`.
 */
export function Textarea({ size = "default", invalid, className, ...rest }: TextareaProps) {
  return (
    <textarea
      className={twMerge(CONTROL_BASE, TEXTAREA_SIZES[size], invalid && "border-danger", className)}
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
