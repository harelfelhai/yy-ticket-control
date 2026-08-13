"use client";

import { type ReactNode, useCallback, useEffect, useId, useRef } from "react";
import { twMerge } from "tailwind-merge";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/he";
import { PANEL_WIDTH, TITLE_DESCRIPTIVE } from "@/lib/ui";

/**
 * פאנל צף מעל התוכן — מקור אמת אחד.
 *
 * זהו הרכיב היחיד במערכת שלוכד את המשתמש: כל עוד הוא פתוח, מה שמאחוריו
 * אינו זמין. לכן ארבע ההתנהגויות שלמטה אינן שיפורים אלא תנאי קיום, ולכן
 * הן יושבות כאן ולא בכל אתר קריאה — כלל שצריך לזכור להוסיף בכל מקום הוא
 * כלל שיישכח במקום השני. ראה `docs/DESIGN.md` § Dialog.
 *
 * **למה לא `<dialog>` נייטיב.** ‏`showModal()` נותן מלכודת מיקוד ו-
 * `::backdrop` בחינם, ושם בדיוק הוא נשבר: ה-`::backdrop` אינו יורש את
 * משתני ה-`@theme`, כלומר הכיסוי היה נכתב כ-hex בקוד רכיב — בניגוד לכלל
 * המפורש בתקן. העלות מפורשת: המיקוד והמקלדת מנוהלים כאן ביד.
 */

interface DialogProps {
  title: string;
  onClose: () => void;
  /** רוחב מ-`src/lib/ui.ts`. ברירת המחדל היא פאנל ממורכז (448px). */
  width?: string;
  children: ReactNode;
}

/** מה שניתן למקד — הבסיס למלכודת המיקוד ולמיקוד הראשוני */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ title, onClose, width = PANEL_WIDTH, children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  /**
   * לאן המיקוד חוזר בסגירה.
   *
   * נלכד ברינדור הראשון ולא בעת הסגירה: עד אז האלמנט שפתח את הפאנל עשוי
   * כבר לא להיות ב-DOM, והמיקוד היה נופל ל-`<body>` — כלומר קורא מסך
   * מתחיל מחדש מראש העמוד אחרי כל סגירה.
   */
  const openerRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    // המיקוד נכנס פנימה מיד: בלעדיו Tab ממשיך לגלול את הדף שמאחור, והפאנל
    // נראה מודאלי אבל אינו מתנהג ככזה.
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panelRef.current)?.focus();

    return () => openerRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }

      if (event.key !== "Tab") return;

      // מלכודת מיקוד: Tab מהאחרון חוזר לראשון, ו-Shift+Tab להפך.
      const items = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close]);

  return (
    // הכיסוי סוגר בלחיצה, אבל **רק כשהלחיצה עליו עצמו** ולא על ילד שלו —
    // אחרת גרירת בחירה שמסתיימת מחוץ לפאנל הייתה סוגרת אותו.
    <div
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="fixed inset-0 z-20 flex items-center justify-center bg-fg/50 p-4"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal
        aria-labelledby={titleId}
        tabIndex={-1}
        className={twMerge("rounded-2xl border border-border bg-surface p-4 shadow-lg", width)}
      >
        {/* הכותרת אינה קישוט: היא השם הנגיש של הפאנל. בלעדיה קורא מסך
            מכריז על אזור אנונימי באמצע העמוד. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {/* כותרת פאנל היא כותרת **תיאורית** לפי הסקאלה, ולא גודל שהרכיב
              קובע לעצמו — ראה `docs/DESIGN.md` § Typography. */}
          <h2 id={titleId} className={`flex-1 ${TITLE_DESCRIPTIVE}`}>
            {title}
          </h2>
          {/* כפתור סגירה גלוי — "לחץ מחוץ" אינו אפשרות שמישהו לומד מעצמו. */}
          <Button variant="secondary" size="compact" onClick={close}>
            {he.common.close}
          </Button>
        </div>

        {children}
      </div>
    </div>
  );
}
