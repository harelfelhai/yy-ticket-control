import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

/**
 * הודעות מצב — מקור אמת אחד לכל מה שהמערכת אומרת למשתמש אחרי פעולה.
 *
 * הרכיבים כאן נולדו אחרי שהתבנית נמצאה ב-**28 מקומות**, ומהם שבעה כבר סטו:
 * `text-sm text-danger` בלי `font-medium`, ואחד אפילו כ-`<span>`. זהו סיפור
 * פער 1 מילה במילה — תבנית שכל קובץ מרכיב מזיכרון, וערכים שנפרדים בשקט.
 *
 * **שלוש תבניות ולא אחת**, וההבחנה ביניהן היא העיקר:
 *
 * | | תפקיד | `role` |
 * |---|---|---|
 * | `FormError` | פעולה נכשלה | `alert` — קוטע, כי המשתמש לחץ וממתין |
 * | `FormNotice` | פעולה הצליחה | `status` — אינו קוטע; הצלחה אינה דחופה |
 * | `Banner` | מצב מתמשך, לא תוצאת לחיצה | `status` |
 *
 * **צבע לבדו אינו נגיש ואינו נראה בשמש** — ההודעה היא תמיד גם טקסט.
 */

interface MessageProps {
  /** **פריסה בלבד** (`mt-2` וכדומה) — חוזה זהה ל-`Button.className` */
  className?: string;
  children: ReactNode;
}

/** שגיאת פעולה. */
export function FormError({ className, children }: MessageProps) {
  return (
    <p role="alert" className={twMerge("text-sm font-medium text-danger", className)}>
      {children}
    </p>
  );
}

/** אישור פעולה שהצליחה. */
export function FormNotice({ className, children }: MessageProps) {
  return (
    <p role="status" className={twMerge("text-sm font-medium text-success", className)}>
      {children}
    </p>
  );
}

export type BannerTone = "success" | "warning";

const BANNER_TONES: Record<BannerTone, string> = {
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
};

/**
 * הודעת **מצב מתמשך** — לא תוצאה של לחיצה שהמשתמש עשה עכשיו.
 *
 * "הפנייה הועברה לאישור המנהל" בפורטל, או "שוחזרה טיוטה" בטופס היצירה:
 * שניהם מתארים מצב שהמסך נפתח לתוכו, ולכן הם יושבים על משטח משלהם ולא
 * כשורת טקסט צבועה.
 *
 * **הרכיב מיישר שתי סטיות שהיו בפועל:** מתוך חמישה באנרים, רק אחד נשא
 * `role="status"` — ארבעה היו אילמים לקורא מסך; ואותו אחד נשא מסגרת ב-`/40`
 * בעוד התקן קובע `/30` (§ מצבי רקע חלשים). כאן שניהם מקובעים.
 */
export function Banner({
  tone,
  className,
  children,
}: MessageProps & { tone: BannerTone }) {
  return (
    <p
      role="status"
      className={twMerge("rounded-xl border p-3 text-sm font-medium", BANNER_TONES[tone], className)}
    >
      {children}
    </p>
  );
}
