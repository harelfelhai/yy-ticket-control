import { hkdfSync } from "node:crypto";
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { env } from "./env";
import { servedOverHttps } from "./session";

/**
 * העוגייה הזמנית שמחזיקה את זרימת ה-OAuth בין `/start` ל-`/callback`.
 *
 * **למה בכלל צריך אותה.** ה-OAuth code flow מפוצל לשתי בקשות HTTP נפרדות
 * שביניהן המשתמש יוצא לאתר של גוגל וחוזר. שלושה סודות נוצרים בבקשה הראשונה
 * ונדרשים בשנייה — `state` (נגד CSRF), `nonce` (נגד replay של ID token)
 * ו-`codeVerifier` (‏PKCE) — ואין להם מקום להתאחסן בו מלבד הדפדפן. הם
 * **חייבים** להיות קשורים ל-user-agent, אחרת בדיקת ה-`state` אינה מוכיחה דבר:
 * כל אחד היה יכול להשלים זרימה שמישהו אחר התחיל.
 *
 * ‏`next` נוסע כאן ולא בתוך פרמטר ה-`state` שנשלח לגוגל. שתי סיבות: הוא אינו
 * נראה ואינו ניתן לעריכה בצד השלישי, והוא כבר עבר `safeNextPath` לפני שנכנס.
 */

export const OAUTH_STATE_COOKIE_NAME = "yy_oauth";

/**
 * עשר דקות — כמה זמן יש למשתמש לבחור חשבון ולאשר אצל גוגל.
 *
 * לא 30 יום כמו הסשן ולא דקה: זה חלון של אדם שמסתכל על מסך הסכמה, אולי
 * מקליד סיסמה בגוגל, אולי עובר אימות דו-שלבי. חלון קצר מדי הופך זרימה
 * לגיטימית ל-`expired`; ארוך מדי משאיר `state` תקף זמן רב אחרי שהוא נזנח.
 */
export const OAUTH_STATE_TTL_SECONDS = 600;

/**
 * מפריד תחומים: המפתח לחתימת עוגיית ה-state נגזר מ-`SESSION_SECRET` אבל אינו
 * זהה לו ואינו זהה למפתח של `tokens.ts`.
 *
 * זהו התקדים המתועד ב-`tokens.ts` (§"מפריד תחומים"): שימוש חוזר באותו מפתח
 * בדיוק לשתי מטרות שונות הוא דפוס שגוי מוכר — הוא יוצר תלות שבה חולשה
 * במנגנון אחד נשפכת לשני. `SESSION_SECRET` נושא כבר שני צרכנים (עוגיית
 * ההתחברות, וטוקני הפורטל דרך HKDF); זהו השלישי, ו-`info` נפרד מפריד בינו
 * לשניים האחרים בלי להוסיף עוד משתנה סביבה שמישהו ישכח להגדיר.
 */
const KEY_INFO = "yy-oauth-state-cookie-v1";
const KEY_BYTES = 32;

/**
 * מיוצא בנפרד — ולא רק כדי לבדוק אותו.
 *
 * הוא הפונקציה הטהורה היחידה בקובץ, ולכן הוא מה שאפשר לאמת בלי
 * `next/headers` ובלי היקף בקשה: שההפרדה בין שלושת התחומים אמיתית, ושהאורך
 * עומד ברצפת 32 התווים של iron-session.
 */
export function oauthStatePassword(sessionSecret: string): string {
  return Buffer.from(hkdfSync("sha256", sessionSecret, "", KEY_INFO, KEY_BYTES)).toString(
    "base64url",
  );
}

export interface OauthState {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** נתיב יחסי שכבר עבר `safeNextPath` */
  next: string;
}

interface OauthStateSession {
  value?: OauthState;
}

/**
 * **‏`sameSite: "lax"` ולא `"strict"`, וזה לא פשרה.**
 *
 * ה-callback הוא ניווט top-level **חוצה-אתר**: `accounts.google.com` מפנה את
 * הדפדפן אלינו ב-GET. תחת `strict` הדפדפן אינו שולח את העוגייה בניווט כזה,
 * ולכן `takeOauthState()` היה מחזיר `null` בכל התחברות אמיתית והזרימה הייתה
 * נגמרת תמיד ב-`expired` — כשל שנראה בדיוק כמו באג באימות ה-`state`.
 * ‏`lax` שולח עוגייה בניווט top-level מסוג GET, שהוא בדיוק המקרה הזה.
 *
 * **וההגנה מ-CSRF אינה באה מהדגל הזה בכלל:** היא באה מכך שה-`state` שמגיע
 * בכתובת חייב להיות שווה ל-`state` שיושב **בתוך** העוגייה. דגל העוגייה קובע
 * מתי היא נשלחת, לא מה מתקבל בה.
 *
 * ‏`secure` נגזר מ-`APP_BASE_URL` ולא מ-`NODE_ENV`, מאותה סיבה בדיוק שבגללה
 * זה נעשה בעוגיית הסשן — ראה `servedOverHttps` ב-`session.ts`.
 */
function oauthSessionOptions(): SessionOptions {
  return {
    password: oauthStatePassword(env.sessionSecret()),
    cookieName: OAUTH_STATE_COOKIE_NAME,
    ttl: OAUTH_STATE_TTL_SECONDS,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: servedOverHttps(env.appBaseUrl()),
      path: "/",
    },
  };
}

async function getOauthSession() {
  // ‏Next 16: cookies() אסינכרוני.
  return getIronSession<OauthStateSession>(await cookies(), oauthSessionOptions());
}

export async function saveOauthState(value: OauthState): Promise<void> {
  const session = await getOauthSession();
  session.value = value;
  await session.save();
}

/**
 * קורא את המצב **ומשמיד אותו באותה פעולה**.
 *
 * אין כאן `readOauthState` נפרד, ובכוונה: מסלול שקורא בלי לצרוך הוא מסלול
 * שבו אותו `state` תקף פעמיים, כלומר ניסיון חוזר עם אותו קוד הרשאה. פעולה
 * אחת שעושה את שניהם אינה מאפשרת לשכוח את החלק השני.
 *
 * ההשמדה נכתבת גם כשאין מה לקרוא. זה נראה מיותר אבל אינו: עוגייה פגומה
 * (סוד שהוחלף, seal שנחתך) מחזירה `null` דרך `unsealData` שמחזיר `{}` —
 * ואם לא נמחק אותה, היא תיכשל שוב בכל ניסיון עד שתפוג מעצמה.
 */
export async function takeOauthState(): Promise<OauthState | null> {
  const session = await getOauthSession();
  const value = session.value ?? null;

  session.destroy();

  return value;
}
