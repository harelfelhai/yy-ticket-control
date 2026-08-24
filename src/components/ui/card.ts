import { twMerge } from "tailwind-merge";

/**
 * הכרטיס של המערכת — מקור אמת אחד.
 *
 * **ההפרדה היא במסגרת ולא בצל.** צל אינו נראה בשמש ישירה, וזהו תנאי העבודה
 * של המשתמש העיקרי. לכן `border border-border` על `bg-surface` מעל ה-`bg`
 * האפור-קר של העמוד; ראו `docs/DESIGN.md` § Elevation.
 *
 * **פונקציית מחלקות ולא רכיב, בניגוד ל-`Button`.** הכרטיס אינו אלמנט אחד:
 * הוא מופיע כ-`<section>` (14 מקומות), `<li>`, `<p>`, `<div>` ו-`<Link>`.
 * רכיב עם `as` היה מסתיר את התגית הסמנטית מאחורי prop בדיוק במקום שבו היא
 * נבחרת בכוונה — ומקשה על הטיפוסים של `<Link>` בלי להחזיר דבר.
 */

/**
 * `default` — כרטיס תוכן רגיל.
 * `danger` — **הודעה שחייבת להיראות**, העומדת בפני עצמה: מסגרת מלאה ורקע
 *   מוצלל.
 * `dangerOutline` — **פריט ברשימה** שמצבו חריג (טיוטה שחוסמת שיגור). מסגרת
 *   מלאה אך **משטח רגיל**: ברשימת כרטיסים כל הפריטים חולקים משטח אחד, וזה
 *   מה שמאפשר סריקה מהירה; רק המסגרת מקודדת מצב. כרטיס מוצלל בתוך רשימה
 *   נקרא כסוג אחר של אובייקט ולא כאותו אובייקט במצב אחר.
 * `dangerQuiet` — אזור מסוכן שהמשתמש **כבר נמצא בו** בכוונה (אישור מחיקה).
 *   מסגרת חלשה: הוא יודע איפה הוא, והמסגרת רק מתחמת.
 * `success` — סיכום פעולה שהצליחה.
 *
 * אין `warning`: אף כרטיס במערכת אינו משתמש בו. וריאנט שנוסף מראש הוא
 * הפשטה לתרחיש שלא קיים. השמות מקבילים בכוונה לאלה של `Button` — אותה
 * הבחנה בין "מלא", "מסגרת בלבד" ו"שקט", ואותו אוצר מילים בכל הפרימיטיבים.
 */
export type CardTone = "default" | "danger" | "dangerOutline" | "dangerQuiet" | "success";

/**
 * `compact` — 8px. כרטיס בתוך רשימה צפופה (שורת ליקוי בהזנה מרוכזת).
 * `default` — 12px. כרטיס במסך.
 * `roomy` — 16px. פאנל יחיד על מסך ריק (התחברות, קישור שפג).
 *
 * כל השלושה ירדו דרגה בסבב הצפיפות. ‏`roomy` נשאר קיים ולא בוטל: פאנל
 * התחברות על מסך ריק הוא המקרה היחיד שבו מרווח הוא התוכן.
 */
export type CardPadding = "compact" | "default" | "roomy";

/**
 * ‏`rounded-md` (‏6px) — דרגה אחת מעל הפקדים (4px) ולא ארבע כמו קודם (16px).
 *
 * ההיררכיה נשמרת: מיכל מעוגל מעט יותר ממה שיושב בתוכו, כך שכרטיס נקרא
 * כמשטח וכפתור נקרא כפקד. מה שהשתנה הוא הסקאלה עצמה — 16px על כרטיס בתוך
 * רשימה צפופה נראה כמו אריח באפליקציה, לא כשורה בטבלת עבודה.
 */
const BASE = "rounded-md border";

const TONES: Record<CardTone, string> = {
  default: "border-border bg-surface",
  danger: "border-danger bg-danger/5",
  dangerOutline: "border-danger bg-surface",
  dangerQuiet: "border-danger/40 bg-danger/5",
  success: "border-success/40 bg-success/10",
};

const PADDINGS: Record<CardPadding, string> = {
  compact: "p-2",
  default: "p-3",
  roomy: "p-4",
};

interface CardOptions {
  tone?: CardTone;
  padding?: CardPadding;
}

/**
 * @param layout מחלקות **פריסה בלבד** — `flex flex-col gap-2` וכדומה.
 *   הכרטיס אינו קובע פריסה פנימית בכוונה: הוא מופיע גם כערימה אנכית, גם
 *   כשורה עם פעולה בקצה, וגם כעטיפה של פסקה אחת.
 */
export function cardClasses(layout?: string, { tone, padding }: CardOptions = {}): string {
  return twMerge(BASE, TONES[tone ?? "default"], PADDINGS[padding ?? "default"], layout);
}
