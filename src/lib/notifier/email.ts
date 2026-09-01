import nodemailer from "nodemailer";
import { env } from "@/lib/env";
import type { EmailTransport } from "./types";

/**
 * ערוצי המייל.
 *
 * שני מימושים לאותו חוזה, וההפרדה ביניהם היא מה שמאפשר לפתח ולבדוק את כל
 * צינור השליחה בלי חשבון חיצוני ובלי לשלוח דואר לאדם אמיתי.
 *
 * **מ-1.9.2026 הערוץ הוא SMTP של Gmail, ולא Resend.** ההחלפה אינה טכנית
 * אלא עסקית: כתובת הדואר של החברה היא `@gmail.com` חופשית, ו-Resend מתיר
 * שליחה **רק מדומיין שבבעלותך ואומת אצלו**. כלומר איתו לא הייתה שום דרך
 * לשלוח מהכתובת של העסק — רק מכתובת חדשה בדומיין חדש, שהקבלן אינו מכיר.
 *
 * וזה בדיוק ההפך ממה שהמערכת צריכה: ההתראה נשלחת לקבלן משנה כדי שהוא
 * **יגיב**. הודעה מהכתובת ששמורה אצלו בטלפון נפתחת; הודעה מכתובת זרה
 * נראית כספאם, ותשובה עליה נוחתת בתיבה שאיש אינו קורא. ‏Gmail שולח
 * מהכתובת האמיתית, ותשובות חוזרות לתיבה האמיתית.
 *
 * המחיר, במפורש: תלות ב-`nodemailer` במקום `fetch` ישיר. זו התלות
 * החיצונית היחידה שנוספה בשביל ערוץ יוצא, והיא נדרשת כי SMTP אינו HTTP.
 */

/**
 * גג לשליחת מייל בודדת.
 *
 * **למה זה קריטי דווקא כאן.** העבודות בתור מנוקזות בזו אחר זו
 * (`drainJobs`), ולכן קריאה יוצאת שאינה חוזרת אינה מעכבת רק את עצמה — היא
 * עוצרת את **כל** ההתראות שממתינות אחריה. שליחת מייל היא בקשת POST קטנה;
 * עשר שניות הן כבר סימן שהצד השני אינו עונה, ועדיף להיכשל, לרשום
 * ב-`Job.lastError`, ולנסות שוב בעוד דקה.
 */
const SEND_TIMEOUT_MS = 10_000;

/**
 * ‏587 עם STARTTLS (`secure: false` פירושו "שדרג לאחר החיבור", לא "בלי
 * הצפנה") — ההמלצה של Google, ועדיף על 465 בסביבות ענן שחוסמות אותו.
 */
const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 587;

/**
 * ‏SMTP של Gmail. האימות הוא **App Password** בן 16 תווים ולא סיסמת
 * החשבון — סיסמה רגילה נדחית, וכדי להנפיק אותו נדרש אימות דו-שלבי על
 * החשבון.
 *
 * `from` חייב להיות החשבון המאומת עצמו (או alias שהוגדר בו); Gmail דוחה
 * כתובת אחרת. שם תצוגה מותר, ולכן `"בקרת פניות <x@gmail.com>"` תקין.
 */
export function gmailTransport(user: string, appPassword: string, from: string): EmailTransport {
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    auth: { user, pass: appPassword },
    // שלושת הגגות מגנים על אותו דבר שה-`AbortSignal` הגן עליו קודם: התור
    // מנוקז סדרתית, וחיבור SMTP תלוי עוצר את **כל** ההתראות שאחריו.
    connectionTimeout: SEND_TIMEOUT_MS,
    greetingTimeout: SEND_TIMEOUT_MS,
    socketTimeout: SEND_TIMEOUT_MS,
  });

  return {
    name: "gmail",
    async send(message) {
      await transporter.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        // גרסת טקסט לצד ה-HTML: חלק מהלקוחות מציגים אותה, והיא מפחיתה
        // את הסיכוי שההודעה תסווג כספאם.
        text: message.text,
      });
    },
  };
}

/**
 * כותב את ההודעה ללוג במקום לשלוח אותה.
 *
 * לא "מימוש ריק": הוא מדפיס את הנמען, את הנושא ואת הגוף המלא, ולכן הוא
 * הדרך לראות בפיתוח מה בדיוק היה נשלח — כולל הקישור שהקבלן היה מקבל.
 */
export function consoleTransport(): EmailTransport {
  return {
    name: "console",
    // ראה `EmailTransport.simulated`: הדגל הוא מה שמונע מהמערכת להצהיר
    // "נשלח" על הודעה שרק נכתבה ללוג.
    simulated: true,
    async send(message) {
      console.info(
        `[notifier] מייל (לא נשלח — אין GMAIL_APP_PASSWORD)\nאל: ${message.to}\nנושא: ${message.subject}\n${message.text}\n`,
      );
    },
  };
}

/**
 * בוחר ערוץ לפי הסביבה.
 *
 * בפרודקשן היעדר מפתח הוא כשל רועש ולא נפילה חיננית לכתיבה ללוג: מערכת
 * שנראית עובדת ובשקט אינה מודיעה לאיש היא בדיוק הכישלון שהמערכת הזו
 * נבנתה כדי למנוע.
 */
/**
 * האם יש ערוץ מייל אמיתי בסביבה הזו.
 *
 * נפרד מ-`selectEmailTransport` כדי שהממשק יוכל **לשאול בלי לבחור ערוץ**:
 * מסך הפנייה צריך לדעת אם להסביר למנהל שלא יצא מייל, ובניית ערוץ שליחה רק
 * כדי לבדוק תנאי היא תופעת לוואי מיותרת במסלול רינדור. שני הקוראים נשענים
 * על אותו תנאי אחד — אחרת הממשק והשליחה היו יכולים לחלוק על עצם קיומו.
 */
export function isEmailConfigured(): boolean {
  return Boolean(env.gmailUser() && env.gmailAppPassword());
}

export function selectEmailTransport(): EmailTransport {
  const user = env.gmailUser();
  const appPassword = env.gmailAppPassword();

  // ‏`NOTIFY_FROM_EMAIL` אופציונלי: ברירת המחדל היא החשבון עצמו, שהוא
  // ממילא הכתובת היחידה ש-Gmail מתיר לשלוח ממנה. הוא קיים רק כדי להוסיף
  // שם תצוגה.
  if (user && appPassword) return gmailTransport(user, appPassword, env.notifyFromEmail() ?? user);

  if (env.isProduction()) {
    throw new Error(
      "שליחת מייל אינה מוגדרת: חסרים GMAIL_USER או GMAIL_APP_PASSWORD. ראה .env.example",
    );
  }

  return consoleTransport();
}
