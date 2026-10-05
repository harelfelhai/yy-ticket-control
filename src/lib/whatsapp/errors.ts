/**
 * סוג הכשל מול Graph API של וואטסאפ — **מה הצינור אמור לעשות**, לא מה קרה.
 *
 * אותו עיקרון כמו `MailSourceError` במייל: לצינור אין דרך אחרת לדעת אם לנסות
 * שוב או לעצור, וניחוש לכל אחד משני הכיוונים נכשל בשקט. `transient` שנקרא
 * `permanent` מאבד הודעה אמיתית; `auth` שנקרא `transient` הופך טוקן שבוטל
 * לניסיונות חוזרים שלעולם לא יצליחו, והמספר שותק בלי שאיש יידע.
 *
 * - `transient` — לנסות שוב עם השהיה (רשת, הגבלת קצב, תקלה אצל Meta).
 * - `auth` — הטוקן, ההרשאה או החשבון אינם תקינים. לעצור ברעש; דורש אדם.
 * - `not_found` — האובייקט אינו קיים (למשל מדיה שפג תוקפה אחרי 7 ימים).
 * - `permanent` — בקשה שנדחתה לגופה. הקוד של Meta (`code`) אומר למה —
 *   למשל 131047, חלון 24 השעות נסגר — והקורא מכריע לפיו.
 */
export type WaErrorKind = "transient" | "auth" | "not_found" | "permanent";

export class WaApiError extends Error {
  readonly kind: WaErrorKind;
  /** קוד ה-HTTP, כשהייתה תשובה. כשל רשת מגיע בלי קוד. */
  readonly status?: number;
  /** קוד השגיאה של Meta (`error.code`), כשהיה */
  readonly code?: number;

  constructor(
    message: string,
    kind: WaErrorKind,
    options: { status?: number; code?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "WaApiError";
    this.kind = kind;
    if (options.status !== undefined) this.status = options.status;
    if (options.code !== undefined) this.code = options.code;
  }
}

/** חלון 24 השעות נסגר: מותרת רק תבנית, שאינה בתחולה (§7 שורה 102) */
export const WINDOW_CLOSED_CODE = 131047;

/**
 * קודי Meta שפירושם "לנסות שוב": תקלה אצלם או הגבלת קצב. **הם נבדקים לפני
 * קוד ה-HTTP**, כי Meta מחזירה הגבלת קצב גם כ-400.
 */
const TRANSIENT_CODES: ReadonlySet<number> = new Set([
  1, // API Unknown
  2, // API Service
  4, // API Too Many Calls
  17, // User request limit
  341, // Application limit
  80007, // WABA rate limit
  130429, // throughput
  131000, // Something went wrong
  131016, // Service unavailable
  131048, // spam rate limit
  131056, // pair rate limit
  133004, // Server temporarily unavailable
]);

/** קודים שפירושם "דרוש אדם": הטוקן, ההרשאה, המספר או החשבון */
const AUTH_CODES: ReadonlySet<number> = new Set([
  0, // AuthException
  3, // capability or permissions
  10, // permission denied
  190, // access token expired or revoked
  368, // temporarily blocked for policy violations
  131005, // access denied
  131031, // business account locked
  133010, // phone number not registered
]);

/** הגוף של שגיאת Graph: `{"error": {"code", "error_subcode", "message"}}` */
export interface GraphErrorBody {
  code?: number;
  subcode?: number;
  message?: string;
}

/** קורא את גוף השגיאה. גוף שאינו JSON (למשל HTML מ-proxy) מחזיר ריק. */
export function parseGraphError(text: string): GraphErrorBody {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown; error_subcode?: unknown; message?: unknown } };
    const error = parsed.error;
    if (!error || typeof error !== "object") return {};
    return {
      code: typeof error.code === "number" ? error.code : undefined,
      subcode: typeof error.error_subcode === "number" ? error.error_subcode : undefined,
      message: typeof error.message === "string" ? error.message : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * מקוד HTTP וגוף השגיאה — להכרעה.
 *
 * `status === null` הוא כשל שלא הגיע לתשובה כלל (רשת, DNS, פסק זמן שלנו), ולכן
 * חולף בהגדרה. הקוד של Meta גובר על קוד ה-HTTP, ואחריו: 401/403 — אדם; 404, או
 * קוד 100 עם תת-קוד 33 ("האובייקט אינו קיים") — לא נמצא; 408, 429 ו-5xx —
 * חולף; כל השאר — בקשה שנדחתה לגופה.
 */
export function classifyGraphError(status: number | null, body: GraphErrorBody): WaErrorKind {
  if (status === null) return "transient";
  if (body.code !== undefined) {
    if (TRANSIENT_CODES.has(body.code)) return "transient";
    if (AUTH_CODES.has(body.code)) return "auth";
    if (body.code === 100 && body.subcode === 33) return "not_found";
  }
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 408 || status === 429 || status >= 500) return "transient";
  return "permanent";
}
