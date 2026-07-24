import { spawn } from "node:child_process";

/**
 * גיבוי ושחזור של בסיס הנתונים דרך pg_dump / pg_restore.
 *
 * **פורמט custom (‏-Fc)** ולא SQL טקסט: הוא דחוס, והוא נשחזר עם pg_restore
 * שיודע לדלג על שגיאות, לבחור טבלאות, ולהריץ במקביל. זהו הפורמט התקני
 * לגיבוי שנועד לשחזור, להבדיל מ-‏-Fp שנועד לקריאה אנושית.
 *
 * **פרטי החיבור עוברים במשתני PG* ולא ב-argv:** ‏URL עם סיסמה כארגומנט
 * מופיע ברשימת התהליכים (ps) וגלוי לכל תהליך במכונה. משתני סביבה אינם.
 */

/** מפרק את ה-DATABASE_URL למשתני החיבור התקניים של libpq */
function connectionEnv(databaseUrl: string): Record<string, string> {
  const url = new URL(databaseUrl);
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.replace(/^\//, ""),
  };
}

interface DumpOptions {
  databaseUrl: string;
  pgDumpPath: string;
}

/**
 * מייצר גיבוי מלא של בסיס הנתונים ומחזיר את הבתים.
 *
 * ‏--no-owner ו---no-privileges: הגיבוי לא ינסה לשחזר בעלות והרשאות שתלויות
 * בשמות תפקידים שאולי אינם קיימים ביעד השחזור — מה שהופך אותו לנייד בין
 * סביבות (פיתוח, פרודקשן, מכונה זרה בשעת חירום).
 */
export function createDatabaseDump(options: DumpOptions): Promise<Buffer> {
  return run(
    options.pgDumpPath,
    ["-Fc", "--no-owner", "--no-privileges"],
    connectionEnv(options.databaseUrl),
    { collectStdout: true },
  );
}

interface RestoreOptions {
  databaseUrl: string;
  pgRestorePath: string;
  dump: Buffer;
}

/**
 * משחזר גיבוי לתוך בסיס נתונים קיים, ומוחק קודם את מה שכבר שם.
 *
 * ‏--clean --if-exists: משמיד את האובייקטים הקיימים לפני השחזור, בלי
 * להיכשל על אובייקט שאינו קיים. כך שחזור לתוך בסיס לא-ריק מחזיר אותו בדיוק
 * למצב הגיבוי, במקום לשכבת נתונים על גבי נתונים.
 *
 * **הערת בטיחות:** פעולה הרסנית. מיועדת לשחזור חירום ולבדיקת סבב מלא, לא
 * לשגרה. השחזור התפעולי נעשה דרך scripts/restore-backup.mjs עם אישור מפורש.
 */
export async function restoreDatabaseDump(options: RestoreOptions): Promise<void> {
  const connection = connectionEnv(options.databaseUrl);
  await run(
    options.pgRestorePath,
    // ‏-d בסיס היעד: pg_restore חייב להתחבר לבסיס שאליו משחזרים (ולא ל-postgres),
    // אחרת השחזור אינו נכנס לשום מקום. שם הבסיס מגיע מה-URL.
    ["--clean", "--if-exists", "--no-owner", "--no-privileges", "-d", connection.PGDATABASE],
    connection,
    { stdin: options.dump },
  );
}

interface RunOptions {
  collectStdout?: boolean;
  stdin?: Buffer;
}

/**
 * מריץ תהליך חיצוני ומחזיר את stdout (אם ביקשו לאסוף), או זורק עם stderr.
 *
 * מסתמך על קוד היציאה ולא על נוכחות פלט ב-stderr: pg_restore כותב ל-stderr
 * הודעות תקינות (NOTICE, "מדלג על אובייקט שאינו קיים") גם בהצלחה, וטיפול
 * בהן ככשל היה מכשיל כל שחזור.
 */
function run(
  command: string,
  args: string[],
  connection: Record<string, string>,
  options: RunOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...connection },
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => {
      if (options.collectStdout) stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));

    child.on("error", (error) => {
      // כשל בהרצה עצמה (הבינארי לא נמצא) — הודעה מפורשת עם מה חסר.
      reject(new Error(`הרצת ${command} נכשלה: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout));
        return;
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      reject(new Error(`${command} יצא עם קוד ${code}: ${detail}`));
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
      child.stdin.end();
    }
  });
}
