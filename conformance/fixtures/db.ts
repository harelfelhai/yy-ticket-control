import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";

/**
 * לקוח Prisma של תהליך הבדיקה, קשור במפורש ל-`E2E_DATABASE_URL`.
 *
 * לא `src/lib/db.ts`: הוא קורא את `DATABASE_URL` בזמן הייבוא, ובתהליך
 * ה-Playwright המשתנה הזה מצביע על בסיס הפיתוח (`yy_dev`). ייבוא שלו כאן
 * היה מריץ את הבדיקות מול נתוני הפיתוח האמיתיים.
 *
 * **למה בכלל צריך גישה ישירה למסד בבדיקת UI:** חלק מהדרישות אינן ניתנות
 * להבאה דרך הדפדפן בתוך ריצה — פנייה "ללא תנועה 9 ימים" (BR-10) דורשת
 * לדחוף את `lastActivityAt` אחורה, ואימות שקישור הקסם **אותו קישור** בין
 * שליחות דורש לקרוא את טבלת הטוקנים. הכלל: המסד משמש להבאת מצב ולקריאת
 * עובדות, **לעולם לא כדי לעקוף פעולה שהיא עצמה נבדקת**.
 */
const connectionString = process.env.E2E_DATABASE_URL;

if (!connectionString) {
  throw new Error("E2E_DATABASE_URL אינו מוגדר. הרץ `npm run db:up` והעתק את הערך ל-.env");
}

export const cdb = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
  log: ["error"],
});
