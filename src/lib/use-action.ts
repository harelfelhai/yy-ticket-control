"use client";

import { useCallback, useState, useTransition } from "react";
import type { ActionResult } from "./action-result";
import { useHydrated } from "./use-hydrated";

/**
 * הפעלת Server Action מצד הלקוח — מקור אמת אחד.
 *
 * **הבעיה שזה פותר.** לכל קריאה ל-Server Action מהדפדפן נלוות שלוש החלטות
 * שאין להן שום קשר לפעולה עצמה, וכולן נכתבו עד היום מחדש בכל קובץ:
 *
 * 1. **מתי הממשק נעול.** `useTransition` מספק `pending`, אבל הנעילה האמיתית
 *    היא `pending || !hydrated` — כפתור שנלחץ לפני שהמטפלים חוברו בולע את
 *    הלחיצה בשקט (ראו `useHydrated`). שני התנאים הם החלטה אחת, ולכן שם אחד.
 * 2. **איפה יושבת השגיאה.** ‏`ActionResult` מחזיר שגיאה כערך ולא כחריגה, ולכן
 *    לכל מסך יש `useState<string | null>` ששמו `error`.
 * 3. **מה קורה בהצלחה.** `if (result.ok) …ניקוי… else setError(result.error)`.
 *
 * שישה-עשר קבצים כתבו את שלושתן מזיכרון, ובשניים מהם — `ticket-actions`
 * ו-`portal-actions` — הפונקציה `run(action, onSuccess)` הייתה זהה **מילה
 * במילה**. זו בדיוק הצורה שבה ערכים נפרדים בשקט (ראו פער 1), והנפרדות כבר
 * קרתה: `tag-access-control` ויתר על בדיקת ה-hydration לגמרי, ושני קבצים
 * נעלו את הממשק על `pending` בלבד.
 *
 * **מה ה-hook הזה אינו.** הוא אינו מנהל טפסים ואינו יודע דבר על השדות, על
 * הוולידציה או על המראה. הוא מחזיק שלושה ערכים ופונקציה אחת. הקומפוזרים
 * נשארו ארבעה קבצים נפרדים בכוונה (§ "לא כל כפילות היא רכיב"), ואותו שיקול
 * חל כאן: מה שחולץ הוא מה שזהה, לא מה שדומה.
 */

/**
 * ‏`void` בטיפוס התוצאה אינו רשלנות אלא **המסלול של פעולה שמנווטת**:
 * `redirect()` קוטע את ה-action באמצע, כך שבהצלחה שום ערך אינו מגיע ללקוח
 * ומה שממתין ב-`await` הוא `undefined`. כשל, לעומת זאת, כן חוזר כערך —
 * ולכן `undefined` פירושו הצלחה.
 */
type ActionCall<T> = () => Promise<ActionResult<T> | void>;

export interface ActionState {
  /** הממשק נעול: הפעולה רצה, או שה-hydration טרם הסתיים */
  busy: boolean;
  /** הפעולה רצה כרגע — בלי תנאי ה-hydration. נחוץ רק להודעת "מנסה שוב" */
  pending: boolean;
  /** הודעת השגיאה האחרונה שנועדה למשתמש, או `null` */
  error: string | null;
  setError: (error: string | null) => void;
  /**
   * המסלול הרגיל: מנקה שגיאה, מריץ, ובהצלחה מפעיל את `onSuccess`.
   */
  run: <T>(action: ActionCall<T>, onSuccess?: (data: T) => void) => void;
  /**
   * פתח מילוט לזרימות רב-שלביות, ובכוונה מצומצם למי שבאמת צריך אותו.
   *
   * שני מסכים מריצים **כמה פעולות ברצף בתוך מעבר אחד**, עם יציאה מוקדמת
   * ביניהן ועם דגל שמירה מקומית שיש להחזיר לאחור בכשל. הם אינם `action`
   * בודדת עם `onSuccess`, וכפייתם לתוך `run` הייתה מחזירה בדיוק את שפת
   * התצורה שנדחתה בפער 27.
   *
   * גם הם עוברים דרך ה-hook, ולכן `busy` ו-`error` נשארים במקום אחד.
   * ‏`tests/unit/primitives.test.ts` מגביל את רשימת המשתמשים בו בשמות.
   */
  start: (scope: () => void) => void;
}

export function useAction(): ActionState {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();

  const run = useCallback(<T,>(action: ActionCall<T>, onSuccess?: (data: T) => void) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      // `result` חסר = ה-action ניווט ולא חזר, כלומר הצלחה. ההמרה נחוצה
      // מפני ש-TypeScript אינו יודע ש-`T` הוא `void` דווקא במסלול הזה.
      if (result && !result.ok) setError(result.error);
      else onSuccess?.(result?.data as T);
    });
  }, []);

  return {
    busy: pending || !hydrated,
    pending,
    error,
    setError,
    run,
    start: startTransition,
  };
}
