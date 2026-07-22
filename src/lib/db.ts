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

const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
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
