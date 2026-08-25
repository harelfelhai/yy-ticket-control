"use client";

import { Camera, Paperclip, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { UploadingNotice } from "@/components/ui/message";
import { he } from "@/lib/he";
import { type MediaUpload, toFileList } from "@/lib/use-media-upload";
import { CameraCapture } from "./camera-capture";

/**
 * ה-"+" של שורת ההקלטה — צירוף קובץ וצילום בגיליון תחתון.
 *
 * **שני כפתורים הפכו לאחד, וזו מדידה** (DESIGN.md § שורת ההקלטה): בשורה
 * של 393px ארבעה פקדים הותירו לתיבת הכתיבה 39% מהרוחב. **שתי היכולות
 * נשמרות במלואן** — הן פשוט יושבות שכבה אחת פנימה.
 *
 * **הדרישה שהאפיון מגן עליה אינה מספר הכפתורים אלא ההתנהגות** (§7 #21):
 * "צלם" חייב לפתוח מצלמה בכל מכשיר — אפליקציית המצלמה בנייד, חלון הצילום
 * המובנה בדסקטופ — ולא בורר קבצים. זה נשמר כאן מילה במילה. ההכרעה עצמה
 * חתומה "(מסך 4)", ושם שני הכפתורים נשארים נפרדים וגלויים.
 *
 * **גיליון ולא תפריט צף, ולא בגלל הצל.** ‏`Dialog` הוא מה שנותן Portal,
 * והקומפוזר יושב ברצועה עם `z-[1]` — הקשר ערימה שכבר לכד פאנל בפרויקט
 * הזה והפך כפתור ללא-לחיץ. יחד איתו מגיעים Escape, מלכודת מיקוד, החזרת
 * מיקוד וסגירה בלחיצה על הכיסוי, וכולם נדרשים ואף אחד מהם אינו קיים בקוד
 * מחוץ ל-`Dialog`.
 */
export function AddMediaButton({ media }: { media: MediaUpload }) {
  const [open, setOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

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
    setOpen(false);
    if (media.nativeCamera) cameraInput.current?.click();
    else setCameraOpen(true);
  }

  return (
    <>
      {/*
       * **שדות הקובץ מרונדרים תמיד, ומחוץ לגיליון.**
       *
       * ‏`e2e/media.spec.ts` נוהג בהם ישירות (`setInputFiles`) ומאתר אותם
       * לפי `accept` — כלומר **מחרוזת ה-`accept` היא סלקטור של שש בדיקות**.
       * אילו הם היו נולדים עם הגיליון, כולן היו נשברות בהודעה "לא נמצא
       * אלמנט", שאינה מרמזת על הסיבה.
       *
       * שני שדות ולא אחד: `capture` פותח את המצלמה מיד, וזה מה שרוצים
       * בשטח — אבל הוא גם חוסם בחירה מהגלריה, שנחוצה כשמצלמים קודם.
       */}
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

      <Button
        variant="secondary"
        size="compact"
        disabled={media.busy}
        onClick={() => setOpen(true)}
        aria-label={he.media.attachMenu}
      >
        <Plus className="size-3" aria-hidden="true" />
      </Button>

      {media.uploading > 0 ? <UploadingNotice /> : null}

      {open ? (
        <Dialog title={he.media.attachMenu} placement="bottom" onClose={() => setOpen(false)}>
          {/*
           * **שתי הכניסות נושאות `aria-label` זהה לטקסט הגלוי.**
           *
           * לא כפילות מיותרת: האוכף ב-`primitives.test.ts` מסמן **כל**
           * אייקון בתוך `<Button>` שאין עליו `aria-label`, גם כשיש טקסט
           * לצדו — והתגובה הנכונה היא להוסיף את התווית ולא להחליש את האוכף.
           * המחרוזת זהה, ולכן `MEDIA.camera` ו-`MEDIA.attach` בבדיקות
           * ממשיכים למצוא בדיוק את מה שמצאו קודם.
           *
           * "צלם" ראשון — זה המסלול השכיח בשטח.
           */}
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              onClick={openCamera}
              aria-label={he.media.camera}
              className="w-full justify-start gap-2"
            >
              <Camera className="size-3" aria-hidden="true" />
              {he.media.camera}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                // הלחיצה על השדה קודמת לסגירה: סגירה קודם מפרקת את הכפתור
                // שנלחץ, ויש דפדפנים שמפסיקים לראות את הפעולה כיוזמת משתמש.
                fileInput.current?.click();
                setOpen(false);
              }}
              aria-label={he.media.attach}
              className="w-full justify-start gap-2"
            >
              <Paperclip className="size-3" aria-hidden="true" />
              {he.media.attach}
            </Button>
          </div>
        </Dialog>
      ) : null}

      {cameraOpen ? (
        <CameraCapture
          onCaptured={(file) => add(toFileList(file))}
          onClose={() => setCameraOpen(false)}
        />
      ) : null}
    </>
  );
}
