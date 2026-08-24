"use client";

import * as Sentry from "@sentry/nextjs";
import { useId, useRef, useState } from "react";
import { confirmUploadAction, registerMediaAction } from "@/app/media-actions";
import { Button } from "@/components/ui/button";
import { cardClasses } from "@/components/ui/card";
import { FormError } from "@/components/ui/message";
import { he } from "@/lib/he";
import { mediaKind } from "@/lib/media-view";
import { useHydrated } from "@/lib/use-hydrated";
import { AudioRecorder } from "./audio-recorder";
import { CameraCapture } from "./camera-capture";

export interface AttachedFile {
  mediaId: string;
  name: string;
  mimeType: string;
  /** כתובת מקומית לתצוגה מקדימה, לפני שהקובץ בכלל נשמר בשרת */
  previewUrl: string | null;
}

interface MediaPickerProps {
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
  /**
   * `prominent` — צילום והקלטה ככפתורים גדולים בראש (מסך היצירה, אפיון
   * מסך 4: "המדיה היא הפעולה הראשונה"). ברירת המחדל קומפקטית, לתיבת התגובה.
   */
  variant?: "default" | "prominent";
}

/**
 * צירוף קבצים לתגובה — תמונה, PDF, וידאו או הקלטה קולית.
 *
 * ההעלאה מתחילה **ברגע הבחירה** ולא בשליחת ההודעה. הסיבה מהשטח: מנהל
 * עבודה מצלם, מקליד תיאור, ורק אז שולח. אם ההעלאה הייתה מחכה ללחיצה על
 * "שלח", הוא היה עומד מול מסך תקוע עם קליטה סלולרית חלשה — בדיוק ברגע
 * שהוא רוצה לעבור לדירה הבאה. כך הבתים כבר בדרך בזמן שהוא כותב.
 *
 * מכאן גם החלוקה לשלושה שלבים בשרת (רישום → העלאה → אישור): קובץ שההעלאה
 * שלו נקטעה נשאר לא מאושר ופשוט אינו מוצג, במקום להופיע בשרשור כקובץ
 * שבור.
 */
export function MediaPicker({
  ticketId,
  token,
  files,
  onChange,
  disabled,
  variant = "default",
}: MediaPickerProps) {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [cameraOpen, setCameraOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const inputId = useId();
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

  async function addFiles(selected: FileList | null) {
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
      // איפוס הערך מאפשר לבחור שוב את אותו קובץ אחרי הסרה. בלעדיו הדפדפן
      // אינו מדווח על שינוי, והבחירה השנייה פשוט לא קורית.
      if (fileInput.current) fileInput.current.value = "";
      if (cameraInput.current) cameraInput.current.value = "";
    }
  }

  /** "צלם" — מצלמת המכשיר בנייד, חלון צילום מובנה בדסקטופ */
  function openCamera() {
    setError(null);
    if (nativeCamera) cameraInput.current?.click();
    else setCameraOpen(true);
  }

  function remove(mediaId: string) {
    const target = files.find((f) => f.mediaId === mediaId);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    onChange(files.filter((f) => f.mediaId !== mediaId));
  }

  return (
    <div className="flex flex-col gap-2">
      {files.length > 0 ? (
        <ul aria-label={he.media.attach} className="flex flex-wrap gap-2">
          {files.map((file) => (
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
                onClick={() => remove(file.mediaId)}
                aria-label={`${he.media.remove}: ${file.name}`}
                className="shrink-0"
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {/* שני שדות ולא אחד: `capture` פותח את המצלמה מיד, וזה מה שרוצים
            בשטח — אבל הוא גם חוסם בחירה מהגלריה, שנחוצה כשמצלמים קודם. */}
        <input
          ref={fileInput}
          id={inputId}
          type="file"
          multiple
          accept="image/*,application/pdf,video/*"
          onChange={(e) => void addFiles(e.target.files)}
          className="hidden"
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => void addFiles(e.target.files)}
          className="hidden"
        />

        {variant === "prominent" ? (
          // צילום והקלטה גדולים ובראש (אפיון מסך 4); "צרף קובץ" משני מתחת.
          <div className="flex w-full flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={openCamera}
                /*
                 * יעד הצילום — **64px, ובכוונה גדול מכל וריאנט של `Button`**:
                 * הוא נלחץ באגודל בכפפה, מול דירה, על מסך בשמש. לכן הוא נשאר
                 * כתוב ביד (חריג מתועד ב-`tests/unit/primitives.test.ts`):
                 * ‏`Button` נושא `touch:min-h-11`, ודריסתו ב-64px
                 * הייתה **מקטינה** אותו דווקא במגע — כלומר בדיוק במכשיר
                 * שבשבילו הוא גדול.
                 *
                 * **הבלטה בגודל, לא בצבע.** הוא היה `border-brand` +
                 * `bg-brand/10` + `text-brand`, ובגרפיט שלושתם הופכים למלבן
                 * אפור עם טקסט בצבע טקסט רגיל — פקד שנראה מושבת. הפיתוי היה
                 * להעביר אותו לטוקן צבעוני אחר, אבל ארבעת הטוקנים הצבעוניים
                 * הם **מצבים** (§ Colors), ו-"צלם" אינו מצב: `info` פירושו
                 * "פנייה חדשה שטרם נצפתה", ושימוש בו כאן הוא בדיוק הצבע
                 * שנגזר מאסתטיקה ולא ממשמעות שהסעיף אוסר.
                 *
                 * לכן המראה הוא של כפתור משני רגיל, וכל ההבלטה מגיעה מהמידה
                 * — שהיא ממילא הסיבה שהפקד הזה חורג. הוא הדבר הגדול ביותר
                 * במסך; הוא אינו זקוק גם לגוון.
                 */
                className="min-h-16 rounded-sm border border-border bg-surface px-3 text-base font-semibold text-fg disabled:opacity-60"
              >
                {he.media.camera}
              </button>
              <AudioRecorder
                disabled={busy}
                onRecorded={(file) => void addFiles(toFileList(file))}
                onError={setError}
                className="min-h-16 w-full text-base"
              />
            </div>
            <Button
              variant="quiet"
              size="compact"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
              className="self-start px-1"
            >
              {he.media.attach}
            </Button>
            {uploading > 0 ? (
              <span role="status" className="text-sm text-muted">
                {he.media.uploading}
              </span>
            ) : null}
          </div>
        ) : (
          <>
            <Button
              variant="secondary"
              size="compact"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              {he.media.attach}
            </Button>
            <Button variant="secondary" size="compact" disabled={busy} onClick={openCamera}>
              {he.media.camera}
            </Button>

            <AudioRecorder
              disabled={busy}
              onRecorded={(file) => void addFiles(toFileList(file))}
              onError={setError}
            />

            {uploading > 0 ? (
              <span role="status" className="text-sm text-muted">
                {he.media.uploading}
              </span>
            ) : null}
          </>
        )}
      </div>

      {/* פער 31: כאן ישב העתק תו-בתו של `FormError`. הוא חמק מהאוכף כי
          ההחרגה ניתנה לקובץ כולו בשביל מונה ההעלאה (`role="status"`) —
          החרגה שהייתה רחבה מנימוקה. האוכף צומצם לתפקיד, לא לקובץ. */}
      {error ? <FormError>{error}</FormError> : null}

      {cameraOpen ? (
        <CameraCapture
          onCaptured={(file) => void addFiles(toFileList(file))}
          onClose={() => setCameraOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** עוטף קובץ יחיד ברשימה, כדי שיעבור באותו מסלול כמו בחירה מרובה */
function toFileList(file: File): FileList {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  return transfer.files;
}
