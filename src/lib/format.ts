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

const dayFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "numeric",
  year: "numeric",
});

/**
 * מפתח היום בשעון ישראל — הבסיס להשוואה "אותו יום".
 *
 * ההשוואה נעשית על המחרוזת המפורמטת ולא על `getDate()`, כי `getDate()` קורא
 * את היום **בשעון המכונה**: הודעה מ-01:30 בישראל היא 22:30 של אתמול ב-UTC,
 * ושרת שרץ ב-UTC היה מציב מפריד יום באמצע הלילה במקום הנכון.
 */
export function dayKey(value: Date): string {
  return dayFormatter.format(value);
}

/**
 * שם היום למפריד בשרשור: "היום" · "אתמול" · תאריך מלא.
 *
 * ‏`now` נמסר ולא נקרא מ-`new Date()`: הפורמט נעשה בשרת, ורכיב שקורא את השעה
 * בעצמו אינו ניתן לבדיקה בלי לזייף את השעון הגלובלי.
 */
export function formatDaySeparator(value: Date, now: Date, labels: { today: string; yesterday: string }): string {
  const key = dayKey(value);
  if (key === dayKey(now)) return labels.today;

  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (key === dayKey(yesterday)) return labels.yesterday;

  return key;
}
