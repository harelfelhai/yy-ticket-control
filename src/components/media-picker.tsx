"use client";

import { Camera, Folder } from "lucide-react";
import { useRef, useState } from "react";
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
}

/**
 * צירוף קבצים בטופס — תמונה, PDF, וידאו או הקלטה קולית.
 *
 * הרכיב מחזיק את **הפקדים** בלבד; ההעלאה עצמה יושבת ב-`useMediaUpload`
 * (שם גם הנימוק לשלושת שלבי השרת ולהעלאה המיידית), והתצוגות המקדימות
 * ב-`AttachedFiles`.
 *
 * **תצורה אחת, ולא וריאנטים.** עד כאן היו שניים: `prominent` שהחזיק שני
 * כפתורי 64px בגריד ו"צרף קובץ" שקט מתחתיהם, ו-`default` שהחזיק שלושה
 * כפתורי טקסט בשורה. שניהם התאחדו לשורת אייקונים אחת — צירוף · צילום ·
 * הקלטה — בהכרעת בעל המוצר, ולכן הפרופ `variant` נמחק ולא נשאר כפרופ שכל
 * ערכיו מרנדרים אותו דבר. שני ההיפוכים רשומים ב-`DESIGN.md` נספח א׳.
 *
 * **הנימוק של 64px לא שרד את 0.7.** הוא נשען על רצפת המגע — ‏`compact`
 * נשא `touch:min-h-11`, כך שבטלפון הכפתורים נשארו 44px — והרצפה בוטלה
 * בהכרעת בעל המוצר (§ אזורי מגע). היום הם 28px בכל מכשיר.
 *
 * **הכרעת האפיון #21 אינה נוגעת כאן.** היא על ההתנהגות — "צלם" נשאר פקד
 * נפרד מ"צרף קובץ" ופותח מצלמה בכל מכשיר — ולא על גודלו של הכפתור.
 */
export function MediaPicker({ ticketId, token, files, onChange, disabled }: MediaPickerProps) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
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

        {/*
         * שלושת ה-`aria-label` נושאים **בדיוק** את המחרוזות שהיו התוויות
         * הגלויות. זו אינה הקפדה תיאורטית: `conformance` ו-`e2e` מאתרים את
         * הפקדים האלה ב-`getByRole("button", { name: ... })`, ונאכף
         * ב-`tests/unit/primitives.test.ts` § "אייקון בכפתור".
         */}
        <Button
          variant="secondary"
          size="compact"
          disabled={media.busy}
          onClick={() => fileInput.current?.click()}
          aria-label={he.media.attach}
        >
          <Folder className="size-3" aria-hidden="true" />
        </Button>
        <Button
          variant="secondary"
          size="compact"
          disabled={media.busy}
          onClick={openCamera}
          aria-label={he.media.camera}
        >
          <Camera className="size-3" aria-hidden="true" />
        </Button>

        <AudioRecorder
          icon
          disabled={media.busy}
          onRecorded={(file) => add(toFileList(file))}
          onError={media.setError}
        />

        {media.uploading > 0 ? <UploadingNotice /> : null}
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
