import { WaApiError } from "./errors";
import { type GraphConfig, graphJson } from "./graph";

/**
 * ניהול החיבור של המספר העסקי מול Meta — מה שמסך 17 צריך מה-Graph API.
 *
 * **שני סוגי זהות, ולכן הטוקן הוא פרמטר.** החלפת הקוד ובדיקת הטוקן נעשות בשם
 * **האפליקציה** (המזהה והסוד שלה); כל השאר נעשה בשם **העסק**, בטוקן שהחלפת הקוד
 * החזירה. האובייקט נבנה פעם אחת מפרטי האפליקציה, והשירות מעביר לכל קריאה את
 * טוקן העסק — בפענוח, ממש לפני הבקשה (`token.ts`).
 *
 * הממשק מוזרק כמו `WaApi`: הבדיקות מזריקות מימוש מזויף ואינן נוגעות ברשת, והמימוש
 * כאן נבדק לבדו מול `fetch` מזויף (`tests/unit/wa-account.test.ts`).
 *
 * **אין כאן תבנית שנשלחת.** `sendMessage` שולח גוף שהקורא הרכיב, והקורא היחיד
 * שמרכיב תבנית הוא `services/wa-number.ts` ("שלח הודעת בדיקה", SC-OUT-01).
 */

export interface WaAppCredentials {
  appId: string;
  appSecret: string;
  /** גרסת ה-Graph API (`WHATSAPP_GRAPH_VERSION`) */
  version: string;
  /** מוזרק בבדיקות. ברירת המחדל — `fetch` של הסביבה. */
  fetch?: typeof fetch;
}

/** מה שהטוקן מתיר, לפי `debug_token` */
export interface WaTokenInfo {
  valid: boolean;
  /** האפליקציה שהנפיקה את הטוקן — חייבת להיות שלנו */
  appId: string | null;
  /** null — הטוקן אינו פג. הקונפיגורציה של Embedded Signup אמורה להנפיק כזה. */
  expiresAt: Date | null;
  /** החשבונות (WABA) שהטוקן מנהל — `whatsapp_business_management` */
  managedWabaIds: string[];
}

export interface WaPhoneNumberInfo {
  id: string;
  displayPhone: string;
  verifiedName: string | null;
  /** המספר פעיל גם באפליקציית WhatsApp Business בטלפון (Coexistence) */
  onBusinessApp: boolean;
  platformType: string | null;
}

/** המנוי של האפליקציה שלנו על החשבון, וכתובת ה-webhook שהוגדרה לו */
export interface WaSubscription {
  callbackUri: string | null;
}

/** שני הסנכרונים שחיבור מספר מהאפליקציה מחייב תוך 24 שעות — אנשי הקשר קודם */
export type WaSyncKind = "smb_app_state_sync" | "history";

export interface WaTemplateInfo {
  id: string;
  name: string;
  language: string;
  category: string;
  /** APPROVED, PENDING, REJECTED, PAUSED, DISABLED, IN_APPEAL — ומה שיתווסף */
  status: string;
}

/** תבנית שהמערכת מגדירה: גוף טקסט בלבד, בלי משתנים ובלי כפתורים */
export interface WaTemplateDefinition {
  name: string;
  language: string;
  category: "UTILITY";
  body: string;
}

/** גוף הודעה יוצאת כפי שהקורא הרכיב אותו: הנמען, הסוג, ומה שהסוג דורש */
export interface WaOutboundBody {
  to: string;
  type: string;
  [key: string]: unknown;
}

export interface WaAccountApi {
  /** הקוד מחלון החיבור, תמורת טוקן העסק. **הקוד תקף 30 שניות.** */
  exchangeCode(code: string): Promise<string>;
  inspectToken(token: string): Promise<WaTokenInfo>;
  listPhoneNumbers(token: string, wabaId: string): Promise<WaPhoneNumberInfo[]>;
  getPhoneNumber(token: string, phoneNumberId: string): Promise<WaPhoneNumberInfo>;
  /** מנוי על החשבון, עם הכתובת שאליה Meta תשלח את ההודעות שלו (`override_callback_uri`) */
  subscribe(token: string, wabaId: string, override: { callbackUri: string; verifyToken: string }): Promise<void>;
  /** המנוי של האפליקציה שלנו, או null כשאינה מנויה */
  getSubscription(token: string, wabaId: string): Promise<WaSubscription | null>;
  unsubscribe(token: string, wabaId: string): Promise<void>;
  requestSync(token: string, phoneNumberId: string, kind: WaSyncKind): Promise<void>;
  listTemplates(token: string, wabaId: string): Promise<WaTemplateInfo[]>;
  createTemplate(token: string, wabaId: string, template: WaTemplateDefinition): Promise<{ status: string }>;
  sendMessage(token: string, phoneNumberId: string, body: WaOutboundBody): Promise<{ wamid: string }>;
}

/** השדות של מספר שהמערכת קוראת — גם ברשימה וגם במספר בודד */
const PHONE_FIELDS = "id,display_phone_number,verified_name,is_on_biz_app,platform_type";

export function graphWaAccountApi(app: WaAppCredentials): WaAccountApi {
  const business = (token: string): GraphConfig => ({ token, version: app.version, fetch: app.fetch });
  const enc = encodeURIComponent;

  return {
    async exchangeCode(code) {
      // בלי טוקן: האפליקציה מזדהה במזהה ובסוד שלה. הכתובת אינה נרשמת בשום מקום —
      // לא בלוג ולא בהודעת השגיאה (`graph.ts`).
      const response = await graphJson<{ access_token?: unknown }>(
        { token: null, version: app.version, fetch: app.fetch },
        `oauth/access_token?client_id=${enc(app.appId)}&client_secret=${enc(app.appSecret)}&code=${enc(code)}`,
      );
      if (typeof response.access_token !== "string" || !response.access_token) {
        throw new WaApiError("Graph החליף את הקוד בלי להחזיר טוקן", "permanent");
      }
      return response.access_token;
    },

    async inspectToken(token) {
      const response = await graphJson<{ data?: DebugTokenData }>(
        { token: `${app.appId}|${app.appSecret}`, version: app.version, fetch: app.fetch },
        `debug_token?input_token=${enc(token)}`,
      );
      return toTokenInfo(response.data ?? {});
    },

    async listPhoneNumbers(token, wabaId) {
      const response = await graphJson<{ data?: unknown[] }>(
        business(token),
        `${enc(wabaId)}/phone_numbers?fields=${PHONE_FIELDS}`,
      );
      return (response.data ?? []).map(toPhoneNumber).filter((number) => number !== null);
    },

    async getPhoneNumber(token, phoneNumberId) {
      const response = await graphJson<unknown>(business(token), `${enc(phoneNumberId)}?fields=${PHONE_FIELDS}`);
      const number = toPhoneNumber(response);
      if (!number) throw new WaApiError("Graph החזיר מספר בלי מזהה", "permanent");
      return number;
    },

    async subscribe(token, wabaId, override) {
      const response = await graphJson<{ success?: unknown }>(business(token), `${enc(wabaId)}/subscribed_apps`, {
        method: "POST",
        json: { override_callback_uri: override.callbackUri, verify_token: override.verifyToken },
      });
      assertSuccess(response, "המנוי על החשבון");
    },

    async getSubscription(token, wabaId) {
      const response = await graphJson<{ data?: unknown[] }>(business(token), `${enc(wabaId)}/subscribed_apps`);
      for (const entry of response.data ?? []) {
        const item = entry as { whatsapp_business_api_data?: { id?: unknown }; override_callback_uri?: unknown };
        if (String(item.whatsapp_business_api_data?.id ?? "") !== app.appId) continue;
        return { callbackUri: typeof item.override_callback_uri === "string" ? item.override_callback_uri : null };
      }
      return null;
    },

    async unsubscribe(token, wabaId) {
      const response = await graphJson<{ success?: unknown }>(business(token), `${enc(wabaId)}/subscribed_apps`, {
        method: "DELETE",
      });
      assertSuccess(response, "ביטול המנוי");
    },

    async requestSync(token, phoneNumberId, kind) {
      await graphJson<{ request_id?: unknown }>(business(token), `${enc(phoneNumberId)}/smb_app_data`, {
        method: "POST",
        json: { messaging_product: "whatsapp", sync_type: kind },
      });
    },

    async listTemplates(token, wabaId) {
      const response = await graphJson<{ data?: unknown[] }>(
        business(token),
        `${enc(wabaId)}/message_templates?fields=id,name,language,category,status&limit=100`,
      );
      return (response.data ?? []).map(toTemplate).filter((template) => template !== null);
    },

    async createTemplate(token, wabaId, template) {
      const response = await graphJson<{ status?: unknown }>(business(token), `${enc(wabaId)}/message_templates`, {
        method: "POST",
        json: {
          name: template.name,
          language: template.language,
          category: template.category,
          components: [{ type: "BODY", text: template.body }],
        },
      });
      return { status: typeof response.status === "string" ? response.status : "PENDING" };
    },

    async sendMessage(token, phoneNumberId, body) {
      const response = await graphJson<{ messages?: { id?: unknown }[] }>(
        business(token),
        `${enc(phoneNumberId)}/messages`,
        { method: "POST", json: { messaging_product: "whatsapp", recipient_type: "individual", ...body } },
      );
      const wamid = response.messages?.[0]?.id;
      if (typeof wamid !== "string" || !wamid) {
        throw new WaApiError("Graph קיבל את ההודעה בלי להחזיר את המזהה שלה", "permanent");
      }
      return { wamid };
    },
  };
}

// ─────────────────────────────── פענוח התשובות ───────────────────────────────

interface DebugTokenData {
  is_valid?: unknown;
  app_id?: unknown;
  expires_at?: unknown;
  granular_scopes?: unknown;
}

/** `expires_at` שהוא 0 — טוקן שאינו פג (טוקן System User של Embedded Signup) */
export function toTokenInfo(data: DebugTokenData): WaTokenInfo {
  const scopes = Array.isArray(data.granular_scopes) ? data.granular_scopes : [];
  const managed = new Set<string>();
  for (const scope of scopes) {
    const item = scope as { scope?: unknown; target_ids?: unknown };
    if (item.scope !== "whatsapp_business_management" || !Array.isArray(item.target_ids)) continue;
    for (const id of item.target_ids) managed.add(String(id));
  }
  const expires = typeof data.expires_at === "number" ? data.expires_at : 0;
  return {
    valid: data.is_valid === true,
    appId: data.app_id === undefined || data.app_id === null ? null : String(data.app_id),
    expiresAt: expires > 0 ? new Date(expires * 1000) : null,
    managedWabaIds: [...managed],
  };
}

function toPhoneNumber(raw: unknown): WaPhoneNumberInfo | null {
  const item = raw as {
    id?: unknown;
    display_phone_number?: unknown;
    verified_name?: unknown;
    is_on_biz_app?: unknown;
    platform_type?: unknown;
  } | null;
  if (!item || typeof item.id !== "string" || !item.id) return null;
  return {
    id: item.id,
    displayPhone: typeof item.display_phone_number === "string" ? item.display_phone_number : "",
    verifiedName: typeof item.verified_name === "string" && item.verified_name ? item.verified_name : null,
    onBusinessApp: item.is_on_biz_app === true,
    platformType: typeof item.platform_type === "string" ? item.platform_type : null,
  };
}

function toTemplate(raw: unknown): WaTemplateInfo | null {
  const item = raw as { id?: unknown; name?: unknown; language?: unknown; category?: unknown; status?: unknown } | null;
  if (!item || typeof item.name !== "string" || !item.name) return null;
  return {
    id: typeof item.id === "string" ? item.id : "",
    name: item.name,
    language: typeof item.language === "string" ? item.language : "",
    category: typeof item.category === "string" ? item.category : "",
    status: typeof item.status === "string" ? item.status : "",
  };
}

/** `{"success": true}` — אחרת Meta קיבלה את הבקשה ולא ביצעה אותה */
function assertSuccess(response: { success?: unknown }, what: string): void {
  if (response.success !== true) throw new WaApiError(`${what}: Graph לא אישר את הבקשה`, "permanent");
}
