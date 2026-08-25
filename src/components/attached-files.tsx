"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cardClasses } from "@/components/ui/card";
import { he } from "@/lib/he";
import type { MediaUpload } from "@/lib/use-media-upload";

/**
 * רשימת הקבצים שצורפו וטרם נשלחו.
 *
 * חולצה מ-`MediaPicker` ב-0.6 יחד עם צינור ההעלאה: הקומפוזר מרכיב את
 * השורה שלו משני חלקים — הפקדים והתצוגות המקדימות — ואלה נמצאים במקומות
 * שונים בפריסה. התצוגות נפרשות מעל השורה, הפקדים יושבים בתוכה.
 *
 * **‏`aria-label` על ה-`<ul>` הוא סלקטור של חמש בדיקות e2e** ולא קישוט:
 * הן מאתרות את הרשימה בשם "צרף קובץ" ובודקות שהתמונה הגיעה. כל שינוי
 * במחרוזת שובר אותן בהודעה "לא נמצא אלמנט", שאינה מרמזת על הסיבה.
 */
export function AttachedFiles({ media }: { media: MediaUpload }) {
  if (media.files.length === 0) return null;

  return (
    <ul aria-label={he.media.attach} className="flex flex-wrap gap-2">
      {media.files.map((file) => (
        // ‏`cardClasses` ולא מסגרת שנכתבת כאן: אריח הקובץ הוא כרטיס קטן,
        // ‏וכל מה שהיה מקומי בו הוא `bg-bg` — רקע שנועד להפריד מהמשטח
        // ‏שמתחתיו בזמן שהכרטיס עשה זאת ממילא במסגרת (§ Elevation).
        <li
          key={file.mediaId}
          className={cardClasses("flex items-center gap-2", { padding: "compact" })}
        >
          {file.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob: מקומי, next/image אינו מטפל בו
            <img
              src={file.previewUrl}
              alt={he.media.imageAlt}
              // ‏4px: התצוגה המקדימה יושבת **בתוך** אריח, ומה שבתוך מיכל
              // ‏מעוגל פחות ממנו.
              className="size-12 rounded-sm object-cover"
            />
          ) : (
            <span className="max-w-40 truncate text-sm">{file.name}</span>
          )}
          <Button
            variant="dangerQuiet"
            size="compact"
            onClick={() => media.remove(file.mediaId)}
            aria-label={`${he.media.remove}: ${file.name}`}
            className="shrink-0"
          >
            {/* היה תו `×` מילולי. הוחלף לאייקון יחד עם שאר השורה — תו טקסט
                בודד לצד ארבעה אייקונים נקרא כשריד, לא כהבחנה. */}
            <X className="size-3" aria-hidden="true" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
