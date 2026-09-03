import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";

/**
 * ‏Next 16 החליף את `middleware.ts` ב-`proxy.ts` (ה-export חייב להיקרא `proxy`).
 *
 * כאן מתבצעת **בדיקה אופטימית בלבד**: קיום עוגיית ההתחברות. המטרה היא
 * לחסוך למשתמש לא מחובר טעינת מסך שלם שממילא יפנה אותו החוצה.
 *
 * ההרשאה האמיתית נבדקת ב-`requireUser()` בתוך המסך המוגן, מול ה-DB. חלוקה
 * זו מכוונת: עוגייה תקפה אינה מוכיחה שהמשתמש עדיין פעיל או שתפקידו לא
 * השתנה, ובדיקה שמסתמכת רק עליה הופכת התנתקות מנהל לפעולה שנכנסת לתוקף
 * רק בעוד 30 יום.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE_NAME)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  // שומרים לאן המשתמש ניסה להגיע, כדי להחזיר אותו לשם אחרי ההתחברות —
  // קישור לפנייה שנשלח בוואטסאפ צריך להגיע ליעד גם אם הסשן פג בדרך.
  loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  /**
   * רק המסכים הפנימיים. מה שנשאר בחוץ במכוון:
   * - `/login` — נגיש בהכרח למי שאינו מחובר.
   * - `/p/...` — פורטל הנמען החיצוני, שנכנס בקישור אישי ולא בסשן.
   * - `/api/...` — מאמת בעצמו, ומחזיר 401 במקום הפניה למסך.
   */
  matcher: [
    "/board/:path*",
    "/tickets/:path*",
    "/tags/:path*",
    "/search/:path*",
    "/overview/:path*",
    "/admin/:path*",
    // ‏`/account` (1.1). מסך פנימי שנשכח כאן אינו נשאר בלי הגנה — `requireUser`
    // ב-layout תופס אותו — אבל הוא **מאבד את `?next=`**: המסלול דרך
    // `SESSION_ENDED_PATH` מפנה ל-`/login` בלי היעד, ולכן המשתמש נוחת ב-`/board`
    // אחרי ההתחברות במקום לחזור לאן שניסה להגיע.
    "/account/:path*",
  ],
};
