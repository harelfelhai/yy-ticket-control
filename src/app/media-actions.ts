"use server";

import { z } from "zod";
import { type ActionResult, guard } from "@/lib/action-result";
import type { RegisteredMediaView } from "@/lib/media-view";
import { confirmUpload, registerMedia } from "@/lib/services/media";
import { resolveViewer } from "@/lib/services/viewer";

/**
 * הפעולות שמאחורי צירוף קובץ, משותפות למסך הפנייה ולפורטל הקבלן.
 *
 * ‏`token` אופציונלי: כשהוא קיים הפועל הוא נמען חיצוני, וכשאינו — משתמש
 * מחובר. ההבחנה נעשית ב-`resolveViewer` ובמקום אחד בלבד, כדי שלא ייווצרו
 * שני מסלולי הרשאה שרק אחד מהם מתוקן כשמשהו משתנה.
 *
 * הפעולות אינן זורקות אלא מחזירות `ActionResult`: ‏Next מצנזר שגיאות של
 * Server Actions בפרודקשן ומחליף אותן בטקסט גנרי, ואז "הקובץ גדול מדי"
 * היה מגיע למשתמש כ"משהו השתבש".
 */

const registerSchema = z.object({
  ticketId: z.string().min(1),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive(),
  originalName: z.string().max(300).optional(),
  token: z.string().min(1).optional(),
});

export async function registerMediaAction(
  input: z.input<typeof registerSchema>,
): Promise<ActionResult<RegisteredMediaView>> {
  return guard(async () => {
    const parsed = registerSchema.parse(input);
    const viewer = await resolveViewer(parsed.token);

    return registerMedia(viewer, {
      ticketId: parsed.ticketId,
      mimeType: parsed.mimeType,
      sizeBytes: parsed.sizeBytes,
      originalName: parsed.originalName,
    });
  });
}

const confirmSchema = z.object({
  mediaId: z.string().min(1),
  token: z.string().min(1).optional(),
});

/**
 * מדווח שההעלאה הושלמה.
 *
 * הזהות נבדקת מחדש גם כאן ולא רק ברישום: ‏Server Action היא נקודת כניסה
 * ציבורית, ובלי הבדיקה כל אחד היה יכול לסמן קבצים של אחרים כמוכנים.
 */
export async function confirmUploadAction(
  input: z.input<typeof confirmSchema>,
): Promise<ActionResult> {
  return guard(async () => {
    const parsed = confirmSchema.parse(input);
    await resolveViewer(parsed.token);
    await confirmUpload(parsed.mediaId);
  });
}
