"use client";

import * as Sentry from "@sentry/nextjs";
import { useId, useRef, useState } from "react";
import { confirmUploadAction, registerMediaAction } from "@/app/media-actions";
import { he } from "@/lib/he";
import { mediaKind } from "@/lib/media-view";
import { useHydrated } from "@/lib/use-hydrated";
import { AudioRecorder } from "./audio-recorder";

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
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const hydrated = useHydrated();
  const busy = disabled || !hydrated;

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
    setUploading((n) => n + selected.length);

    try {
      const results = await Promise.all(Array.from(selected).map(upload));
      const added = results.filter((item): item is AttachedFile => item !== null);
      if (added.length > 0) onChange([...files, ...added]);
    } finally {
      setUploading((n) => Math.max(0, n - selected.length));
      // איפוס הערך מאפשר לבחור שוב את אותו קובץ אחרי הסרה. בלעדיו הדפדפן
      // אינו מדווח על שינוי, והבחירה השנייה פשוט לא קורית.
      if (fileInput.current) fileInput.current.value = "";
      if (cameraInput.current) cameraInput.current.value = "";
    }
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
            <li
              key={file.mediaId}
              className="flex items-center gap-2 rounded-xl border border-border bg-bg p-2"
            >
              {file.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- blob: מקומי, next/image אינו מטפל בו
                <img
                  src={file.previewUrl}
                  alt={he.media.imageAlt}
                  className="size-12 rounded-lg object-cover"
                />
              ) : (
                <span className="max-w-40 truncate text-sm">{file.name}</span>
              )}
              <button
                type="button"
                onClick={() => remove(file.mediaId)}
                aria-label={`${he.media.remove}: ${file.name}`}
                className="min-h-11 shrink-0 px-2 text-sm font-medium text-danger"
              >
                ×
              </button>
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
                onClick={() => cameraInput.current?.click()}
                className="min-h-16 rounded-xl border border-brand bg-brand/10 px-3 text-base font-semibold text-brand disabled:opacity-60"
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
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
              className="min-h-11 self-start px-1 text-sm font-medium text-brand disabled:opacity-60"
            >
              {he.media.attach}
            </button>
            {uploading > 0 ? (
              <span role="status" className="text-sm text-muted">
                {he.media.uploading}
              </span>
            ) : null}
          </div>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
              className="min-h-11 rounded-xl border border-border px-3 text-sm font-medium disabled:opacity-60"
            >
              {he.media.attach}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => cameraInput.current?.click()}
              className="min-h-11 rounded-xl border border-border px-3 text-sm font-medium disabled:opacity-60"
            >
              {he.media.camera}
            </button>

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

      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
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
