import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WA_HEALTH_INTERVAL_MS, ensureWaHealthScheduled, runWaHealth } from "@/jobs/handlers/wa-health";
import { JOB_TYPES } from "@/jobs/types";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import {
  SYNC_WINDOW_MS,
  applyAccountUpdate,
  checkWhatsappConnection,
  connectWhatsappNumber,
  createWhatsappSystemTemplates,
  disconnectWhatsappNumber,
  getWhatsappScreen,
  listWhatsappTemplates,
  sendWhatsappTestMessage,
} from "@/lib/services/wa-number";
import { processWebhookEvent } from "@/lib/services/wa-webhook";
import type { SessionUser } from "@/lib/session";
import { WaApiError } from "@/lib/whatsapp/errors";
import { TEST_TEMPLATE } from "@/lib/whatsapp/system-templates";
import { openWaToken, sealWaToken } from "@/lib/whatsapp/token";
import { checks } from "@/watchdog/checks";
import { HEARTBEAT, getHeartbeat, setHeartbeat } from "@/watchdog/heartbeat";
import { FAKE_PHONE_NUMBER_ID, FAKE_WABA_ID, type FakeWaAccountApi, fakeWaAccountApi } from "../helpers/fake-wa-api";
import { resetDb } from "../helpers/reset-db";

/**
 * מסך 17 — חיבור המספר העסקי (אפיון 1.4, W5): חיבור, ניתוק, בדיקה תקופתית, הודעת
 * הניתוק של Meta, תבניות והודעת בדיקה — מול הבסיס האמיתי ו-Meta מזויפת
 * (`fakeWaAccountApi`). **אף בדיקה כאן אינה נוגעת ברשת**: כל קריאה לשירות מקבלת
 * `api` מפורש, כי בלי `api` השירות בוחר את ה-Graph האמיתי לפי התצורה.
 */

const BASE = "https://yy.example.test";
const CALLBACK = `${BASE}/api/whatsapp/webhook`;
const NOW = new Date("2026-10-05T09:00:00Z");
const HOUR = 60 * 60_000;
const errors = he.whatsappAdmin.errors;

let admin: SessionUser;

const connectInput = (overrides: Partial<Parameters<typeof connectWhatsappNumber>[1]> = {}) => ({
  code: "code-1",
  wabaId: FAKE_WABA_ID,
  phoneNumberId: null,
  coexistence: true,
  ...overrides,
});

/** מספר שכבר מחובר בבסיס — בלי לעבור בחלון החיבור */
async function seedNumber(
  overrides: Partial<{
    status: "CONNECTED" | "DISCONNECTED" | "ERROR";
    tokenCipher: string | null;
    lastError: string | null;
    activatedAt: Date;
    connectedAt: Date;
    phoneNumberId: string;
    coexistence: boolean;
    contactsSyncedAt: Date | null;
    historySyncedAt: Date | null;
    verifiedName: string | null;
  }> = {},
) {
  return db.waNumber.create({
    data: {
      phoneNumberId: FAKE_PHONE_NUMBER_ID,
      wabaId: FAKE_WABA_ID,
      displayPhone: "+972 50-000-0009",
      verifiedName: "Y&Y אחזקה",
      tokenCipher: sealWaToken("business-token-1"),
      coexistence: true,
      status: "CONNECTED",
      activatedAt: new Date(NOW.getTime() - 48 * HOUR),
      connectedAt: new Date(NOW.getTime() - 48 * HOUR),
      contactsSyncedAt: new Date(NOW.getTime() - 48 * HOUR),
      historySyncedAt: new Date(NOW.getTime() - 48 * HOUR),
      ...overrides,
    },
  });
}

/** Meta שבה המנוי שלנו קיים, עם הכתובת שלנו */
function healthyMeta(options: Parameters<typeof fakeWaAccountApi>[0] = {}): FakeWaAccountApi {
  return fakeWaAccountApi({ ...options, state: { subscription: { callbackUri: CALLBACK }, ...options.state } });
}

const methods = (api: FakeWaAccountApi) => api.calls.map((call) => call.method);
const failWith = (method: string, error: WaApiError) => (name: string) => (name === method ? error : null);

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("WHATSAPP_APP_SECRET", "test-app-secret");
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "test-verify-token");
  vi.stubEnv("WHATSAPP_APP_ID", "app-1");
  vi.stubEnv("WHATSAPP_CONFIG_ID", "config-1");
  vi.stubEnv("APP_BASE_URL", BASE);
  const user = await db.user.create({
    data: { role: "ADMIN", name: "מנהלת", phone: "0500000001", passwordHash: "x" },
  });
  admin = { id: user.id, name: user.name, role: "ADMIN", siteId: null };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db.$disconnect();
});

// ─────────────────────────────── חיבור ───────────────────────────────

describe("WA-S17-02 — חבר מספר", () => {
  it("חיבור תקין: הקוד מוחלף, המנוי עם הכתובת שלנו, הטוקן מוצפן, והסנכרון — אנשי הקשר ואז ההיסטוריה", async () => {
    const api = fakeWaAccountApi();
    const result = await connectWhatsappNumber(admin, connectInput(), { api, now: NOW });
    expect(result).toEqual({ displayPhone: "+972 50-000-0009" });

    const row = await db.waNumber.findUniqueOrThrow({ where: { phoneNumberId: FAKE_PHONE_NUMBER_ID } });
    expect(row).toMatchObject({
      wabaId: FAKE_WABA_ID,
      status: "CONNECTED",
      coexistence: true,
      verifiedName: "Y&Y אחזקה",
      activatedAt: NOW,
      connectedAt: NOW,
      connectedById: admin.id,
      contactsSyncedAt: NOW,
      historySyncedAt: NOW,
      lastError: null,
    });
    // מוצפן במנוחה, ונפתח בחזרה לאותו טוקן
    expect(row.tokenCipher).not.toContain("business-token-1");
    expect(openWaToken(row.tokenCipher ?? "")).toBe("business-token-1");

    expect(api.state.subscription).toEqual({ callbackUri: CALLBACK });
    const subscribe = api.calls.find((call) => call.method === "subscribe");
    expect(subscribe?.args[2]).toEqual({ callbackUri: CALLBACK, verifyToken: "test-verify-token" });
    expect(api.calls.filter((call) => call.method === "requestSync").map((call) => call.args[2])).toEqual([
      "smb_app_state_sync",
      "history",
    ]);
    // הקוד מוחלף לפני כל דבר אחר — הוא תקף 30 שניות
    expect(methods(api)[0]).toBe("exchangeCode");
  });

  it("§7 שורה 108 — החלון דיווח על מספר שאינו באפליקציה בטלפון: נדחה בלי לפנות ל-Meta", async () => {
    const api = fakeWaAccountApi();
    await expect(connectWhatsappNumber(admin, connectInput({ coexistence: false }), { api })).rejects.toThrow(
      errors.notCoexistence,
    );
    expect(api.calls).toEqual([]);
    expect(await db.waNumber.count()).toBe(0);
  });

  it("Meta אומרת שהמספר שנבחר אינו באפליקציה — נדחה, ולא נוצר מנוי", async () => {
    const api = fakeWaAccountApi({
      state: { numbers: [{ id: "301", displayPhone: "+1 555", verifiedName: null, onBusinessApp: false, platformType: "CLOUD_API" }] },
    });
    await expect(connectWhatsappNumber(admin, connectInput({ phoneNumberId: "301" }), { api })).rejects.toThrow(
      errors.notCoexistence,
    );
    expect(methods(api)).not.toContain("subscribe");
    expect(await db.waNumber.count()).toBe(0);
  });

  it.each([
    ["אין מספר שפועל באפליקציה", []],
    [
      "שני מספרים שפועלים באפליקציה",
      [
        { id: "301", displayPhone: "1", verifiedName: null, onBusinessApp: true, platformType: null },
        { id: "302", displayPhone: "2", verifiedName: null, onBusinessApp: true, platformType: null },
      ],
    ],
  ])("%s — 'לא ניתן לזהות', ולא מנחשים", async (_label, numbers) => {
    const api = fakeWaAccountApi({ state: { numbers } });
    await expect(connectWhatsappNumber(admin, connectInput(), { api })).rejects.toThrow(errors.numberNotIdentified);
    expect(methods(api)).not.toContain("subscribe");
  });

  it("הטוקן אינו מנהל את החשבון שהדף מסר — 'לא ניתן היה להשלים', ולא נשמר דבר", async () => {
    const api = fakeWaAccountApi({
      state: { tokenInfo: { valid: true, appId: "app-1", expiresAt: null, managedWabaIds: ["999"] } },
    });
    await expect(connectWhatsappNumber(admin, connectInput(), { api })).rejects.toThrow(errors.exchangeFailed);
    expect(methods(api)).toEqual(["exchangeCode", "inspectToken"]);
    expect(await db.waNumber.count()).toBe(0);
  });

  it("החלפת הקוד נכשלה (קוד שפג) — 'לא ניתן היה להשלים'", async () => {
    const api = fakeWaAccountApi({ fail: failWith("exchangeCode", new WaApiError("expired", "permanent", { code: 100 })) });
    await expect(connectWhatsappNumber(admin, connectInput(), { api })).rejects.toThrow(errors.exchangeFailed);
    expect(await db.waNumber.count()).toBe(0);
  });

  it("Meta דחתה את המנוי — הודעה למפתח; כשל חולף — 'נסו שוב'. בשניהם לא נשמר דבר", async () => {
    const rejected = fakeWaAccountApi({ fail: failWith("subscribe", new WaApiError("verify failed", "permanent")) });
    await expect(connectWhatsappNumber(admin, connectInput(), { api: rejected })).rejects.toThrow(errors.subscribeRejected);

    const transient = fakeWaAccountApi({ fail: failWith("subscribe", new WaApiError("down", "transient")) });
    await expect(connectWhatsappNumber(admin, connectInput(), { api: transient })).rejects.toThrow(errors.exchangeFailed);
    expect(await db.waNumber.count()).toBe(0);
  });

  it("כבר מחובר מספר — נדחה לפני שהקוד מוחלף", async () => {
    await seedNumber({ phoneNumberId: "309" });
    const api = fakeWaAccountApi();
    await expect(connectWhatsappNumber(admin, connectInput(), { api })).rejects.toThrow(errors.alreadyConnected);
    expect(api.calls).toEqual([]);
  });

  it("WA-23 — חיבור מחדש של מספר ב'תקלה': הרצפה זזה לרגע החיבור, התקלה נמחקת, והסנכרון מתחיל מחדש", async () => {
    await seedNumber({ status: "ERROR", lastError: "token_revoked", tokenCipher: null });
    const api = fakeWaAccountApi();
    await connectWhatsappNumber(admin, connectInput(), { api, now: NOW });

    const rows = await db.waNumber.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "CONNECTED", activatedAt: NOW, lastError: null, contactsSyncedAt: NOW });
    expect(openWaToken(rows[0].tokenCipher ?? "")).toBe("business-token-1");
  });

  it("מספר אחר במקום מספר בתקלה — הקודם מתנתק ואינו מחזיק עוד טוקן (מספר אחד בלבד)", async () => {
    await seedNumber({ phoneNumberId: "309", status: "ERROR", lastError: "subscription_lost" });
    await connectWhatsappNumber(admin, connectInput(), { api: fakeWaAccountApi(), now: NOW });

    const old = await db.waNumber.findUniqueOrThrow({ where: { phoneNumberId: "309" } });
    expect(old).toMatchObject({ status: "DISCONNECTED", tokenCipher: null });
    expect(await db.waNumber.count({ where: { status: "CONNECTED" } })).toBe(1);
  });

  it("סנכרון שנכשל זמנית — החיבור נשמר, אנשי הקשר נשארים פתוחים, וההיסטוריה אינה מתבקשת לפניהם", async () => {
    const api = fakeWaAccountApi({ fail: failWith("requestSync", new WaApiError("down", "transient")) });
    await connectWhatsappNumber(admin, connectInput(), { api, now: NOW });

    const row = await db.waNumber.findUniqueOrThrow({ where: { phoneNumberId: FAKE_PHONE_NUMBER_ID } });
    expect(row).toMatchObject({ status: "CONNECTED", contactsSyncedAt: null, historySyncedAt: null });
    expect(api.calls.filter((call) => call.method === "requestSync")).toHaveLength(1);
  });

  it("כתובת המערכת אינה https — 'לא הוגדר', בלי לפנות ל-Meta", async () => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3100");
    const api = fakeWaAccountApi();
    await expect(connectWhatsappNumber(admin, connectInput(), { api })).rejects.toThrow(errors.notConfigured);
    expect(api.calls).toEqual([]);
  });

  it("החיבור אינו מוגדר בשרת — 'לא הוגדר'", async () => {
    await expect(connectWhatsappNumber(admin, connectInput(), { api: null })).rejects.toThrow(errors.notConfigured);
  });

  it("רק מנהל מערכת", async () => {
    const owner = await db.user.create({ data: { role: "OWNER", name: "בעלים", phone: "0500000003", passwordHash: "x" } });
    const actor: SessionUser = { id: owner.id, name: owner.name, role: "OWNER", siteId: null };
    const api = fakeWaAccountApi();
    await expect(connectWhatsappNumber(actor, connectInput(), { api })).rejects.toThrow(he.admin.forbidden);
    await expect(disconnectWhatsappNumber(actor, { api })).rejects.toThrow(he.admin.forbidden);
    await expect(sendWhatsappTestMessage(actor, { api })).rejects.toThrow(he.admin.forbidden);
    expect(api.calls).toEqual([]);
  });
});

// ─────────────────────────────── ניתוק ───────────────────────────────

describe("WA-S17-03 — נתק", () => {
  it("WA-24 — המנוי מבוטל אצל Meta, המצב 'מנותק', וההרשאה השמורה נמחקת", async () => {
    await seedNumber();
    const api = healthyMeta();
    await disconnectWhatsappNumber(admin, { api });

    expect(methods(api)).toEqual(["unsubscribe"]);
    expect(api.calls[0].args).toEqual(["business-token-1", FAKE_WABA_ID]);
    expect(api.state.subscription).toBeNull();
    expect(await db.waNumber.findFirstOrThrow()).toMatchObject({ status: "DISCONNECTED", tokenCipher: null });
  });

  it("Meta אינה זמינה — 'לא ניתן היה לנתק', ודבר אינו משתנה", async () => {
    await seedNumber();
    const api = healthyMeta({ fail: failWith("unsubscribe", new WaApiError("down", "transient")) });
    await expect(disconnectWhatsappNumber(admin, { api })).rejects.toThrow(errors.disconnectUnavailable);

    const row = await db.waNumber.findFirstOrThrow();
    expect(row.status).toBe("CONNECTED");
    expect(openWaToken(row.tokenCipher ?? "")).toBe("business-token-1");
  });

  it("הטוקן כבר בוטל אצל Meta — אין מה לבטל, והניתוק המקומי מתבצע", async () => {
    await seedNumber({ status: "ERROR", lastError: "token_revoked" });
    const api = healthyMeta({ fail: failWith("unsubscribe", new WaApiError("revoked", "auth", { code: 190 })) });
    await disconnectWhatsappNumber(admin, { api });
    expect(await db.waNumber.findFirstOrThrow()).toMatchObject({ status: "DISCONNECTED", tokenCipher: null, lastError: null });
  });

  it("אין מספר מחובר (מסך שלא עודכן) — בלי שגיאה ובלי פנייה ל-Meta", async () => {
    await seedNumber({ status: "DISCONNECTED", tokenCipher: null });
    const api = healthyMeta();
    await disconnectWhatsappNumber(admin, { api });
    expect(api.calls).toEqual([]);
  });
});

// ─────────────────────────────── הבדיקה התקופתית ───────────────────────────────

describe("WA-22 — הבדיקה התקופתית מגלה ניתוק (§7 שורה 109)", () => {
  it("חיבור שלם — המצב נשאר 'מחובר', בלי לגעת בסנכרון שהושלם", async () => {
    await seedNumber();
    const api = healthyMeta();
    await expect(checkWhatsappConnection({ api, now: NOW })).resolves.toEqual({ kind: "wa-health", status: "ok", synced: false });
    expect(methods(api)).toEqual(["getSubscription", "getPhoneNumber"]);
    expect((await db.waNumber.findFirstOrThrow()).status).toBe("CONNECTED");
  });

  it.each([
    ["המנוי הוסר", null],
    ["ההודעות הופנו לכתובת אחרת", { callbackUri: "https://other.example/webhook" }],
  ])("%s — 'תקלה' subscription_lost", async (_label, subscription) => {
    await seedNumber();
    const api = fakeWaAccountApi({ state: { subscription } });
    await expect(checkWhatsappConnection({ api, now: NOW })).resolves.toMatchObject({ status: "issue", issue: "subscription_lost" });
    expect(await db.waNumber.findFirstOrThrow()).toMatchObject({ status: "ERROR", lastError: "subscription_lost" });
  });

  it.each([
    ["auth", "token_revoked"],
    ["not_found", "number_missing"],
  ] as const)("Graph מחזיר %s — 'תקלה' %s", async (kind, issue) => {
    await seedNumber();
    const api = healthyMeta({ fail: failWith("getSubscription", new WaApiError("x", kind)) });
    await expect(checkWhatsappConnection({ api, now: NOW })).resolves.toMatchObject({ status: "issue", issue });
    expect((await db.waNumber.findFirstOrThrow()).lastError).toBe(issue);
  });

  it("Meta אינה עונה — המצב אינו משתנה, והפעימה אינה נרשמת", async () => {
    await seedNumber();
    const api = healthyMeta({ fail: failWith("getSubscription", new WaApiError("down", "transient")) });
    await expect(runWaHealth(NOW, { api })).resolves.toEqual({ kind: "wa-health", status: "unreachable" });
    expect((await db.waNumber.findFirstOrThrow()).status).toBe("CONNECTED");
    expect(await getHeartbeat(HEARTBEAT.waHealth)).toBeNull();
  });

  it("המספר כבר אינו באפליקציה בטלפון — 'תקלה' not_on_app", async () => {
    await seedNumber();
    const api = healthyMeta({
      state: { numbers: [{ id: FAKE_PHONE_NUMBER_ID, displayPhone: "+972 50-000-0009", verifiedName: null, onBusinessApp: false, platformType: null }] },
    });
    await expect(checkWhatsappConnection({ api, now: NOW })).resolves.toMatchObject({ issue: "not_on_app" });
  });

  it("סנכרון פתוח בתוך 24 השעות — מושלם עכשיו", async () => {
    await seedNumber({ activatedAt: new Date(NOW.getTime() - 5 * HOUR), contactsSyncedAt: null, historySyncedAt: null });
    const api = healthyMeta();
    await expect(checkWhatsappConnection({ api, now: NOW })).resolves.toEqual({ kind: "wa-health", status: "ok", synced: true });
    expect(await db.waNumber.findFirstOrThrow()).toMatchObject({ contactsSyncedAt: NOW, historySyncedAt: NOW });
  });

  it("סנכרון פתוח אחרי 24 שעות — 'תקלה' sync_overdue, בלי לבקש סנכרון ש-Meta כבר לא תקבל", async () => {
    await seedNumber({ activatedAt: new Date(NOW.getTime() - SYNC_WINDOW_MS - HOUR), historySyncedAt: null });
    const api = healthyMeta();
    await expect(checkWhatsappConnection({ api, now: NOW })).resolves.toMatchObject({ issue: "sync_overdue" });
    expect(methods(api)).not.toContain("requestSync");
  });

  it("ההרשאה השמורה אינה ניתנת לפענוח — 'תקלה' token_unreadable, בלי לפנות ל-Meta", async () => {
    await seedNumber({ tokenCipher: "not-a-cipher" });
    const api = healthyMeta();
    await expect(checkWhatsappConnection({ api, now: NOW })).resolves.toMatchObject({ issue: "token_unreadable" });
    expect(api.calls).toEqual([]);
  });

  it("השם העסקי השתנה אצל Meta — המסך מציג את החדש", async () => {
    await seedNumber({ verifiedName: "שם ישן" });
    await checkWhatsappConnection({ api: healthyMeta(), now: NOW });
    expect((await db.waNumber.findFirstOrThrow()).verifiedName).toBe("Y&Y אחזקה");
  });

  it("מספר שכבר ב'תקלה' אינו נבדק שוב — הוא מחכה לחיבור מחדש", async () => {
    await seedNumber({ status: "ERROR", lastError: "token_revoked" });
    const api = healthyMeta();
    await expect(checkWhatsappConnection({ api, now: NOW })).resolves.toEqual({ kind: "wa-health", status: "no-number" });
    expect(api.calls).toEqual([]);
  });
});

// ─────────────────────────────── הודעת הניתוק של Meta ───────────────────────────────

describe("account_update — הודעת הניתוק, כשהיא בכל זאת מגיעה", () => {
  const accountUpdate = (wabaId: string, value: Record<string, unknown>) =>
    JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: wabaId, changes: [{ field: "account_update", value }] }] });

  async function deliver(body: string) {
    const event = await db.waWebhookEvent.create({ data: { body } });
    return processWebhookEvent({ webhookEventId: event.id }, { now: NOW });
  }

  it("PARTNER_REMOVED עם סיבה — 'תקלה' עם הסיבה, דרך ה-webhook", async () => {
    await seedNumber();
    const outcome = await deliver(
      accountUpdate(FAKE_WABA_ID, {
        event: "PARTNER_REMOVED",
        phone_number: "972500000009",
        disconnection_info: { reason: "PRIMARY_INACTIVITY", initiated_by: "SYSTEM" },
      }),
    );
    expect(outcome).toMatchObject({ status: "processed", accountEvents: 1 });
    expect(await db.waNumber.findFirstOrThrow()).toMatchObject({ status: "ERROR", lastError: "partner_removed:PRIMARY_INACTIVITY" });
  });

  it("הסיבה של Meta מחליפה תקלה כללית שהבדיקה כבר רשמה", async () => {
    await seedNumber({ status: "ERROR", lastError: "subscription_lost" });
    await applyAccountUpdate({ wabaId: FAKE_WABA_ID, event: "PARTNER_REMOVED", phoneNumber: null, reason: "CHANGE_NUMBER" });
    expect((await db.waNumber.findFirstOrThrow()).lastError).toBe("partner_removed:CHANGE_NUMBER");
  });

  it("ACCOUNT_OFFBOARDED — 'תקלה' בלי סיבה", async () => {
    await seedNumber();
    await applyAccountUpdate({ wabaId: FAKE_WABA_ID, event: "ACCOUNT_OFFBOARDED", phoneNumber: null, reason: null });
    expect((await db.waNumber.findFirstOrThrow()).lastError).toBe("partner_removed");
  });

  it("חשבון של מערכת אחרת, מספר אחר, או אירוע שאינו ניתוק — אינם נוגעים בדבר", async () => {
    await seedNumber();
    await expect(
      applyAccountUpdate({ wabaId: "999", event: "PARTNER_REMOVED", phoneNumber: null, reason: null }),
    ).resolves.toBe("ignored");
    await expect(
      applyAccountUpdate({ wabaId: FAKE_WABA_ID, event: "PARTNER_REMOVED", phoneNumber: "15550000000", reason: null }),
    ).resolves.toBe("ignored");
    await expect(
      applyAccountUpdate({ wabaId: FAKE_WABA_ID, event: "ACCOUNT_RECONNECTED", phoneNumber: null, reason: null }),
    ).resolves.toBe("ignored");
    expect((await db.waNumber.findFirstOrThrow()).status).toBe("CONNECTED");
  });
});

// ─────────────────────────────── תבניות והודעת בדיקה ───────────────────────────────

describe("WA-S17-04 — תבניות הודעה", () => {
  it("הרשימה מ-Meta, ותבנית הבדיקה מסומנת כחסרה", async () => {
    await seedNumber();
    const api = healthyMeta({
      state: { templates: [{ id: "1", name: "other_template", language: "en_US", category: "MARKETING", status: "APPROVED" }] },
    });
    await expect(listWhatsappTemplates(admin, { api })).resolves.toEqual({
      ok: true,
      templates: api.state.templates,
      missing: [TEST_TEMPLATE.name],
    });
  });

  it("'צור את תבנית הבדיקה' — נוצרת רק החסרה, בנוסח מהאפיון; לחיצה שנייה אינה יוצרת כפולה", async () => {
    await seedNumber();
    const api = healthyMeta();
    await createWhatsappSystemTemplates(admin, { api });
    await createWhatsappSystemTemplates(admin, { api });

    const created = api.calls.filter((call) => call.method === "createTemplate");
    expect(created).toHaveLength(1);
    expect(created[0].args[2]).toEqual({
      name: "connection_test_v1",
      language: "he",
      category: "UTILITY",
      body: he.whatsappAdmin.testTemplateBody,
    });
    expect(api.state.templates[0].status).toBe("PENDING");
  });

  it("Meta אינה זמינה, או שאין מספר מחובר — 'לא ניתן לטעון', בלי להפיל את המסך", async () => {
    await seedNumber();
    const down = healthyMeta({ fail: failWith("listTemplates", new WaApiError("down", "transient")) });
    await expect(listWhatsappTemplates(admin, { api: down })).resolves.toEqual({ ok: false, reason: "unavailable" });

    await db.waNumber.updateMany({ data: { status: "DISCONNECTED" } });
    await expect(listWhatsappTemplates(admin, { api: healthyMeta() })).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("WA-S17-05 — שלח הודעת בדיקה", () => {
  const template = (status: string) => ({ id: "1", name: TEST_TEMPLATE.name, language: "he", category: "UTILITY", status });

  it("תבנית הבדיקה חסרה — הודעה שאומרת מה לעשות, ושום דבר לא נשלח", async () => {
    await seedNumber();
    const api = healthyMeta();
    await expect(sendWhatsappTestMessage(admin, { api })).rejects.toThrow(he.whatsappAdmin.testTemplateMissing);
    expect(api.sent).toEqual([]);
  });

  it("התבנית ממתינה לאישור — המצב במילים", async () => {
    await seedNumber();
    const api = healthyMeta({ state: { templates: [template("PENDING")] } });
    await expect(sendWhatsappTestMessage(admin, { api })).rejects.toThrow(
      he.whatsappAdmin.testTemplateNotApproved("ממתינה לאישור"),
    );
    expect(api.sent).toEqual([]);
  });

  it("תבנית מאושרת — נשלחת לטלפון של מנהל המערכת, ונרשמת כשורה יוצאת שהסטטוסים יחולו עליה", async () => {
    const number = await seedNumber();
    const api = healthyMeta({ state: { templates: [template("APPROVED")] } });
    await expect(sendWhatsappTestMessage(admin, { api, now: NOW })).resolves.toEqual({ phone: "0500000001" });

    expect(api.sent).toEqual([
      {
        phoneNumberId: FAKE_PHONE_NUMBER_ID,
        body: { to: "972500000001", type: "template", template: { name: "connection_test_v1", language: { code: "he" } } },
        wamid: "wamid.test-1",
      },
    ]);
    expect(await db.waMessage.findFirstOrThrow()).toMatchObject({
      direction: "OUTBOUND",
      state: "SENT",
      numberId: number.id,
      wamid: "wamid.test-1",
      type: "template",
      authorUserId: admin.id,
      sentAt: NOW,
    });
  });

  it("Meta דחתה את השליחה — השגיאה שלה במילים", async () => {
    await seedNumber();
    const api = healthyMeta({
      state: { templates: [template("APPROVED")] },
      fail: failWith("sendMessage", new WaApiError("Graph החזיר 400 (131031) — Business Account locked", "auth", { code: 131031 })),
    });
    await expect(sendWhatsappTestMessage(admin, { api })).rejects.toThrow(
      he.whatsappAdmin.testFailed("Graph החזיר 400 (131031) — Business Account locked"),
    );
    expect(await db.waMessage.count()).toBe(0);
  });

  it("אין מספר מחובר — 'אין מספר מחובר'", async () => {
    await expect(sendWhatsappTestMessage(admin, { api: healthyMeta() })).rejects.toThrow(errors.notConnected);
  });
});

// ─────────────────────────────── המסך ───────────────────────────────

describe("WA-S17-01 — מצב החיבור במסך", () => {
  it("בלי מספר — המסך יודע שאין, ומקבל את פרטי חלון החיבור", async () => {
    await expect(getWhatsappScreen(admin, NOW)).resolves.toEqual({
      signup: { appId: "app-1", configId: "config-1", graphVersion: "v25.0" },
      number: null,
      adminPhone: "0500000001",
    });
  });

  it("בלי תצורה — אין חלון חיבור", async () => {
    vi.stubEnv("WHATSAPP_CONFIG_ID", "");
    expect((await getWhatsappScreen(admin, NOW)).signup).toBeNull();
  });

  it("ההודעה האחרונה, השולחים שלא זוהו ב-30 יום, והודעת הבדיקה האחרונה עם מצב המסירה", async () => {
    const number = await seedNumber();
    const inbound = (createdAt: Date, outcome: "IGNORED_UNIDENTIFIED" | "IGNORED_UNAUTHORIZED", receivedAt: Date) =>
      db.waMessage.create({
        data: { direction: "INBOUND", state: "DONE", numberId: number.id, type: "text", outcome, receivedAt, createdAt },
      });
    await inbound(new Date(NOW.getTime() - 2 * HOUR), "IGNORED_UNIDENTIFIED", new Date(NOW.getTime() - 2 * HOUR));
    await inbound(new Date(NOW.getTime() - HOUR), "IGNORED_UNAUTHORIZED", new Date(NOW.getTime() - HOUR));
    await inbound(new Date(NOW.getTime() - 40 * 24 * HOUR), "IGNORED_UNIDENTIFIED", new Date(NOW.getTime() - 40 * 24 * HOUR));
    await db.waMessage.create({
      data: {
        direction: "OUTBOUND",
        state: "FAILED",
        numberId: number.id,
        type: "template",
        wamid: "wamid.t",
        errorCode: 131031,
        createdAt: new Date(NOW.getTime() - 3 * HOUR),
      },
    });

    const screen = await getWhatsappScreen(admin, NOW);
    expect(screen.number).toMatchObject({
      status: "CONNECTED",
      issue: null,
      syncPending: false,
      lastMessageAt: new Date(NOW.getTime() - HOUR),
      unidentified: 1,
      lastTest: { at: new Date(NOW.getTime() - 3 * HOUR), delivery: "failed", errorCode: 131031 },
    });
  });

  it("'תקלה' — הקוד מפוענח לנוסח; סנכרון פתוח — מסומן", async () => {
    await seedNumber({ status: "ERROR", lastError: "partner_removed:PRIMARY_INACTIVITY" });
    expect((await getWhatsappScreen(admin, NOW)).number?.issue).toEqual({ code: "partner_removed", reason: "PRIMARY_INACTIVITY" });

    await db.waNumber.updateMany({ data: { status: "CONNECTED", lastError: null, historySyncedAt: null } });
    expect((await getWhatsappScreen(admin, NOW)).number).toMatchObject({ issue: null, syncPending: true });
  });
});

// ─────────────────────────────── הג׳וב וה-watchdog ───────────────────────────────

describe("WA_HEALTH — ג׳וב שמתזמן את עצמו", () => {
  it("ממתין אחד בדיוק, בעוד 6 שעות", async () => {
    await ensureWaHealthScheduled(NOW);
    await ensureWaHealthScheduled(NOW);
    const jobs = await db.job.findMany({ where: { type: JOB_TYPES.waHealth } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "PENDING", runAt: new Date(NOW.getTime() + WA_HEALTH_INTERVAL_MS) });
  });

  it("'אין מספר מחובר' היא תשובה — הפעימה נרשמת", async () => {
    await expect(runWaHealth(NOW, { api: null })).resolves.toEqual({ kind: "wa-health", status: "no-number" });
    expect(await getHeartbeat(HEARTBEAT.waHealth)).toEqual(NOW);
  });
});

describe("watchdog — wa-subscription-intact", () => {
  const check = () => {
    const found = checks.find((candidate) => candidate.name === "wa-subscription-intact");
    if (!found) throw new Error("הבדיקה חסרה");
    return found;
  };

  it("אין מספר, או מספר שנותק בכוונה — עובר", async () => {
    await expect(check().run(NOW)).resolves.toBeUndefined();
    await seedNumber({ status: "DISCONNECTED", tokenCipher: null });
    await expect(check().run(NOW)).resolves.toBeUndefined();
  });

  it("מספר ב'תקלה' — זורק, עם הקוד", async () => {
    await seedNumber({ status: "ERROR", lastError: "token_revoked" });
    await expect(check().run(NOW)).rejects.toThrow("token_revoked");
  });

  it("מחובר ופעימה טרייה — עובר; פעימה בת 14 שעות — זורק", async () => {
    await seedNumber();
    await setHeartbeat(HEARTBEAT.waHealth, new Date(NOW.getTime() - 5 * HOUR));
    await expect(check().run(NOW)).resolves.toBeUndefined();

    await setHeartbeat(HEARTBEAT.waHealth, new Date(NOW.getTime() - 14 * HOUR));
    await expect(check().run(NOW)).rejects.toThrow("בדיקת חיבור הוואטסאפ");
  });
});
