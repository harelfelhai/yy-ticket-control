import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { graphWaApi } from "@/lib/whatsapp/api";
import { WINDOW_CLOSED_CODE, WaApiError, classifyGraphError, parseGraphError } from "@/lib/whatsapp/errors";
import { type GraphConfig, graphUrl } from "@/lib/whatsapp/graph";
import { MAX_TEXT_LENGTH } from "@/lib/whatsapp/send";

/**
 * המתאם ל-Graph API — מול `fetch` מזויף, בלי רשת.
 *
 * מה שנבדק הוא מה שהצינור נשען עליו: **הסיווג** (לנסות שוב, לעצור, להכריע),
 * **הטוקן בשתי הקפיצות** של הורדת מדיה (נמדד בספייק W0 — בלעדיו 401), ו**צורת
 * ההודעה** שנשלחת: טקסט בלבד, עם ציטוט ההודעה של השולח.
 */

interface Call {
  url: string;
  method: string;
  authorization: string | undefined;
  body: unknown;
}

type Route = { status?: number; json?: unknown; text?: string; bytes?: Buffer; throws?: Error };

function fakeGraph(handler: (url: URL, method: string) => Route) {
  const calls: Call[] = [];
  const fetchImpl = (async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: href,
      method,
      authorization: headers.Authorization,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const route = handler(new URL(href), method);
    if (route.throws) throw route.throws;
    const body = route.bytes ? new Uint8Array(route.bytes) : (route.text ?? JSON.stringify(route.json ?? {}));
    return new Response(body, { status: route.status ?? 200 });
  }) satisfies typeof globalThis.fetch;

  const config: GraphConfig = { token: "test-token", version: "v25.0", fetch: fetchImpl };
  return { api: graphWaApi(config), calls };
}

function graphError(code: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ error: { message: `error ${code}`, type: "OAuthException", code, ...extra } });
}

async function caught(promise: Promise<unknown>): Promise<WaApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WaApiError) return error;
    throw error;
  }
  throw new Error("ציפיתי לשגיאה");
}

// ─────────────────────────────── הסיווג ───────────────────────────────

describe("classifyGraphError", () => {
  it.each([
    [null, {}, "transient"],
    [500, {}, "transient"],
    [503, {}, "transient"],
    [429, {}, "transient"],
    [408, {}, "transient"],
    [400, { code: 4 }, "transient"],
    [400, { code: 130429 }, "transient"],
    [400, { code: 131000 }, "transient"],
    [401, {}, "auth"],
    [403, {}, "auth"],
    [400, { code: 190 }, "auth"],
    [400, { code: 131031 }, "auth"],
    [400, { code: 10 }, "auth"],
    [404, {}, "not_found"],
    [400, { code: 100, subcode: 33 }, "not_found"],
    [400, { code: 100 }, "permanent"],
    [400, { code: WINDOW_CLOSED_CODE }, "permanent"],
    [400, {}, "permanent"],
  ] as const)("status %s, %j → %s", (status, body, expected) => {
    expect(classifyGraphError(status, body)).toBe(expected);
  });

  it("הקוד של Meta גובר על קוד ה-HTTP: הגבלת קצב שחוזרת כ-403 אינה עצירה", () => {
    expect(classifyGraphError(403, { code: 80007 })).toBe("transient");
  });

  it("גוף שאינו JSON (HTML מ-proxy) אינו מפיל את הסיווג", () => {
    expect(parseGraphError("<html>bad gateway</html>")).toEqual({});
    expect(classifyGraphError(502, parseGraphError("<html>"))).toBe("transient");
  });
});

describe("graphUrl", () => {
  it("ברירת המחדל — Meta, בגרסה שנקבעה", () => {
    expect(graphUrl({ version: "v25.0" }, "/123/messages")).toBe("https://graph.facebook.com/v25.0/123/messages");
  });

  it("כתובת חלופית (שרת מדומה בבדיקה מקומית) — בלי לוכסן כפול", () => {
    expect(graphUrl({ version: "v25.0", host: "http://127.0.0.1:3199/" }, "123/messages")).toBe(
      "http://127.0.0.1:3199/v25.0/123/messages",
    );
  });
});

// ─────────────────────────────── שליחה ───────────────────────────────

describe("sendText", () => {
  it("טקסט בלבד, כתגובה להודעת השולח, מהמספר העסקי ועם הטוקן", async () => {
    const { api, calls } = fakeGraph(() => ({ json: { messages: [{ id: "wamid.SENT" }] } }));
    const result = await api.sendText({ phoneNumberId: "300000000000002", to: { phone: "972500000002" }, body: "שלום", contextWamid: "wamid.IN" });

    expect(result).toEqual({ wamid: "wamid.SENT" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://graph.facebook.com/v25.0/300000000000002/messages",
      method: "POST",
      authorization: "Bearer test-token",
      body: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "972500000002",
        type: "text",
        text: { body: "שלום", preview_url: false },
        context: { message_id: "wamid.IN" },
      },
    });
  });

  it("משתמש שהסתיר את הטלפון — המזהה בשדה `recipient`, ובלי `to`", async () => {
    const { api, calls } = fakeGraph(() => ({ json: { messages: [{ id: "wamid.SENT" }] } }));
    await api.sendText({ phoneNumberId: "1", to: { bsuid: "IL.1234567890" }, body: "שלום" });
    expect(calls[0]?.body).toMatchObject({ recipient: "IL.1234567890" });
    expect(calls[0]?.body).not.toHaveProperty("to");
  });

  it("בלי הודעה לצטט — בלי `context`", async () => {
    const { api, calls } = fakeGraph(() => ({ json: { messages: [{ id: "wamid.SENT" }] } }));
    await api.sendText({ phoneNumberId: "1", to: { phone: "972500000002" }, body: "שלום" });
    expect(calls[0]?.body).not.toHaveProperty("context");
  });

  it("חלון 24 השעות נסגר (131047) — הכרעה, עם הקוד לקורא", async () => {
    const { api } = fakeGraph(() => ({ status: 400, text: graphError(WINDOW_CLOSED_CODE) }));
    const error = await caught(api.sendText({ phoneNumberId: "1", to: { phone: "972500000002" }, body: "שלום" }));
    expect(error).toMatchObject({ kind: "permanent", status: 400, code: WINDOW_CLOSED_CODE });
  });

  it("טוקן שבוטל — עצירה ברעש, והטוקן אינו בהודעת השגיאה", async () => {
    const { api } = fakeGraph(() => ({ status: 401, text: graphError(190) }));
    const error = await caught(api.sendText({ phoneNumberId: "1", to: { phone: "972500000002" }, body: "שלום" }));
    expect(error.kind).toBe("auth");
    expect(error.message).not.toContain("test-token");
  });

  it("כשל רשת — חולף", async () => {
    const { api } = fakeGraph(() => ({ throws: new TypeError("fetch failed") }));
    expect((await caught(api.sendText({ phoneNumberId: "1", to: { phone: "9725" }, body: "שלום" }))).kind).toBe("transient");
  });

  it("תשובה בלי מזהה הודעה — הכרעה: בלי המזהה תגובה עליה לא תחזור לטיוטה", async () => {
    const { api } = fakeGraph(() => ({ json: { messages: [] } }));
    expect((await caught(api.sendText({ phoneNumberId: "1", to: { phone: "9725" }, body: "שלום" }))).kind).toBe("permanent");
  });

  it("גוף ריק או ארוך מהגג נדחה לפני שנשלחת בקשה", async () => {
    const { api, calls } = fakeGraph(() => ({ json: { messages: [{ id: "x" }] } }));
    expect((await caught(api.sendText({ phoneNumberId: "1", to: { phone: "9725" }, body: "  " }))).kind).toBe("permanent");
    expect((await caught(api.sendText({ phoneNumberId: "1", to: { phone: "9725" }, body: "א".repeat(MAX_TEXT_LENGTH + 1) }))).kind).toBe(
      "permanent",
    );
    expect(calls).toHaveLength(0);
  });
});

// ─────────────────────────────── מדיה ───────────────────────────────

const BYTES = Buffer.from("fake jpeg bytes");
const SHA = createHash("sha256").update(BYTES).digest("hex");
const MEDIA_URL = "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1000000000000101";

function mediaRoutes(overrides: { info?: Route; download?: Route } = {}) {
  return fakeGraph((url) => {
    if (url.hostname === "graph.facebook.com") {
      return overrides.info ?? { json: { url: MEDIA_URL, mime_type: "image/jpeg", sha256: SHA, file_size: BYTES.byteLength } };
    }
    return overrides.download ?? { bytes: BYTES };
  });
}

describe("downloadMedia", () => {
  it("שתי קפיצות, והטוקן בשתיהן", async () => {
    const { api, calls } = mediaRoutes();
    const result = await api.downloadMedia("1000000000000101", { maxBytes: 1024 });

    expect(result).toEqual({ ok: true, media: { bytes: BYTES, mimeType: "image/jpeg", sha256: SHA, sizeBytes: BYTES.byteLength } });
    expect(calls.map((call) => call.url)).toEqual(["https://graph.facebook.com/v25.0/1000000000000101", MEDIA_URL]);
    expect(calls.every((call) => call.authorization === "Bearer test-token")).toBe(true);
  });

  it("קובץ גדול מהתקרה לפי הגודל המוצהר — בלי הורדה", async () => {
    const { api, calls } = mediaRoutes({ info: { json: { url: MEDIA_URL, mime_type: "video/mp4", file_size: 5000 } } });
    expect(await api.downloadMedia("m", { maxBytes: 1000 })).toEqual({ ok: false, reason: "too-large", sizeBytes: 5000 });
    expect(calls).toHaveLength(1);
  });

  it("קובץ גדול מהתקרה בפועל (הגודל לא הוצהר) — נדחה אחרי ההורדה", async () => {
    const { api } = mediaRoutes({ info: { json: { url: MEDIA_URL, mime_type: "image/jpeg" } } });
    expect(await api.downloadMedia("m", { maxBytes: 4 })).toEqual({ ok: false, reason: "too-large", sizeBytes: BYTES.byteLength });
  });

  it("גיבוב שאינו תואם — ההורדה נקטעה, ולכן לנסות שוב ולא להכריע", async () => {
    const { api } = mediaRoutes({ download: { bytes: Buffer.from("truncated") } });
    expect((await caught(api.downloadMedia("m", { maxBytes: 1024 }))).kind).toBe("transient");
  });

  it("מדיה שאינה קיימת עוד (אחרי 7 ימים) — לא נמצאה", async () => {
    const { api } = mediaRoutes({ info: { status: 400, text: graphError(100, { error_subcode: 33 }) } });
    expect((await caught(api.downloadMedia("m", { maxBytes: 1024 }))).kind).toBe("not_found");
  });

  it("404 על הכתובת הטרייה אינו \"לא נמצאה\" — ניסיון חוזר מתחיל מכתובת חדשה", async () => {
    const { api } = mediaRoutes({ download: { status: 404, text: "" } });
    expect((await caught(api.downloadMedia("m", { maxBytes: 1024 }))).kind).toBe("transient");
  });

  it("401 בקפיצה השנייה — עצירה ברעש (הטוקן אינו תקף)", async () => {
    const { api } = mediaRoutes({ download: { status: 401, text: "" } });
    expect((await caught(api.downloadMedia("m", { maxBytes: 1024 }))).kind).toBe("auth");
  });

  it("שרת Graph מדומה (בדיקה מקומית): כתובת http מותרת רק כשהיא של אותו שרת", async () => {
    const host = "http://127.0.0.1:3199";
    const routes = (url: string) => {
      const calls: string[] = [];
      const fetchImpl = (async (input: RequestInfo | URL) => {
        const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        calls.push(href);
        return href.includes("/v25.0/")
          ? new Response(JSON.stringify({ url, mime_type: "image/jpeg", sha256: SHA }), { status: 200 })
          : new Response(new Uint8Array(BYTES), { status: 200 });
      }) satisfies typeof globalThis.fetch;
      return { api: graphWaApi({ token: "t", version: "v25.0", host, fetch: fetchImpl }), calls };
    };

    const same = routes(`${host}/media-bytes/m`);
    expect(await same.api.downloadMedia("m", { maxBytes: 1024 })).toMatchObject({ ok: true });
    expect(same.calls).toEqual([`${host}/v25.0/m`, `${host}/media-bytes/m`]);

    const other = routes("http://evil.example/x");
    expect((await caught(other.api.downloadMedia("m", { maxBytes: 1024 }))).kind).toBe("permanent");
    expect(other.calls).toHaveLength(1);
  });

  it("תשובה בלי כתובת https — הכרעה, בלי לפנות לכתובת אחרת", async () => {
    const { api, calls } = mediaRoutes({ info: { json: { url: "http://evil.example/x", mime_type: "image/jpeg" } } });
    expect((await caught(api.downloadMedia("m", { maxBytes: 1024 }))).kind).toBe("permanent");
    expect(calls).toHaveLength(1);
  });
});
