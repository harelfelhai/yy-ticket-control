"use client";

import { useEffect } from "react";
import { he } from "@/lib/he";
import { captureError } from "@/lib/observability/log";
import { PAGE_X, PANEL_WIDTH, TITLE_DESCRIPTIVE } from "@/lib/ui";
import { Button, ButtonLink } from "@/components/ui/button";
import { cardClasses } from "@/components/ui/card";

/**
 * גבול השגיאה של האפליקציה — עברית, ועם שתי דרכי המשך.
 *
 * **נכתב יחד עם `not-found.tsx` (GAP-A4)**, מאותו נימוק: בלעדיו חריגה
 * שאינה נתפסת מציגה את מסך ברירת המחדל של Next, באנגלית.
 *
 * **מה שהוא אינו מכסה, וזה מכוון:** שגיאות של Server Actions אינן מגיעות
 * לכאן — הן מוחזרות כערך דרך `ActionResult` ומוצגות במקום שבו המשתמש
 * לחץ (ראו `src/lib/action-result.ts`). מסך שלם על כשל פעולה אחת היה
 * מאבד למשתמש את ההקשר ואת מה שהקליד. כאן נוחתות רק חריגות רינדור.
 *
 * `captureError` ולא `Sentry.captureException` ישירות — זו נקודת הכניסה
 * היחידה ללוגים בפרויקט, והיא איזומורפית ולכן בטוחה גם ברכיב לקוח.
 * `reset()` של Next מנסה לרנדר מחדש את אותו מסלול; כשהתקלה חולפת (רשת,
 * מרוץ) זה עובד, וכשלא — יש קישור ללוח.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // ‏`digest` הוא המזהה ש-Next מצמיד לחריגה בפרודקשן, והוא מה שמאפשר
    // לקשור בין מה שהמשתמש ראה לבין הרשומה ב-Sentry. הוא עובר כתגית ולא
    // כ-fingerprint: קיבוץ לפיו היה יוצר issue נפרד לכל חריגה.
    captureError(error, {
      tags: { boundary: "app", digest: error.digest ?? "none" },
      fingerprint: ["render-boundary"],
    });
  }, [error]);

  return (
    <main className={`flex flex-1 items-center justify-center py-3 ${PAGE_X}`}>
      <div className={cardClasses(`text-center ${PANEL_WIDTH}`, { padding: "roomy" })}>
        <h1 className={TITLE_DESCRIPTIVE}>{he.errorPage.crashTitle}</h1>
        <p className="mt-2 text-muted">{he.errorPage.crashHelp}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <Button onClick={reset}>{he.errorPage.retry}</Button>
          <ButtonLink href="/board" variant="secondary">
            {he.errorPage.toBoard}
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
