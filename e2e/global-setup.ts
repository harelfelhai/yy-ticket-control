import "dotenv/config";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import type { Client as PgClient } from "pg";

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
 * `pg` ישירות ולא Prisma: טעינת לקוח Prisma כאן הייתה קושרת את ההכנה
 * ל-DATABASE_URL של הסביבה במקום לכתובת שנמסרה. הטבלאות נשלפות מהקטלוג
 * ולא נכתבות ידנית, כדי שטבלה חדשה בסכימה לא תישאר מלוכלכת בשקט.
 *
 * **הריקון קורה כששרת הבדיקות כבר חי** — נמדד 7.9.2026, בניגוד למה שנכתב
 * כאן קודם. Playwright מעלה את `webServer` ומחכה לו, ורק אז מריץ את
 * ה-globalSetup. זה תקין (הבדיקות רצות אחרי), אבל זו הסיבה ש-
 * `assertSoleDbClient` שואל על **גיל** החיבור ולא על עצם קיומו.
 */
export async function truncateAll(connectionString: string): Promise<void> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await assertSoleDbClient(client);

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

/** חיבור פתוח לבסיס הבדיקות שאינו שלנו */
export interface ForeignDbClient {
  pid: number;
  /** הפורט המקומי של החיבור — דרכו מזהים את התהליך ב-`netstat -ano` */
  clientPort: number | null;
  applicationName: string;
  backendStart: Date;
  /** בן כמה שניות החיבור, **לפי שעון בסיס הנתונים** — ראה `assertSoleDbClient` */
  ageSeconds: number;
}

/** מתג מילוט למי שמריץ בכוונה מול שרת שהעלה בעצמו */
const ALLOW_FOREIGN_ENV = "E2E_ALLOW_FOREIGN_DB_CLIENTS";

/** מרווח לזמן שלוקח לשרת לעלות ולהתחבר, מעבר לגיל תהליך הריצה */
const STARTUP_GRACE_SECONDS = 15;

/**
 * כל חיבור לקוח פתוח לבסיס הבדיקות שאינו החיבור שממנו נשאלה השאלה.
 *
 * `backend_type = 'client backend'` מסנן את תהליכי הרקע של Postgres עצמו
 * (autovacuum, walwriter): הם מופיעים ב-`pg_stat_activity` עם `datname`
 * מלא, והיו נספרים כזרים.
 *
 * הגיל מחושב ב-SQL ולא ב-JS **בכוונה**: `backend_start` הוא שעון בסיס
 * הנתונים, ו-`Date.now()` הוא שעון התהליך. חיסור בין השניים היה גורר את
 * הפרש השעונים אל תוך ההכרעה.
 */
export async function foreignDbClients(client: PgClient): Promise<ForeignDbClient[]> {
  const { rows } = await client.query<{
    pid: number;
    client_port: number | null;
    application_name: string;
    backend_start: Date;
    age_seconds: string;
  }>(
    `select pid, client_port, application_name, backend_start,
            extract(epoch from (now() - backend_start)) as age_seconds
       from pg_stat_activity
      where datname = current_database()
        and backend_type = 'client backend'
        and pid <> pg_backend_pid()
      order by backend_start`,
  );

  return rows.map((row) => ({
    pid: row.pid,
    clientPort: row.client_port,
    applicationName: row.application_name,
    backendStart: row.backend_start,
    ageSeconds: Number(row.age_seconds),
  }));
}

/**
 * **בסיס הבדיקות חייב להיות שלנו בלבד, ואין לזה תחליף בבידוד לוגי.**
 *
 * מה שקרה בפועל (7.9.2026): שרת `next start -p 3105` של הפרויקט הזה, שעלה
 * שלושה ימים קודם ונשכח, נשאר מחובר ל-`yy_e2e`. **לכל שרת של המערכת יש עובד
 * תור בתוך התהליך** (`src/instrumentation.ts`), והתור הוא טבלה בבסיס — ולכן
 * אותו שרת נשכח המשיך לתפוס ג׳ובים מהתור של הבדיקות ולהריץ אותם **בסביבה
 * שלו**: עם `GEMINI_API_KEY` אמיתי ועם קוד מלפני שלושה ימים.
 *
 * התוצאה הייתה `media.spec.ts` שנכשל בעקביות על מסלול "אין מנוע AI" — כי
 * המנוע כן היה, אצל תהליך אחר — ו-`Job.lastError` שהכיל נוסח שגיאה שכבר לא
 * קיים ב-`src/`. שתי ראיות שכל אחת מהן מובילה, לבדה, לאבחון שגוי.
 *
 * `webServer.env` אינו מגן על כך: הוא שולט בסביבת השרת ש-Playwright מעלה,
 * ולא בשאלה מי עוד מחובר לאותו בסיס. הבידוד היחיד שהיה עוזר הוא בסיס נתונים
 * לכל ריצה — מחיר גבוה לתקלה נדירה — ולכן במקומו יש כאן **גילוי**: הריצה
 * נעצרת מיד עם הודעה שמצביעה על התהליך, במקום להיכשל בעוד 30 שניות על
 * טענה שנראית כמו באג בקוד.
 *
 * **הקריטריון הוא גיל החיבור, ולא עצם קיומו** — ולכך יש סיבה שנמדדה:
 * Playwright מעלה את `webServer` **לפני** ה-globalSetup ולא אחריו (נמדד
 * 7.9.2026: העובד של שרת הבדיקות התחבר ל-`yy_e2e` שלוש שניות לפני שהקובץ
 * הזה פתח את החיבור שלו). כלומר שרת הבדיקות **תמיד** יופיע כאן, וכלל של
 * "אף חיבור זר" היה חוסם כל ריצה.
 *
 * מה שכן מבדיל: השרת הלגיטימי נולד **בתוך הריצה הזו**, ולכן הוא צעיר
 * מתהליך הריצה עצמו (`process.uptime()`); שרת נשכח נולד לפניו — בדקות,
 * בשעות או בימים. אותו קריטריון מסלק גם רעש רגעי כמו בדיקת בריאות של
 * מכולת Postgres ב-CI. מי שהעלה שרת בעצמו ומריץ מולו ב-`reuseExistingServer`
 * ייתפס אף הוא — וזה נכון, כי סביבת אותו שרת אינה ידועה; בשבילו יש
 * `E2E_ALLOW_FOREIGN_DB_CLIENTS=1`.
 */
export async function assertSoleDbClient(
  client: PgClient,
  /** הגיל שמעליו חיבור נחשב זר. פרמטר כדי שבדיקה לא תידרש לחיבור בן דקות */
  maxAgeSeconds: number = process.uptime() + STARTUP_GRACE_SECONDS,
): Promise<void> {
  if (process.env[ALLOW_FOREIGN_ENV] === "1") return;

  const stale = staleForeignClients(await foreignDbClients(client), maxAgeSeconds);
  if (stale.length === 0) return;

  throw new Error(foreignDbClientsMessage(stale));
}

/** ההכרעה עצמה, טהורה */
export function staleForeignClients(
  clients: ForeignDbClient[],
  maxAgeSeconds: number,
): ForeignDbClient[] {
  return clients.filter((row) => row.ageSeconds > maxAgeSeconds);
}

/** מופרד מהזריקה כדי שהנוסח ייבדק בלי בסיס נתונים */
export function foreignDbClientsMessage(foreign: ForeignDbClient[]): string {
  const lines = foreign.map(
    (row) =>
      `  • pid ${row.pid} · חובר ב-${row.backendStart.toISOString()}` +
      (row.clientPort === null ? "" : ` · netstat -ano | findstr ${row.clientPort}`),
  );

  return [
    `בסיס הבדיקות תפוס: ${foreign.length} חיבורים נוספים פתוחים אליו.`,
    "",
    "לכל שרת של המערכת יש עובד תור בתוך התהליך, ולכן שרת אחר שמחובר לבסיס",
    "הזה יתפוס ג׳ובים של הבדיקות ויריץ אותם בסביבה שלו — והבדיקות ייכשלו על",
    "טענות שנראות כמו באג בקוד. עצור את התהליכים האלה ונסה שוב:",
    ...lines,
    "",
    `אם החיבור מכוון (שרת שהעלית בעצמך ל-reuseExistingServer), הרץ עם ${ALLOW_FOREIGN_ENV}=1.`,
  ].join("\n");
}
