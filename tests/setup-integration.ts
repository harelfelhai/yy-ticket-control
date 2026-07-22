import "dotenv/config";

/**
 * מפנה את בדיקות האינטגרציה לבסיס הבדיקות ולא לבסיס הפיתוח.
 *
 * ההצבה חייבת לקרות כאן, בקובץ ה-setup, ולא בתוך קובץ בדיקה: `src/lib/db.ts`
 * קורא את DATABASE_URL ברגע הייבוא, וקובצי ה-setup רצים לפני שקובצי הבדיקה
 * מייבאים מודולים. הצבה מאוחרת יותר הייתה מפילה בדיקות על נתוני פיתוח אמיתיים.
 */
if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL אינו מוגדר. הרץ `npm run db:up` והעתק את הערך ל-.env",
  );
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
