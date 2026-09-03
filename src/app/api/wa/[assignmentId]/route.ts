import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { UserFacingError } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { captureError } from "@/lib/observability/log";
import { toViewer } from "@/lib/session";
import { openWhatsApp } from "@/lib/services/delivery";

/**
 * "שלח בוואטסאפ" — מתעד את הפתיחה, ואז מפנה ל-`wa.me`.
 *
 * **למה נתיב שרת ולא קישור ישיר ל-`wa.me`.** שתי סיבות, ושתיהן נלמדו:
 *
 * 1. **הרישום חייב לשרוד את היציאה מהדפדפן.** בנייד `wa.me` מוסר את השליטה
 *    לאפליקציית וואטסאפ, והדף שמאחור עלול להיפרק. פעולה אסינכרונית שנשלחה
 *    מ-`onClick` ו"תסתדר בהמשך" היא בדיוק מה שנקטע שם — ודווקא במכשיר שבו
 *    כל התרחיש הזה חי. כאן הכתיבה קורית **לפני** ההפניה, בשרת.
 * 2. **קישור הקסם מפסיק לנסוע ללקוח.** קודם כתובת ה-`wa.me` המלאה — ובתוכה
 *    סוד הגישה של הקבלן — נבנתה בשרת ונשלחה ב-payload של המסך לכל נמען.
 *    עכשיו הלקוח מחזיק מזהה שיוך בלבד, והסוד נבנה כאן ברגע הלחיצה.
 *
 * ‏GET שמשנה מצב הוא חריג מודע: זהו קישור שנפתח בלשונית, וזו הצורה היחידה
 * שבה דפדפן מוכן לפתוח אפליקציה חיצונית מתוך מחווה של המשתמש. הרישום אינו
 * הרסני ואינו נצבר — הוא חותמת זמן שנדרסת.
 */
export async function GET(request: Request, context: RouteContext<"/api/wa/[assignmentId]">) {
  const { assignmentId } = await context.params;

  try {
    const viewer = toViewer(await requireUser());
    const url = await openWhatsApp(viewer, assignmentId);
    return NextResponse.redirect(url);
  } catch (error) {
    // ‏redirect למסך ההתחברות (משתמש לא מחובר) חייב לעבור הלאה כמו שהוא.
    unstable_rethrow(error);

    // שיוך שאינו קיים, נמען בלי טלפון, או צופה שאינו רשאי — כולם 404.
    // הבחנה ביניהם בתשובה הייתה מגלה לצופה זר אילו שיוכים קיימים.
    if (error instanceof UserFacingError) {
      return NextResponse.json({ error: he.ticket.notFound }, { status: 404 });
    }

    captureError(error, { tags: { route: "wa" }, fingerprint: ["wa-open"] });
    return NextResponse.json({ error: he.ticket.notFound }, { status: 404 });
  }
}
