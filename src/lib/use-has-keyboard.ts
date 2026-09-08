"use client";

import { useSyncExternalStore } from "react";

/**
 * האם למכשיר הזה יש מקלדת פיזית — כלומר, האם Enter יכול לשמש כשליחה.
 *
 * **הבעיה שזה פותר.** בקומפוזר, Enter ששולח הוא הרגל של שיחה במחשב. בטלפון
 * הוא הפוך: מקש ה-Enter במקלדת המסך הוא "שורה חדשה" בכל אפליקציית הודעות
 * שהמשתמש מכיר, ואין Shift נוח שיחזיר אותה. אותה התנהגות בדיוק בשני
 * המכשירים היא באג באחד מהם — וההכרעה (7.9.2026, בעל המוצר) היא שהמחשב
 * שולח והטלפון יורד שורה.
 *
 * ---
 *
 * **`any-pointer` ולא `pointer`, וזה כל העניין.**
 *
 * `tests/unit/touch-variant.test.ts` אוסר `pointer-coarse:` ב-`src/`,
 * ומתעד למה: `pointer` שואל על המצביע **הראשי**, ולכן מחשב נייד עם מסך מגע
 * עונה "גס" ומקבל את התנהגות הטלפון — למרות שיש עליו מקלדת ועכבר. הגרסה
 * הזו של הכלל כבר נשלחה פעם אחת ושרדה חודשיים בלי שאיש ראה אותה נשברת.
 *
 * `any-pointer: fine` שואל שאלה אחרת: **האם קיים מצביע מדויק כלשהו.** זו
 * בדיוק הצורה שאין בה הפגם ההוא — לפטופ עם מסך מגע עונה "כן", טלפון עונה
 * "לא". האיסור על `pointer-coarse:` נשאר בתוקף במלואו; מה שנאסר שם הוא
 * השאלה השבורה, לא עצם ההבחנה בין מכשירים.
 *
 * **וזה כן נבדק בדפדפן, בניגוד למה שנכתב שם.** `playwright.config.ts`
 * מריץ שני פרופילים — `mobile` (Pixel 5) ו-`desktop` — ואמולציית המכשיר
 * של Chromium משנה את `any-pointer` בהתאם. לכן שתי ההתנהגויות נאכפות
 * ב-E2E ולא נשארות טענה בתיעוד.
 *
 * ---
 *
 * `useSyncExternalStore` ולא `useState` + `useEffect`, כמו ב-
 * `use-hydrated.ts`: זו הצורה שבה React מבדיל בין תמונת השרת לזו של
 * הלקוח. **תמונת השרת היא `false`** — כלומר עד ל-hydration Enter יורד
 * שורה. זו ברירת המחדל הבטוחה: מקש שיורד שורה ואז מתחיל לשלוח מפתיע פחות
 * ממקש ששולח הודעה לפני שהמסך מוכן.
 */

const QUERY = "(any-pointer: fine)";

function subscribe(onChange: () => void): () => void {
  // מכשיר יכול לצמוח מקלדת באמצע הסשן — טאבלט שמחובר למעגן. `matchMedia`
  // מדווח על זה, ובלי ההרשמה הקומפוזר היה נשאר על התשובה שקיבל בטעינה.
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function useHasKeyboard(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches, // בדפדפן
    () => false, // בשרת ובמעבר ה-hydration הראשון
  );
}
