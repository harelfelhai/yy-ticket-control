import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * מופע Prisma יחיד לכל תהליך.
 *
 * שתי סיבות ל-singleton דרך globalThis ולא משתנה מודול פשוט:
 * 1. ב-`next dev` המודולים נטענים מחדש בכל שינוי קוד; בלי זה כל שמירה
 *    הייתה יוצרת בריכת חיבורים נוספת עד שה-DB מסרב לחיבורים חדשים.
 * 2. הבריכה נשמרת בין בקשות, וזו הסיבה שהאירוח הוא שרת Node קבוע ולא
 *    serverless — שם כל קריאה הייתה משלמת על חיבור חדש.
 *
 * מ-Prisma 7 החיבור עובר דרך driver adapter (`@prisma/adapter-pg`) ולא דרך
 * מנוע Rust פנימי.
 */
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL אינו מוגדר. בפיתוח: הרץ `npm run db:up` והעתק את הערך ל-.env",
  );
}

/**
 * תצורת בריכת החיבורים — **מפורשת, ולא ברירות המחדל של `pg`**.
 *
 * מה שהיה שבור בברירות המחדל: `pg` נותן `max: 10` ו**אינו** מגדיר
 * ‏`connectionTimeoutMillis` (ראה `pg-pool/index.js`, `if
 * (!this.options.connectionTimeoutMillis)`). כלומר בקשה שממתינה לחיבור
 * מבריכה מלאה ממתינה **לנצח**. אותה בריכה משרתת גם את רינדור המסכים — שבו
 * ‏Server Component בודד מריץ כמה שאילתות — וגם את לולאת העובד שרצה כל שתי
 * שניות, ולכן שאילתה איטית אחת יכולה להשאיר מסך תלוי בלי שום הודעה.
 *
 * הכלל כאן: **להיכשל מהר ובקול, במקום להמתין בשקט.** כישלון מוצג למשתמש
 * בעברית ונתפס ב-Sentry; המתנה אינסופית אינה נראית בשום מקום.
 *
 * הערכים מכוונים לסדר הגודל האמיתי — כשישה משתמשים במקביל ועד כ-100 פניות
 * פתוחות — ולא לשרת עמוס: `max` נשאר 10 מפני שהצוואר כאן אינו מספר החיבורים
 * אלא זמן ההמתנה עליהם.
 */
const POOL = {
  /** מפורש ולא מרומז — כדי ששינוי ברירת מחדל של `pg` לא ישנה התנהגות בשקט */
  max: 10,
  /** ‏10 שניות להשגת חיבור. מעבר לזה משהו תקוע, ועדיף לומר זאת מאשר להמתין */
  connectionTimeoutMillis: 10_000,
  /**
   * גג לשאילתה בודדת, נאכף בצד השרת. שאילתה שרצה 20 שניות במערכת הזו היא
   * שאילתה שבורה, והיא מחזיקה בינתיים חיבור שאחרים ממתינים לו.
   */
  statement_timeout: 20_000,
  /**
   * הגג המקביל בצד הלקוח, גבוה במעט: כך `statement_timeout` הוא זה שיורה
   * ראשון ומחזיר שגיאה מפורשת, וזה כאן רק רשת ביטחון למקרה שהשרת אינו עונה.
   */
  query_timeout: 25_000,
} as const;

const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString, ...POOL }),
    // בפיתוח מדפיסים אזהרות ושגיאות בלבד; רישום כל שאילתה מציף את הלוג
    // ומסתיר את מה שבאמת נשבר.
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
