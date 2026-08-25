"use client";

import * as Sentry from "@sentry/nextjs";
import { useState } from "react";
import { confirmUploadAction, registerMediaAction } from "@/app/media-actions";
import { he } from "@/lib/he";
import { mediaKind } from "@/lib/media-view";
import { useHydrated } from "@/lib/use-hydrated";

export interface AttachedFile {
  mediaId: string;
  name: string;
  mimeType: string;
  /** כתובת מקומית לתצוגה מקדימה, לפני שהקובץ בכלל נשמר בשרת */
  previewUrl: string | null;
}

interface UseMediaUploadOptions {
  /**
   * הפנייה שאליה הקובץ מיועד.
   *
   * חסר במסך היצירה: שם הפנייה עדיין אינה קיימת, והקובץ נשמר בלי שיוך עד
   * שהיא נוצרת. זהו המסלול העיקרי בשטח — מצלמים קודם, ממלאים אחר כך.
   */
  ticketId?: string;
  /** קיים כשהמעלה הוא נמען חיצוני בפורטל */
  token?: string;
  files: AttachedFile[];
  onChange: (files: AttachedFile[]) => void;
  disabled?: boolean;
}

export interface MediaUpload {
  addFiles: (selected: FileList | null, onDone?: () => void) => Promise<void>;
  remove: (mediaId: string) => void;
  files: AttachedFile[];
  uploading: number;
  error: string | null;
  setError: (message: string | null) => void;
  /** מושבת מבחוץ, או שההידרציה טרם הסתיימה */
  busy: boolean;
  /** האם "צלם" צריך לפתוח את אפליקציית המצלמה של המכשיר */
  nativeCamera: boolean;
}

/**
 * צינור העלאת המדיה — תמונה, PDF, וידאו או הקלטה קולית.
 *
 * ההעלאה מתחילה **ברגע הבחירה** ולא בשליחת ההודעה. הסיבה מהשטח: מנהל
 * עבודה מצלם, מקליד תיאור, ורק אז שולח. אם ההעלאה הייתה מחכה ללחיצה על
 * "שלח", הוא היה עומד מול מסך תקוע עם קליטה סלולרית חלשה — בדיוק ברגע
 * שהוא רוצה לעבור לדירה הבאה. כך הבתים כבר בדרך בזמן שהוא כותב.
 *
 * מכאן גם החלוקה לשלושה שלבים בשרת (רישום → העלאה → אישור): קובץ שההעלאה
 * שלו נקטעה נשאר לא מאושר ופשוט אינו מוצג, במקום להופיע בשרשור כקובץ שבור.
 *
 * ---
 *
 * **למה hook ולא רכיב, מ-0.6.** עד כאן הצינור חי בתוך `MediaPicker`, וכל
 * מי שרצה להעלות קובץ היה חייב לרנדר את הכפתורים שלו. זה נעשה בלתי אפשרי
 * כשהמיקרופון עבר לקצה שורת ההקלטה: הוא צריך את `addFiles` אבל יושב
 * במקום אחר בשורה. ‏hook מפריד את **מה שקורה לקובץ** מ**מי מבקש אותו**,
 * ומאפשר לשני פקדים במקומות שונים לחלוק מצב אחד.
 *
 * **מבוקר ולא עצמאי:** `files` ו-`onChange` מגיעים מההורה, כפי שהיו. אחרת
 * חמשת אתרי הקריאה היו צריכים לשנות את מי שמחזיק את המצב — שינוי גדול
 * בהרבה מהסיבה שבגללה החילוץ נעשה.
 */
export function useMediaUpload({
  ticketId,
  token,
  files,
  onChange,
  disabled,
}: UseMediaUploadOptions): MediaUpload {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const hydrated = useHydrated();
  const busy = disabled || !hydrated;

  /**
   * לאן מוביל "צלם".
   *
   * ‏`capture="environment"` פותח את אפליקציית המצלמה בנייד — המסלול הנכון
   * שם, עם איכות מלאה, פלאש וממשק מוכר. **בדסקטופ הדפדפן מתעלם ממנו בשקט**
   * ופותח בורר קבצים, כך שמי שלוחץ "צלם" מקבל "בחר קובץ" ומסיק שהמערכת
   * שבורה. שם, ורק שם, נפתחת מצלמה מובנית.
   *
   * ‏`pointer: coarse` ולא סניפת user-agent: השאלה האמיתית היא אם זה מכשיר
   * מגע, וזו בדיוק השאלה שה-media query עונה עליה. הבדיקה אחרי hydration
   * מפני ש-`matchMedia` אינו קיים בשרת, ורינדור שונה בין השניים הוא שגיאת
   * hydration.
   */
  const nativeCamera = hydrated && window.matchMedia("(pointer: coarse)").matches;

  /** מעלה קובץ יחיד ומחזיר את הרשומה, או null אם נכשל */
  async function upload(file: File): Promise<AttachedFile | null> {
    const registered = await registerMediaAction({
      ticketId,
      token,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      originalName: file.name,
    });

    if (!registered.ok) {
      setError(registered.error);
      return null;
    }

    const { mediaId, upload: target } = registered.data;

    const response = await fetch(target.url, {
      method: "PUT",
      headers: target.headers,
      body: file,
    }).catch((error) => {
      // כשל רשת (אין קליטה, timeout, CORS) — נזרק. בלי לכידה כשלי העלאה
      // בשטח נעלמים לגמרי; עכשיו הם גלויים ב-Sentry. המשתמש עדיין רואה
      // הודעה ידידותית. תחת Playwright (DSN ריק) זה no-op.
      Sentry.captureException(error, { tags: { area: "media-upload-put" } });
      return null;
    });

    if (!response?.ok) {
      // ‏response קיים אך לא-ok = תשובת HTTP שגויה (חתימה פגה, 403 מ-R2),
      // להבדיל מכשל רשת שכבר נלכד למעלה.
      if (response) {
        Sentry.captureException(new Error(`media upload PUT failed: ${response.status}`), {
          tags: { area: "media-upload-put", status: String(response.status) },
        });
      }
      setError(he.media.uploadFailed);
      return null;
    }

    const confirmed = await confirmUploadAction({ mediaId, token });
    if (!confirmed.ok) {
      setError(confirmed.error);
      return null;
    }

    return {
      mediaId,
      name: file.name || he.media.audioLabel,
      mimeType: file.type,
      // ‏URL מקומי ולא כתובת מהשרת: התצוגה המקדימה מופיעה מיד, בלי סבב
      // רשת נוסף אחרי העלאה שכבר עלתה.
      previewUrl: mediaKind(file.type) === "image" ? URL.createObjectURL(file) : null,
    };
  }

  /**
   * ‏`onDone` מאפס את ערך שדה הקובץ שממנו הגיעה הבחירה.
   *
   * הוא פרמטר ולא ref בתוך ה-hook: ל-hook אין DOM, ומי שמחזיק את השדות
   * הוא הרכיב. בלי האיפוס, בחירה חוזרת של **אותו** קובץ אחרי הסרה אינה
   * מייצרת אירוע `change` והמשתמש רואה לחיצה שלא קרה בה דבר.
   */
  async function addFiles(selected: FileList | null, onDone?: () => void) {
    if (!selected?.length) return;
    setError(null);

    /**
     * **הקבצים נלכדים כאן, לפני ה-`try`, ולא נקראים מ-`selected` בהמשך.**
     *
     * ‏`selected` הוא ה-`FileList` **החי** של השדה, ואיפוס `input.value`
     * בסוף מרוקן את אותו אובייקט עצמו (‏`captured === input.files`, אומת
     * בדפדפן). ‏`setUploading` מקבל פונקציית עדכון ש-React מריץ מאוחר יותר —
     * ועד אז `selected.length` כבר 0, כלומר ההפחתה הייתה של אפס והמונה נתקע.
     *
     * התוצאה בפועל, שהתגלתה בסבב QA על הפרודקשן: "מעלה…" נשאר על המסך
     * **לתמיד** אחרי כל צירוף קובץ. אף בדיקה לא נכשלה, כי כולן בדקו שהתמונה
     * הופיעה ואף אחת לא בדקה שחיווי ההעלאה נעלם.
     */
    const chosen = Array.from(selected);

    setUploading((n) => n + chosen.length);

    try {
      const results = await Promise.all(chosen.map(upload));
      const added = results.filter((item): item is AttachedFile => item !== null);
      if (added.length > 0) onChange([...files, ...added]);
    } finally {
      setUploading((n) => Math.max(0, n - chosen.length));
      onDone?.();
    }
  }

  function remove(mediaId: string) {
    const target = files.find((f) => f.mediaId === mediaId);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    onChange(files.filter((f) => f.mediaId !== mediaId));
  }

  return { addFiles, remove, files, uploading, error, setError, busy, nativeCamera };
}

/** עוטף קובץ יחיד ברשימה, כדי שיעבור באותו מסלול כמו בחירה מרובה */
export function toFileList(file: File): FileList {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  return transfer.files;
}
