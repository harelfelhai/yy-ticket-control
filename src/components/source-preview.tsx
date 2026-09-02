"use client";

import { he } from "@/lib/he";
import { isPdf } from "@/lib/media-view";
import type { AttachedFile } from "@/lib/use-media-upload";

/**
 * דוח המקור, מוצג בצד מסך ההזנה המרוכזת כהקשר קבוע (אפיון מסך 5, שורה 271).
 *
 * **למה זה נחוץ בכלל.** עד כאן הדוח הועלה, נסרק ב-OCR ונכנס לחיפוש — אבל
 * **מעולם לא הוצג**. מי שהזין עשרות ליקויים ראה בצד את שם הקובץ בלבד, וקרא
 * את הדוח עצמו בחלון אחר. זה הפער היחיד שנשאר בין מסך 5 לאפיון.
 *
 * **כתובת `blob:` מקומית ולא `/api/media/[id]`, ולא מטעמי מהירות.** הדוח
 * בשלב הזה אינו מצורף לשום פנייה ולשום הודעה, ולכן `getViewableMedia`
 * מחזיר עליו `null` **בכוונה** — קובץ שאינו תלוי ברשומה שאפשר לבדוק עליה
 * הרשאה אינו מוגש לאיש. המסלול המקומי אינו עוקף את הכלל הזה אלא נמנע ממנו:
 * הבתים כבר בדפדפן שבחר אותם.
 *
 * המחיר מוצהר: **רענון הדף מאבד את התצוגה** (‏object URL חי כל עוד המסמך
 * חי). זה עקבי עם המסך — אין בו שמירה מקומית לטיוטה, ורענון מאבד ממילא את
 * כל השורות.
 *
 * **‏`<iframe>` ולא `<embed>`/`<object>`:** ‏`object-src 'none'` ב-CSP חוסם
 * את השניים, ובצדק. ה-`frame-src 'self' blob:` שנוסף שם הוא מה שמאפשר את
 * המסלול הזה — בלעדיו ה-iframe נחסם **בשקט**, בנסיגה ל-`default-src`.
 */
export function SourcePreview({ files }: { files: AttachedFile[] }) {
  if (files.length === 0) return null;

  /**
   * ‏`flatMap` ולא `filter`: ‏TypeScript אינו מצמצם `string | null` דרך
   * ‏`filter`, ובניית האובייקט מחדש חוסכת סימן קריאה על כל שימוש.
   */
  const previewable = files.flatMap((file) =>
    file.previewUrl ? [{ ...file, previewUrl: file.previewUrl }] : [],
  );

  // וידאו והקלטה מועלים גם הם כאן. אין להם תצוגה, ויש להם עיבוד AI —
  // ולכן הודעה שמסבירה את שניהם, ולא שתיקה שנראית ככשל.
  if (previewable.length === 0) {
    return <p className="text-xs text-muted">{he.batch.sourceNoPreview}</p>;
  }

  return (
    /*
     * **הגובה נגזר מהחלון ולא נקבע במספר** — DESIGN.md § תצוגת המקור.
     *
     * הפאנל הזה דביק (‏`STICKY_UNDER_HEADER` ב-`batch-form.tsx`), ואלמנט דביק
     * שגובהו עולה על החלון מפסיק להידבק: תחתיתו יוצאת מהמסך ואינה נגישה
     * בשום גלילה. הניסיון הראשון כאן היה `h-96` קבוע — ‏384px — והצילום
     * הראה בדיוק את זה: בחלון של 900px הכרטיס נחתך למטה.
     *
     * ‏`36rem` (576px) הוא מה שהפאנל תופס **מעל** התצוגה, **כפי שנמדד
     * בצילום ולא כפי שהוערך**: ראש העמוד — ניווט, ריפוד וכותרת (110),
     * כרטיס ההקשר המשותף (258), המרווח (12), וראש כרטיס המקור — כותרת,
     * רמז, שורת הפקדים והצ׳יפ (185), ועוד 12 של נשימה למטה. ההערכה
     * הראשונה הייתה 32rem, ושכחה את כותרת העמוד: הכרטיס נחתך שוב.
     *
     * ‏`min-h-48` הוא הרצפה: בחלון נמוך מ-‏768px החישוב יורד מתחת ל-192px,
     * ותצוגת PDF שאין בה מקום לסרגל של Chrome ולעמוד היא לא תצוגה. שם, ורק
     * שם, הפאנל גבוה מהחלון — והמחיר מוצהר.
     */
    <div
      role="group"
      aria-label={he.batch.sourcePreview}
      className="flex h-[calc(100vh-36rem)] min-h-48 flex-col gap-2 overflow-y-auto"
    >
      {previewable.map((file) =>
        isPdf(file.mimeType) ? (
          /*
           * ‏`h-full` — ‏100% מגובה המיכל, ולכן הגובה מוגדר **פעם אחת**
           * למעלה. עם שני קבצים כל אחד מקבל מסגרת מלאה והם נגללים זה אחרי
           * זה, כמו דפדוף בין דפי הדוח.
           *
           * ‏`shrink-0` אינו קישוט: בלעדיו `flex` מכווץ שתי מסגרות של 100%
           * לחצי כל אחת, במקום לגלול.
           *
           * ‏`title` הוא שם הקובץ — השם הנגיש של המסגרת. קורא מסך שנכנס
           * אליה שומע "דוח-בדק.pdf" ולא "frame".
           */
          <iframe
            key={file.mediaId}
            src={file.previewUrl}
            title={file.name}
            className="h-full w-full shrink-0 rounded-sm border border-border"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- blob: מקומי, next/image אינו מטפל בו
          <img
            key={file.mediaId}
            src={file.previewUrl}
            alt={file.name || he.media.imageAlt}
            className="w-full shrink-0 rounded-sm"
          />
        ),
      )}
    </div>
  );
}
