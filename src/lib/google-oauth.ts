import * as client from "openid-client";
import { env } from "./env";
import { captureError } from "./observability/log";

/**
 * זרימת ה-OpenID Connect מול גוגל — הבית **היחיד** של `openid-client`.
 *
 * ‏1.2 הוסיף מסלול התחברות שני לצד הסיסמה המקומית: משתמש שכתובת המייל שלו
 * רשומה במערכת נכנס דרך חשבון הגוגל שלו, בלי סיסמה. המסלול נגמר בקריאה
 * ל-`createSession()` עם אותו `SessionUser` בדיוק — ולכן כל שכבת ההרשאה
 * (`requireUser`, `toViewer`, `permissions.ts`) אינה יודעת שהוא קיים.
 *
 * **‏authorization code flow עם client סודי, ולא זרימת דפדפן.** חילוף הקוד
 * הוא POST שרת-לשרת עם `client_secret`; הדפדפן רק מנווט. לכן אין כאן שום
 * JavaScript של גוגל, אין `Authorized JavaScript origins`, ואין access token
 * שנשמר במקום כלשהו.
 *
 * **מה `openid-client` עושה במקומנו, ולמה זה נבחר.** הספרייה מאמתת את חתימת
 * ה-ID token מול ה-JWKS של גוגל, ובנוסף את `iss`, `aud`, `exp`, `state`
 * ו-`nonce`. החלופה — פענוח base64url ביד והסתמכות על TLS במקום על החתימה
 * (מותר לפי OIDC Core §3.1.3.7 לזרימה הזו) — הייתה מעבירה את האחריות אלינו
 * בלי לחסוך דבר. `arctic`, שנשקלה, הוכרזה deprecated ביולי 2026.
 *
 * **מה נשאר לנו לאמת:** ש-`email` קיים, ושהוא **מאומת**. ראה
 * `readGoogleIdentity` — זו הבדיקה שהספרייה לא יכולה לעשות, כי היא שאלה
 * עסקית ולא שאלה של תקן.
 */

export const GOOGLE_ISSUER = "https://accounts.google.com";

/**
 * שלושה scopes, ולא אחד יותר.
 *
 * **זו הכרעת היקף ולא נוחות.** גוגל מסווגת את השלושה כ-non-sensitive, ולכן
 * האפליקציה מתפרסמת בלי verification review ובלי מסך "Google hasn't verified
 * this app". זה בדיוק החשש שרשום באפיון §6 כנימוק לדחיית יומן גוגל ("אימות
 * אפליקציה מול גוגל עלול לקחת שבועות עד חודשים ולחסום עלייה לאוויר") —
 * והבחירה כאן היא מה שמנטרל אותו.
 *
 * ‏scope של יומן הוא restricted, והוא אסור: `SC-OUT-02` אוכף את היעדרו על
 * קוד המקור.
 */
export const GOOGLE_SCOPES = "openid email profile";

/**
 * שני הנתיבים, כקבועים ולא כמחרוזות מפוזרות.
 *
 * ‏`GOOGLE_CALLBACK_PATH` מופיע בשלושה מקומות שחייבים להסכים ביניהם: ה-route
 * עצמו, ה-`redirect_uri` שנשלח לגוגל, וכתובת ה-Authorized redirect URI
 * שהוגדרה ב-Google Console. אי-התאמה מוחזרת כשגיאה של גוגל **לפני** שהבקשה
 * מגיעה אלינו — כלומר שום לוג שלנו לא יסביר אותה.
 */
export const GOOGLE_START_PATH = "/api/auth/google/start";
export const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";

/**
 * קודי הכשל שעוברים בכתובת חזרה למסך ההתחברות.
 *
 * איגוד סגור וקצר, ו**ההבחנה ביניהם היא העיקר**:
 * - `denied` / `expired` — המשתמש יכול לפעול (לנסות שוב, לאשר).
 * - `no_account` — נדרשת פעולה של מנהל.
 * - `unavailable` — תקלה אצלנו או אצל גוגל; לא באשמתו ולא בשליטתו.
 *
 * מה ש**אינו** מובחן: "אין משתמש", "אין מייל" ו"מושבת" — שלושתם `no_account`
 * באותו נוסח בדיוק, מאותו נימוק של `he.login.invalidCredentials`.
 */
export const GOOGLE_LOGIN_ERROR_CODES = [
  "denied",
  "expired",
  "no_account",
  "unavailable",
] as const;

export type GoogleLoginErrorCode = (typeof GOOGLE_LOGIN_ERROR_CODES)[number];

/**
 * מפרש את `?error=` של מסך ההתחברות, או `null`.
 *
 * טהור, ומקבל גם `string[]` מפני ש-`searchParams` של Next מחזיר מערך כשאותו
 * פרמטר מופיע פעמיים — קלט שמגיע מכל מי ששולח קישור, ולא רק מאיתנו.
 */
export function parseGoogleLoginError(
  value: string | string[] | null | undefined,
): GoogleLoginErrorCode | null {
  if (typeof value !== "string") return null;

  return (GOOGLE_LOGIN_ERROR_CODES as readonly string[]).includes(value)
    ? (value as GoogleLoginErrorCode)
    : null;
}

/**
 * כתובת ה-callback המלאה. אותה צורה של `portalUrl` ב-`tokens.ts`.
 *
 * **חייבת להיגזר מ-`APP_BASE_URL` ולא מ-`request.url`.** `openid-client` גוזר
 * את ה-`redirect_uri` שהוא שולח ל-token endpoint מתוך ה-URL שמועבר ל-
 * `authorizationCodeGrant` (‏`redirectUri = stripParams(currentUrl)` בקוד
 * שלו), ומאחורי ה-proxy של Railway `request.url` יכול לשאת מארח או סכימה
 * פנימיים. אי-התאמה שם היא `redirect_uri_mismatch` שמופיע בפרודקשן בלבד.
 */
export function googleRedirectUri(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "")}${GOOGLE_CALLBACK_PATH}`;
}

/**
 * ה-`Configuration` של גוגל, פעם אחת לכל חיי התהליך.
 *
 * ‏`discovery()` הוא סבב רשת אל `/.well-known/openid-configuration`, ואסור
 * שיקרה בכל התחברות. singleton של ה-Promise (ולא של הערך) מונע גם סבב כפול
 * כששתי בקשות נכנסות יחד. אותה תבנית של `src/lib/db.ts`, ומאותה סיבה:
 * האירוח כאן הוא תהליך Node קבוע ולא serverless.
 *
 * כשל ב-discovery מאפס את ה-cache — אחרת תקלת רשת חולפת בעלייה הייתה נועלת
 * את המסלול עד לפריסה הבאה.
 */
let configuration: Promise<client.Configuration> | null = null;

function googleConfiguration(): Promise<client.Configuration> {
  const credentials = env.googleOauth();
  if (!credentials) {
    throw new Error("התחברות עם Google אינה מוגדרת: חסרים GOOGLE_CLIENT_ID או GOOGLE_CLIENT_SECRET");
  }

  configuration ??= client
    .discovery(new URL(GOOGLE_ISSUER), credentials.clientId, credentials.clientSecret)
    .catch((error: unknown) => {
      configuration = null;
      throw error;
    });

  return configuration;
}

export interface OauthChallenge {
  state: string;
  nonce: string;
  codeVerifier: string;
  url: URL;
}

/**
 * בונה את כתובת ההרשאה ואת שלושת הסודות שנשמרים בעוגייה.
 *
 * שלושת הסודות **חייבים להיות אקראיים לכל בקשה וקשורים ל-user-agent** —
 * `state` נגד CSRF, `nonce` נגד replay של ID token, ו-`codeVerifier` (PKCE)
 * נגד יירוט קוד ההרשאה. `buildAuthorizationUrl` מוסיף בעצמו את `client_id`
 * ואת `response_type=code`.
 *
 * **‏`prompt: "select_account"` אינו קוסמטי.** בלעדיו גוגל עשויה לאשר
 * אוטומטית מול החשבון שהדפדפן כבר מחובר אליו. למשתמשים כאן יש חשבון אישי
 * וחשבון עבודה, ובחירה שקטה בלא-נכון מייצרת `no_account` בלי שום דרך להחליף.
 *
 * **מה שבמכוון אינו נשלח:** `access_type=offline` (אין צורך ב-refresh token —
 * אנחנו מנפיקים סשן משלנו ולא פונים לשום API של גוגל), `login_hint`,
 * ו-`hd`. `hd=<domain>` היא ההקשחה שתתווסף **אם** החברה תעבור ל-Google
 * Workspace: אז גוגל עצמה תסרב לחשבון שאינו של החברה, שכבה אחת לפנינו.
 */
export async function buildGoogleAuthorization(redirectUri: string): Promise<OauthChallenge> {
  const config = await googleConfiguration();

  const state = client.randomState();
  const nonce = client.randomNonce();
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: GOOGLE_SCOPES,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });

  return { state, nonce, codeVerifier, url };
}

export interface OauthChecks {
  state: string;
  nonce: string;
  codeVerifier: string;
}

/**
 * התפר להזרקה: מקבל את כתובת ה-callback ומחזיר את ה-claims, או `null`.
 *
 * הטיפוס מיוצא כדי ש-`completeGoogleCallback` תוכל לקבל מימוש מזויף
 * בבדיקות. זו הסיבה שכל עץ ההכרעה של ה-callback נבדק בלי גוגל ובלי רשת.
 */
export type GoogleClaimsVerifier = (
  currentUrl: URL,
  checks: OauthChecks,
) => Promise<Record<string, unknown> | null>;

/**
 * מחליף את קוד ההרשאה ומחזיר את ה-claims המאומתים, או `null`.
 *
 * ‏`authorizationCodeGrant` מאמת את תשובת ההרשאה **לפני** שהוא פונה ל-token
 * endpoint (הוא קורא ל-`validateAuthResponse` קודם), ולכן `state` שגוי נדחה
 * בלי קריאת רשת. זו שכבה שנייה: `completeGoogleCallback` בודקת את ה-`state`
 * מול העוגייה עוד לפני שהיא מגיעה לכאן.
 *
 * מחזיר `null` ואינו זורק, מפני שכל מצבי הכשל כאן הם מצבים שהממשק צריך
 * להתמודד איתם בהודעה — קוד שפג, קוד שנפדה כבר, אי-התאמה של `redirect_uri`,
 * או תקלת רשת מול גוגל. `captureError` נשלח כדי שההבחנה תישאר ב-Sentry.
 */
export const verifyGoogleCallback: GoogleClaimsVerifier = async (currentUrl, checks) => {
  try {
    const config = await googleConfiguration();

    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: checks.codeVerifier,
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      idTokenExpected: true,
    });

    // ‏`claims()` מחזיר undefined כשלא הוחזר ID token. `idTokenExpected`
    // וגם `expectedNonce` אמורים למנוע זאת — הבדיקה כאן היא כדי שהטיפוס
    // לא ייאלץ אותנו ל-`!` על ערך שהתקן אינו מבטיח.
    const claims = tokens.claims();
    if (!claims) {
      captureError(new Error("גוגל לא החזירה ID token"), {
        fingerprint: ["google-login", "no-id-token"],
      });
      return null;
    }

    return claims as unknown as Record<string, unknown>;
  } catch (error) {
    captureError(error, { fingerprint: ["google-login", "code-grant"] });
    return null;
  }
};

export type IdentityCheck =
  | { ok: true; email: string }
  | { ok: false; code: Extract<GoogleLoginErrorCode, "no_account"> };

/**
 * מוציא את כתובת המייל מה-claims — **אחרי** שהספרייה אימתה את הטוקן.
 *
 * טהור, ולכן זו הפונקציה שנבדקת ביחידה על כל מקרה דחייה בנפרד.
 *
 * **‏`email_verified === true` בהשוואה קפדנית, וזו הכרעה להיכשל-סגור.**
 * כתובת שגוגל לא אימתה אינה הוכחה לשליטה בתיבה: היא רק אומרת שמישהו הקליד
 * אותה. אילו הייתה כאן השוואה רכה (`==`, או `Boolean(...)`), הערך `"true"`
 * כמחרוזת היה מאשר התחברות — ולכן הצורה הקפדנית היא שכל צורה שאינה בוליאן
 * ‏`true` נדחית.
 *
 * ‏`sub`, `iat`, `azp`, `name`, `given_name`, `picture`, `hd` ו-`at_hash`
 * מגיעים ואינם נצרכים. `sub` במיוחד: הוא המזהה היציב של גוגל, וההכרעה
 * המפורשת ב-1.2 היא **לא** לשמור אותו — ההתאמה היא לפי מייל בלבד, כדי
 * שמנהל שמשנה מייל למשתמש יחתוך בכך גם את גישת הגוגל שלו.
 *
 * המייל מוחזר **כמות שהוא**, בלי נרמול. הנרמול הוא תפקידה של שכבת השירות,
 * שהיא גם זו שמשווה מול ה-DB — פיצול בין השתיים הוא איך שנרמול נעשה פעמיים
 * או אף פעם.
 */
export function readGoogleIdentity(claims: Record<string, unknown>): IdentityCheck {
  const email = claims["email"];
  const verified = claims["email_verified"];

  if (typeof email !== "string" || email.trim() === "") {
    return { ok: false, code: "no_account" };
  }
  if (verified !== true) {
    return { ok: false, code: "no_account" };
  }

  return { ok: true, email };
}
