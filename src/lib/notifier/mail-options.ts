import type { SendMailOptions } from "nodemailer";
import { formatMessageId, normalizeMessageId } from "@/lib/email-intake/headers";
import type { EmailMessage } from "./types";

/**
 * ההמרה היחידה מ-`EmailMessage` לאפשרויות של nodemailer.
 *
 * **למה זה קובץ ולא שתי שורות בכל ערוץ.** שני הערוצים בונים הודעה דרך
 * nodemailer — `gmail-api.ts` כדי להרכיב אותה ולשלוח אותה ב-HTTPS,
 * ו-`email.ts` כדי לשלוח אותה ב-SMTP. אילו כל אחד מהם היה ממפה את השדות
 * בעצמו, כותרת שרשור שנוספה לאחד הייתה חסרה בשני, והתקלה שהייתה מתגלה
 * היא "אצל חלק מהקבלנים התשובה פותחת שיחה חדשה" — בלי שום שגיאה.
 */

/**
 * הכותרות שמבקשות מהצד השני לא לענות אוטומטית.
 *
 * - `Auto-Submitted: auto-replied` הוא התקן (RFC 3834 §5): כל מה שאינו
 *   `no` פירושו "נוצר בידי מכונה", ומשיב אוטומטי מחויב לא לענות עליו.
 * - `X-Auto-Response-Suppress: All` הוא מה ש-Exchange ו-Outlook קוראים
 *   בפועל; הם אינם מכבדים את הראשון לבדו.
 *
 * בלעדיהן: "מחוץ למשרד" של הנמען עונה למענה שלנו, המערכת קולטת את התשובה
 * ועונה עליה, וכל סיבוב בלולאה גם מעדכן טיוטה. שים לב שאותו
 * `Auto-Submitted` הוא הסימן ש-`autoReplySignal` מחפש בכיוון הנכנס — ולכן
 * אם המענה שלנו יחזור אלינו (החזרה, העברה אוטומטית), הוא יזוהה ולא ייקלט.
 */
const AUTO_REPLY_HEADERS: Readonly<Record<string, string>> = {
  "Auto-Submitted": "auto-replied",
  "X-Auto-Response-Suppress": "All",
};

/**
 * מזהה בצורת הכותרת, או `undefined` כשאין כאן מזהה אמיתי.
 *
 * מזהה פגום (`<>`, מחרוזת ריקה) אינו מפיל את השליחה: מייל שלא יצא הוא
 * נזק גדול משרשור שנשבר, והכותרת פשוט לא נכתבת. `formatMessageId` הוא
 * המקום היחיד שקובע את הצורה, והוא גם זה שמנקה רווחים בתוך המזהה — בלעדיו
 * ירידת שורה שהגיעה מהמייל הנכנס הייתה פותחת כותרת חדשה בהודעה שלנו
 * (header injection).
 */
function headerId(value: string | undefined): string | undefined {
  if (!value || !normalizeMessageId(value)) return undefined;
  return formatMessageId(value);
}

export function toNodemailerMail(from: string, message: EmailMessage): SendMailOptions {
  const references = (message.references ?? [])
    .map(headerId)
    .filter((id): id is string => id !== undefined);

  const options: SendMailOptions = {
    from,
    to: message.to,
    subject: message.subject,
    // גרסת טקסט לצד ה-HTML: חלק מהלקוחות מציגים אותה, והיא מפחיתה את
    // הסיכוי שההודעה תסווג כספאם.
    text: message.text,
    html: message.html,
    // nodemailer מדלג על שדה שערכו `undefined`, ולכן הודעה בלי שדות
    // השרשור יוצאת בדיוק כפי שיצאה לפני שהם נוספו — אותן כותרות, באותו
    // סדר. זה מה שמאפשר להוסיף אותם בלי לגעת במסלול ההתראות.
    messageId: headerId(message.messageId),
    inReplyTo: headerId(message.inReplyTo),
  };

  // מערך ריק דווקא **אינו** `undefined`, ולכן הוא נבדק במפורש
  if (references.length > 0) options.references = references;
  if (message.autoReply) options.headers = { ...AUTO_REPLY_HEADERS };

  return options;
}
