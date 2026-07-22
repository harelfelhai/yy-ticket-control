import { UserFacingError } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import type { Viewer } from "@/lib/permissions";
import { toViewer } from "@/lib/session";
import { resolveToken } from "./portal";

/**
 * מזהה את מבצע הפעולה — משתמש פנימי או נמען חיצוני — בנקודה אחת.
 *
 * קיים בגלל המדיה. עד M3 כל פעולה שייכה לצד אחד בלבד: מסך הפנייה ידע
 * שמדובר במשתמש מחובר, והפורטל ידע שמדובר בטוקן. צירוף קובץ הוא הפעולה
 * הראשונה שאותו קוד בדיוק משרת את שניהם — קבלן מגיב בתמונה מהשטח, ומנהל
 * מצרף צילום של הליקוי.
 *
 * שכפול ההיגיון הזה לשני מסלולים היה מזמין את הכשל הקלאסי: תיקון הרשאה
 * באחד מהם ולא באחר.
 */
export async function resolveViewer(token?: string | null): Promise<Viewer> {
  if (!token) {
    // ‏requireUser מפנה למסך ההתחברות אם אין סשן, ולכן אין כאן ענף כושל.
    return toViewer(await requireUser());
  }

  const identity = await resolveToken(token);
  if (!identity) throw new UserFacingError(he.portal.expired);

  return { kind: "professional", id: identity.professionalId };
}
