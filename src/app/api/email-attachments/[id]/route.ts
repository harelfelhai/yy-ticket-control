import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { UserFacingError } from "@/lib/action-result";
import { db } from "@/lib/db";
import { captureError } from "@/lib/observability/log";
import type { Viewer } from "@/lib/permissions";
import { canViewCorrespondence } from "@/lib/services/email-correspondence";
import { resolveViewer } from "@/lib/services/viewer";
import { selectStorage } from "@/lib/storage";

/**
 * הגשת קובץ מצורף מהתכתבות מייל (`MailboxAttachment`) — אחרי בדיקת הרשאה,
 * ולעולם לא מכתובת ציבורית.
 *
 * מראה כמעט זהה ל-`api/media/[id]` (ראו שם), עם שני הבדלים בלבד:
 *
 * 1. **שרשרת ההרשאה ארוכה יותר.** קובץ מדיה תלוי ישירות בהודעה ובפנייה
 *    שלה; קובץ מצורף של מייל תלוי בהודעה (`MailboxMessage`), שתלויה
 *    בשרשרת (`MailThread`), שתלויה בפנייה. הבדיקה עצמה (`canViewTicket`
 *    על הפנייה ושיוכיה) אינה נכתבת כאן שוב — `canViewCorrespondence`
 *    (מודול K, `email-correspondence.ts`) היא כתובת ההרשאה היחידה
 *    ל"האם הצופה רואה את ההתכתבות של הפנייה הזו", ונתיב זה רק מתרגם
 *    מזהה קובץ מצורף למזהה פנייה ומעביר לשם. שרשרת שאין לה `thread`
 *    (עדיין לא שויכה לשום שרשור), או ששרשורה מצביע על טיוטה שנמחקה
 *    (`MailThread.ticketId` הופך `null` ב-SetNull כשהטיוטה נמחקת —
 *    אפיון §2.6 שלב 6, "תשובה במייל אחרי שהטיוטה נמחקה") — שתיהן חסרות
 *    `ticketId` להעביר, ונופלות ל"לא נמצא" **לפני** שמגיעים לבדיקת K,
 *    בדיוק כמו מזהה לא קיים.
 * 2. **לא לכל קובץ יש בתים להגיש.** קובץ שסומן `skippedReason` (גדול מדי,
 *    כפילות לפי sha256, סוג שאינו מדיה שנשמר "בהתכתבות בלבד") נשאר בלי
 *    `storageKey` — נרשם רק כשורה בהתכתבות, ולא הועלה לאחסון בפועל.
 *    "לא נמצא" הוא התשובה הנכונה: אין בתים, ולכן אין מה להגיש.
 *
 * הקישור שקורא לנתיב הזה נבנה במסך שרשור המייל (S8) — לא כאן.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/email-attachments/[id]">,
) {
  const { id } = await context.params;
  const token = new URL(request.url).searchParams.get("t");

  // אותה הבחנה כמו במדיה: "טוקן לא תקף" (צפוי) מול "שגיאת שרת" (לא צפוי).
  // הראשון 404 רגיל; השני עדיין 404 לקורא, אבל נלכד ל-Sentry.
  let viewer: Viewer;
  try {
    viewer = await resolveViewer(token);
  } catch (error) {
    // חריגות בקרה של Next (הפניה למסך התחברות למשתמש פנימי בלי טוקן)
    // חייבות לעבור הלאה — אחרת המשתמש יקבל 404 במקום מסך ההתחברות.
    unstable_rethrow(error);
    if (error instanceof UserFacingError) return notFound();
    captureError(error, {
      tags: { route: "email-attachments" },
      fingerprint: ["email-attachments-resolve-viewer"],
    });
    return notFound();
  }

  const attachment = await getViewableAttachment(viewer, id);
  // storageKey נבדק כאן ולא בתוך getViewableAttachment: הסינון שם הוא הרשאה
  // בלבד, וההיצרות שהשדה כאן אינו null חייבת לקרות בנקודת השימוש בו —
  // אחרת טיפוסי Prisma (`string | null`) לא מצטמצמים דרך גבול הפונקציה.
  if (!attachment || !attachment.storageKey) return notFound();

  const storage = selectStorage();
  const directUrl = await storage.createDownloadUrl(attachment.storageKey);
  if (directUrl) return NextResponse.redirect(directUrl);

  const body = await storage.read(attachment.storageKey);

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(body.byteLength),
      // inline ולא attachment: תמונה בשרשור אמורה להיפתח, לא לרדת.
      // שם הקובץ מקודד כי הוא מגיע מהמייל הנכנס ועשוי להכיל עברית או פסיקים.
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(
        attachment.filename ?? "file",
      )}`,
      // פרטי ולא ציבורי: הקובץ שייך לפנייה, ואסור שיישמר במטמון משותף.
      "Cache-Control": "private, max-age=300",
    },
  });
}

/**
 * שולף קובץ מצורף להגשה, אחרי בדיקת הרשאה על הפנייה שאליה הוא שייך
 * דרך השרשרת: קובץ ← הודעה ← שרשור ← פנייה.
 *
 * שאילתה רזה (`select`, לא `include` של הפנייה כולה) שמביאה רק את מה
 * שהנתיב הזה צריך: בתי הקובץ עצמו, ו-`ticketId` כדי להעביר להכרעת
 * ההרשאה. ההכרעה עצמה — `canViewTicket` על הפנייה ושיוכיה — אינה
 * נכתבת כאן: `canViewCorrespondence` (מודול K) היא כתובת האמת היחידה
 * ל"מותר לצופה הזה לראות את ההתכתבות של הפנייה הזו", וקובץ מצורף הוא
 * חלק מאותה התכתבות בדיוק (EM-M01) — אין הרשאה נפרדת לקובץ בודד.
 * המחיר: סבב DB נוסף (השאילתה שלה, מעל זו שכאן) — מחיר ששווה למניעת
 * שני מימושים של אותה הכרעה, בדיוק כמו שהערת ה-export במודול K קבעה
 * מראש שיקרה.
 */
async function getViewableAttachment(viewer: Viewer, attachmentId: string) {
  const attachment = await db.mailboxAttachment.findUnique({
    where: { id: attachmentId },
    select: {
      filename: true,
      mimeType: true,
      storageKey: true,
      message: { select: { thread: { select: { ticketId: true } } } },
    },
  });

  if (!attachment) return null;

  // thread חסר (עדיין לא שויך לשרשור) או ticketId חסר (טיוטה נמחקה,
  // SetNull על MailThread.ticketId) — שניהם "לא נמצא", ולפני שיש בכלל
  // מזהה פנייה להעביר ל-canViewCorrespondence.
  const ticketId = attachment.message.thread?.ticketId;
  if (!ticketId) return null;

  const allowed = await canViewCorrespondence(viewer, ticketId);
  return allowed ? attachment : null;
}

/** אותה תשובה לקובץ שאינו קיים, לקובץ שאין הרשאה אליו, ולקובץ בלי בתים */
function notFound() {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
