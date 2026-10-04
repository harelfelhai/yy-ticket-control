import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * אימות `X-Hub-Signature-256` — ההוכחה שמשלוח ה-webhook בא מ-Meta.
 *
 * **החתימה היא על הבתים הגולמיים**, HMAC-SHA256 במפתח ה-App Secret, בקידוד
 * hex אחרי `sha256=`. גוף שפוענח ל-JSON וחזר לטקסט אינו אותם בתים (סדר
 * מפתחות, רווחים, escaping של עברית), ולכן ה-route מעביר לכאן את מה שהגיע,
 * לפני כל פענוח. נמדד בספייק W0: אירוע Test ושש הודעות אמיתיות אומתו כך.
 *
 * **ההשוואה timing-safe**, כדי שזמן התגובה לא יסגיר כמה תווים של חתימה
 * מזויפת נכונים. אורך שונה נדחה לפני ההשוואה — `timingSafeEqual` זורק
 * על אורכים שונים, וזריקה כאן הייתה הופכת חתימה פגומה ל-500 במקום ל-401.
 */

const PREFIX = "sha256=";

export function verifySignature(rawBody: Uint8Array | string, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const value = header.trim();
  if (!value.toLowerCase().startsWith(PREFIX)) return false;

  const received = value.slice(PREFIX.length).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(received)) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(received, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
