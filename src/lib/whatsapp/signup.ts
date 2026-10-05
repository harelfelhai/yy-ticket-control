/**
 * ההודעה שחלון החיבור של Meta (Embedded Signup v4) שולח לדף בסיום — מסך 17.
 *
 * החלון נפתח מהדף שלנו ומדווח לו ב-`postMessage`: איזה חשבון (WABA) נבחר, ואם
 * המספר נשאר באפליקציה בטלפון. הקוד שמוחלף בטוקן מגיע בנפרד, ב-callback של
 * `FB.login`. המודול טהור ורץ בדפדפן — בלי Node ובלי `he.ts`.
 *
 * **המקור נבדק לפי שם המארח, לא לפי סיומת המחרוזת.** הדוגמה של Meta בודקת
 * `origin.endsWith("facebook.com")`, ואז גם `https://evilfacebook.com` עובר.
 */

export type SignupEvent =
  /** החיבור הסתיים. `coexistence` — המספר נשאר באפליקציה בטלפון (§7 שורה 106). */
  | { kind: "finish"; coexistence: boolean; wabaId: string; phoneNumberId: string | null }
  /** החלון נסגר לפני הסיום */
  | { kind: "cancel" }
  /** Meta דיווחה על שגיאה בחלון */
  | { kind: "error"; message: string };

/** `https://www.facebook.com`, `https://web.facebook.com` — HTTPS ותחת facebook.com בלבד */
export function isFacebookOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && (url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com"));
  } catch {
    return false;
  }
}

/** ההודעה כפי שהגיעה (מחרוזת JSON או אובייקט), או null כשאינה מחלון החיבור */
export function parseSignupMessage(raw: unknown): SignupEvent | null {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const message = data as { type?: unknown; event?: unknown; data?: Record<string, unknown> } | null;
  if (!message || typeof message !== "object" || message.type !== "WA_EMBEDDED_SIGNUP") return null;
  const payload = message.data ?? {};

  switch (message.event) {
    case "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING":
    case "FINISH":
    case "FINISH_ONLY_WABA": {
      const wabaId = text(payload.waba_id);
      if (!wabaId) return null;
      return {
        kind: "finish",
        coexistence: message.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
        wabaId,
        phoneNumberId: text(payload.phone_number_id),
      };
    }
    case "CANCEL":
      return { kind: "cancel" };
    case "ERROR":
      return { kind: "error", message: text(payload.error_message) ?? "" };
    default:
      return null;
  }
}

function text(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value ? value : null;
}
