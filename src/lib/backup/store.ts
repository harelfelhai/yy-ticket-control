import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

/**
 * יעד אחסון הגיבויים — מקביל להפשטת אחסון המדיה, ומאותה סיבה: פיתוח
 * ובדיקות חייבים לרוץ בלי חשבון בענן. בפרודקשן הגיבויים יושבים ב-bucket
 * השני ב-R2 (fallback של Gate G6); בפיתוח, בתיקייה מקומית.
 *
 * חוזה שונה מ-MediaStorage: כאן **השרת** כותב את הבתים (‏put), ולא הדפדפן
 * דרך כתובת חתומה, ויש `list` לצורך ניקוי גיבויים ישנים (retention).
 */
export interface BackupStore {
  readonly name: string;
  put(key: string, body: Buffer): Promise<void>;
  /** כל המפתחות תחת התחילית, לצורך retention */
  list(prefix: string): Promise<string[]>;
  remove(key: string): Promise<void>;
}

/** בתוך תיקייה שנמצאת ב-gitignore */
const ROOT = path.join(process.cwd(), ".backups");

/** ממיר מפתח לנתיב ומסרב לצאת מהתיקייה — המפתח נבנה אצלנו, אך הזהירות זולה */
function resolveKey(key: string): string {
  const target = path.resolve(ROOT, key);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    throw new Error(`מפתח גיבוי אינו חוקי: ${key}`);
  }
  return target;
}

export function localBackupStore(): BackupStore {
  return {
    name: "local",

    async put(key, body) {
      const target = resolveKey(key);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, body);
    },

    async list(prefix) {
      const dir = resolveKey(prefix);
      try {
        const names = await readdir(dir);
        return names.map((name) => path.posix.join(prefix.replace(/\/$/, ""), name));
      } catch (error) {
        // התיקייה טרם נוצרה (עוד לא היה גיבוי) — אין מפתחות, לא שגיאה.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    },

    async remove(key) {
      await rm(resolveKey(key), { force: true });
    },
  };
}

export interface BackupR2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export function r2BackupStore(config: BackupR2Config): BackupStore {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return {
    name: "r2",

    async put(key, body) {
      await client.send(
        new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body }),
      );
    },

    async list(prefix) {
      const response = await client.send(
        new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix }),
      );
      return (response.Contents ?? [])
        .map((object) => object.Key)
        .filter((key): key is string => Boolean(key));
    },

    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
  };
}

/**
 * בוחר יעד לפי הסביבה. בפרודקשן חוסר הגדרה הוא כשל רועש: גיבוי לילי שאין
 * לו לאן לכתוב הוא בדיוק מצב "חשבנו שיש גיבוי ואין" — ולכן הוא נופל
 * ומופיע כג'וב FAILED, במקום לכתוב בשקט לדיסק זמני שנמחק עם הקונטיינר.
 */
export function selectBackupStore(): BackupStore {
  const config = env.backupR2();
  if (config) return r2BackupStore(config);

  if (env.isProduction()) {
    throw new Error(
      "יעד הגיבוי אינו מוגדר: חסר R2_BACKUP_BUCKET. הגדר אותו ב-Railway Variables.",
    );
  }

  return localBackupStore();
}
