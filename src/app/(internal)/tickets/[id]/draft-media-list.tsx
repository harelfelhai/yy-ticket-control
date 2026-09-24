"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cardClasses } from "@/components/ui/card";
import { FormError } from "@/components/ui/message";
import { he } from "@/lib/he";
import { type MediaView, mediaKind } from "@/lib/media-view";
import { useAction } from "@/lib/use-action";
import { removeDraftMediaAction } from "./actions";

/**
 * הקבצים שבטיוטה ממייל, עם "הסר קובץ" לכל אחד (אפיון מסך 7, EM-S7-05).
 *
 * הצורך המיידי הוא לוגו בחתימת המייל: הוא נכנס לטיוטה כתמונה משובצת (§2.6
 * שלב 3), ובלי הסרה היה מוצג לנמענים אחרי השיגור. **ההסרה חלה על הטיוטה
 * בלבד** — קובץ שהגיע במייל נשאר בהתכתבות, שהיא התיעוד של מה שנשלח
 * למערכת, והשורה שמתחת לרשימה אומרת זאת במילים. לכן `X` ולא `Trash2`, ובלי
 * `window.confirm`: זו אותה משמעות לא-הרסנית של הסרת קובץ מהטופס (DESIGN.md
 * § אייקונים). "כל קובץ מדיה ניתן להסרה" (§7 שורה 68) חל גם על קובץ שצורף
 * לטיוטה בשרשור; הוא אינו בהתכתבות, אבל גם לא נשלח מעולם לאיש.
 *
 * אותה תבנית של `AttachedFiles` — אריח קומפקטי, תמונה ממוזערת או שם — על
 * קבצים שכבר בשרת ולא על קבצים שבדרך.
 */
export function DraftMediaList({ ticketId, media }: { ticketId: string; media: MediaView[] }) {
  const { busy, error, run } = useAction();

  if (media.length === 0) return null;

  return (
    <section aria-label={he.emailDraft.draftFiles} className="flex flex-col gap-1">
      <p className="text-sm font-medium">{he.emailDraft.draftFiles}</p>
      <ul className="flex flex-wrap gap-2">
        {media.map((file, index) => {
          /*
           * תמונה משובצת בגוף המייל — המקרה המרכזי כאן, לוגו בחתימה — מגיעה
           * לעיתים בלי שם קובץ. בלי שם חלופי כל האריחים היו נושאים את אותו שם
           * נגיש ("הסר קובץ: "), וקובץ שאינו תמונה היה אריח ריק. המספור הוא
           * מקומו ברשימה, כדי ששני קבצים בלי שם יהיו ניתנים לאיתור בנפרד.
           */
          const name = file.name || he.emailDraft.unnamedAttachmentN(index + 1);
          return (
            <li key={file.id} className={cardClasses("flex items-center gap-2", { padding: "compact" })}>
              {mediaKind(file.mimeType) === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element -- הכתובת עוברת דרך route שבודק הרשאה; ראה media-attachments.tsx
                <img src={file.url} alt={file.name || he.media.imageAlt} className="size-12 rounded-sm object-cover" />
              ) : (
                <span className="max-w-40 truncate text-sm">{name}</span>
              )}
              <Button
                variant="dangerQuiet"
                size="compact"
                disabled={busy}
                onClick={() => run(() => removeDraftMediaAction(ticketId, file.id))}
                aria-label={`${he.media.remove}: ${name}`}
                className="shrink-0"
              >
                <X className="size-3" aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">{he.emailDraft.mediaKept}</p>
      {error ? <FormError>{error}</FormError> : null}
    </section>
  );
}
