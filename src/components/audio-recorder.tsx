"use client";

import { useEffect, useRef, useState } from "react";
import { he } from "@/lib/he";

interface AudioRecorderProps {
  onRecorded: (file: File) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

/**
 * הקלטה קולית ישירות מהדפדפן.
 *
 * זו הדרך המהירה ביותר לפתוח פנייה בשטח: מנהל עבודה עם כפפות, מול דירה,
 * מדבר במקום להקליד. ההקלטה נשלחת לתמלול (M3.4) והתמלול ממלא את התיאור
 * אם הוא ריק — אבל **ההקלטה עצמה נשמרת תמיד**, גם אם התמלול נכשל, כי היא
 * המקור והתמלול הוא נגזרת.
 *
 * ‏MediaRecorder ולא ספרייה חיצונית: הוא נתמך בכל דפדפן רלוונטי היום,
 * ותוסף להקלטה היה מוסיף מאות קילובייטים לטובת פונקציה אחת.
 */
export function AudioRecorder({ onRecorded, onError, disabled }: AudioRecorderProps) {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // עצירה בעת פירוק הרכיב: בלעדיה נורית המיקרופון נשארת דולקת אחרי מעבר
  // מסך, וזו התנהגות שנראית למשתמש כמו האזנה.
  useEffect(() => {
    return () => stopTracks(recorderRef.current);
  }, []);

  async function start() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      onError(he.media.micUnavailable);
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // דחייה של המשתמש ותקלת חומרה נראות זהות ב-API. הנוסח מכוון לסיבה
      // השכיחה, שהיא הרשאה שלא ניתנה.
      onError(he.media.micDenied);
      return;
    }

    const recorder = new MediaRecorder(stream, pickMimeType());
    chunksRef.current = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      const type = recorder.mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      stopTracks(recorder);
      setRecording(false);

      if (blob.size > 0) {
        onRecorded(new File([blob], `${he.media.audioLabel}.webm`, { type }));
      }
    };

    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
  }

  function stop() {
    recorderRef.current?.stop();
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => (recording ? stop() : void start())}
      aria-pressed={recording}
      className={`min-h-11 rounded-xl px-3 text-sm font-medium disabled:opacity-60 ${
        recording ? "bg-danger text-white" : "border border-border"
      }`}
    >
      {recording ? he.media.stopRecording : he.media.record}
    </button>
  );
}

/**
 * בוחר פורמט שהדפדפן באמת יודע להקליט.
 *
 * ‏webm/opus הוא ברירת המחדל בכרום ובאנדרואיד; ספארי ב-iOS מקליט mp4
 * בלבד. העברת סוג שאינו נתמך ל-MediaRecorder זורקת, ולכן הבחירה נעשית
 * לפי מה שהדפדפן מצהיר עליו ולא לפי הנחה.
 */
function pickMimeType(): MediaRecorderOptions {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

  for (const mimeType of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) return { mimeType };
  }
  // אין התאמה — נותנים לדפדפן לבחור בעצמו במקום להיכשל.
  return {};
}

function stopTracks(recorder: MediaRecorder | null): void {
  if (!recorder) return;
  if (recorder.state !== "inactive") recorder.stop();
  for (const track of recorder.stream.getTracks()) track.stop();
}
