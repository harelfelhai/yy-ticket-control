import { he } from "./he";

/**
 * מה לומר למנהל על מצב היידוע של נמען — פונקציה טהורה.
 *
 * הבחנה שהמערכת כולה נשענת עליה: **"נשלח" בסטטוס השיוך אינו אומר שמישהו
 * יודע.** הוא אומר שהמערכת שייכה אותו. פנייה שיושבת יומיים כי לקבלן אין
 * מייל ואיש לא לחץ על וואטסאפ תיראה בדיוק כמו פנייה שנשלחה — אלא אם השורה
 * הזו אומרת אחרת.
 *
 * הפונקציה טהורה ויושבת מחוץ לשכבת השירות כדי שתיבדק ישירות, בלי DB.
 */

export interface DeliveryFacts {
  /** מתי יצאה הודעה אוטומטית בפועל */
  notifiedAt: Date | null;
  hasEmail: boolean;
  hasPhone: boolean;
  /** האם בכלל קיים ערוץ מייל בסביבה הזו (`isEmailConfigured`) */
  emailConfigured: boolean;
}

export function deliveryNote(facts: DeliveryFacts, formatTime: (value: Date) => string): string {
  if (facts.notifiedAt) return he.ticket.notifiedAt(formatTime(facts.notifiedAt));

  /**
   * יש כתובת, וטרם יצאה הודעה — שתי סיבות שונות לחלוטין.
   *
   * ‏`notifyQueued` ("בתור לשליחה") נכון כשיש ערוץ: הג'וב ממתין או נכשל
   * ויחזור, ובשני המקרים אין מה לעשות. אבל כשאין ערוץ כלל הוא הבטחה
   * שלעולם לא תתקיים — מנהל שקורא אותה אינו מרים טלפון, והקבלן לא יוצא
   * לעבודה.
   *
   * הבדיקה **בתוך** הענף של `hasEmail` ולא לפניו, וזה תיקון של תיקון:
   * בגרסה הראשונה היא ישבה למעלה, וקבלן שאין לו מייל בכלל קיבל "ערוץ
   * המייל אינו מוגדר" במקום "אין מייל". שתי אמירות נכונות, אחת מהן אינה
   * הסיבה — ומי שקורא אותה מחפש הגדרה שחסרה במקום להשלים כתובת.
   */
  if (facts.hasEmail) {
    return facts.emailConfigured ? he.ticket.notifyQueued : he.ticket.notifyNotConfigured;
  }

  // אין מייל אבל יש טלפון — זה בדיוק המצב שבו הכפתור שלצד השורה נחוץ.
  if (facts.hasPhone) return he.ticket.notifyNoEmail;

  // אין כלום. זו שגיאת נתונים שהמנהל היחיד שיכול לתקן, ולכן היא נאמרת
  // במפורש ולא נבלעת.
  return he.notices.cannotSendNoContact;
}
