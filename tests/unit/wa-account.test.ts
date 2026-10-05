import { describe, expect, it } from "vitest";
import { graphWaAccountApi, toTokenInfo } from "@/lib/whatsapp/account";
import { WaApiError } from "@/lib/whatsapp/errors";

/**
 * ניהול החיבור מול Graph (מסך 17) — מול `fetch` מזויף, בלי רשת.
 *
 * מה שנבדק הוא מה שהשירות נשען עליו: **מי מזדהה בכל קריאה** (האפליקציה בהחלפת
 * הקוד ובבדיקת הטוקן, העסק בכל השאר — ואף פעם לא שניהם), **צורת הבקשות** שמשנות
 * דבר אצל Meta (מנוי, ביטולו, סנכרון, תבנית), ו**הפענוח** של מה שחוזר.
 */

interface Call {
  url: URL;
  method: string;
  authorization: string | undefined;
  body: unknown;
}

function fakeGraph(handler: (url: URL, method: string) => { status?: number; json?: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const url = new URL(href);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      authorization: headers.Authorization,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const route = handler(url, method);
    return new Response(JSON.stringify(route.json ?? {}), { status: route.status ?? 200 });
  }) satisfies typeof globalThis.fetch;

  const api = graphWaAccountApi({ appId: "app-1", appSecret: "app-secret", version: "v25.0", fetch: fetchImpl });
  return { api, calls };
}

describe("החלפת הקוד בטוקן", () => {
  it("בשם האפליקציה, בלי כותרת הרשאה — והטוקן חוזר", async () => {
    const { api, calls } = fakeGraph(() => ({ json: { access_token: "business-token", token_type: "bearer" } }));
    await expect(api.exchangeCode("code-123")).resolves.toBe("business-token");

    const [call] = calls;
    expect(call.url.pathname).toBe("/v25.0/oauth/access_token");
    expect(call.url.searchParams.get("client_id")).toBe("app-1");
    expect(call.url.searchParams.get("client_secret")).toBe("app-secret");
    expect(call.url.searchParams.get("code")).toBe("code-123");
    expect(call.authorization).toBeUndefined();
  });

  it("תשובה בלי טוקן — שגיאה קבועה ולא מחרוזת ריקה", async () => {
    const { api } = fakeGraph(() => ({ json: {} }));
    await expect(api.exchangeCode("x")).rejects.toMatchObject({ kind: "permanent" });
  });

  it("קוד שפג — השגיאה של Graph מסווגת ואינה נבלעת", async () => {
    const { api } = fakeGraph(() => ({
      status: 400,
      json: { error: { message: "This authorization code has expired.", code: 100 } },
    }));
    await expect(api.exchangeCode("old")).rejects.toBeInstanceOf(WaApiError);
  });
});

describe("בדיקת הטוקן (debug_token)", () => {
  it("בטוקן האפליקציה, והטוקן הנבדק בפרמטר", async () => {
    const { api, calls } = fakeGraph(() => ({
      json: {
        data: {
          is_valid: true,
          app_id: "app-1",
          expires_at: 0,
          granular_scopes: [
            { scope: "whatsapp_business_management", target_ids: ["200", "201"] },
            { scope: "whatsapp_business_messaging", target_ids: ["200"] },
            { scope: "business_management" },
          ],
        },
      },
    }));
    const info = await api.inspectToken("business-token");
    expect(info).toEqual({ valid: true, appId: "app-1", expiresAt: null, managedWabaIds: ["200", "201"] });
    expect(calls[0].authorization).toBe("Bearer app-1|app-secret");
    expect(calls[0].url.searchParams.get("input_token")).toBe("business-token");
  });

  it("טוקן שפג — מועד התפוגה; טוקן פסול — valid=false", () => {
    expect(toTokenInfo({ is_valid: true, expires_at: 1_800_000_000 }).expiresAt).toEqual(new Date(1_800_000_000_000));
    expect(toTokenInfo({ is_valid: false }).valid).toBe(false);
    expect(toTokenInfo({}).managedWabaIds).toEqual([]);
  });
});

describe("המספרים בחשבון", () => {
  it("רשימה עם השדות של Coexistence, בטוקן העסק", async () => {
    const { api, calls } = fakeGraph(() => ({
      json: {
        data: [
          { id: "300", display_phone_number: "+972 50-000-0009", verified_name: "Y&Y", is_on_biz_app: true, platform_type: "CLOUD_API" },
          { id: "301", display_phone_number: "+1 555-0100", is_on_biz_app: false },
          { display_phone_number: "בלי מזהה" },
        ],
      },
    }));
    const numbers = await api.listPhoneNumbers("business-token", "200");
    expect(numbers).toEqual([
      { id: "300", displayPhone: "+972 50-000-0009", verifiedName: "Y&Y", onBusinessApp: true, platformType: "CLOUD_API" },
      { id: "301", displayPhone: "+1 555-0100", verifiedName: null, onBusinessApp: false, platformType: null },
    ]);
    expect(calls[0].url.pathname).toBe("/v25.0/200/phone_numbers");
    expect(calls[0].url.searchParams.get("fields")).toContain("is_on_biz_app");
    expect(calls[0].authorization).toBe("Bearer business-token");
  });
});

describe("המנוי על החשבון", () => {
  it("subscribe — הכתובת שלנו ו-verify token בגוף", async () => {
    const { api, calls } = fakeGraph(() => ({ json: { success: true } }));
    await api.subscribe("business-token", "200", { callbackUri: "https://yy.example/api/whatsapp/webhook", verifyToken: "v" });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.pathname).toBe("/v25.0/200/subscribed_apps");
    expect(calls[0].body).toEqual({ override_callback_uri: "https://yy.example/api/whatsapp/webhook", verify_token: "v" });
  });

  it("subscribe בלי success — שגיאה, לא הצלחה שקטה", async () => {
    const { api } = fakeGraph(() => ({ json: { success: false } }));
    await expect(api.subscribe("t", "200", { callbackUri: "https://x", verifyToken: "v" })).rejects.toMatchObject({
      kind: "permanent",
    });
  });

  it("getSubscription — רק האפליקציה שלנו, עם הכתובת שלה", async () => {
    const { api } = fakeGraph(() => ({
      json: {
        data: [
          { whatsapp_business_api_data: { id: "other-app", name: "אחרת" }, override_callback_uri: "https://other" },
          { whatsapp_business_api_data: { id: "app-1", name: "שלנו" }, override_callback_uri: "https://ours" },
        ],
      },
    }));
    await expect(api.getSubscription("t", "200")).resolves.toEqual({ callbackUri: "https://ours" });
  });

  it("getSubscription — האפליקציה שלנו אינה ברשימה: null; מנויה בלי כתובת: callbackUri null", async () => {
    const missing = fakeGraph(() => ({ json: { data: [{ whatsapp_business_api_data: { id: "other-app" } }] } }));
    await expect(missing.api.getSubscription("t", "200")).resolves.toBeNull();
    const bare = fakeGraph(() => ({ json: { data: [{ whatsapp_business_api_data: { id: "app-1" } }] } }));
    await expect(bare.api.getSubscription("t", "200")).resolves.toEqual({ callbackUri: null });
  });

  it("unsubscribe — DELETE על אותו נתיב", async () => {
    const { api, calls } = fakeGraph(() => ({ json: { success: true } }));
    await api.unsubscribe("t", "200");
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url.pathname).toBe("/v25.0/200/subscribed_apps");
  });
});

describe("הסנכרון שהחיבור מחייב", () => {
  it.each(["smb_app_state_sync", "history"] as const)("%s — POST ל-smb_app_data", async (kind) => {
    const { api, calls } = fakeGraph(() => ({ json: { messaging_product: "whatsapp", request_id: "r-1" } }));
    await api.requestSync("t", "300", kind);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.pathname).toBe("/v25.0/300/smb_app_data");
    expect(calls[0].body).toEqual({ messaging_product: "whatsapp", sync_type: kind });
  });
});

describe("תבניות", () => {
  it("רשימה — השדות הנחוצים, ותבנית בלי שם נזרקת", async () => {
    const { api, calls } = fakeGraph(() => ({
      json: {
        data: [
          { id: "1", name: "connection_test_v1", language: "he", category: "UTILITY", status: "APPROVED" },
          { id: "2", language: "he" },
        ],
      },
    }));
    await expect(api.listTemplates("t", "200")).resolves.toEqual([
      { id: "1", name: "connection_test_v1", language: "he", category: "UTILITY", status: "APPROVED" },
    ]);
    expect(calls[0].url.pathname).toBe("/v25.0/200/message_templates");
  });

  it("יצירה — גוף טקסט אחד, בעברית ובקטגוריה Utility", async () => {
    const { api, calls } = fakeGraph(() => ({ json: { id: "9", status: "PENDING", category: "UTILITY" } }));
    await expect(
      api.createTemplate("t", "200", { name: "connection_test_v1", language: "he", category: "UTILITY", body: "שלום" }),
    ).resolves.toEqual({ status: "PENDING" });
    expect(calls[0].body).toEqual({
      name: "connection_test_v1",
      language: "he",
      category: "UTILITY",
      components: [{ type: "BODY", text: "שלום" }],
    });
  });
});

describe("שליחה", () => {
  it("הגוף שהקורא הרכיב, עם messaging_product — וה-wamid חוזר", async () => {
    const { api, calls } = fakeGraph(() => ({ json: { messages: [{ id: "wamid.1" }] } }));
    await expect(api.sendMessage("t", "300", { to: "972500000009", type: "text", text: { body: "x" } })).resolves.toEqual({
      wamid: "wamid.1",
    });
    expect(calls[0].body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "972500000009",
      type: "text",
      text: { body: "x" },
    });
  });

  it("בלי wamid — שגיאה: הודעה שאין לנו את המזהה שלה אינה 'נשלחה'", async () => {
    const { api } = fakeGraph(() => ({ json: { messages: [] } }));
    await expect(api.sendMessage("t", "300", { to: "1", type: "text" })).rejects.toMatchObject({ kind: "permanent" });
  });
});
