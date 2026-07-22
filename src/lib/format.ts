/**
 * תצוגת זמן.
 *
 * הכלל בפרויקט: **אחסון ב-UTC, תצוגה בשעון ישראל.** בלי אזור זמן מפורש
 * הפורמט נגזר מהשעון של המכונה — ואז שרת שרץ ב-UTC מציג למנהל בשטח שעה
 * שאינה השעה שבה הדבר קרה, בהפרש שמשתנה בין קיץ לחורף.
 *
 * הפורמט נעשה **בשרת** והתוצאה עוברת ללקוח כמחרוזת מוכנה. פורמט בצד הלקוח
 * היה מייצר תוכן שונה בין הרינדור בשרת לרינדור בדפדפן, וזו שגיאת hydration
 * שמתגלה רק אצל משתמש עם הגדרות אזור אחרות.
 */

const TIME_ZONE = "Asia/Jerusalem";
const LOCALE = "he-IL";

const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** שעה בלבד: "16:45" */
export function formatTime(value: Date): string {
  return timeFormatter.format(value);
}

/** תאריך ושעה קצרים: "22.7, 16:45" — מספיק לשרשור ולחיווי שליחה */
export function formatDateTime(value: Date): string {
  return dateTimeFormatter.format(value);
}
