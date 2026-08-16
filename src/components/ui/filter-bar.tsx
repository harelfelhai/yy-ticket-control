"use client";

import { type ReactNode, useId, useState } from "react";
import { twMerge } from "tailwind-merge";
import { chipClasses } from "@/components/ui/chip";
import { Input, type InputProps, Select, type SelectProps } from "@/components/ui/field";
import { he } from "@/lib/he";

/**
 * רצועת מסננים — מקור אמת אחד ללוח ולחיפוש.
 *
 * הרצועה פתרה שתי בעיות שהצטברו:
 *
 * **1. עלות המסך בנייד.** שישה בוררים ברצועה גלויה תפסו כשליש מהמסך הראשון
 * של הלוח — המסך שמנהל העבודה פותח בבוקר ושבו הוא רוצה לראות פניות, לא
 * פקדים. בנייד הרצועה מקופלת מאחורי מתג, ובמסך רחב היא נשארת גלויה כי שם
 * אין מחסור בגובה.
 *
 * **2. קיפול אינו הסתרה.** מסנן פעיל משנה את מה שהמשתמש רואה, ואם המתג
 * נראה סתום — לוח חסר נקרא כאובדן נתונים. לכן `activeCount` מוצג על המתג,
 * והרצועה **נפתחת מאליה** כשמגיעים למסך מסונן (למשל דרך קישור שמישהו שלח).
 */
interface FilterBarProps {
  /**
   * מספר המסננים הפעילים כרגע. הקורא גוזר אותו מהכתובת — הוא היחיד שיודע
   * אילו פרמטרים הם מסננים ואילו הם מצב תצוגה (`view`, `focus`).
   */
  activeCount: number;
  /**
   * פקדים שנשארים גלויים גם כשהרצועה מקופלת. שם מקומם של דברים שאינם
   * מסננים — מתג התצוגה (טבלה/כרטיסים) הוא מצב תצוגה ולא סינון, וכך גם
   * "נקה מסננים", שהוא פעולה על הרצועה ולא פריט בתוכה.
   */
  trailing?: ReactNode;
  children: ReactNode;
}

export function FilterBar({ activeCount, trailing, children }: FilterBarProps) {
  /**
   * ‏`useState` ולא `useSearchParams` ישירות: אחרי הטעינה הראשונה המצב שייך
   * למשתמש. אילו הוא היה נגזר מהכתובת בכל רינדור, ניקוי המסנן האחרון היה
   * סוגר את הרצועה בזמן שהמשתמש עובד בתוכה.
   */
  const [open, setOpen] = useState(activeCount > 0);
  const panelId = useId();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium md:hidden"
      >
        {he.board.filters}
        {activeCount > 0 ? (
          <>
            {/* המספר לבדו קריא בעין אך חסר-משמעות באוזן, ולכן הוא מוסתר
                מהקורא והמשפט המלא נמסר לו בנפרד. */}
            {/* ‏`min-w-5` + `px-1` הופכים את הצ׳יפ לעיגול מונה: ספרה בודדת
                אינה אמורה להימתח לרוחב של מילה. */}
            <span aria-hidden className={chipClasses("brand", "solid", "default", "min-w-5 justify-center px-1")}>
              {activeCount}
            </span>
            {/* ‏`{" "}` מפורש: `gap-2` מפריד את הפקדים בעין, אבל השם הנגיש
                נבנה משרשור טקסט — ובלי הרווח הוא יוצא "מסננים2 פעילים". */}{" "}
            <span className="sr-only">{he.board.activeFilters(activeCount)}</span>
          </>
        ) : null}
      </button>

      {/*
        ‏`order-last` בנייד בלבד: כשהרצועה פתוחה היא יורדת לשורה משלה
        (`w-full`), ובלעדיו היא הייתה דוחפת את פקדי ה-`trailing` אל מתחתיה
        ומרחיקה אותם ממתג המסננים. במסך רחב הפאנל חוזר לסדר ה-DOM ומשתלב
        באותה שורה עם שאר הפקדים.
      */}
      <div
        id={panelId}
        className={twMerge(
          "order-last w-full flex-wrap items-center gap-2 md:order-none md:flex md:w-auto",
          open ? "flex" : "hidden",
        )}
      >
        {children}
      </div>

      {trailing}
    </div>
  );
}

/**
 * בורר בתוך רצועת מסננים.
 *
 * הוא קיים כדי לבטל את `w-full` של הפקד: בטופס שדה ממלא את עמודתו, אבל
 * ברצועה `w-full` הופך כל בורר לשורה שלמה — שישה בוררים נערמו זה תחת זה
 * במקום להצטופף בשורה. הרוחב כאן נגזר מהאפשרות הארוכה ביותר, וחסום
 * ב-176px כדי ששם ספק ארוך לא ימתח בורר יחיד על פני כל הרצועה.
 */
export function FilterSelect({ className, ...rest }: SelectProps) {
  return <Select size="compact" className={twMerge("w-auto max-w-44", className)} {...rest} />;
}

export type FilterDateProps = { label: ReactNode } & Omit<InputProps, "type" | "size">;

/**
 * שדה תאריך ברצועת המסננים.
 *
 * **הפקד הוא נייטיב, בהחלטה ולא בהיעדר החלטה.** `<input type="date">` פותח
 * את בורר התאריך של מערכת ההפעלה, והמכשיר העיקרי כאן הוא טלפון בשטח —
 * גלגלת מערכת עם אצבע בכפפה עדיפה על כל לוח שנה שנכתב ב-React, שגם היה
 * מאות שורות של ניווט מקלדת ומיקוד לכוד עבור שני שדות במסך אחד.
 *
 * **אייקון הלוח של הדפדפן נשאר כפי שהוא, ואינו מיושר ל-`.control-chevron`.**
 * זה נראה כמו סתירה לפער 17 — שם הנייטיב חוקה את המותאם — אבל ההבדל מכריע:
 * אצל `<select>` הסתרת החץ עולה **במראה בלבד**, ואילו כאן
 * `::-webkit-calendar-picker-indicator` הוא (א) webkit בלבד, ו-(ב) **היעד
 * היחיד שפותח את הבורר בדסקטופ**. הסתרתו שוברת את הפקד. חריג בעל גבול,
 * לא רשלנות.
 *
 * **התווית גלויה, בשונה מהבוררים שלצדו.** בורר נושא את משמעותו באפשרות
 * ברירת המחדל ("כל הבניינים"), ולכן `aria-label` מספיק לו. שדה תאריך ריק
 * מציג מסכת פורמט בלבד, ואי אפשר לדעת ממנה מי "מתאריך" ומי "עד תאריך".
 *
 * הרכיב קיים כדי שלחריג יהיה **בית אחד שאפשר לסרוק** — ראו
 * `tests/unit/primitives.test.ts`. חריג שאין לו בית נעקף, לא נאכף.
 */
export function FilterDate({ label, className, ...rest }: FilterDateProps) {
  return (
    <label className="flex items-center gap-1 text-sm">
      {label}
      <Input
        type="date"
        size="compact"
        className={twMerge("w-auto max-w-44", className)}
        {...rest}
      />
    </label>
  );
}
