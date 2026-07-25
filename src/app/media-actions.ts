"use server";

import { z } from "zod";
import { type ActionResult, guard } from "@/lib/action-result";
import { he } from "@/lib/he";
import type { RegisteredMediaView } from "@/lib/media-view";
import type { Viewer } from "@/lib/permissions";
import { MediaError, confirmUpload, registerMedia } from "@/lib/services/media";
import { allowPortalAction } from "@/lib/services/portal";
import { resolveViewer } from "@/lib/services/viewer";

/**
 * הגבלת קצב לפעולות כתיבה של קבלן, גם על מדיה.
 *
 * בלי זה קבלן משויך יכול לרשום קבצים ולקבל כתובות העלאה ללא הגבלה, ולעקוף
 * את מכסת 30/דקה שחלה על שאר פעולות הפורטל. משתמש פנימי אינו מוגבל.
 */
async function throttlePortal(viewer: Viewer): Promise<void> {
  if (viewer.kind === "professional" && !(await allowPortalAction(viewer.id))) {
    throw new MediaError(he.portal.tooManyActions);
  }
}

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
  /** חסר במסך היצירה — ראה `registerMedia` */
  ticketId: z.string().min(1).optional(),
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
    await throttlePortal(viewer);

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
    const viewer = await resolveViewer(parsed.token);
    await throttlePortal(viewer);
    await confirmUpload(viewer, parsed.mediaId);
  });
}
