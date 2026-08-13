"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/message";
import { he } from "@/lib/he";

interface CameraCaptureProps {
  onCaptured: (file: File) => void;
  onClose: () => void;
}

/**
 * חלון צילום בתוך המערכת — למכשירים שאין להם אפליקציית מצלמה בהישג יד.
 *
 * **הבעיה שזה פותר.** לכפתור "צלם" יש מסלול אחד מובן: `<input type="file"
 * capture="environment">`, שבנייד פותח את אפליקציית המצלמה של המכשיר. זה
 * המסלול הנכון שם — איכות מלאה, פלאש, פוקוס, וממשק שהמשתמש כבר מכיר.
 * אבל **בדסקטופ הדפדפן מתעלם מ-`capture` בשקט** ופותח בורר קבצים, כך
 * שמי שלוחץ "צלם" מקבל חלון "בחר קובץ" ומסיק שהמערכת שבורה. זה מה שדווח.
 *
 * לכן: הנייד ממשיך במסלול הקיים, והדסקטופ מקבל מצלמה אמיתית — תצוגה חיה,
 * צילום ל-canvas, ואישור לפני שהתמונה נכנסת. הבחירה בין השניים נעשית
 * ב-`MediaPicker`, שהוא היחיד שיודע איזה כפתור נלחץ.
 *
 * ‏JPEG ולא PNG: צילום של ליקוי הוא תצלום ולא גרפיקה, ו-PNG היה מייצר
 * קובץ גדול פי כמה בלי שום רווח — על רשת סלולרית באתר בנייה זה מורגש.
 */
export function CameraCapture({ onCaptured, onClose }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function open() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setError(he.media.cameraUnavailable);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // ‏`ideal` ולא `exact`: מצלמה אחורית היא העדפה בטלפון ואינה קיימת
          // ברוב המחשבים. `exact` היה נכשל שם לגמרי במקום לקחת מה שיש.
          video: { facingMode: "environment", width: { ideal: 1920 } },
        });

        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setReady(true);
      } catch {
        // סירוב הרשאה ומצלמה תפוסה נראים זהים ב-API; הנוסח מכוון לשכיח.
        setError(he.media.cameraDenied);
      }
    }

    void open();

    // כיבוי בפירוק: בלי זה נורית המצלמה נשארת דולקת אחרי סגירת החלון,
    // וזו התנהגות שנראית למשתמש כמו צילום שנמשך.
    return () => {
      cancelled = true;
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = null;
    };
  }, []);

  function shoot() {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setError(he.media.captureFailed);
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError(he.media.captureFailed);
          return;
        }
        onCaptured(new File([blob], `${he.media.photoLabel}.jpg`, { type: "image/jpeg" }));
        onClose();
      },
      "image/jpeg",
      0.92,
    );
  }

  return (
    <Dialog title={he.media.camera} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {error ? (
          <FormError>{error}</FormError>
        ) : (
          <>
            {/* ‏`playsInline` — בלעדיו ספארי ב-iOS פותח את הווידאו במסך מלא
                של מערכת ההפעלה ומכסה את כפתור הצילום.
                ‏`muted` — אין כאן שמע, והוא תנאי ל-autoplay ברוב הדפדפנים. */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              aria-label={he.media.cameraPreview}
              className="w-full rounded-xl bg-fg"
            />
            {/*
             * טקסט מפורש בזמן ההמתנה, ולא כפתור מושבת לבדו.
             *
             * זה לא ליטוש: בהרצה בפועל התמונה שחורה כל עוד הדפדפן ממתין
             * לאישור ההרשאה, והכפתור עמום — כלומר המסך נראה **בדיוק כמו
             * תקלה**. זו אותה מחלה שדווחה על "יש לי שאלה" בפורטל, ולכן
             * אותו תיקון: להגיד במילים מה קורה.
             */}
            {ready ? null : (
              <p className="text-sm text-muted">{he.media.cameraStarting}</p>
            )}
            <Button onClick={shoot} disabled={!ready} className="w-full">
              {he.media.takePhoto}
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
