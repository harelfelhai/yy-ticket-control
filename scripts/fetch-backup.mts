/**
 * מוריד את הגיבוי האחרון של הפרודקשן מה-bucket של הגיבויים ב-R2 — **קריאה
 * בלבד** — אל `.backups/prod/` (ב-gitignore).
 *
 * **למה זה קיים.** מיגרציה שעוברת על בסיס ריק או על נתוני פיתוח אינה מוכיחה
 * שהיא עוברת על הנתונים שבפרודקשן: CHECK חדש נבדק מול כל שורה קיימת, ושינוי
 * טיפוס נכשל על ערך שאיש לא זכר שקיים. השער של שלב שמכניס מיגרציה הוא הרצתה
 * על שחזור מקומי של הגיבוי, וזה החלק הראשון שלו. המשך:
 *
 *   npx tsx scripts/restore-backup.ts <קובץ> --yes   (עם DATABASE_URL לבסיס מקומי ייעודי)
 *   npx prisma migrate deploy                         (אותו DATABASE_URL)
 *
 * הרצה — פרטי R2 מגיעים מ-Railway ואינם נשמרים במכונה:
 *   railway run npx tsx scripts/fetch-backup.mts
 *
 * הסקריפט אינו מדפיס מפתחות, ואינו נוגע ב-`DATABASE_URL` שהסביבה מזריקה.
 */

import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const accountId = process.env["R2_ACCOUNT_ID"];
const accessKeyId = process.env["R2_ACCESS_KEY_ID"];
const secretAccessKey = process.env["R2_SECRET_ACCESS_KEY"];
const bucket = process.env["R2_BACKUP_BUCKET"];

if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
  console.error("✖ חסרים פרטי R2 של הגיבויים. הרץ דרך `railway run`.");
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

// שם המפתח הוא חותמת זמן ISO (`backupKey` ב-src/lib/backup), ולכן מיון
// מחרוזות הוא גם מיון כרונולוגי.
const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "db/" }));
const latest = (listed.Contents ?? [])
  .map((object) => object.Key)
  .filter((key): key is string => Boolean(key?.endsWith(".dump")))
  .sort()
  .at(-1);

if (!latest) {
  console.error("✖ לא נמצא גיבוי ב-bucket.");
  process.exit(1);
}

const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: latest }));
const bytes = Buffer.from(await object.Body!.transformToByteArray());

const dir = join(process.cwd(), ".backups", "prod");
await mkdir(dir, { recursive: true });
const target = join(dir, latest.replace(/^db\//, ""));
await writeFile(target, bytes);

console.log(`✔ ${latest} (${bytes.byteLength} בייט) → ${target}`);
