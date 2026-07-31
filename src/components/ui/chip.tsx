import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

/**
 * הצ׳יפ של המערכת — מקור אמת אחד.
 *
 * לפני החילוץ היו שלוש משפחות צ׳יפים עם שלוש סקאלות ריפוד שונות:
 * `px-2.5 py-0.5` (סטטוס), `px-3 py-1.5` (תגית), `px-2 py-0.5` (תג התראה).
 * שלושתן נכתבו בנפרד ואף אחת לא הייתה שגויה בפני עצמה — הן פשוט לא ידעו
 * זו על זו.
 *
 * **הריפוד כאן הוא החריג המאושר היחיד לסקאלת ה-4px** (`docs/DESIGN.md`
 * § Chip): ריפוד של 12px/4px מנפח את הצ׳יפ עד כדי שבירת שורת המטא-דאטה
 * בכרטיס. החריג מוגבל לרכיב הזה, וזו הסיבה שהוא רכיב.
 */

/**
 * הצבע נגזר ממשמעות ולא מאסתטיקה. מנהל עבודה סורק את הלוח בשמש ובמהירות,
 * והצבע הוא מה שהוא קולט לפני הטקסט:
 * `neutral` — מצב ללא דחיפות ובלי שקרה דבר ("נשלח").
 * `neutralStrong` — גם הוא ללא דחיפות, **אבל משהו קרה**: "נצפה" אומר
 *   שהקבלן באמת פתח. אותו גוון, טקסט מלא במקום דהוי. ההבחנה נשמרת כאן
 *   כי איחודה עם `neutral` היה מוחק את ההבדל בין "שלחתי" ל"הוא ראה".
 * `brand` — תגית או שיוך. `success` — הסתיים.
 * `warning` — ממתין להכרעה. `danger` — עבודה עצורה.
 */
export type ChipTone = "neutral" | "neutralStrong" | "brand" | "success" | "warning" | "danger";

/**
 * `soft` — רקע דהוי ומסגרת. ברירת המחדל: הצ׳יפ מוסר מידע ואינו פעולה.
 * `solid` — מילוי מלא. **רק לצ׳יפ שהמשתמש עצמו יצר** (תגית שבחר), שבו
 *   המילוי אומר "זה שלך" ולא "שים לב".
 */
export type ChipVariant = "soft" | "solid";

/**
 * `default` — 12px. מטא-דאטה בכרטיס, תג סטטוס.
 * `large` — 14px. תגית שהיא תוכן בפני עצמו, לרוב עם כפתור הסרה בתוכה.
 */
export type ChipSize = "default" | "large";

const BASE = "inline-flex items-center rounded-full font-medium";

const SOFT: Record<ChipTone, string> = {
  neutral: "border border-border bg-surface text-muted",
  neutralStrong: "border border-border bg-surface text-fg",
  brand: "border border-brand/30 bg-brand/10 text-brand",
  success: "border border-success/30 bg-success/10 text-success",
  warning: "border border-warning/30 bg-warning/10 text-warning",
  danger: "border border-danger/30 bg-danger/10 text-danger",
};

const SOLID: Record<ChipTone, string> = {
  neutral: "bg-muted text-brand-fg",
  neutralStrong: "bg-fg text-brand-fg",
  brand: "bg-brand text-brand-fg",
  success: "bg-success text-brand-fg",
  warning: "bg-warning text-brand-fg",
  danger: "bg-danger text-brand-fg",
};

/** ‏`py-0.5`/`py-1.5` — ראו ההערה על החריג בראש הקובץ. */
const SIZES: Record<ChipSize, string> = {
  default: "gap-1 px-2.5 py-0.5 text-xs",
  large: "gap-1 px-3 py-1.5 text-sm",
};

export function chipClasses(
  tone: ChipTone = "neutral",
  variant: ChipVariant = "soft",
  size: ChipSize = "default",
  className?: string,
): string {
  return twMerge(BASE, variant === "solid" ? SOLID[tone] : SOFT[tone], SIZES[size], className);
}

interface ChipProps {
  tone?: ChipTone;
  variant?: ChipVariant;
  size?: ChipSize;
  /** **פריסה בלבד** — `line-through`, `shrink-0` וכדומה */
  className?: string;
  children: ReactNode;
}

export function Chip({
  tone = "neutral",
  variant = "soft",
  size = "default",
  className,
  children,
}: ChipProps) {
  return <span className={chipClasses(tone, variant, size, className)}>{children}</span>;
}
