import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { GOOGLE_START_PATH, buildGoogleAuthorization, googleRedirectUri } from "@/lib/google-oauth";
import { logInfo, logWarn } from "@/lib/observability/log";
import { saveOauthState } from "@/lib/oauth-state";
import { safeNextPath } from "@/lib/safe-next";
import { getSessionUser } from "@/lib/session";
import { isGoogleLoginConfigured } from "@/lib/services/google-login";

/**
 * פותח את זרימת ההתחברות בגוגל: מייצר את הסודות, שומר אותם בעוגייה, ומפנה.
 *
 * **‏Route Handler ולא Server Action, וזה אילוץ CSP ולא סגנון.** ה-CSP של
 * המערכת נושא `form-action 'self'` (`src/lib/security-headers.ts`), והדירקטיבה
 * הזו נאכפת גם על **שרשרת ההפניות שאחרי שיגור טופס** — לא רק על היעד הראשון.
 * טופס ששולח ל-Server Action שמפנה ל-`accounts.google.com` נחסם בדפדפן,
 * והחסימה מגיעה כשגיאת CSP בקונסול ולא כהודעה במסך. ניווט GET רגיל אינו כפוף
 * ל-`form-action`, ולכן הכפתור במסך ההתחברות הוא `<a>`. **לא להמיר את זה
 * לטופס** — זה נראה כמו פישוט ושובר התחברות, בפרודקשן בלבד.
 *
 * מאותה סיבה הכפתור אינו `ButtonLink`: `next/link` עושה prefetch של היעד,
 * כלומר היה פותח זרימה חדשה ושומר עוגייה בכל טעינה של מסך ההתחברות — ודורס
 * את ה-`state` של הזרימה שהמשתמש באמת התחיל.
 *
 * הנתיב אינו ב-matcher של `proxy.ts` (`/api/*` נשאר בחוץ בכוונה), ולכן הוא
 * נגיש למי שאינו מחובר — וזה כל תפקידו.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // מי שמחזיק סשן תקף אינו צריך להתחבר. בלי זה, לחיצה על קישור שנשמר
  // בסימניות הייתה פותחת זרימה חדשה ומחליפה סשן קיים בלי סיבה.
  if (await getSessionUser()) redirect("/board");

  if (!isGoogleLoginConfigured()) {
    // הכפתור אינו מוצג כשאין תצורה, ולכן הגעה לכאן היא קישור שנשמר או
    // תצורה שהוסרה. הודעה בעברית עדיפה על 500.
    logWarn("google_login.unconfigured", { path: GOOGLE_START_PATH });
    redirect("/login?error=unavailable");
  }

  // ‏`safeNextPath` **בדרך פנימה**, כדי שערך לא-מאומת לא ייכנס לעוגייה כלל.
  // ה-callback מריץ אותו שוב לפני ההפניה האחרונה — כך שערובת אי-ההפניה
  // החוצה אינה תלויה בשלמות העוגייה.
  const next = safeNextPath(new URL(request.url).searchParams.get("next"));

  const challenge = await buildGoogleAuthorization(googleRedirectUri(env.appBaseUrl()));

  await saveOauthState({
    state: challenge.state,
    nonce: challenge.nonce,
    codeVerifier: challenge.codeVerifier,
    next,
  });

  logInfo("google_login.started");

  // בלי `try/catch`: שום דבר כאן אינו צפוי להיכשל, וזריקה בלתי צפויה צריכה
  // להגיע ל-`onRequestError` → Sentry ולא להיבלע בהפניה שקטה.
  redirect(challenge.url.toString());
}
