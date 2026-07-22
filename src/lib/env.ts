/**
 * קריאת משתני סביבה במקום אחד, עם כשל מוקדם וברור.
 *
 * הכלל: משתנה חסר מפיל את השרת בעלייה עם הודעה שאומרת מה חסר, ולא מייצר
 * התנהגות שקטה ושגויה בזמן ריצה. משתנה שנקרא ישירות מ-`process.env` בתוך
 * לוגיקה עסקית הוא באג שמתגלה רק בפרודקשן, כשמישהו כבר סומך על המערכת.
 *
 * הפונקציות עצלות (ולא קבועים ברמת המודול) כדי שקובץ בדיקה שאינו נוגע
 * ב-R2 או ב-AI לא ייכשל רק משום שהמפתחות האלה לא מוגדרים אצלו.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`משתנה הסביבה ${name} אינו מוגדר. ראה .env.example`);
  }
  return value;
}

/** אורך מינימלי למפתח הצפנת העוגייה. iron-session דורש 32 תווים לפחות. */
const SESSION_SECRET_MIN_LENGTH = 32;

export const env = {
  databaseUrl: () => required("DATABASE_URL"),

  sessionSecret: () => {
    const secret = required("SESSION_SECRET");
    if (secret.length < SESSION_SECRET_MIN_LENGTH) {
      throw new Error(
        `SESSION_SECRET חייב להיות באורך ${SESSION_SECRET_MIN_LENGTH} תווים לפחות`,
      );
    }
    return secret;
  },

  /** הבסיס לקישורי הקסם שנשלחים לקבלנים — חייב להיות כתובת שהם יכולים לפתוח */
  appBaseUrl: () => required("APP_BASE_URL"),

  isProduction: () => process.env.NODE_ENV === "production",
};
