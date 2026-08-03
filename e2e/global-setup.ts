import "dotenv/config";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

export const E2E_ADMIN = {
  phone: "0500000000",
  password: "dev-admin-1234",
  name: "מנהל ראשי",
};

/**
 * מכין את בסיס הבדיקות לפני ריצת ה-E2E: ריקון, מיגרציות ואז seed.
 *
 * **הריקון אינו ניקיון קוסמטי.** בלעדיו כל ריצה מוסיפה פניות, שיוכים
 * וקישורים על גבי הקודמות: אחרי עשרות ריצות הבסיס הכיל מאות שיוכים,
 * הלוח נטען לאט יותר, ועובד התור התחיל כל ריצה בגיבוי של עבודות ישנות —
 * מה שהפך את הבדיקות לאיטיות ולא יציבות מסיבות שאינן קשורות לקוד הנבדק.
 *
 * ה-seed הוא idempotent, ולכן הרצה חוזרת אינה משכפלת ואינה משנה את סיסמת
 * המנהל הקיים. הסיסמה נקבעת דרך SEED_ADMIN_PASSWORD כי בדיקה חייבת פרטי
 * התחברות ידועים מראש; בפרודקשן המשתנה נשאר ריק ונוצרת סיסמה אקראית.
 */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) {
    throw new Error("E2E_DATABASE_URL אינו מוגדר. הרץ `npm run db:up` והעתק את הערך ל-.env");
  }

  await truncateAll(url);

  // ‏Playwright מריץ את הקובץ כ-CommonJS, ולכן `import.meta.url` אינו זמין.
  // עוגן יחסי לשורש הפרויקט משיג את אותה תוצאה בלי תלות בפורמט המודול.
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const env = { ...process.env, DATABASE_URL: url, SEED_ADMIN_PASSWORD: E2E_ADMIN.password };

  const steps: [string, string[]][] = [
    [require.resolve("prisma/build/index.js"), ["migrate", "deploy"]],
    [require.resolve("tsx/cli"), ["prisma/seed.ts"]],
  ];

  for (const [script, args] of steps) {
    const result = spawnSync(process.execPath, [script, ...args], { env, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(
        `הכנת בסיס הבדיקות נכשלה (${args.join(" ")}):\n${result.stdout}\n${result.stderr}`,
      );
    }
  }
}

/**
 * מרוקן את כל הטבלאות של בסיס ה-E2E.
 *
 * ‏`pg` ישירות ולא Prisma: הקובץ רץ לפני שהשרת עולה, וטעינת לקוח Prisma
 * כאן הייתה קושרת את ההכנה ל-DATABASE_URL של הסביבה במקום לכתובת שנמסרה.
 * הטבלאות נשלפות מהקטלוג ולא נכתבות ידנית, כדי שטבלה חדשה בסכימה לא
 * תישאר מלוכלכת בשקט.
 */
export async function truncateAll(connectionString: string): Promise<void> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const { rows } = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename not like '_prisma%'",
    );
    if (rows.length > 0) {
      const list = rows.map((row) => `"public"."${row.tablename}"`).join(", ");
      await client.query(`truncate table ${list} restart identity cascade`);
    }
  } finally {
    await client.end();
  }
}
