/**
 * הטיפוסים של שכבת השליחה.
 *
 * הם מוגדרים בקובץ נפרד ובלי תלות ב-Prisma ובשום ספריית שליחה, כדי ששתי
 * המטרות של השכבה יתקיימו: הניסוח נבדק כפונקציה טהורה, והוספת ערוץ עתידי
 * (SMS, WhatsApp Business API) לא נוגעת בקוד שקורא לה.
 */

/** האירועים שמצדיקים הודעה יוצאת. לא כל אירוע בשרשור שולח הודעה. */
export type NotificationEvent = "ASSIGNED" | "REOPENED" | "QUESTION" | "DONE";

/** מה שצריך לדעת על הפנייה כדי לנסח הודעה עליה */
export interface TicketSummary {
  /** המספר הקריא לאדם — מה שאומרים בטלפון */
  seq: number;
  buildingName: string | null;
  apartmentNumber: string | null;
  domainName: string | null;
  description: string;
}

export interface ComposeInput {
  event: NotificationEvent;
  /** שם מקבל ההודעה */
  toName: string;
  /** מי גרם לאירוע — הקבלן ששאל או שסימן טופל. ריק בשיוך ובפתיחה מחדש. */
  actorName?: string;
  ticket: TicketSummary;
  /** לאן ההודעה מובילה: קישור קסם לקבלן, כתובת הפנייה למשתמש פנימי */
  link: string;
  /** תוכן חופשי שנלווה לאירוע — למשל טקסט השאלה שנשאלה */
  note?: string;
}

/**
 * ההודעה המנוסחת, לפני שהיא נכנסת לערוץ כלשהו.
 * `body` הוא טקסט פשוט: וואטסאפ אינו יודע HTML, והמייל עוטף את אותו טקסט.
 */
export interface ComposedMessage {
  subject: string;
  body: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * ערוץ מייל אחד. המימוש האמיתי (Resend) והמימוש שרק כותב ללוג מקיימים את
 * אותו חוזה, ולכן אפשר להריץ את כל צינור השליחה בפיתוח ובבדיקות בלי מפתח
 * ובלי לשלוח מייל לאיש.
 */
export interface EmailTransport {
  /** לזיהוי בלוגים ובבדיקות: מה בפועל שלח את ההודעה */
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}
