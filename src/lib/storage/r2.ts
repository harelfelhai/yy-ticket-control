import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { MediaStorage } from "./types";

/**
 * ‏Cloudflare R2 — האחסון בפרודקשן.
 *
 * ‏R2 תואם ל-S3, ולכן משתמשים ב-SDK של AWS מול נקודת קצה של Cloudflare.
 * שתי סיבות לבחירה: אין דמי יציאה (egress) — והמדיה כאן היא תמונות שנצפות
 * שוב ושוב מהשטח — והמחיר לאחסון נמוך מ-S3.
 *
 * ‏`region: "auto"` נדרש: ל-R2 אין אזורים, אבל חתימת SigV4 מחייבת ערך.
 */

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** חלון קצר: הכתובת נוצרת ברגע שמשתמש מבקש, ונצרכת מיד */
const UPLOAD_EXPIRY_SECONDS = 300;
const DOWNLOAD_EXPIRY_SECONDS = 300;

export function r2Storage(config: R2Config): MediaStorage {
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

    async createUploadTarget(key, contentType) {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: config.bucket, Key: key, ContentType: contentType }),
        { expiresIn: UPLOAD_EXPIRY_SECONDS },
      );

      // ‏Content-Type חייב להישלח בדיוק כפי שנחתם, אחרת החתימה נדחית.
      return { url, headers: { "Content-Type": contentType } };
    },

    async createDownloadUrl(key) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
        expiresIn: DOWNLOAD_EXPIRY_SECONDS,
      });
    },

    async read(key) {
      const response = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      );
      if (!response.Body) throw new Error(`הקובץ ${key} ריק או אינו קיים`);

      return Buffer.from(await response.Body.transformToByteArray());
    },

    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },

    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
        return true;
      } catch (error) {
        // 404/NotFound = הקובץ לא הועלה. כל שגיאה אחרת (הרשאה, רשת) אינה
        // "חסר" אלא תקלה אמיתית — נזרקת כדי שתיתפס ולא תתחפש ל"לא קיים".
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode;
        if (status === 404 || (error as { name?: string }).name === "NotFound") return false;
        throw error;
      }
    },
  };
}
