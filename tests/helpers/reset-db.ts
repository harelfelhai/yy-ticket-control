import { db } from "@/lib/db";

/**
 * מרוקן את כל טבלאות בסיס הבדיקות.
 *
 * ‏TRUNCATE ... CASCADE ולא סדרת deleteMany: הוא עוקף את אילוצי המפתח הזר
 * (הסכימה מלאה ב-Restrict, ולכן מחיקה לפי סדר הייתה שברירית וקשה לתחזוקה),
 * ומאפס גם את המונה של Ticket.seq — כך שכל בדיקה מתחילה ממספר פנייה 1
 * וניתן לכתוב ציפיות יציבות.
 *
 * שמות הטבלאות נשלפים מ-information_schema ולא נכתבים ידנית, כדי שטבלה
 * חדשה בסכימה לא תישאר מלוכלכת בשקט בין בדיקות.
 */
export async function resetDb() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename not like '_prisma%'
  `;

  if (tables.length === 0) return;

  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`truncate table ${list} restart identity cascade`);
}
