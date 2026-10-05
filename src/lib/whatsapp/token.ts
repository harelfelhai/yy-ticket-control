import { env } from "@/lib/env";
import { decryptToken, encryptToken } from "@/lib/tokens";

/**
 * טוקן העסק של המספר המחובר — מוצפן במנוחה (`WaNumber.tokenCipher`).
 *
 * המפתח נגזר מ-`SESSION_SECRET` בתחום משלו (`TOKEN_INFO`), ולא באותו מפתח של
 * קישורי הפורטל: מי שמחזיק אחד אינו מפענח את השני. הטוקן הגלוי חי רק בזיכרון,
 * ממש לפני בקשה ל-Graph, ולעולם אינו נרשם בלוג.
 */

const TOKEN_INFO = "yy-whatsapp-business-token-v1";

export function sealWaToken(token: string): string {
  return encryptToken(token, env.sessionSecret(), TOKEN_INFO);
}

/** הטוקן הגלוי, או null כשאי אפשר לפענח (הסוד הוחלף, הנתון נפגע) — אז דרוש חיבור מחדש */
export function openWaToken(cipher: string): string | null {
  return decryptToken(cipher, env.sessionSecret(), TOKEN_INFO);
}
