import { normalizePhone } from "@/lib/normalize";

/**
 * שיתוף בוואטסאפ דרך קישור `wa.me` — לא דרך WhatsApp Business API.
 *
 * ההכרעה הזו מרכזית ומכוונת. ה-API הרשמי דורש אימות עסקי, תבניות הודעה
 * מאושרות מראש וחלון של 24 שעות שמחוצה לו אי אפשר ליזום פנייה — תלות
 * רגולטורית שהייתה חוסמת את המערכת כולה עד לאישור. `wa.me` פותח וואטסאפ
 * **בטלפון של המנהל** עם ההודעה מוכנה, והוא לוחץ "שלח" בעצמו.
 *
 * המשמעות: ההודעה מגיעה מהמספר האישי שהקבלן כבר מכיר, ולא ממספר עסקי זר.
 * המחיר: זו פעולה ידנית ולא אוטומטית, ולכן הוואטסאפ הוא כפתור בממשק ואילו
 * המייל נשלח מעצמו ברקע.
 */

/** ‏972 היא קידומת ישראל. wa.me דורש את הצורה הבינלאומית בלי + ובלי מפרידים. */
const ISRAEL_CODE = "972";

/** מספר ישראלי קצר מזה אינו יכול להיות מספר נייד תקין */
const MIN_LOCAL_DIGITS = 9;

/**
 * ממיר מספר טלפון לצורה ש-wa.me מבין, או null אם אין מה להמיר.
 *
 * ‏`normalizePhone` מאחד קודם את כל הצורות שנשמרו במערכת ("054-1234567",
 * "+972 54 1234567") לצורה מקומית אחת — כך ההמרה כאן נשענת על מקור אמת אחד
 * ולא מנחשת מחדש מה הפורמט.
 */
export function toWhatsAppNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const local = normalizePhone(phone);
  if (!local) return null;

  // מספר שכבר נשמר בצורה בינלאומית שאינה ישראלית — נשלח כמות שהוא בלי ה-+.
  if (local.startsWith("+")) return local.slice(1);

  const digits = local.replace(/\D/g, "");
  if (digits.length < MIN_LOCAL_DIGITS) return null;

  return `${ISRAEL_CODE}${digits.replace(/^0/, "")}`;
}

/**
 * בונה את הקישור שפותח וואטסאפ עם ההודעה מוכנה.
 * מחזיר null כשאין מספר — הכפתור פשוט לא מוצג, במקום לפתוח וואטסאפ ריק.
 */
export function waShareUrl(phone: string | null | undefined, text: string): string | null {
  const number = toWhatsAppNumber(phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/**
 * הנתיב הפנימי שמתעד את הפתיחה ומפנה ל-`wa.me` — מקור אמת יחיד.
 *
 * יושב כאן, במודול הטהור, ולא לצד `openWhatsApp`: הוא נבנה גם בשרת (מסך
 * הפנייה) וגם בקומפוננטת לקוח (הפאנל "נותר לשלוח"), וקובץ ה-service מייבא
 * ‏`db` — כלומר ייבוא ממנו בלקוח היה גורר את Prisma לחבילת הדפדפן.
 */
export function whatsAppPath(assignmentId: string): string {
  return `/api/wa/${encodeURIComponent(assignmentId)}`;
}

/** נמען שלא יקבל שום הודעה עד שמישהו יפתח עבורו את הוואטסאפ */
export interface WaPendingRecipient {
  assignmentId: string;
  name: string;
}
