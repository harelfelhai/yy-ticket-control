import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { UserFacingError } from "@/lib/action-result";
import { db } from "@/lib/db";
import { captureError } from "@/lib/observability/log";
import type { Viewer } from "@/lib/permissions";
import { canViewCorrespondence } from "@/lib/services/email-correspondence";
import { resolveViewer } from "@/lib/services/viewer";
import { serveStoredFile } from "@/lib/storage/serve";

/**
 * הגשת קובץ משיחת הוואטסאפ (`WaMedia`) — אחרי בדיקת הרשאה, ולעולם לא מכתובת
 * ציבורית. המקבילה של `api/email-attachments/[id]` (ראו שם), באותו מבנה:
 *
 * 1. **ההרשאה היא של השיחה.** קובץ ← הודעה ← שיחה ← פנייה, ו-`canViewCorrespondence`
 *    היא הכתובת היחידה ל"מותר לצופה לראות את ההתכתבות של הפנייה" — הקובץ חלק
 *    ממנה (WA-M01). נמען חיצוני אינו רואה אותה לעולם: היא כוללת גם את מה שהוסר
 *    מהטיוטה בכוונה (WA-S7-03). שיחה של טיוטה שנמחקה (`WaThread.ticketId` מתאפס)
 *    נופלת ל"לא נמצא" לפני בדיקת ההרשאה, כמו מזהה שאינו קיים.
 * 2. **לא לכל קובץ יש בתים.** קובץ שלא נשמר (גדול מדי, ההורדה מוואטסאפ נכשלה)
 *    נרשם בשיחה בלי `storageKey`, והתשובה היא "לא נמצא". הקובץ נשאר שמור גם
 *    אחרי "הסר קובץ" מהטיוטה — הבתים משותפים לו ולקובץ המדיה, וההסרה מוחקת רק
 *    את רשומת המדיה.
 */
export async function GET(request: Request, context: RouteContext<"/api/wa-media/[id]">) {
  const { id } = await context.params;
  const token = new URL(request.url).searchParams.get("t");
  // אותה הבחנה כמו בשאר הנתיבים: "טוקן לא תקף" (צפוי) מול "שגיאת שרת" (לא צפוי).
  let viewer: Viewer;
  try {
    viewer = await resolveViewer(token);
  } catch (error) {
    // הפניה למסך ההתחברות (משתמש פנימי בלי סשן) חייבת לעבור הלאה כמו שהיא
    unstable_rethrow(error);
    if (error instanceof UserFacingError) return notFound();
    captureError(error, { tags: { route: "wa-media" }, fingerprint: ["wa-media-resolve-viewer"] });
    return notFound();
  }

  const media = await getViewableWaMedia(viewer, id);
  if (!media || !media.storageKey) return notFound();

  return serveStoredFile({
    storageKey: media.storageKey,
    mimeType: media.mimeType,
    filename: media.filename,
    download: !media.isMedia,
  });
}

/** הקובץ, אם הצופה רשאי לראות את השיחה שהוא שייך לה — אחרת null */
async function getViewableWaMedia(viewer: Viewer, mediaId: string) {
  const media = await db.waMedia.findUnique({
    where: { id: mediaId },
    select: {
      filename: true,
      mimeType: true,
      isMedia: true,
      storageKey: true,
      message: { select: { thread: { select: { ticketId: true } } } },
    },
  });
  if (!media) return null;

  const ticketId = media.message.thread?.ticketId;
  if (!ticketId) return null;

  return (await canViewCorrespondence(viewer, ticketId)) ? media : null;
}

function notFound() {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
