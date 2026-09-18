/**
 * ה-access token של גוגל — מקור אחד לשני המסלולים שפונים לתיבה.
 *
 * **למה הוא יצא מ-`notifier/gmail-api.ts`.** עד 1.3 היה רק צרכן אחד: שליחת
 * המייל. מ-1.3 נוסף סבב שקורא את התיבה (§2.6), והוא פונה לאותה כתובת עם
 * אותו `refresh token` בדיוק — ההרשאה שהונפקה לחשבון היא `gmail.send`
 * **ו-`gmail.readonly`** יחד (`scripts/gmail-oauth.mts`). מטמון שני היה
 * מכפיל את מספר בקשות הטוקן ואת מצבי הכשל, בלי שום תמורה: אותו טוקן משרת
 * את שניהם.
 *
 * **המטמון אינו גלובלי אלא לכל מופע.** מי שבונה provider מקבל מטמון משלו —
 * כך בדיקה שבונה טרנספורט משלה אינה יורשת טוקן של ריצה קודמת, וכך אין מצב
 * שבו שני סודות שונים (סביבה שהוחלפה) חולקים תא אחד. המשמעות המעשית: מי
 * שרוצה לחסוך בקשות מחזיק את ה-provider, לא קורא לו מחדש.
 *
 * **בקשה אחת לכל הקוראים.** שתי קריאות מקבילות שמצאו מטמון ריק מקבלות את
 * **אותה** בקשה. בלי זה, סבב הקריאה והשליחה שמתעוררים יחד באותו תהליך היו
 * מנפיקים שני טוקנים — והמטמון היה מקבל את התשובה שהגיעה אחרונה, כלומר את
 * הטוקן הקצר מבין השניים. כשל מפנה את הבקשה התלויה, כדי שתקלת רשת אחת לא
 * תינעל על שני המסלולים עד להפעלה מחדש.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * גג זמן על בקשת הטוקן.
 *
 * אותו נימוק של השליחה עצמה (`gmail-api.ts`): העבודות בתור מנוקזות בזו אחר
 * זו, ולכן קריאה יוצאת שאינה חוזרת אינה מעכבת רק את עצמה אלא עוצרת את כל
 * מה שאחריה. הערך נפרד מזה של השליחה בכוונה — אלה שתי קריאות שונות לשני
 * שרתים שונים, ומי שישנה אחת מהן אינו מתכוון בהכרח לשנייה.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * שוליים לפני פקיעת ה-access token.
 *
 * גוגל מנפיקה טוקן לשעה. בלי השוליים, טוקן שנותרו לו שתי שניות היה נשלח
 * ופוקע באמצע הבקשה — כשל שמופיע פעם בשעה ואינו ניתן לשחזור.
 */
const TOKEN_SAFETY_MARGIN_MS = 60_000;

/** מה שגוגל מנפיקה בפועל, וברירת המחדל כשהשדה חסר מהתשובה */
const DEFAULT_LIFETIME_SECONDS = 3600;

/**
 * שלושת הפרטים שמזהים את **החשבון** מול גוגל.
 *
 * זוג המפתחות משותף עם ההתחברות (`env.gmailApi()` קורא את
 * `GOOGLE_CLIENT_ID`/`SECRET`), וה-`refreshToken` הוא ההרשאה של תיבת המערכת
 * עצמה — ולא של משתמש כלשהו.
 */
export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/**
 * תפר להזרקה, לבדיקות בלבד.
 *
 * `now` קיים כדי שהפקיעה תיבדק בקפיצת זמן ולא בהמתנה, ו-`fetch` כדי שאף
 * בדיקה לא תפנה לגוגל. בקוד הרץ שניהם נשארים ריקים.
 */
export interface AccessTokenDeps {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

/**
 * כשל בהנפקת הטוקן, עם קוד ה-HTTP כשהייתה תשובה.
 *
 * **הקוד הוא כל ההבדל בין שתי תקלות שההתנהגות הנכונה בהן הפוכה.** דחיית
 * הבקשה עצמה (`invalid_grant` — refresh token שנשלל — חוזר כ-400) פירושה
 * שאין טעם לנסות שוב לעולם, ודורשת אדם; 429 או 5xx הם אותו מסלול בדיוק
 * שיצליח בעוד דקה. `Error` אחד לשניהם מכריח את הקורא לנחש, והניחוש
 * ל"חולף" משתיק את הערוץ ימים בזמן שהג׳וב "רץ" (`email-intake/source.ts`).
 *
 * המסלול השולח אינו מסווג דבר, וההודעה שהוא רושם ב-`Job.lastError` לא
 * השתנתה: זהו `Error` לכל דבר, עם אותו נוסח.
 */
export class GoogleTokenError extends Error {
  /** קוד ה-HTTP של תשובת ה-OAuth. כשל רשת או פסק זמן מגיעים בלי קוד. */
  readonly status?: number;

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GoogleTokenError";
    if (options.status !== undefined) this.status = options.status;
  }
}

/**
 * מחזיר פונקציה שמספקת access token תקף, מהמטמון או מגוגל.
 *
 * הפונקציה זורקת `GoogleTokenError` — `Error` לכל דבר, ולא `UserFacingError`:
 * אין כאן מסך ואין משתמש — הקורא הוא ג׳וב, וההודעה מגיעה ל-`Job.lastError`
 * ול-Sentry. משום כך **גוף התשובה נכנס להודעה**: `invalid_grant` — refresh
 * token שנשלל — הוא הכשל היחיד במסלול הזה שדורש פעולה אנושית, והוא מופיע
 * שם בלבד. מי שצריך להחליט אם לנסות שוב קורא את `status`.
 */
export function createAccessTokenProvider(
  config: GoogleOAuthConfig,
  deps: AccessTokenDeps = {},
): () => Promise<string> {
  const now = deps.now ?? Date.now;

  let cached: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;

  async function requestToken(): Promise<string> {
    // `fetch` נקרא כאן ולא בזמן הבנייה: הטרנספורט נבנה פעם אחת, ובדיקות
    // של המסלולים שמעליו מחליפות את הגלובלי אחרי שהוא כבר קיים.
    const call = deps.fetch ?? globalThis.fetch;

    const response = await call(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const body = await response.text();
    if (!response.ok) {
      throw new GoogleTokenError(`הנפקת access token של גוגל נכשלה (${response.status}): ${body.slice(0, 300)}`, {
        status: response.status,
      });
    }

    const parsed = parseTokenBody(body, response.status);
    if (!parsed.access_token) {
      // 200 בלי טוקן אינו "טוקן ריק": מחרוזת ריקה הייתה נשלחת ככותרת
      // `Bearer ` וחוזרת כ-401 חסר פשר מהקצה השני.
      throw new GoogleTokenError("תשובת ה-OAuth של גוגל חסרה access_token", { status: response.status });
    }

    // `Number` ולא השדה כמות שהוא: ערך שאינו מספר (מחרוזת לא-מספרית, תשובה
    // של proxy) היה מייצר `NaN`, וכל השוואה מול `NaN` היא false — כלומר
    // מטמון שלעולם אינו נחשב תקף, ובקשת טוקן על **כל** קריאה. זה אינו נראה
    // כשגיאה בשום מקום: הערוץ עובד, עד שגוגל מגבילה את הקצב.
    const lifetimeSeconds = Number(parsed.expires_in ?? DEFAULT_LIFETIME_SECONDS);
    const lifetimeMs = (Number.isFinite(lifetimeSeconds) ? lifetimeSeconds : DEFAULT_LIFETIME_SECONDS) * 1000;
    cached = {
      token: parsed.access_token,
      expiresAt: now() + Math.max(lifetimeMs - TOKEN_SAFETY_MARGIN_MS, 0),
    };
    return parsed.access_token;
  }

  return async () => {
    if (cached && now() < cached.expiresAt) return cached.token;

    // `??=` הוא האיחוד: מי שהגיע בזמן שבקשה כבר בדרך מקבל אותה עצמה.
    // `finally` מפנה את התא בשני המצבים — אחרי הצלחה המטמון כבר מלא,
    // ואחרי כשל הקריאה הבאה מנסה מחדש במקום לרשת את השגיאה לנצח.
    pending ??= requestToken().finally(() => {
      pending = null;
    });
    return pending;
  };
}

/**
 * פענוח גוף התשובה, עם הגוף עצמו בהודעה כשהוא אינו JSON.
 *
 * תשובה שאינה JSON מגיעה מ-proxy או מ-captive portal באמצע, ולא מגוגל.
 * בלי העטיפה ההודעה הייתה `Unexpected token <` — שאינה אומרת דבר על מי ענה.
 */
function parseTokenBody(body: string, status: number): { access_token?: string; expires_in?: number } {
  try {
    return JSON.parse(body) as { access_token?: string; expires_in?: number };
  } catch (error) {
    throw new GoogleTokenError(`תשובת ה-OAuth של גוגל אינה JSON: ${body.slice(0, 300)}`, { status, cause: error });
  }
}
