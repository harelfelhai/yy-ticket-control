"use client";

import { X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { twMerge } from "tailwind-merge";
import { Button } from "@/components/ui/button";
import { cardClasses } from "@/components/ui/card";
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
  /**
   * `center` — פאנל ממורכז (ברירת מחדל).
   * `bottom` — **גיליון תחתון**, לתפריט קצר של פעולות.
   *
   * **ההבדל הוא בכיסוי בלבד** (`items-end` מול `items-center`); הפאנל זהה,
   * כולל `rounded-md` בארבע הפינות — כלומר הגיליון **צף מעל הקצה ואינו
   * נצמד אליו**. גיליון צמוד-קצה היה דורש `rounded-none` בשתי פינות, שאינו
   * בסקאלה (§ Shapes).
   *
   * **למה הוא עובר דרך `Dialog` ולא נבנה כפאנל מוחלט:** לא בגלל הצל — אותו
   * ‏§ Elevation כבר מתיר — אלא בגלל ה-**Portal**. הקומפוזר שפותח אותו יושב
   * ברצועה דביקה עם `z-[1]`, כלומר בהקשר ערימה, ופאנל שנפתח בתוכה נלכד בו
   * בדיוק כפי שקרה לדיאלוג "פרטים" (ראו ההסבר על ה-Portal למטה).
   *
   * ‏`DIALOG_SCROLL_BODY` נכתב לפאנל ממורכז; תוכן ארוך ב-`bottom` יגלוש
   * כלפי מעלה מחוץ למסך, ולכן הוא שמור לתפריט קצר.
   */
  placement?: "center" | "bottom";
  children: ReactNode;
}

/** מה שניתן למקד — הבסיס למלכודת המיקוד ולמיקוד הראשוני */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  title,
  onClose,
  width = PANEL_WIDTH,
  placement = "center",
  children,
}: DialogProps) {
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

  /**
   * הפאנל נתלה על `<body>` ולא במקום שבו נכתב — וזו אינה נוחות.
   *
   * ‏`z-20` של הכיסוי (§ אלמנט דביק, סולם ה-z) מבטיח "מעל הכול" רק כל עוד
   * הוא נמדד מול אותו שורש. אלמנט אב עם `z-[1]` — למשל הפס העליון הדביק
   * של מסך הפנייה — יוצר **הקשר ערימה** חדש, וכל מה שבתוכו נלכד בו: הדיאלוג
   * צויר מתחת לרצועה התחתונה, וכפתור "מחק פנייה" שבתוכו לא היה לחיץ. בדיקת
   * E2E תפסה זאת כ-"subtree intercepts pointer events".
   *
   * ‏Portal מוציא את הפאנל מכל הקשר ערימה של אבותיו, ולכן הסולם המתועד
   * הופך לנכון בפועל ולא רק בכוונה. המיקום ב-React tree אינו משתנה, ולכן
   * ה-`children` וההקשרים ממשיכים לעבוד כרגיל.
   *
   * ‏`document` נבדק כי הרכיב עשוי להיטען בשרת; בפועל הוא מרונדר רק אחרי
   * אינטראקציה, ולכן הענף הזה אינו נתפס בשום מסלול קיים.
   */
  if (typeof document === "undefined") return null;

  return createPortal(
    /*
     * הכיסוי סוגר בלחיצה, אבל **רק כשהלחיצה עליו עצמו** ולא על ילד שלו —
     * אחרת גרירת בחירה שמסתיימת מחוץ לפאנל הייתה סוגרת אותו.
     *
     * ‏`p-4` כאן **אינו** ריפוד עמוד ולכן אינו `PAGE_X`: זה השוליים שבין
     * הפאנל הצף לקצה המסך, והוא היחיד שמונע מפאנל בטלפון צר להיצמד
     * לשפה. ריפוד עמוד נמדד מול `PAGE_BLEED` של רצועות דביקות; לכיסוי
     * ‏`fixed` אין רצועה ואין בליטה.
     */
    <div
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className={`fixed inset-0 z-20 flex justify-center bg-fg/50 p-4 ${
        placement === "bottom" ? "items-end" : "items-center"
      }`}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal
        aria-labelledby={titleId}
        tabIndex={-1}
        /*
         * ‏`cardClasses` ולא גיאומטריית כרטיס שנכתבת כאן בשנית.
         *
         * מה שישב כאן — `rounded-2xl border border-border bg-surface p-4` — היה
         * העתק תו-בתו של הכרטיס, ולכן הוא **פספס את סבב הצפיפות**: הכרטיס ירד
         * ל-6px עיגול ול-12px ריפוד, והפאנל נשאר על 16px ועל 16px. עותק אינו
         * יורש, וזו בדיוק הסיבה שגיאומטריה יושבת בפונקציה אחת.
         *
         * ‏`shadow-lg` נוסף מבחוץ ואינו נכנס לכרטיס: התקן קובע הפרדה במסגרת
         * ולא בצל (§ Elevation), והדיאלוג הוא החריג היחיד — הוא **צף** מעל
         * כיסוי ומעל תוכן, ושם הצל אומר "זה למעלה", לא "זה מוגבה מעט".
         */
        className={twMerge(cardClasses(), "shadow-lg", width)}
      >
        {/* הכותרת אינה קישוט: היא השם הנגיש של הפאנל. בלעדיה קורא מסך
            מכריז על אזור אנונימי באמצע העמוד. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {/* כותרת פאנל היא כותרת **תיאורית** לפי הסקאלה, ולא גודל שהרכיב
              קובע לעצמו — ראה `docs/DESIGN.md` § Typography.

              ‏`flex-1` ירד ממנה **ואינו חוזר**: הוא מותח את ה-`<h2>` על כל
              רוחב הפאנל, כלומר `justify-between` בשם אחר, ומה שנמתח בו הוא
              **התווית**. זו הצורה שהאוכף ב-`layout-guards` תופס, ובצדק. */}
          <h2 id={titleId} className={TITLE_DESCRIPTIVE}>
            {title}
          </h2>
          {/*
           * **כפתור סגירה גלוי** — "לחץ מחוץ" אינו אפשרות שמישהו לומד מעצמו.
           *
           * ‏`ms-auto` **על הכפתור** הוא מנגנון אחר מ-`flex-1` על הכותרת,
           * ולא עקיפה שלו: הכותרת נשארת ברוחב תוכנה, והפקד הוא זה שזז. וזה
           * גם אינו חידוש — זהו הדפוס שכבר במוצר (כפתור "פרטים" במסך
           * הפנייה): **מוצא נדחף לקצה מפני שהוא מתייחס למיכל ולא לכותרת
           * שלצדו**. § Layout מחזיק את החריג הזה בכתב מ-0.6.
           *
           * **השם הנגיש הוא `he.common.close` בדיוק.** ‏`world.ts` ו-
           * `ticket-screen.ts` מחפשים `{ name: "סגור", exact: true }` בכל
           * זרימה שנוגעת בקישורי הגישה, ו-`exact` פירושו שאין רשת ביטחון
           * של תת-מחרוזת: "סגור פאנל" היה שובר את שתיהן בצוואר בקבוק.
           *
           * רצפת המגע מגיעה מהפרימיטיב (`touch:min-h-11`) ואינה מחלקה שמישהו
           * צריך לזכור — § Dialog דורש 44px גם מכפתור הסגירה.
           */}
          <Button
            variant="secondary"
            size="compact"
            onClick={close}
            aria-label={he.common.close}
            className="ms-auto shrink-0"
          >
            <X className="size-3" aria-hidden="true" />
          </Button>
        </div>

        {children}
      </div>
    </div>,
    document.body,
  );
}
