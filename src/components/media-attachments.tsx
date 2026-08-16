import { he } from "@/lib/he";
import { type MediaView, mediaKind } from "@/lib/media-view";
import { ROW_LIST } from "@/lib/ui";

interface MediaAttachmentsProps {
  media: MediaView[];
}

/**
 * הצגת הקבצים המצורפים להודעה בשרשור.
 *
 * ‏Server Component: אין כאן שום התנהגות שדורשת JavaScript, והתמונות
 * צריכות להיטען גם לפני hydration — מנהל שפותח פנייה ברשת סלולרית חלשה
 * רואה את התמונה לפני שהדף "מתעורר".
 *
 * ‏`<img>` רגיל ולא `next/image`: הכתובת עוברת דרך route שבודק הרשאה
 * ומפנה לכתובת חתומה שתקפה חמש דקות. אופטימיזציית תמונות של Next הייתה
 * מנסה לשמור אותן במטמון משותף — כלומר להוציא קובץ של פנייה מגדר ההרשאה
 * שהוגדרה לו.
 */
export function MediaAttachments({ media }: MediaAttachmentsProps) {
  if (media.length === 0) return null;

  return (
    <ul className={`mt-2 ${ROW_LIST}`}>
      {media.map((file) => (
        <li key={file.id} className="flex flex-col gap-1">
          {renderFile(file)}
          {file.aiText ? (
            <p className="rounded-lg bg-surface p-2 text-sm">
              <span className="text-xs font-medium text-muted">
                {mediaKind(file.mimeType) === "audio"
                  ? he.ai.transcriptionLabel
                  : he.ai.extractionLabel}
                :{" "}
              </span>
              {file.aiText}
            </p>
          ) : null}
          {file.aiNote ? <p className="text-xs text-muted">{file.aiNote}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function renderFile(file: MediaView) {
  switch (mediaKind(file.mimeType)) {
    case "image":
      return (
        <a href={file.url} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element -- ראה הערת הרכיב */}
          <img
            src={file.url}
            alt={file.name || he.media.imageAlt}
            loading="lazy"
            className="max-h-72 w-full rounded-xl object-cover"
          />
        </a>
      );

    case "video":
      return (
        <video controls preload="metadata" className="max-h-72 w-full rounded-xl">
          <source src={file.url} type={file.mimeType.split(";")[0]} />
        </video>
      );

    case "audio": {
      /*
       * ‏controls ולא נגן משלנו: נגן הדפדפן נגיש, מוכר, ועובד גם כשה-JS
       * של האפליקציה עוד לא נטען.
       *
       * ‏`w-72` ולא `w-full` — DESIGN.md § מדיה בבועה. רוחב באחוזים אינו תורם
       * למדידת ה-max-content של בועה שמתכווצת לתוכן, ובהודעה שיש בה הקלטה
       * בלבד הנגן נדחס לרוחב חותמת השעה עד שנשאר ממנו כפתור ה-⋮ לבדו.
       *
       * התווית **נראית**, כי `aria-label` לבדו משאיר על המסך מלבן אפור בלי
       * מילה שאומרת מה זה. ‏`aria-labelledby` מקשר אותה לנגן; `aria-label`
       * לצידה היה מקריא את אותו טקסט פעמיים.
       */
      const labelId = `audio-label-${file.id}`;
      return (
        <div className="flex flex-col gap-1">
          <span id={labelId} className="text-xs font-medium text-muted">
            {he.media.audioLabel}
          </span>
          <audio
            controls
            preload="metadata"
            aria-labelledby={labelId}
            className="w-72 max-w-full"
          >
            <source src={file.url} type={file.mimeType.split(";")[0]} />
          </audio>
        </div>
      );
    }

    default:
      return (
        <a
          href={file.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm font-medium text-brand"
        >
          {he.media.fileLabel(file.name)}
        </a>
      );
  }
}
