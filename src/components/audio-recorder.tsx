"use client";

import { Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { he } from "@/lib/he";

interface AudioRecorderProps {
  onRecorded: (file: File) => void;
  onError: (message: string) => void;
  disabled?: boolean;
  /**
   * הכפתור שלפני ההקלטה מוצג כאייקון מיקרופון במקום כטקסט.
   *
   * **כל ארבעת הקוראים מבקשים אותו היום**, ומאז שהטופס עבר גם הוא לשורת
   * אייקונים (`MediaPicker`) הוא חדל לסמן "קומפוזר". הוא נשאר פרופ ולא
   * נעשה התנהגות קבועה מפני שהוא מתאר **החלטה** — האם לכפתור יש תווית
   * גלויה — ומצב ההמתנה להרשאה עדיין נשען עליה (ראו למטה).
   *
   * **מצב ההקלטה הפעילה נשאר טקסטואלי בשני המצבים** — "עצור ושמור" נושא
   * את הטיימר, שהוא מידע תפקודי (כמה ייכנס לקובץ) ולא קישוט.
   *
   * **בזמן הקלטה הוא נמתח לכל רוחב השורה.** בקומפוזר זה המקום ש-`+`
   * והתיבה פינו; בטופס זו שורה משלו מתחת לשני כפתורי המדיה. בשני
   * המקרים הנימוק זהה — "עצור ושמור" נושא טיימר, והוא חייב להישאר קריא
   * לצד "בטל". פרופ נוסף היה מקודד את אותו מידע פעמיים.
   */
  icon?: boolean;
  /**
   * מדווח להורה שההקלטה החלה או הסתיימה.
   *
   * הקומפוזר צריך לדעת כדי להוריד את `+` ואת התיבה. הדיווח נעשה כאן ולא
   * נגזר מבחוץ, מפני שההקלטה מסתיימת גם בלי לחיצה — `onstop` יורה גם
   * בביטול וגם בפירוק הרכיב.
   */
  onRecordingChange?: (recording: boolean) => void;
  /**
   * מוסתר לגמרי (מוחזר `null`).
   *
   * **הפרופ קיים כדי שהאלמנט לא יזוז ממקומו ב-JSX.** הקומפוזר מחליף בין
   * מיקרופון לכפתור שליחה באותו מקום, והדרך הטבעית — לרנדר את המקליט
   * בענף אחד ואת השליחה באחר — הייתה **מפרקת ומרכיבה** אותו: React מזהה
   * אלמנט לפי מיקומו, ה-cleanup קורא ל-`stopTracks`, וההקלטה מתה באמצע.
   * הבדיקות מרנדרות את הרכיב לבדו ולעולם לא היו תופסות את זה.
   */
  hidden?: boolean;
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
 *
 * **הביטול הוא פעולה בזמן ההקלטה, לא אחריה.** קודם לכן הייתה דרך אחת
 * לצאת מהקלטה — לעצור אותה, ואז הקובץ כבר עלה לשרת ונרשם, והסרתו הייתה
 * פעולה שנייה על צ׳יפ ברשימה. מי שהתחיל להקליד־בקול והתחרט העלה בכל פעם
 * הקלטת סרק. עכשיו "בטל" מוצג לצד "עצור ושמור" כל עוד ההקלטה רצה.
 */
export function AudioRecorder({
  onRecorded,
  onError,
  disabled,
  icon,
  onRecordingChange,
  hidden,
}: AudioRecorderProps) {
  const [recording, setRecording] = useState(false);
  /**
   * ההרשאה נבדקת, ההקלטה טרם התחילה.
   *
   * לא קוסמטיקה: `getUserMedia` ממתין לאישור המשתמש, ובזמן הזה הכפתור נראה
   * כאילו הלחיצה נבלעה. לחיצה שנייה הייתה פותחת **זרם שני** ודורסת את
   * ‏`recorderRef` — כלומר הראשון נשאר פתוח לנצח והמיקרופון ממשיך לדלוק
   * בלי שום דרך לכבותו. התגלה בהרצה בפועל.
   */
  const [starting, setStarting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  /**
   * ‏ref ולא state, וזו הנקודה: `MediaRecorder.stop()` יורה `onstop` תמיד,
   * ואין ב-API דרך "לזרוק" הקלטה. הביטול הוא לכן החלטה **להתעלם** מה-blob
   * — והיא חייבת להיות קריאה בתוך `onstop`, שרץ מחוץ למחזור הרינדור.
   * ‏state היה מתעדכן מאוחר מדי, וההקלטה המבוטלת הייתה עולה בכל זאת.
   */
  const cancelledRef = useRef(false);

  // עצירה בעת פירוק הרכיב: בלעדיה נורית המיקרופון נשארת דולקת אחרי מעבר
  // מסך, וזו התנהגות שנראית למשתמש כמו האזנה.
  useEffect(() => {
    return () => stopTracks(recorderRef.current);
  }, []);

  /**
   * מונה הזמן החולף.
   *
   * לא קישוט: בלעדיו אין שום חיווי שההקלטה באמת רצה — הכפתור מחליף טקסט
   * וזהו. מנהל שמדבר לתוך מיקרופון חסום ראה מסך זהה למסך של הקלטה תקינה.
   */
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  async function start() {
    if (starting || recording) return;

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      onError(he.media.micUnavailable);
      return;
    }

    setStarting(true);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // דחייה של המשתמש ותקלת חומרה נראות זהות ב-API. הנוסח מכוון לסיבה
      // השכיחה, שהיא הרשאה שלא ניתנה.
      onError(he.media.micDenied);
      return;
    } finally {
      setStarting(false);
    }

    const recorder = new MediaRecorder(stream, pickMimeType());
    chunksRef.current = [];
    cancelledRef.current = false;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      const type = recorder.mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      stopTracks(recorder);
      setRecording(false);
      onRecordingChange?.(false);
      setSeconds(0);

      // הבתים נאספו ממילא — מה שהביטול עושה הוא לא להעביר אותם הלאה,
      // כלומר לא לרשום מדיה בשרת ולא להעלות דבר.
      if (cancelledRef.current) return;
      if (blob.size > 0) {
        onRecorded(new File([blob], `${he.media.audioLabel}.webm`, { type }));
      }
    };

    recorder.start();
    recorderRef.current = recorder;
    setSeconds(0);
    setRecording(true);
    onRecordingChange?.(true);
  }

  function stop() {
    cancelledRef.current = false;
    recorderRef.current?.stop();
  }

  function cancel() {
    cancelledRef.current = true;
    recorderRef.current?.stop();
  }

  // מוסתר — אך **נשאר באותו מיקום ב-JSX** אצל ההורה. ראו `hidden`.
  if (hidden && !recording) return null;

  if (!recording) {
    /*
     * ‏`label` הוא אותה מחרוזת בשני המצבים, ומשמש פעמיים בכוונה: כטקסט גלוי
     * במצב הרגיל, וכ-`aria-label` במצב האייקון. **השם הנגיש אינו משתנה** —
     * וזה מה שמשאיר את `getByRole("button", { name: "הקלט" })` בחבילות
     * ה-e2e עובד אחרי המעבר לאייקון (DESIGN.md § אייקונים).
     */
    const label = starting ? he.media.micStarting : he.media.record;

    return (
      <button
        type="button"
        disabled={disabled || starting}
        onClick={() => void start()}
        aria-pressed={false}
        aria-label={icon ? label : undefined}
        /*
         * שלושת הכפתורים כאן נשארים כתובים ביד (חריג מתועד ב-
         * `tests/unit/primitives.test.ts`), כי המראה שלהם הוא **מצב**: אותו
         * פקד עצמו הוא מסגרת שקטה לפני ההקלטה ומילוי אדום בתוכה, ו-`Button`
         * אינו מחליף וריאנט תוך כדי. מה שהם כן חייבים לרשת הוא הצורה:
         * ‏4px עיגול, וגובה הפקד הקומפקטי. קודם הם ישבו על `rounded-xl`
         * ועל `min-h-11` — שלוש מידות שאינן מידה של אף פקד.
         *
         * **הגובה נכתב כאן ולא מגיע מההורה.** עד לאיחוד `MediaPicker` הוא
         * היה `className` שההורה דרס ב-64px, ומשירד אותו כפתור נשאר פרופ
         * בלי קורא — כלומר בדיוק ההפשטה לתרחיש שאינו קיים שהתקן אוסר.
         */
        className="min-h-7 rounded-sm border border-border px-2 text-sm font-medium disabled:opacity-60"
      >
        {/* טקסט מפורש בזמן המתנה להרשאה — כפתור שנראה כאילו הלחיצה נבלעה
            הוא בדיוק מה שדווח מהשטח על פקדים אחרים. במצב האייקון החיווי
            הזה נשמר דרך `aria-label`, שמתחלף באותה מחרוזת. */}
        {icon ? <Mic className="size-3" aria-hidden="true" /> : label}
      </button>
    );
  }

  return (
    // **במצב האייקון השורה כולה היא המקליט:** ‏`w-full` מותח אותו על המקום
    // ש-`+` והתיבה פינו בקומפוזר, ועל שורה משלו בטופס — כדי שהטיימר יישאר
    // קריא ליד "עצור ושמור". בלי `icon` (טקסט) הוא נשאר פקד בשורה.
    <div
      className={`flex items-stretch gap-2 ${icon ? "w-full text-sm" : "text-sm"}`}
      // הכרזה לקורא מסך שההקלטה החלה. הטיימר לבדו הוא מספר שמשתנה כל
      // שנייה — הכרזה עליו הייתה רעש, ולכן הוא `aria-hidden` והמצב נמסר פעם אחת.
      role="group"
      aria-label={he.media.recording}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={stop}
        aria-pressed
        className="min-h-7 flex-1 rounded-sm bg-danger px-2 font-medium text-brand-fg disabled:opacity-60"
      >
        {he.media.stopRecording}
        {/* הזמן צמוד לפעולה השומרת, כי הוא מתאר אותה: כמה ייכנס לקובץ.
            ‏`dir="ltr"` — שעון הוא מספר ולא טקסט עברי. */}
        <span dir="ltr" aria-hidden className="ms-2 tabular-nums">
          {formatElapsed(seconds)}
        </span>
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={cancel}
        className="min-h-7 rounded-sm border border-border px-2 font-medium disabled:opacity-60"
      >
        {he.media.cancelRecording}
      </button>
    </div>
  );
}

/** ‏m:ss — הקלטה בשטח נמדדת בשניות ובדקות בודדות, ולא בשעות */
function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
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
