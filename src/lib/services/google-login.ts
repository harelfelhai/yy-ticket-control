import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  type GoogleClaimsVerifier,
  type GoogleLoginErrorCode,
  readGoogleIdentity,
  verifyGoogleCallback,
} from "@/lib/google-oauth";
import { normalizeEmail } from "@/lib/normalize";
import { captureError, logWarn } from "@/lib/observability/log";
import type { OauthState } from "@/lib/oauth-state";
import type { SessionUser } from "@/lib/session";

/**
 * ההכרעה של מסלול ההתחברות בגוגל: מי הזדהה, והאם הוא משתמש במערכת.
 *
 * **מה השירות הזה עושה שונה מכל שירות אחר בפרויקט — והנימוק.** שירות כאן
 * זורק `UserFacingError`, ו-`guard()` בשכבת ה-action ממיר אותו להודעה. הקובץ
 * הזה **במכוון אינו זורק**, ומחזיר קודים. הצרכן שלו אינו Server Action
 * שמרנדר מחרוזת אלא Route Handler ש**מפנה** למסך ההתחברות עם `?error=`, וקוד
 * הוא מה שנוסע בכתובת. `ActionResult` ו-`guard()` אינם מופיעים בפיצ׳ר הזה
 * בכלל — לרשום כאן, כדי שאיש לא "יתקן" את זה בסבב הבא.
 *
 * **הכרעת 1.2: ההתאמה היא לפי `User.email` בלבד.** אין עמודה חדשה, אין
 * מיגרציה, ואין שמירה של ה-`sub` של גוגל. המשמעות המכוונת: מנהל שמשנה מייל
 * למשתמש חותך בכך גם את גישת הגוגל שלו — אותה סמכות שיש לו כבר על הסיסמה.
 *
 * **מה שהמסלול לא מוסיף: צורת סשן שנייה.** הוא נגמר בהחזרת אותו `SessionUser`
 * בדיוק שמחזיר `authenticate()`, ומשם `createSession()` הקיים. לכן `requireUser`
 * ממשיך לרענן מול ה-DB בכל מסך מוגן, `permissions.ts` אינו יודע שהמסלול
 * קיים, והשבתת משתמש מוציאה אותו מיד — הכול בלי מימוש שני.
 */

/** האם שני משתני הסביבה מוגדרים. אינו פונה לרשת ואינו מאתחל discovery. */
export function isGoogleLoginConfigured(): boolean {
  return env.googleOauth() !== undefined;
}

export type GoogleUserResolution =
  | { ok: true; user: SessionUser }
  | { ok: false; code: Extract<GoogleLoginErrorCode, "no_account"> };

/**
 * מאתר את המשתמש הפעיל שכתובת המייל שלו זהה לזו שגוגל אימתה.
 *
 * **שלושת מצבי הדחייה מוחזרים זהים בייט-בבייט** — משתמש שאינו קיים, משתמש
 * מושבת, ומשתמש שאין לו מייל כלל. אותו נימוק שכתוב ב-`auth.ts`: הפרדה
 * ביניהם מאפשרת למפות מי רשום במערכת. ההבחנה שכן נשמרת חיה ב-`logWarn`,
 * שהוא ערוץ פנימי.
 *
 * **מייל ריק נדחה לפני פנייה ל-DB, וזו לא אופטימיזציה.** `User.email` הוא
 * `String?`, ו-`findFirst({ where: { email: "" } })` היה בסדר — אבל שרשור
 * לא-זהיר שהופך את הערך ל-`null` או ל-`undefined` הופך את התנאי ל"כל משתמש
 * בלי מייל", כלומר מזהה את הפונה כמנהל ה-seed. `readGoogleIdentity` כבר
 * מבטיח מחרוזת לא-ריקה; החזרה על הבדיקה כאן היא מפני שזו שכבת השירות, והיא
 * אינה סומכת על הקורא.
 */
export async function resolveGoogleUser(email: string): Promise<GoogleUserResolution> {
  const normalized = normalizeEmail(email);
  if (normalized === "") {
    logWarn("google_login.rejected", { reason: "empty_email" });
    return { ok: false, code: "no_account" };
  }

  const user = await db.user.findFirst({ where: { email: normalized } });

  if (!user || !user.active) {
    logWarn("google_login.rejected", { reason: user ? "inactive" : "no_user" });
    return { ok: false, code: "no_account" };
  }

  return {
    ok: true,
    user: { id: user.id, name: user.name, role: user.role, siteId: user.siteId },
  };
}

export interface GoogleCallbackInput {
  /**
   * כתובת ה-callback המלאה, כולל ה-query.
   *
   * חייבת להיות בנויה מ-`APP_BASE_URL` ולא מ-`request.url` — ראה
   * `googleRedirectUri`. `openid-client` גוזר ממנה את ה-`redirect_uri` שהוא
   * שולח ל-token endpoint.
   */
  currentUrl: URL;
  saved: OauthState | null;
  /**
   * מוזרק. ברירת המחדל היא המימוש האמיתי — וההזרקה היא מה שמאפשר לבדוק את
   * כל עץ ההכרעה כאן בלי חשבון גוגל, בלי רשת ובלי דפדפן.
   */
  verify?: GoogleClaimsVerifier;
}

export type GoogleCallbackOutcome =
  | { kind: "session"; user: SessionUser; next: string }
  | { kind: "error"; code: GoogleLoginErrorCode };

/**
 * מריץ את חצי השני של הזרימה ומחזיר מה לעשות: להתחבר, או להציג שגיאה.
 *
 * **סדר הבדיקות הוא הגנה ולא סגנון.** שגיאה שגוגל החזירה, והיעדר העוגייה או
 * אי-התאמת ה-`state`, נבדקים **לפני** כל קריאת רשת. לכן הצפת ה-callback
 * בבקשות אינה עולה לנו כלום: אין כתיבה ל-DB, אין POST לגוגל, ואין גיבוב.
 * זו גם הסיבה שמסלול גוגל אינו מחובר למגבלת הקצב של ההתחברות (ראה למטה) —
 * הבדיקה הזולה כבר סוגרת את מה שהמגבלה הייתה סוגרת.
 *
 * **למה אין כאן `consumeRateLimit`, והשאלה תישאל.** מגבלת הקצב ב-`auth.ts`
 * סופרת **ניחושי סיסמה**; כאן אין מה לנחש — כדי לייצר זהות גוגל לכתובת
 * מסוימת צריך קודם להתאמת מול גוגל כבעל אותה תיבה. ובנוסף, חיבור לאותם
 * מפתחות (`login:email:<x>`) היה יוצר **נעילה חוצת-מסלולים שאינה קיימת
 * היום**: רעש בגוגל היה נועל את מסלול הסיסמה לאותו מזהה. אי-התלות בין
 * השניים היא תכונה — אם תוקף נועל למישהו את הסיסמה ל-15 דקות, גוגל היא
 * עדיין דרך פנימה. מסיבה זו גם התחברות מוצלחת בגוגל **אינה** מאפסת את מכסת
 * הסיסמה.
 */
export async function completeGoogleCallback({
  currentUrl,
  saved,
  verify = verifyGoogleCallback,
}: GoogleCallbackInput): Promise<GoogleCallbackOutcome> {
  const params = currentUrl.searchParams;

  const googleError = params.get("error");
  if (googleError) {
    // ‏`access_denied` הוא המשתמש שלחץ "ביטול" — מצב שגרתי ולא תקלה, ולכן
    // אינו נשלח ל-Sentry. כל שגיאה אחרת של גוגל כן: היא אומרת שמשהו בתצורה
    // או אצלה שבור, ואיש לא ידע על כך אחרת.
    if (googleError === "access_denied") return { kind: "error", code: "denied" };

    captureError(new Error(`גוגל החזירה שגיאה: ${googleError}`), {
      fingerprint: ["google-login", "authorization-error"],
    });
    return { kind: "error", code: "unavailable" };
  }

  const state = params.get("state");
  if (!saved || !state || !params.get("code") || state !== saved.state) {
    // ההודעה למשתמש היא "תוקף ההתחברות פג, נסה שוב" גם כשמדובר ב-`state`
    // שאינו תואם — כלומר בניסיון CSRF. אין מה להסביר לו מעבר לכך, והנוסח
    // מכסה את המצב הריאלי (לשונית שנשארה פתוחה) ואת התקיפה גם יחד.
    logWarn("google_login.rejected", {
      reason: saved ? "state_mismatch" : "no_state_cookie",
    });
    return { kind: "error", code: "expired" };
  }

  const claims = await verify(currentUrl, {
    state: saved.state,
    nonce: saved.nonce,
    codeVerifier: saved.codeVerifier,
  });
  if (!claims) return { kind: "error", code: "unavailable" };

  const identity = readGoogleIdentity(claims);
  if (!identity.ok) {
    logWarn("google_login.rejected", { reason: "unverified_email" });
    return { kind: "error", code: identity.code };
  }

  const resolution = await resolveGoogleUser(identity.email);
  if (!resolution.ok) return { kind: "error", code: resolution.code };

  return { kind: "session", user: resolution.user, next: saved.next };
}
