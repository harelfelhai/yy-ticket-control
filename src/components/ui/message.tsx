import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { he } from "@/lib/he";

/**
 * הודעות מצב — מקור אמת אחד לכל מה שהמערכת אומרת למשתמש אחרי פעולה.
 *
 * הרכיבים כאן נולדו אחרי שהתבנית נמצאה ב-**28 מקומות**, ומהם שבעה כבר סטו:
 * `text-sm text-danger` בלי `font-medium`, ואחד אפילו כ-`<span>`. זהו סיפור
 * פער 1 מילה במילה — תבנית שכל קובץ מרכיב מזיכרון, וערכים שנפרדים בשקט.
 *
 * **התבניות מובחנות זו מזו, וההבחנה ביניהן היא העיקר**:
 *
 * | | תפקיד | `role` |
 * |---|---|---|
 * | `FormError` | פעולה נכשלה | `alert` — קוטע, כי המשתמש לחץ וממתין |
 * | `FormNotice` | פעולה הצליחה | `status` — אינו קוטע; הצלחה אינה דחופה |
 * | `Banner` | מצב מתמשך, לא תוצאת לחיצה | `status` |
 * | `PendingNotice` | סבב שרת בעיצומו (צ'יפ צף) | `status` |
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

/**
 * חיווי "מעלה…" בזמן שקובץ בדרך לשרת.
 *
 * **נולד ב-0.6 מפני שהוא כבר היה במוצר שלוש פעמים** — אותן שלוש שורות
 * בדיוק, בשלושת הווריאנטים של בורר המדיה. זהו אותו סיפור של `quiet`
 * ב-`Button` ושל `info` ב-`Banner`: התבנית קיימת, ורק הפרימיטיב לא הכיר
 * אותה. וכאן היה לזה מחיר נוסף — היא כפתה החרגה ברמת **קובץ** באוכף
 * ה-`role="status"`, שכיסתה בדרך גם דברים שלא נועדה להם.
 *
 * ‏`status` ולא `alert`: העלאה שמתקדמת אינה תקלה ואינה דורשת קטיעה.
 * **מוצג בתנאי בלבד** — אלמנט `role="status"` שמרונדר תמיד היה הופך שש
 * בדיקות שמחפשות `getByRole("status")` בלי scope לשגיאת strict-mode.
 */
export function UploadingNotice({ className }: { className?: string }) {
  return (
    <span role="status" className={twMerge("text-sm text-muted", className)}>
      {he.media.uploading}
    </span>
  );
}

/**
 * צ'יפ "טוען…" בזמן סבב שרת של מסך שמצבו חי בכתובת (ספק #39,
 * § FilterBar — חיווי עדכון).
 *
 * ‏`status` ולא `alert`: עדכון שמתקדם אינו תקלה ואינו דורש קטיעה. **מוצג
 * בתנאי בלבד** — כמו `UploadingNotice` ומאותה סיבה. בשונה ממנו יש לו רקע
 * ומסגרת: הוא **צף מעל תוכן קיים** ולא יושב בזרימה, ובלעדיהם היה נבלע
 * בכרטיסים שמתחתיו. המיקום עצמו (`absolute` וכדומה) הוא פריסה, ולכן מגיע
 * מהקורא דרך `className`.
 */
export function PendingNotice({ className }: { className?: string }) {
  return (
    <span
      role="status"
      className={twMerge(
        "rounded-sm border border-border bg-surface px-2 py-1 text-sm text-muted",
        className,
      )}
    >
      {he.common.loading}
    </span>
  );
}

/**
 * הכרזת "טוען…" **לקורא מסך בלבד**, בלי שום ביטוי חזותי.
 *
 * נפרד מ-`PendingNotice` ולא וריאנט שלו: זה צ'יפ שרואים, וזו הכרזה
 * שרק שומעים. שלד טעינה כבר אומר את המצב בעיניים — מעטפות במקום תוכן —
 * ולכן מה שחסר בו הוא בדיוק הערוץ השני, ולא עוד פקד על המסך.
 *
 * **נולד מכשל אוכף.** שלד הלוח (ספק #39) כתב `role="status"` ביד, מפני
 * שאף פרימיטיב לא כיסה את המקרה — אותו סיפור של `quiet` ב-`Button`,
 * ‏`info` ב-`Banner` ו-`UploadingNotice` כאן: וריאנט חסר דוחף כתיבה
 * ידנית, והאוכף תופס את התסמין. הבית הזה הוא התיקון.
 */
export function LoadingStatus() {
  return (
    <span role="status" className="sr-only">
      {he.common.loading}
    </span>
  );
}

export type BannerTone = "success" | "warning" | "info";

/**
 * ‏`info` (שנקרא `brand` עד המעבר לגרפיט) נוסף בסבב 0.4 (פער 34), ומאותה סיבה שבה `quiet` נוסף ל-`Button`
 * בדיעבד: **וריאנט חסר דוחף כתיבה ידנית.** באנר המיקוד בלוח נכתב ביד עם
 * `bg-brand/5` — ערך שקיפות שאינו קיים בתקן כלל — ובלי `role`, כלומר אילם
 * לקורא מסך. השקיפות מיושרת כאן ל-`/10` של שאר הטונים (§ מצבי רקע חלשים).
 */
const BANNER_TONES: Record<BannerTone, string> = {
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  info: "border-info/30 bg-info/10 text-info",
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
      className={twMerge("rounded-md border p-2 text-sm font-medium", BANNER_TONES[tone], className)}
    >
      {children}
    </p>
  );
}
