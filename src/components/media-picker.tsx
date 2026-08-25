"use client";

import { useId, useRef, useState } from "react";
import { AttachedFiles } from "@/components/attached-files";
import { Button } from "@/components/ui/button";
import { FormError, UploadingNotice } from "@/components/ui/message";
import { he } from "@/lib/he";
import { type AttachedFile, toFileList, useMediaUpload } from "@/lib/use-media-upload";
import { AudioRecorder } from "./audio-recorder";
import { CameraCapture } from "./camera-capture";

export type { AttachedFile };

interface MediaPickerProps {
  /** הפנייה שאליה הקובץ מיועד; חסר במסך היצירה (ראו `useMediaUpload`) */
  ticketId?: string;
  /** קיים כשהמעלה הוא נמען חיצוני בפורטל */
  token?: string;
  files: AttachedFile[];
  onChange: (files: AttachedFile[]) => void;
  disabled?: boolean;
  /**
   * `default` — כפתורי טקסט קומפקטיים. זהו הווריאנט של **טופס**, ומשמש
   *   היום את מסך ההזנה המרוכזת בלבד.
   * `prominent` — צילום והקלטה ככפתורים גדולים בראש (אפיון מסך 4:
   *   "המדיה היא הפעולה הראשונה").
   *
   * **הווריאנט `composer` ירד ב-0.6 ולא הוחלף בשלישי.** הקומפוזר הפסיק
   * להיות תצורה של הרכיב הזה ונעשה **הרכבה במקום הקריאה**: `AddMediaButton`
   * לצירוף ולצילום, `AudioRecorder` בקצה השורה, ו-`AttachedFiles` מעליה.
   * שלושתם חולקים מצב אחד דרך `useMediaUpload`.
   *
   * הסיבה אינה אסתטיקה אלא פריסה: המיקרופון עבר לקצה השורה ומתחלף שם
   * בכפתור השליחה, כלומר הוא כבר **אינו שכן** של הצירוף והצילום. וריאנט
   * הוא הכלי הנכון כשאותו מבנה משנה מראה; כאן המבנה עצמו התפרק.
   *
   * **טופס אינו שיחה ואינו נראה כמותה** — זה מה שנשאר מ-0.5, וזו הסיבה
   * ש-`default` לא ירש את האייקונים.
   */
  variant?: "default" | "prominent";
}

/**
 * צירוף קבצים בטופס — תמונה, PDF, וידאו או הקלטה קולית.
 *
 * הרכיב מחזיק את **הפקדים** בלבד; ההעלאה עצמה יושבת ב-`useMediaUpload`
 * (שם גם הנימוק לשלושת שלבי השרת ולהעלאה המיידית), והתצוגות המקדימות
 * ב-`AttachedFiles`.
 */
export function MediaPicker({
  ticketId,
  token,
  files,
  onChange,
  disabled,
  variant = "default",
}: MediaPickerProps) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const media = useMediaUpload({ ticketId, token, files, onChange, disabled });

  /**
   * איפוס ערך שני השדות אחרי כל בחירה.
   *
   * בלעדיו הדפדפן אינו מדווח על שינוי כשבוחרים **שוב את אותו קובץ** אחרי
   * הסרה, והבחירה השנייה פשוט לא קורית.
   */
  function resetInputs() {
    if (fileInput.current) fileInput.current.value = "";
    if (cameraInput.current) cameraInput.current.value = "";
  }

  function add(selected: FileList | null) {
    void media.addFiles(selected, resetInputs);
  }

  /** "צלם" — מצלמת המכשיר בנייד, חלון צילום מובנה בדסקטופ */
  function openCamera() {
    media.setError(null);
    if (media.nativeCamera) cameraInput.current?.click();
    else setCameraOpen(true);
  }

  return (
    <div className="flex flex-col gap-2">
      <AttachedFiles media={media} />

      <div className="flex flex-wrap items-center gap-2">
        {/* שני שדות ולא אחד: `capture` פותח את המצלמה מיד, וזה מה שרוצים
            בשטח — אבל הוא גם חוסם בחירה מהגלריה, שנחוצה כשמצלמים קודם. */}
        <input
          ref={fileInput}
          id={inputId}
          type="file"
          multiple
          accept="image/*,application/pdf,video/*"
          onChange={(e) => add(e.target.files)}
          className="hidden"
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => add(e.target.files)}
          className="hidden"
        />

        {variant === "prominent" ? (
          // צילום והקלטה גדולים ובראש (אפיון מסך 4); "צרף קובץ" משני מתחת.
          <div className="flex w-full flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={media.busy}
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
                disabled={media.busy}
                onRecorded={(file) => add(toFileList(file))}
                onError={media.setError}
                className="min-h-16 w-full text-base"
              />
            </div>
            <Button
              variant="quiet"
              size="compact"
              disabled={media.busy}
              onClick={() => fileInput.current?.click()}
              className="self-start px-1"
            >
              {he.media.attach}
            </Button>
            {media.uploading > 0 ? <UploadingNotice /> : null}
          </div>
        ) : (
          /* טופס — תוויות טקסט מלאות. אינו שיחה ואינו נראה כמותה. */
          <>
            <Button
              variant="secondary"
              size="compact"
              disabled={media.busy}
              onClick={() => fileInput.current?.click()}
            >
              {he.media.attach}
            </Button>
            <Button
              variant="secondary"
              size="compact"
              disabled={media.busy}
              onClick={openCamera}
            >
              {he.media.camera}
            </Button>

            <AudioRecorder
              disabled={media.busy}
              onRecorded={(file) => add(toFileList(file))}
              onError={media.setError}
            />

            {media.uploading > 0 ? <UploadingNotice /> : null}
          </>
        )}
      </div>

      {media.error ? <FormError>{media.error}</FormError> : null}

      {cameraOpen ? (
        <CameraCapture
          onCaptured={(file) => add(toFileList(file))}
          onClose={() => setCameraOpen(false)}
        />
      ) : null}
    </div>
  );
}
