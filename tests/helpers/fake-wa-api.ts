import { createHash } from "node:crypto";
import type {
  WaAccountApi,
  WaOutboundBody,
  WaPhoneNumberInfo,
  WaSubscription,
  WaTemplateInfo,
  WaTokenInfo,
} from "@/lib/whatsapp/account";
import type { WaApi } from "@/lib/whatsapp/api";
import { WaApiError } from "@/lib/whatsapp/errors";
import type { MediaDownload } from "@/lib/whatsapp/media";
import type { SendTextInput } from "@/lib/whatsapp/send";

/**
 * וואטסאפ בזיכרון שמממש את `WaApi` — לכל בדיקה של הצינור (W4 ואילך).
 *
 * **אין כאן רשת, ואי אפשר להוסיף אותה בלי לשנות את הקובץ** — אותו עיקרון כמו
 * `fake-mail-source.ts`. המספר העסקי אמיתי ומשמש את הצוות, ובדיקה ש"נגעה בטעות"
 * בשליחה הייתה שולחת הודעה לאדם.
 *
 * **הכשל הוא חצי מהתפקיד.** `failSend` ו-`failMedia` מחזירים `WaApiError` מסווג,
 * כדי שהבדיקות יעברו גם במסלול הדחייה (`transient`), העצירה (`auth`) וההכרעה
 * (`permanent`, למשל 131047) — מימוש שיודע רק להצליח משאיר אותם בלי כיסוי.
 */

export interface FakeMedia {
  bytes: Buffer;
  mimeType: string;
}

export interface FakeWaApi extends WaApi {
  /** כל הודעה שנשלחה, לפי הסדר */
  sent: (SendTextInput & { wamid: string })[];
  /** כל מזהה מדיה שהתבקש, לפי הסדר */
  mediaRequests: string[];
}

export function fakeWaApi(
  options: {
    media?: Record<string, FakeMedia>;
    failSend?: (input: SendTextInput) => WaApiError | null;
    failMedia?: (mediaId: string) => WaApiError | null;
  } = {},
): FakeWaApi {
  const sent: FakeWaApi["sent"] = [];
  const mediaRequests: string[] = [];

  return {
    sent,
    mediaRequests,
    async sendText(input) {
      const failure = options.failSend?.(input);
      if (failure) throw failure;
      const wamid = `wamid.sent-${sent.length + 1}`;
      sent.push({ ...input, wamid });
      return { wamid };
    },
    async downloadMedia(mediaId, { maxBytes }): Promise<MediaDownload> {
      mediaRequests.push(mediaId);
      const failure = options.failMedia?.(mediaId);
      if (failure) throw failure;
      const media = options.media?.[mediaId];
      if (!media) throw new Error(`fakeWaApi: אין מדיה ${mediaId} — הבדיקה לא הגדירה אותה`);
      if (media.bytes.byteLength > maxBytes) return { ok: false, reason: "too-large", sizeBytes: media.bytes.byteLength };
      return {
        ok: true,
        media: {
          bytes: media.bytes,
          mimeType: media.mimeType,
          sha256: createHash("sha256").update(media.bytes).digest("hex"),
          sizeBytes: media.bytes.byteLength,
        },
      };
    },
  };
}

// ─────────────────────────────── ניהול החיבור (מסך 17) ───────────────────────────────

/**
 * חשבון וואטסאפ בזיכרון שמממש את `WaAccountApi` — לבדיקות של מסך 17 (W5).
 *
 * **המצב חי ומשתנה כמו אצל Meta**: `subscribe` רושם מנוי, `unsubscribe` מסיר אותו,
 * `createTemplate` מוסיף תבנית ב"ממתינה". כך בדיקה רואה את התוצאה של פעולה ולא רק
 * את הקריאה, ויכולה להכין מצב שבו מישהו אחר שינה דבר אצל Meta (מנוי שהוסר,
 * תבנית שאושרה).
 */
export interface FakeWaAccountState {
  /** הטוקן שהחלפת הקוד מחזירה */
  token: string;
  tokenInfo: WaTokenInfo;
  numbers: WaPhoneNumberInfo[];
  subscription: WaSubscription | null;
  templates: WaTemplateInfo[];
}

export type FakeAccountMethod = keyof WaAccountApi;

export interface FakeWaAccountApi extends WaAccountApi {
  state: FakeWaAccountState;
  /** כל קריאה, לפי הסדר — עם הטוקן שנמסר, כשיש */
  calls: { method: FakeAccountMethod; args: unknown[] }[];
  /** כל הודעה שנשלחה */
  sent: { phoneNumberId: string; body: WaOutboundBody; wamid: string }[];
}

export const FAKE_WABA_ID = "200000000000009";
export const FAKE_PHONE_NUMBER_ID = "300000000000009";

export function fakeWaAccountApi(
  options: {
    state?: Partial<FakeWaAccountState>;
    /** כשל מסווג לפי שם הפעולה — `null` להצלחה */
    fail?: (method: FakeAccountMethod, args: unknown[]) => WaApiError | null;
  } = {},
): FakeWaAccountApi {
  const state: FakeWaAccountState = {
    token: "business-token-1",
    tokenInfo: { valid: true, appId: "app-1", expiresAt: null, managedWabaIds: [FAKE_WABA_ID] },
    numbers: [
      {
        id: FAKE_PHONE_NUMBER_ID,
        displayPhone: "+972 50-000-0009",
        verifiedName: "Y&Y אחזקה",
        onBusinessApp: true,
        platformType: "CLOUD_API",
      },
    ],
    subscription: null,
    templates: [],
    ...options.state,
  };
  const calls: FakeWaAccountApi["calls"] = [];
  const sent: FakeWaAccountApi["sent"] = [];

  const call = (method: FakeAccountMethod, args: unknown[]) => {
    calls.push({ method, args });
    const failure = options.fail?.(method, args);
    if (failure) throw failure;
  };

  return {
    state,
    calls,
    sent,
    async exchangeCode(code) {
      call("exchangeCode", [code]);
      return state.token;
    },
    async inspectToken(token) {
      call("inspectToken", [token]);
      return state.tokenInfo;
    },
    async listPhoneNumbers(token, wabaId) {
      call("listPhoneNumbers", [token, wabaId]);
      return state.numbers;
    },
    async getPhoneNumber(token, phoneNumberId) {
      call("getPhoneNumber", [token, phoneNumberId]);
      const number = state.numbers.find((candidate) => candidate.id === phoneNumberId);
      if (!number) throw new WaApiError("fake: אין מספר כזה", "not_found");
      return number;
    },
    async subscribe(token, wabaId, override) {
      call("subscribe", [token, wabaId, override]);
      state.subscription = { callbackUri: override.callbackUri };
    },
    async getSubscription(token, wabaId) {
      call("getSubscription", [token, wabaId]);
      return state.subscription;
    },
    async unsubscribe(token, wabaId) {
      call("unsubscribe", [token, wabaId]);
      state.subscription = null;
    },
    async requestSync(token, phoneNumberId, kind) {
      call("requestSync", [token, phoneNumberId, kind]);
    },
    async listTemplates(token, wabaId) {
      call("listTemplates", [token, wabaId]);
      return state.templates;
    },
    async createTemplate(token, wabaId, template) {
      call("createTemplate", [token, wabaId, template]);
      state.templates.push({
        id: `tpl-${state.templates.length + 1}`,
        name: template.name,
        language: template.language,
        category: template.category,
        status: "PENDING",
      });
      return { status: "PENDING" };
    },
    async sendMessage(token, phoneNumberId, body) {
      call("sendMessage", [token, phoneNumberId, body]);
      const wamid = `wamid.test-${sent.length + 1}`;
      sent.push({ phoneNumberId, body, wamid });
      return { wamid };
    },
  };
}
