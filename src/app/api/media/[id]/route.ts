import { NextResponse } from "next/server";
import { getViewableMedia } from "@/lib/services/media";
import { resolveViewer } from "@/lib/services/viewer";
import { selectStorage } from "@/lib/storage";

/**
 * הגשת קובץ מדיה — אחרי בדיקת הרשאה, ולעולם לא מכתובת ציבורית.
 *
 * שני מסלולי הגשה, לפי מה שהאחסון מציע:
 * - יש כתובת ישירה (R2): הפניה לכתובת חתומה שתקפה חמש דקות. הבתים אינם
 *   עוברים דרך השרת, וקישור שדלף מת מעצמו.
 * - אין (אחסון מקומי): הבתים מוגשים מכאן.
 *
 * הטוקן מגיע כפרמטר בכתובת, כי הנמען החיצוני אינו מחזיק עוגיית סשן. אותה
 * בדיקה בדיוק חלה על שני סוגי הצופים: `canViewTicket` על הפנייה שאליה
 * הקובץ מצורף.
 */
export async function GET(request: Request, context: RouteContext<"/api/media/[id]">) {
  const { id } = await context.params;
  const token = new URL(request.url).searchParams.get("t");

  const viewer = await resolveViewer(token).catch(() => null);
  if (!viewer) return notFound();

  const media = await getViewableMedia(viewer, id);
  if (!media) return notFound();

  const storage = selectStorage();
  const directUrl = await storage.createDownloadUrl(media.storageKey);
  if (directUrl) return NextResponse.redirect(directUrl);

  const body = await storage.read(media.storageKey);

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": media.mimeType,
      "Content-Length": String(body.byteLength),
      // ‏inline ולא attachment: תמונה בשרשור אמורה להיפתח, לא לרדת.
      // שם הקובץ מקודד כי הוא מגיע מהמשתמש ועשוי להכיל עברית או פסיקים.
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(
        media.originalName ?? "file",
      )}`,
      // פרטי ולא ציבורי: הקובץ שייך לפנייה, ואסור שיישמר במטמון משותף.
      "Cache-Control": "private, max-age=300",
    },
  });
}

/** אותה תשובה לקובץ שאינו קיים ולקובץ שאין הרשאה אליו */
function notFound() {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
