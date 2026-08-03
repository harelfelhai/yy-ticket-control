import { Client } from "pg";

/**
 * גישה ישירה לבסיס הבדיקות מתוך תהליך הבדיקה, דרך `pg` ולא דרך Prisma.
 *
 * שתי סיבות, שתיהן נתקלו בפועל:
 * 1. ‏`src/lib/db.ts` קורא את `DATABASE_URL` בזמן הייבוא, ובתהליך Playwright
 *    המשתנה מצביע על בסיס הפיתוח — ייבוא שלו היה מריץ את הבדיקות מול נתוני
 *    הפיתוח האמיתיים.
 * 2. הלקוח המיוצר (`src/generated/prisma/client.ts`) משתמש ב-`import.meta`,
 *    ו-Playwright טוען קובצי בדיקה כ-CJS — ייבוא שלו נופל על שגיאת תחביר.
 *    זו אותה מגבלה שמתועדת ב-`e2e/global-setup.ts`, ואותו פתרון: `pg` ישיר.
 *
 * **מה מותר לעשות כאן:** להביא מצב שאי אפשר להגיע אליו בדפדפן בתוך ריצה
 * (פנייה "ללא תנועה 9 ימים"), ולקרוא עובדות לאימות. **מה אסור:** לעקוף
 * פעולה שהיא עצמה הדרישה הנבדקת.
 */
function connectionString(): string {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) {
    throw new Error("E2E_DATABASE_URL אינו מוגדר. הרץ `npm run db:up` והעתק את הערך ל-.env");
  }
  return url;
}

/** מריץ שאילתה אחת וסוגר את החיבור — בדיקות עושות זאת נדיר, ובריכה מיותרת */
export async function query<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: connectionString() });
  await client.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows as T[];
  } finally {
    await client.end();
  }
}
