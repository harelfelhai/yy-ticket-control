import nodemailer from "nodemailer";
import type { EmailMessage, EmailTransport } from "./types";

/**
 * ערוץ Gmail מעל HTTPS, ולא מעל SMTP.
 *
 * **למה הוא קיים — מדידה, לא העדפה.** ב-7.9.2026 נבדק מתוך הקונטיינר של
 * הפרודקשן ב-Railway: חיבור TCP אל 25, 465 ו-587 נבלע בשקט ל-8 שניות אל
 * כל מארח שנוסה — `smtp.gmail.com`, `smtp-relay.gmail.com`, ה-MX של גוגל
 * ו-`smtp.sendgrid.net` — בעוד ש-`www.google.com:443` נענה ב-16 מילישניות
 * ו-`generativelanguage.googleapis.com:443` בארבע. כלומר יציאה ב-IPv4
 * תקינה לחלוטין, וכלל firewall **מפיל** חבילות SMTP (DROP ולא REJECT).
 *
 * ארבעה ג׳ובי התראה נכשלו כך סופית לפני שזה אובחן. השגיאות שהם השאירו —
 * שלוש `Connection timeout` ואחת `connect ENETUNREACH …:587` — מזמינות שתי
 * מסקנות שגויות: "רשת חולפת" ו"בעיית IPv6". שתיהן היו שולחות לתיקון הלא
 * נכון; כפיית `family: 4` הייתה משנה רק את נוסח השגיאה.
 *
 * **ולמה Gmail ולא ספק עם API.** האילוץ העסקי שרשום ב-`email.ts` לא השתנה:
 * ההודעה חייבת לצאת מכתובת ה-Gmail של העסק, שהקבלן מכיר, כדי שתיפתח
 * ושהתשובה תחזור לתיבה האמיתית. `Resend` ודומיו מתירים שליחה רק מדומיין
 * מאומת — כלומר מכתובת זרה, וזו בדיוק הסיבה שהם נפסלו ב-1.9.2026. מה
 * שהתחליף כאן הוא **התעבורה בלבד**, לא הזהות.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

/**
 * גג לשליחה יחידה — אותו נימוק שנשמר מ-SMTP.
 *
 * העבודות בתור מנוקזות בזו אחר זו (`drainJobs`), ולכן קריאה יוצאת שאינה
 * חוזרת אינה מעכבת רק את עצמה אלא עוצרת את **כל** ההתראות שאחריה.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * שוליים לפני פקיעת ה-access token.
 *
 * Google מנפיק טוקן לשעה. בלי השוליים, טוקן שנותרו לו שתי שניות היה נשלח
 * ופוקע באמצע הבקשה — כשל שמופיע פעם בשעה ואינו ניתן לשחזור.
 */
const TOKEN_SAFETY_MARGIN_MS = 60_000;

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/**
 * בונה את הודעת ה-RFC822 דרך nodemailer, ולא ביד.
 *
 * `streamTransport` הוא ה-API הציבורי של nodemailer להרכבת הודעה **בלי
 * לשלוח אותה**, והוא מטפל בכל מה שכתיבה ידנית שוברת בעברית: קידוד הכותרות
 * (`=?UTF-8?B?…?=`), גבולות ה-multipart בין הטקסט ל-HTML, ו-`Content-Transfer-Encoding`.
 * הספרייה כבר תלות בפרויקט מהמסלול הקודם, ולכן זה גם אינו מוסיף דבר.
 */
async function buildRawMessage(from: string, message: EmailMessage): Promise<string> {
  const composer = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    // `newline: "unix"` ולא ברירת המחדל: ה-base64url שלמטה נכנס לתוך JSON,
    // וגוגל מקבלת LF. ההבדל אינו נראה עד שהודעה מסוימת נדחית.
    newline: "unix",
  });

  const info = await composer.sendMail({
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  // base64url ולא base64: זה מה ש-Gmail API דורש בשדה `raw`.
  return (info.message as Buffer).toString("base64url");
}

/**
 * מנפיק access token מה-refresh token, ומחזיק אותו עד סמוך לפקיעה.
 *
 * המטמון הוא ברמת הטרנספורט ולא גלובלי: כך בדיקה שבונה טרנספורט משלה אינה
 * יורשת טוקן של ריצה קודמת.
 */
function accessTokenProvider(config: OAuthConfig): () => Promise<string> {
  let cached: { token: string; expiresAt: number } | null = null;

  return async () => {
    if (cached && Date.now() < cached.expiresAt) return cached.token;

    const response = await fetch(TOKEN_URL, {
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
      // גוף התשובה נכנס להודעה: גוגל מחזירה כאן `invalid_grant` כשה-refresh
      // token נשלל, וזו התקלה היחידה במסלול הזה שדורשת פעולה אנושית. בלי
      // הגוף, `Job.lastError` היה אומר "401" ותו לא.
      throw new Error(`הנפקת access token ל-Gmail נכשלה (${response.status}): ${body.slice(0, 300)}`);
    }

    const parsed = JSON.parse(body) as { access_token?: string; expires_in?: number };
    if (!parsed.access_token) {
      throw new Error("תשובת ה-OAuth של Gmail חסרה access_token");
    }

    const lifetimeMs = (parsed.expires_in ?? 3600) * 1000;
    cached = {
      token: parsed.access_token,
      expiresAt: Date.now() + Math.max(lifetimeMs - TOKEN_SAFETY_MARGIN_MS, 0),
    };
    return cached.token;
  };
}

/**
 * `from` חייב להיות חשבון השליחה עצמו (או alias שהוגדר בו) — הודעה שנשלחת
 * דרך `users/me` בשם כתובת אחרת נדחית. שם תצוגה מותר, ולכן
 * `"בקרת פניות <x@gmail.com>"` תקין.
 */
export function gmailApiTransport(config: OAuthConfig, from: string): EmailTransport {
  const getAccessToken = accessTokenProvider(config);

  return {
    name: "gmail-api",
    async send(message) {
      const raw = await buildRawMessage(from, message);
      const token = await getAccessToken();

      const response = await fetch(SEND_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ raw }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        // הזריקה מחזירה את הג׳וב לתור (`failJob`), וזו ההתנהגות הנכונה: רוב
        // הכשלים כאן הם 429/5xx חולפים. אחרי שלושה ניסיונות הוא ננעל
        // ל-FAILED, `markNotifyFailed` מסמן את השיוך, והמסך אומר זאת.
        const body = await response.text();
        throw new Error(`שליחת מייל דרך Gmail API נכשלה (${response.status}): ${body.slice(0, 300)}`);
      }
    },
  };
}
