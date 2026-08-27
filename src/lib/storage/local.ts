import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MediaStorage, UploadTarget } from "./types";

/**
 * אחסון מקומי על הדיסק — לפיתוח ולבדיקות בלבד.
 *
 * הוא אינו "מימוש מדומה": הוא כותב וקורא קבצים אמיתיים, ולכן כל מסלול
 * המדיה — העלאה, הצגה בשרשור, תמלול, חילוץ טקסט — ניתן להרצה מלאה בלי
 * חשבון Cloudflare ובלי תשלום.
 *
 * ההעלאה מכוונת ל-route של האפליקציה במקום לכתובת חתומה בענן, כך שקוד
 * הלקוח זהה בשתי הסביבות ואין מסלול שנבדק רק באחת מהן.
 */

/** בתוך התיקייה הזו, שנמצאת ב-gitignore */
const ROOT = path.join(process.cwd(), ".localmedia");

export function localStorage(baseUrl: string): MediaStorage {
  return {
    name: "local",

    async createUploadTarget(key, contentType): Promise<UploadTarget> {
      return {
        url: `${baseUrl.replace(/\/+$/, "")}/api/media/upload/${key}`,
        headers: { "Content-Type": contentType },
      };
    },

    // אין כתובת ישירה: הבקשה ממשיכה לעבור דרך בדיקת ההרשאה של האפליקציה,
    // והבתים מוגשים משם.
    async createDownloadUrl() {
      return null;
    },

    async read(key) {
      return readFile(resolveKey(key));
    },

    async remove(key) {
      await rm(resolveKey(key), { force: true });
    },

    async head(key) {
      try {
        return { sizeBytes: (await stat(resolveKey(key))).size };
      } catch (error) {
        // הקובץ לא נכתב (העלאה שנקטעה) → null. תקלה אחרת נזרקת.
        if ((error as { code?: string }).code === "ENOENT") return null;
        throw error;
      }
    },
  };
}

/** כותב את הבתים. נקרא מה-route שמקבל את ההעלאה, ולא מהלקוח. */
export async function writeLocalObject(key: string, body: Buffer): Promise<void> {
  const target = resolveKey(key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
}

/**
 * ממיר מפתח לנתיב, ומסרב לצאת מהתיקייה.
 *
 * המפתח מגיע מהכתובת שהלקוח ביקש, ולכן `../../.env` הוא קלט אפשרי. בלי
 * הבדיקה הזו ה-route של ההעלאה היה כותב לכל מקום בדיסק — ושל ההורדה היה
 * מגיש כל קובץ בפרויקט.
 */
export function resolveKey(key: string): string {
  const target = path.resolve(ROOT, key);
  const root = path.resolve(ROOT);

  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`מפתח מדיה אינו חוקי: ${key}`);
  }
  return target;
}
