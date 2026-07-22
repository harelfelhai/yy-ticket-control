import { env } from "@/lib/env";
import type { EmailTransport } from "./types";

/**
 * ערוצי המייל.
 *
 * שני מימושים לאותו חוזה, וההפרדה ביניהם היא מה שמאפשר לפתח ולבדוק את כל
 * צינור השליחה בלי חשבון חיצוני ובלי לשלוח דואר לאדם אמיתי.
 *
 * ‏Resend נקרא ב-`fetch` ישיר ולא דרך ה-SDK שלו: מדובר בקריאת POST אחת
 * לנקודת קצה מתועדת, וה-SDK גורר איתו את מנוע הרינדור של react-email —
 * תלות כבדה עבור בקשה אחת, במערכת שממילא מנסחת את ההודעות בעצמה.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function resendTransport(apiKey: string, from: string): EmailTransport {
  return {
    name: "resend",
    async send(message) {
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          // גרסת טקסט לצד ה-HTML: חלק מהלקוחות מציגים אותה, והיא מפחיתה
          // את הסיכוי שההודעה תסווג כספאם.
          text: message.text,
        }),
      });

      if (!response.ok) {
        // הטקסט המלא נכנס לשגיאה כדי שהוא יישמר ב-`Job.lastError` ויהיה
        // אפשר לאבחן כשל שליחה בלי לשחזר אותו.
        const details = await response.text().catch(() => "");
        throw new Error(`Resend החזיר ${response.status}: ${details}`);
      }
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
    async send(message) {
      console.info(
        `[notifier] מייל (לא נשלח — אין RESEND_API_KEY)\nאל: ${message.to}\nנושא: ${message.subject}\n${message.text}\n`,
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
export function selectEmailTransport(): EmailTransport {
  const apiKey = env.resendApiKey();
  const from = env.notifyFromEmail();

  if (apiKey && from) return resendTransport(apiKey, from);

  if (env.isProduction()) {
    throw new Error(
      "שליחת מייל אינה מוגדרת: חסרים RESEND_API_KEY או NOTIFY_FROM_EMAIL. ראה .env.example",
    );
  }

  return consoleTransport();
}
