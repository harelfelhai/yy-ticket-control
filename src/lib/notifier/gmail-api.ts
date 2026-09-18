import nodemailer from "nodemailer";
import { createAccessTokenProvider, type GoogleOAuthConfig } from "@/lib/google/gmail-token";
import { toNodemailerMail } from "./mail-options";
import type { EmailMessage, EmailSendResult, EmailTransport } from "./types";

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

const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

/**
 * גג לשליחה יחידה — אותו נימוק שנשמר מ-SMTP.
 *
 * העבודות בתור מנוקזות בזו אחר זו (`drainJobs`), ולכן קריאה יוצאת שאינה
 * חוזרת אינה מעכבת רק את עצמה אלא עוצרת את **כל** ההתראות שאחריה.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * בונה את הודעת ה-RFC822 דרך nodemailer, ולא ביד.
 *
 * `streamTransport` הוא ה-API הציבורי של nodemailer להרכבת הודעה **בלי
 * לשלוח אותה**, והוא מטפל בכל מה שכתיבה ידנית שוברת בעברית: קידוד הכותרות
 * (`=?UTF-8?B?…?=`), גבולות ה-multipart בין הטקסט ל-HTML, ו-`Content-Transfer-Encoding`.
 * הספרייה כבר תלות בפרויקט מהמסלול הקודם, ולכן זה גם אינו מוסיף דבר.
 *
 * מיוצא בשביל הבדיקות: מה שנבדק כאן הוא **הכותרות שיוצאות בפועל**, ואת
 * אלה אפשר לראות רק מתוך ההודעה הבנויה. בדיקה שתסתפק בכך שהשדה נמסר
 * ל-nodemailer הייתה מאמתת את הקריאה ולא את התוצאה.
 */
export async function buildRawMessage(from: string, message: EmailMessage): Promise<string> {
  const composer = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    // `newline: "unix"` ולא ברירת המחדל: ה-base64url שלמטה נכנס לתוך JSON,
    // וגוגל מקבלת LF. ההבדל אינו נראה עד שהודעה מסוימת נדחית.
    newline: "unix",
  });

  // המיפוי עצמו משותף לשני הערוצים (`mail-options.ts`) — כותרת שרשור
  // שתיווסף שם חייבת לצאת גם ב-SMTP וגם כאן.
  const info = await composer.sendMail(toNodemailerMail(from, message));

  // base64url ולא base64: זה מה ש-Gmail API דורש בשדה `raw`.
  return (info.message as Buffer).toString("base64url");
}

/**
 * מה שגוגל ענתה על השליחה.
 *
 * `users.messages.send` מחזירה משאב `Message` — `id`, `threadId`
 * ו-`labelIds`. את ה-`Message-ID` של RFC היא **אינה** מחזירה, ולכן השדה
 * נשאר ריק ואינו מוחזר כהד למה שביקשנו: Gmail רשאי לכתוב מזהה משלו, ומזהה
 * שגוי שנשמר גרוע ממזהה חסר — הוא נראה כמו עובדה, ותשובה שתגיע לעולם לא
 * תותאם לו. השרשור נשען על `threadId`, שהוא הסמכות ממילא.
 *
 * תשובה שאינה JSON אינה זורקת: ההודעה כבר יצאה, וזריקה כאן הייתה מחזירה
 * את הג׳וב לתור ושולחת אותה שוב.
 */
function parseSendResponse(body: string): EmailSendResult {
  try {
    const parsed = JSON.parse(body) as { id?: string; threadId?: string };
    return { id: parsed.id, threadId: parsed.threadId };
  } catch {
    return {};
  }
}

/**
 * `from` חייב להיות חשבון השליחה עצמו (או alias שהוגדר בו) — הודעה שנשלחת
 * דרך `users/me` בשם כתובת אחרת נדחית. שם תצוגה מותר, ולכן
 * `"בקרת פניות <x@gmail.com>"` תקין.
 */
export function gmailApiTransport(config: GoogleOAuthConfig, from: string): EmailTransport {
  // provider אחד לכל טרנספורט, ולא מטמון גלובלי: כך בדיקה שבונה טרנספורט
  // משלה אינה יורשת טוקן של ריצה קודמת. המימוש עצמו יצא מכאן ל-
  // `lib/google/gmail-token.ts` מפני שמ-1.3 יש לו צרכן שני — הסבב שקורא את
  // התיבה פונה לאותה כתובת עם אותו refresh token.
  const getAccessToken = createAccessTokenProvider(config);

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
        // `threadId` נמסר רק כשיש שרשור לצרף אליו. Gmail דוחה בקשה שבה
        // ה-`threadId` אינו מתיישב עם כותרות ההודעה, ולכן אין לשלוח אותו
        // "ליתר ביטחון" — הוא מגיע יחד עם `inReplyTo` מאותו מייל נכנס.
        body: JSON.stringify(message.threadId ? { raw, threadId: message.threadId } : { raw }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        // הזריקה מחזירה את הג׳וב לתור (`failJob`), וזו ההתנהגות הנכונה: רוב
        // הכשלים כאן הם 429/5xx חולפים. אחרי שלושה ניסיונות הוא ננעל
        // ל-FAILED, `markNotifyFailed` מסמן את השיוך, והמסך אומר זאת.
        const body = await response.text();
        throw new Error(`שליחת מייל דרך Gmail API נכשלה (${response.status}): ${body.slice(0, 300)}`);
      }

      return parseSendResponse(await response.text());
    },
  };
}
