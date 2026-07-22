/**
 * שרת PostgreSQL מקומי לפיתוח ולבדיקות, ללא דוקר וללא הרשאות מנהל.
 *
 * למה לא `prisma dev`: ה-Postgres שהוא מריץ הוא PGlite — בנייה של Postgres
 * ל-WASM ב-32 ביט. הוא נכשל ב-`prisma migrate dev` (P1017), ובעיקר הוא לא
 * אותו מנוע שרץ בפרודקשן. כאן רצים הבינאריים הרשמיים של PostgreSQL 18
 * (חבילת npm‏ `embedded-postgres`), כך שמיגרציה שעברה מקומית מתנהגת אותו
 * דבר מול Railway.
 *
 * שימוש:
 *   node scripts/local-db.mjs start   # מאתחל בפעם הראשונה, ואז מפעיל
 *   node scripts/local-db.mjs stop
 *   node scripts/local-db.mjs status
 *   node scripts/local-db.mjs reset   # מוחק את הנתונים ומתחיל מחדש
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "node_modules", "@embedded-postgres", "windows-x64", "native", "bin");
const DATA_DIR = path.join(ROOT, ".localdb", "data");
const LOG_FILE = path.join(ROOT, ".localdb", "postgres.log");
const PW_FILE = path.join(ROOT, ".localdb", ".initpw");

export const LOCAL_DB = {
  port: 5433,
  user: "postgres",
  password: "postgres",
  /** בסיס הפיתוח שהאפליקציה עובדת מולו */
  database: "yy_dev",
  /** בסיס הצל שבו Prisma מריץ מיגרציות כדי לזהות סטייה */
  shadowDatabase: "yy_shadow",
  /** בסיס נפרד לבדיקות, כדי שריצת בדיקות לא תמחק נתוני פיתוח */
  testDatabase: "yy_test",
};

const url = (database) =>
  `postgresql://${LOCAL_DB.user}:${LOCAL_DB.password}@localhost:${LOCAL_DB.port}/${database}`;

export const localDbUrls = {
  database: url(LOCAL_DB.database),
  shadow: url(LOCAL_DB.shadowDatabase),
  test: url(LOCAL_DB.testDatabase),
};

function exe(name) {
  return path.join(BIN, `${name}.exe`);
}

function run(command, args, { detached = false } = {}) {
  // ‏detached: השרת שנוצר יורש את הצינורות של התהליך הזה ולא סוגר אותם לעולם,
  // ולכן spawnSync היה נתקע לנצח בהמתנה ל-EOF. הפלט של ההפעלה הולך ל-LOG_FILE.
  if (detached) {
    return spawnSync(command, args, { stdio: "ignore" });
  }
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function isInitialised() {
  return existsSync(path.join(DATA_DIR, "PG_VERSION"));
}

function initialise() {
  console.log("מאתחל אשכול PostgreSQL חדש…");
  mkdirSync(path.dirname(DATA_DIR), { recursive: true });
  writeFileSync(PW_FILE, LOCAL_DB.password, "utf8");
  const result = run(exe("initdb"), [
    "-D", DATA_DIR,
    "-U", LOCAL_DB.user,
    "--pwfile", PW_FILE,
    "--auth", "scram-sha-256",
    "--encoding", "UTF8",
    // ‏locale ניטרלי: ממיין לפי נקודות קוד ולא לפי כללי שפה של המכונה,
    // כדי שסדר תוצאות יהיה זהה כאן ובשרת.
    "--locale", "C",
  ]);
  rmSync(PW_FILE, { force: true });
  if (result.status !== 0) {
    throw new Error("initdb נכשל");
  }
}

function pgCtl(args, options) {
  return run(exe("pg_ctl"), ["-D", DATA_DIR, ...args], options);
}

function isRunning() {
  return pgCtl(["status"], { detached: true }).status === 0;
}

async function ensureDatabases() {
  const client = new pg.Client({ connectionString: url("postgres") });
  await client.connect();
  try {
    for (const name of [LOCAL_DB.database, LOCAL_DB.shadowDatabase, LOCAL_DB.testDatabase]) {
      const { rowCount } = await client.query("select 1 from pg_database where datname = $1", [name]);
      if (rowCount === 0) {
        // ‏identifier לא ניתן לפרמטריזציה; השמות כאן קבועים בקוד ולא מגיעים מקלט.
        await client.query(`create database "${name}"`);
        console.log(`נוצר בסיס נתונים ${name}`);
      }
    }
  } finally {
    await client.end();
  }
}

async function start() {
  if (isRunning()) {
    console.log(`השרת כבר רץ על פורט ${LOCAL_DB.port}.`);
  } else {
    if (!isInitialised()) initialise();
    mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    const result = pgCtl(
      ["-l", LOG_FILE, "-o", `-p ${LOCAL_DB.port} -c listen_addresses=localhost`, "-w", "start"],
      { detached: true },
    );
    if (result.status !== 0) {
      throw new Error(`הפעלת השרת נכשלה. ראה ${LOG_FILE}`);
    }
  }
  await ensureDatabases();
  console.log(`\nDATABASE_URL="${localDbUrls.database}"`);
  console.log(`SHADOW_DATABASE_URL="${localDbUrls.shadow}"`);
  console.log(`TEST_DATABASE_URL="${localDbUrls.test}"`);
}

function stop() {
  if (!isRunning()) {
    console.log("השרת אינו רץ.");
    return;
  }
  // ‏fast: מנתק חיבורים פתוחים ומבצע checkpoint, בלי להמתין ללקוחות.
  pgCtl(["-m", "fast", "-w", "stop"], { detached: true });
  console.log("השרת נעצר.");
}

async function reset() {
  stop();
  rmSync(path.join(ROOT, ".localdb"), { recursive: true, force: true });
  console.log("נתוני הפיתוח נמחקו.");
  await start();
}

const command = process.argv[2] ?? "start";
const commands = {
  start,
  stop: async () => stop(),
  status: async () => console.log(isRunning() ? "רץ" : "עצור"),
  reset,
};

if (!commands[command]) {
  console.error(`פקודה לא מוכרת: ${command}. אפשרויות: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}

try {
  await commands[command]();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
