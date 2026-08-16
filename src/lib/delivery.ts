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
   * אין ערוץ מייל כלל — נבדק **לפני** "ממתין לשליחה".
   *
   * בלי הענף הזה השורה הייתה אומרת "ההודעה תישלח בקרוב" על מערכת שאין לה
   * דרך לשלוח, כלומר הבטחה שלעולם לא תתקיים. מנהל שקורא אותה אינו מרים
   * טלפון, והקבלן לא יוצא לעבודה. כאן ההודעה קוראת לפעולה — הכפתור
   * לוואטסאפ שלצד השורה הוא המסלול שכן עובד.
   */
  if (!facts.emailConfigured) return he.ticket.notifyNotConfigured;

  // יש כתובת אך טרם יצאה הודעה: הג'וב ממתין בתור או נכשל ויחזור. בשני
  // המקרים אין מה לעשות, ולכן הנוסח מתאר ואינו קורא לפעולה.
  if (facts.hasEmail) return he.ticket.notifyQueued;

  // אין מייל אבל יש טלפון — זה בדיוק המצב שבו הכפתור שלצד השורה נחוץ.
  if (facts.hasPhone) return he.ticket.notifyNoEmail;

  // אין כלום. זו שגיאת נתונים שהמנהל היחיד שיכול לתקן, ולכן היא נאמרת
  // במפורש ולא נבלעת.
  return he.notices.cannotSendNoContact;
}
