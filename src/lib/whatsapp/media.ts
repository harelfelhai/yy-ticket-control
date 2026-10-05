import { createHash } from "node:crypto";
import { WaApiError } from "./errors";
import { type GraphConfig, graphFetch, graphJson } from "./graph";

/**
 * הורדת קובץ שהגיע בוואטסאפ — שתי קפיצות, והטוקן בשתיהן.
 *
 * 1. `GET /{media-id}` מחזיר כתובת זמנית, סוג, גודל ו-sha256 (hex).
 * 2. ההורדה מהכתובת **דורשת את הטוקן גם היא** — בלעדיו התשובה 401 (נמדד
 *    בספייק W0).
 *
 * **הכתובת פגה תוך דקות, ולכן אינה נשמרת ואינה עוברת בתור.** כל ניסיון מתחיל
 * מהקפיצה הראשונה, לפי המזהה, שתקף 7 ימים — כך ג׳וב שנדחה בעשר דקות אינו
 * מוריד כתובת מתה.
 */

/** מה ש-`GET /{media-id}` מחזיר */
interface MediaInfo {
  url?: unknown;
  mime_type?: unknown;
  sha256?: unknown;
  file_size?: unknown;
}

export interface DownloadedMedia {
  bytes: Buffer;
  mimeType: string;
  /** sha256 בקידוד hex, של הבתים שהורדו בפועל */
  sha256: string;
  sizeBytes: number;
}

export type MediaDownload =
  | { ok: true; media: DownloadedMedia }
  /** הקובץ גדול מהתקרה — נרשם בלי בתים, כמו קובץ מצורף גדול במייל */
  | { ok: false; reason: "too-large"; sizeBytes: number };

export async function downloadMedia(
  config: GraphConfig,
  mediaId: string,
  options: { maxBytes: number },
): Promise<MediaDownload> {
  const info = await graphJson<MediaInfo>(config, encodeURIComponent(mediaId));
  if (typeof info.url !== "string" || !isDownloadUrl(info.url, config)) {
    throw new WaApiError("Graph לא החזיר כתובת להורדת המדיה", "permanent");
  }
  const declaredSize = typeof info.file_size === "number" ? info.file_size : null;
  if (declaredSize !== null && declaredSize > options.maxBytes) {
    return { ok: false, reason: "too-large", sizeBytes: declaredSize };
  }

  let response: Response;
  try {
    response = await graphFetch(config, info.url);
  } catch (error) {
    // הכתובת טרייה, ו-404 עליה אינו "המדיה אינה קיימת" — הקפיצה הראשונה כבר
    // ענתה שהיא קיימת. ניסיון חוזר מתחיל מכתובת חדשה.
    if (error instanceof WaApiError && error.kind === "not_found") {
      throw new WaApiError(error.message, "transient", { status: error.status, code: error.code, cause: error });
    }
    throw error;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > options.maxBytes) return { ok: false, reason: "too-large", sizeBytes: bytes.byteLength };

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const expected = typeof info.sha256 === "string" ? info.sha256.toLowerCase() : null;
  // הורדה שנקטעה באמצע נראית כמו קובץ תקין — רק הגיבוב מבדיל ביניהם
  if (expected && expected !== sha256) {
    throw new WaApiError("הגיבוב של המדיה שהורדה אינו תואם — ההורדה נקטעה", "transient");
  }

  const mimeType = typeof info.mime_type === "string" && info.mime_type ? info.mime_type : "application/octet-stream";
  return { ok: true, media: { bytes, mimeType, sha256, sizeBytes: bytes.byteLength } };
}

/**
 * הטוקן נשלח גם לכתובת ההורדה, ולכן היא חייבת להיות HTTPS. החריג היחיד הוא שרת
 * Graph מדומה בבדיקה מקומית (`GraphConfig.host`, שאינו נקרא בפרודקשן): שם הכתובת
 * היא של **אותו שרת** — לא של כל כתובת שהתשובה תציע.
 */
function isDownloadUrl(url: string, config: GraphConfig): boolean {
  if (url.startsWith("https://")) return true;
  if (!config.host) return false;
  try {
    return new URL(url).origin === new URL(config.host).origin;
  } catch {
    return false;
  }
}
