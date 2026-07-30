import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { twMerge } from "tailwind-merge";

/**
 * הכפתור של המערכת — מקור אמת אחד.
 *
 * **למה פרימיטיב ולא מחלקות Tailwind בכל מקום.** לפני החילוץ הכפתור הראשי
 * הופיע בשבע וריאציות: גובה 11/12/14, ריפוד 3/4/6, משקל medium/semibold,
 * ‏radius xl/lg, ומצב `disabled` שלעיתים חסר לגמרי או `opacity-40` במקום 60.
 * זו אינה רשלנות של מי שכתב — זו התוצאה הבלתי נמנעת של 18 עמודים שכל אחד
 * מהם מרכיב את הכפתור מחדש מזיכרון. הספציפיקציה ב-`docs/DESIGN.md` § Components
 * יכולה להיאכף רק אם יש מקום אחד שמממש אותה.
 *
 * הכפתור אינו `"use client"`: הוא רק מרכיב מחלקות ומעביר props. רכיב לקוח
 * שמשתמש בו מסמן את עצמו, ורכיב שרת יכול לרנדר אותו כמו שהוא.
 */

/**
 * `primary` — הפעולה הראשית של המסך. אחת לכל מסך, לכל היותר.
 * `secondary` — פעולה חלופית לצד הראשית.
 * `danger` — פעולה הרסנית שהיא הפעולה הראשית של ההקשר (מחיקת פנייה).
 * `dangerOutline` — פעולה הרסנית שעומדת **לצד** פעולה ראשית ("מחק טיוטה" ליד
 *   "שגר"). היא חייבת להיקרא כהרסנית, אך לא להתחרות בפעולה החיובית שלצדה.
 * `dangerQuiet` — פעולה הרסנית בתוך שורה או כרטיס ("הסר נמען"), שאסור לה
 *   למשוך את העין יותר מהתוכן שהיא פועלת עליו.
 *
 * חמישה ואף לא אחד מעבר: כל אחד מהם ממופה לשימוש קיים בפועל. וריאנט שנוסף
 * "ליתר ביטחון" הוא הזמנה לסחיפה חדשה.
 */
export type ButtonVariant = "primary" | "secondary" | "danger" | "dangerOutline" | "dangerQuiet";

/**
 * `default` — 48px. פעולה ראשית או פעולה שקשה לבטל.
 * `compact` — 44px, המינימום המוחלט. לפעולות בתוך שורה או כרטיס בלבד,
 *   ולעולם לא כפעולה ראשית של מסך.
 */
export type ButtonSize = "default" | "compact";

const BASE = "inline-flex items-center justify-center disabled:opacity-60";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-fg font-semibold",
  secondary: "border border-border bg-surface text-fg font-medium",
  danger: "bg-danger text-brand-fg font-semibold",
  dangerOutline: "border border-danger bg-surface text-danger font-medium",
  dangerQuiet: "text-danger font-medium",
};

const SIZES: Record<ButtonSize, string> = {
  default: "min-h-12 rounded-xl px-6 text-base",
  compact: "min-h-11 rounded-lg px-4 text-sm",
};

/**
 * מחלקות הכפתור, לאלמנט שאינו `<button>` ואינו `<Link>` של Next.
 *
 * המקרה היחיד בפועל הוא קישור **חיצוני** (וואטסאפ) — `<a>` עם `target="_blank"`.
 * ‏`Link` של Next נועד לניווט פנימי ומנסה לעשות prefetch, ולכן `<a>` רגיל הוא
 * הנכון שם. הפונקציה מאפשרת לו להיראות זהה בלי לשכפל את הספציפיקציה.
 */
export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "default",
  className?: string,
): string {
  return twMerge(BASE, VARIANTS[variant], SIZES[size], className);
}

const classes = buttonClasses;

type Shared = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * **פריסה בלבד** — `self-start`, `flex-1`, `w-full` וכדומה.
   *
   * צבע, גובה, ריפוד ומשקל שייכים ל-variant ול-size; לדרוס אותם כאן פירושו
   * להחזיר בדיוק את הסחיפה שהפרימיטיב נועד לעצור. `twMerge` דואג שדריסה
   * שכן נעשית תיקח אפקט לפי סדר הכתיבה ולא לפי סדר ה-CSS — כלומר לא תיכשל
   * בשקט — אבל היא עדיין חריגה שדורשת הערה שמנמקת אותה.
   */
  className?: string;
  children: ReactNode;
};

export type ButtonProps = Shared & Omit<ComponentProps<"button">, "className" | "children">;

export function Button({
  variant = "primary",
  size = "default",
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={classes(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}

export type ButtonLinkProps = Shared & Omit<ComponentProps<typeof Link>, "className" | "children">;

/**
 * כפתור שהוא ניווט.
 *
 * רכיב נפרד ולא prop בשם `href` על `Button`: `<button>` ו-`<a>` נבדלים
 * בסמנטיקה, בניווט מקלדת ובמה שקורא מסך מכריז. איחודם מאחורי prop אחד מסתיר
 * את ההבדל בדיוק מהמקום שבו הוא חשוב.
 */
export function ButtonLink({
  variant = "primary",
  size = "default",
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link className={classes(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}
