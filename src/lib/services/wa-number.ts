import { UserFacingError } from "@/lib/action-result";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { he } from "@/lib/he";
import { toWhatsAppNumber } from "@/lib/notifier/wa-share";
import { captureError, logInfo, logWarn } from "@/lib/observability/log";
import type { SessionUser } from "@/lib/session";
import {
  type WaAccountApi,
  type WaPhoneNumberInfo,
  type WaTemplateInfo,
  graphWaAccountApi,
} from "@/lib/whatsapp/account";
import { type WaIssue, decodeIssue, encodeIssue } from "@/lib/whatsapp/connection-issue";
import { WaApiError } from "@/lib/whatsapp/errors";
import type { WaAccountEvent } from "@/lib/whatsapp/webhook";
import { SYSTEM_TEMPLATES, TEST_TEMPLATE } from "@/lib/whatsapp/system-templates";
import { openWaToken, sealWaToken } from "@/lib/whatsapp/token";
import { assertAdmin } from "./admin";

/**
 * המספר העסקי המחובר — מסך 17 (אפיון 1.4): חיבור, ניתוק, בדיקה תקופתית,
 * תבניות והודעת בדיקה.
 *
 * **מספר אחד בלבד.** הכלל נאכף כאן ולא בסכימה (`WaNumber`), כדי שמעבר לכמה
 * מספרים לא ידרוש מיגרציה: חיבור נדחה כשמספר אחר מחובר, וחיבור במקום מספר
 * ב"תקלה" מנתק את הקודם באותה טרנזאקציה.
 *
 * **הטוקן גלוי רק בזיכרון.** הוא נשמר מוצפן (`sealWaToken`), מפוענח ממש לפני
 * בקשה ל-Graph, ואינו נכנס ללוג, להודעת שגיאה או ל-Sentry. "נתק" מוחק אותו.
 *
 * **הקובץ היחיד ששולח תבנית** (`scope-boundaries.test.ts` SC-OUT-01): בגרסה 1.4
 * אין שליחה יזומה, והתבנית היחידה שיוצאת היא הודעת הבדיקה של מסך 17.
 */

export class WaNumberError extends UserFacingError {}

export interface WaNumberDeps {
  /** מוזרק בבדיקות. בלעדיו — לפי התצורה; `null` מפורש — "החיבור אינו מוגדר". */
  api?: WaAccountApi | null;
  now?: Date;
}

/** כמה זמן Meta נותנת לסנכרון שהחיבור מחייב, לפני שהיא מבטלת אותו */
export const SYNC_WINDOW_MS = 24 * 60 * 60_000;

/** החלון של ספירת השולחים שלא זוהו במסך 17 (§2.7 שלב 2) */
const UNIDENTIFIED_WINDOW_MS = 30 * 24 * 60 * 60_000;

/** ה-API של ניהול החיבור לפי התצורה, או null כשהיא חסרה */
export function selectWaAccountApi(): WaAccountApi | null {
  const app = env.whatsapp();
  const signup = env.whatsappSignup();
  if (!app || !signup) return null;
  return graphWaAccountApi({ appId: signup.appId, appSecret: app.appSecret, version: app.graphVersion });
}

/**
 * הכתובת שאליה Meta תשלח את ההודעות של המספר (`override_callback_uri`).
 *
 * נגזרת מ-`APP_BASE_URL`, ולכן מעבר לדומיין אחר מתגלה בבדיקה התקופתית כמנוי
 * "שהופנה למקום אחר" ומחייב חיבור מחדש — וזה נכון: Meta ממשיכה לשלוח לכתובת
 * הישנה. **HTTPS בלבד**: Meta אינה שולחת לכתובת אחרת, ובפיתוח זו כתובת המנהרה.
 */
export function webhookCallbackUrl(): string | null {
  const base = env.appBaseUrl().replace(/\/+$/, "");
  if (!base.startsWith("https://")) return null;
  return `${base}/api/whatsapp/webhook`;
}

function resolveApi(deps: WaNumberDeps): WaAccountApi | null {
  return deps.api === undefined ? selectWaAccountApi() : deps.api;
}

// ─────────────────────────────── חיבור ───────────────────────────────

/** מה שחלון החיבור מסר, והקוד מה-callback של `FB.login` */
export interface ConnectInput {
  code: string;
  wabaId: string;
  phoneNumberId: string | null;
  /** החלון דיווח שהמספר נשאר באפליקציה בטלפון (`FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`) */
  coexistence: boolean;
}

/**
 * "חבר מספר" (מסך 17): הקוד שחלון החיבור החזיר → טוקן → המספר → מנוי → שמירה →
 * סנכרון.
 *
 * **הסדר קובע מה נשאר כשמשהו נכשל.** עד המנוי לא נכתב דבר — חיבור שנכשל באמצע
 * משאיר את המסך כפי שהיה. המנוי קודם לשמירה, כי מספר שנשמר "מחובר" בלי שההודעות
 * שלו מגיעות הוא בדיוק השקט שהמסך קיים כדי למנוע. הסנכרון אחרון, ובמאמץ סביר:
 * כשהוא נכשל הבדיקה התקופתית משלימה אותו בתוך 24 השעות של Meta.
 */
export async function connectWhatsappNumber(
  actor: SessionUser,
  input: ConnectInput,
  deps: WaNumberDeps = {},
): Promise<{ displayPhone: string }> {
  assertAdmin(actor);
  const api = resolveApi(deps);
  const app = env.whatsapp();
  const callbackUri = webhookCallbackUrl();
  if (!api || !app) throw new WaNumberError(he.whatsappAdmin.errors.notConfigured);
  if (!callbackUri) {
    logWarn("wa.number.callback_not_https", {});
    throw new WaNumberError(he.whatsappAdmin.errors.notConfigured);
  }
  if (!input.coexistence) throw new WaNumberError(he.whatsappAdmin.errors.notCoexistence);

  const connected = await db.waNumber.findFirst({ where: { status: "CONNECTED" }, select: { id: true } });
  if (connected) throw new WaNumberError(he.whatsappAdmin.errors.alreadyConnected);

  // הקוד תקף 30 שניות — ולכן ההחלפה ראשונה, לפני כל בדיקה שאינה דורשת אותו
  const token = await orExchangeFailed("exchange", () => api.exchangeCode(input.code));
  const tokenInfo = await orExchangeFailed("inspect", () => api.inspectToken(token));
  if (!tokenInfo.valid || !tokenInfo.managedWabaIds.includes(input.wabaId)) {
    // החשבון שהדף מסר אינו בין מה שהטוקן מנהל: הודעה שזויפה, או חלון שנסגר באמצע
    logWarn("wa.number.token_scope_mismatch", { valid: tokenInfo.valid });
    throw new WaNumberError(he.whatsappAdmin.errors.exchangeFailed);
  }
  if (tokenInfo.expiresAt) {
    // הקונפיגורציה של Embedded Signup אמורה להנפיק טוקן שאינו פג. טוקן שפג יתגלה
    // בבדיקה התקופתית כ"ההרשאה בוטלה" — עדיף שהמפתח יידע עכשיו.
    captureError(new Error(`טוקן החיבור לוואטסאפ פג ב-${tokenInfo.expiresAt.toISOString()}`), {
      fingerprint: ["wa-token-expires"],
      level: "warning",
    });
  }

  const numbers = await orExchangeFailed("phone-numbers", () => api.listPhoneNumbers(token, input.wabaId));
  const number = pickConnectedNumber(numbers, input.phoneNumberId);
  if (!number) throw new WaNumberError(he.whatsappAdmin.errors.numberNotIdentified);
  if (!number.onBusinessApp) throw new WaNumberError(he.whatsappAdmin.errors.notCoexistence);

  try {
    await api.subscribe(token, input.wabaId, { callbackUri, verifyToken: app.verifyToken });
  } catch (error) {
    if (!(error instanceof WaApiError)) throw error;
    if (error.kind === "transient") throw new WaNumberError(he.whatsappAdmin.errors.exchangeFailed);
    // Meta דחתה את הכתובת — לרוב אימות ה-webhook שלנו נכשל. ניסיון חוזר לא יעזור.
    captureError(error, { fingerprint: ["wa-subscribe-rejected"] });
    throw new WaNumberError(he.whatsappAdmin.errors.subscribeRejected);
  }

  const now = deps.now ?? new Date();
  const tokenCipher = sealWaToken(token);
  const fields = {
    wabaId: input.wabaId,
    displayPhone: number.displayPhone,
    verifiedName: number.verifiedName,
    tokenCipher,
    coexistence: true,
    status: "CONNECTED" as const,
    // **כל חיבור, גם חוזר, קובע מחדש את הרצפה** (מסך 17, §7 שורה 103)
    activatedAt: now,
    connectedAt: now,
    connectedById: actor.id,
    contactsSyncedAt: null,
    historySyncedAt: null,
    lastError: null,
  };
  const saved = await db.$transaction(async (tx) => {
    // מספר אחד: הקודם — שהיה ב"תקלה" — מתנתק, ואינו מחזיק עוד טוקן
    await tx.waNumber.updateMany({
      where: { status: { not: "DISCONNECTED" }, phoneNumberId: { not: number.id } },
      data: { status: "DISCONNECTED", tokenCipher: null },
    });
    return tx.waNumber.upsert({
      where: { phoneNumberId: number.id },
      create: { phoneNumberId: number.id, ...fields },
      update: fields,
      select: { id: true },
    });
  });
  logInfo("wa.number.connected", { numberId: saved.id, actorId: actor.id });

  await syncPending({ id: saved.id, phoneNumberId: number.id, contactsSyncedAt: null, historySyncedAt: null }, api, token, now);
  return { displayPhone: number.displayPhone };
}

/**
 * איזה מספר חובר. בחיבור מהאפליקציה בטלפון החלון מוסר רק את החשבון, ולכן
 * המספר הוא היחיד בחשבון שפועל באפליקציה. כשיש כמה — אין דרך לדעת איזה, וזה
 * נאמר במקום לנחש (מסך 17).
 */
export function pickConnectedNumber(
  numbers: readonly WaPhoneNumberInfo[],
  phoneNumberId: string | null,
): WaPhoneNumberInfo | null {
  if (phoneNumberId) return numbers.find((number) => number.id === phoneNumberId) ?? null;
  const onApp = numbers.filter((number) => number.onBusinessApp);
  return onApp.length === 1 ? onApp[0] : null;
}

/** כשל מול Meta בשלבי ההחלפה — "לא ניתן היה להשלים". באג נזרק כמו שהוא. */
async function orExchangeFailed<T>(step: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof WaApiError)) throw error;
    logWarn("wa.number.connect_failed", { step, kind: error.kind, code: error.code ?? null });
    throw new WaNumberError(he.whatsappAdmin.errors.exchangeFailed);
  }
}

// ─────────────────────────────── סנכרון ───────────────────────────────

interface SyncTarget {
  id: string;
  phoneNumberId: string;
  contactsSyncedAt: Date | null;
  historySyncedAt: Date | null;
}

/**
 * הסנכרון שחיבור מהאפליקציה מחייב: אנשי הקשר, ואחריהם ההיסטוריה — בסדר הזה,
 * כמו שהתיעוד של Meta קובע. ההיסטוריה עצמה אינה נקלטת (§7 שורה 101).
 *
 * **כשל חולף משאיר את הסנכרון פתוח**, והבדיקה התקופתית תנסה שוב. **כשל קבוע
 * נרשם כמבוצע** ומדווח ל-Sentry: הבקשה אפשרית פעם אחת לכל סוג, ותשובה "כבר
 * בוצע" — אחרי שהשמירה שלנו נכשלה — הייתה מסמנת תקלה של 24 שעות על חיבור תקין.
 * מספר שהסנכרון שלו באמת לא בוצע יתנתק אצל Meta, והבדיקה תגלה את הניתוק.
 */
async function syncPending(target: SyncTarget, api: WaAccountApi, token: string, now: Date): Promise<void> {
  const steps = [
    { kind: "smb_app_state_sync" as const, field: "contactsSyncedAt" as const, done: target.contactsSyncedAt },
    { kind: "history" as const, field: "historySyncedAt" as const, done: target.historySyncedAt },
  ];
  for (const step of steps) {
    if (step.done) continue;
    try {
      await api.requestSync(token, target.phoneNumberId, step.kind);
    } catch (error) {
      if (!(error instanceof WaApiError)) throw error;
      if (error.kind === "transient" || error.kind === "auth") {
        logWarn("wa.number.sync_deferred", { numberId: target.id, sync: step.kind, kind: error.kind });
        return; // ההיסטוריה רק אחרי אנשי הקשר
      }
      captureError(error, { fingerprint: ["wa-sync-rejected", step.kind], level: "warning" });
    }
    await db.waNumber.update({ where: { id: target.id }, data: { [step.field]: now } });
    logInfo("wa.number.synced", { numberId: target.id, sync: step.kind });
  }
}

// ─────────────────────────────── ניתוק ───────────────────────────────

/**
 * "נתק" (מסך 17): ביטול המנוי של המערכת אצל Meta, ואז מצב "מנותק" בלי טוקן.
 *
 * **כש-Meta אינה זמינה דבר אינו משתנה** — אחרת המספר היה נראה מנותק כאן
 * וממשיך לשלוח אלינו שם. כשהטוקן כבר אינו תקף, או שהמנוי כבר אינו קיים, אין
 * מה לבטל: הניתוק המקומי מתבצע, ונרשם בלוג.
 */
export async function disconnectWhatsappNumber(actor: SessionUser, deps: WaNumberDeps = {}): Promise<void> {
  assertAdmin(actor);
  const number = await db.waNumber.findFirst({
    where: { status: { not: "DISCONNECTED" } },
    orderBy: { connectedAt: "desc" },
    select: { id: true, wabaId: true, tokenCipher: true },
  });
  if (!number) return; // כבר מנותק — מסך שלא עודכן, לחיצה כפולה

  const api = resolveApi(deps);
  const token = number.tokenCipher ? openWaToken(number.tokenCipher) : null;
  if (api && token) {
    try {
      await api.unsubscribe(token, number.wabaId);
    } catch (error) {
      if (!(error instanceof WaApiError)) throw error;
      if (error.kind === "transient") throw new WaNumberError(he.whatsappAdmin.errors.disconnectUnavailable);
      logWarn("wa.number.unsubscribe_failed", { numberId: number.id, kind: error.kind, code: error.code ?? null });
    }
  } else {
    logWarn("wa.number.unsubscribe_skipped", { numberId: number.id, reason: api ? "no-token" : "not-configured" });
  }

  await db.waNumber.update({
    where: { id: number.id },
    data: { status: "DISCONNECTED", tokenCipher: null, lastError: null },
  });
  logInfo("wa.number.disconnected", { numberId: number.id, actorId: actor.id });
}

// ─────────────────────────────── בדיקה תקופתית ───────────────────────────────

export type WaHealthOutcome = { kind: "wa-health" } & (
  | { status: "no-number" }
  | { status: "not-configured" }
  /** Meta לא ענתה — המצב לא השתנה, והפעימה אינה נרשמת */
  | { status: "unreachable" }
  | { status: "ok"; synced: boolean }
  | { status: "issue"; issue: WaIssue["code"] }
);

/**
 * הבדיקה התקופתית (ג׳וב `WA_HEALTH`, כל 6 שעות) — **היא שמגלה ניתוק**, כי
 * הודעת הניתוק של Meta אינה מגיעה לכתובת שלנו (§7 שורה 109).
 *
 * שלוש שאלות, לפי הסדר: האפליקציה שלנו עדיין מנויה, וההודעות נשלחות לכתובת
 * שלנו? המספר עדיין קיים, ועדיין באפליקציה בטלפון? והסנכרון — הושלם, או
 * שעוד יש זמן להשלים אותו? תשובה שלילית הופכת את המצב ל"תקלה" עם הקוד שלה.
 */
export async function checkWhatsappConnection(deps: WaNumberDeps = {}): Promise<WaHealthOutcome> {
  const kind = "wa-health" as const;
  const now = deps.now ?? new Date();
  const number = await db.waNumber.findFirst({
    where: { status: "CONNECTED" },
    orderBy: { connectedAt: "desc" },
    select: {
      id: true,
      phoneNumberId: true,
      wabaId: true,
      tokenCipher: true,
      coexistence: true,
      activatedAt: true,
      displayPhone: true,
      verifiedName: true,
      contactsSyncedAt: true,
      historySyncedAt: true,
    },
  });
  if (!number) return { kind, status: "no-number" };

  const api = resolveApi(deps);
  if (!api) {
    logWarn("wa.health.not_configured", { numberId: number.id });
    return { kind, status: "not-configured" };
  }

  const token = number.tokenCipher ? openWaToken(number.tokenCipher) : null;
  if (!token) return reportIssue(number.id, { code: "token_unreadable" });

  try {
    const subscription = await api.getSubscription(token, number.wabaId);
    if (!subscription || subscription.callbackUri !== webhookCallbackUrl()) {
      return reportIssue(number.id, { code: "subscription_lost" });
    }

    const info = await api.getPhoneNumber(token, number.phoneNumberId);
    if (number.coexistence && !info.onBusinessApp) return reportIssue(number.id, { code: "not_on_app" });
    if (info.displayPhone !== number.displayPhone || info.verifiedName !== number.verifiedName) {
      // השם העסקי משתנה אצל Meta (אישור שם חדש) — המסך מציג את מה שמוצג בוואטסאפ
      await db.waNumber.update({
        where: { id: number.id },
        data: { displayPhone: info.displayPhone || number.displayPhone, verifiedName: info.verifiedName },
      });
    }

    const syncOpen = number.coexistence && (!number.contactsSyncedAt || !number.historySyncedAt);
    if (syncOpen) {
      if (now.getTime() - number.activatedAt.getTime() > SYNC_WINDOW_MS) {
        return reportIssue(number.id, { code: "sync_overdue" });
      }
      await syncPending(number, api, token, now);
    }
    return { kind, status: "ok", synced: syncOpen };
  } catch (error) {
    if (!(error instanceof WaApiError)) throw error;
    if (error.kind === "auth") return reportIssue(number.id, { code: "token_revoked" });
    if (error.kind === "not_found") return reportIssue(number.id, { code: "number_missing" });
    logWarn("wa.health.unreachable", { numberId: number.id, kind: error.kind, code: error.code ?? null });
    return { kind, status: "unreachable" };
  }
}

/**
 * מצב "תקלה" עם הקוד שלה. **Sentry רק במעבר** — מספר שכבר בתקלה נשאר בה עד
 * חיבור מחדש, וה-watchdog (`wa-subscription-intact`) מתריע עליו בכל סבב.
 */
async function reportIssue(
  numberId: string,
  issue: WaIssue,
  options: { replaceIssue?: boolean } = {},
): Promise<WaHealthOutcome> {
  const changed = await db.waNumber.updateMany({
    where: { id: numberId, status: "CONNECTED" },
    data: { status: "ERROR", lastError: encodeIssue(issue) },
  });
  if (changed.count === 0 && options.replaceIssue) {
    // הודעת הניתוק של Meta מפורטת מכל מה שהבדיקה מסיקה ("המנוי הוסר"), ולכן היא
    // מחליפה תקלה שכבר נרשמה: "לא נפתחה 14 יום" אומר למנהל מה לעשות בטלפון.
    await db.waNumber.updateMany({ where: { id: numberId, status: "ERROR" }, data: { lastError: encodeIssue(issue) } });
  }
  if (changed.count > 0) {
    logWarn("wa.number.issue", { numberId, issue: issue.code });
    captureError(new Error(`חיבור הוואטסאפ עבר למצב תקלה: ${encodeIssue(issue)}`), {
      fingerprint: ["wa-connection-issue", issue.code],
      level: "warning",
    });
  }
  return { kind: "wa-health", status: "issue", issue: issue.code };
}

/**
 * אירוע חשבון מה-webhook (`account_update`) — כשהוא בכל זאת מגיע. הניתוק מהטלפון
 * הופך את המספר ל"תקלה" עם הסיבה שבאירוע; אירועים אחרים נרשמים בלוג בלבד.
 *
 * **הניתוב לפי ה-WABA**, ובנוסף לפי המספר כשהוא נמסר: אפליקציית Meta משותפת לכמה
 * מערכות, ואירוע של חשבון שאינו שלנו אינו נוגע בדבר.
 */
export async function applyAccountUpdate(account: WaAccountEvent): Promise<"applied" | "ignored"> {
  const numbers = await db.waNumber.findMany({
    where: { wabaId: account.wabaId, status: { not: "DISCONNECTED" } },
    select: { id: true, displayPhone: true },
  });
  const digits = (value: string) => value.replace(/\D/g, "");
  const number = account.phoneNumber
    ? numbers.find((candidate) => digits(candidate.displayPhone) === digits(account.phoneNumber ?? ""))
    : numbers[0];
  if (!number) return "ignored";

  if (account.event === "PARTNER_REMOVED" || account.event === "ACCOUNT_OFFBOARDED") {
    await reportIssue(
      number.id,
      { code: "partner_removed", reason: account.event === "PARTNER_REMOVED" ? account.reason : null },
      { replaceIssue: true },
    );
    return "applied";
  }
  logInfo("wa.number.account_event", { numberId: number.id, event: account.event });
  return "ignored";
}

// ─────────────────────────────── תבניות ───────────────────────────────

/** המספר המחובר, הטוקן שלו וה-API — או הודעה שאומרת למה אין */
async function requireConnected(deps: WaNumberDeps) {
  const api = resolveApi(deps);
  if (!api) throw new WaNumberError(he.whatsappAdmin.errors.notConfigured);
  const number = await db.waNumber.findFirst({
    where: { status: "CONNECTED" },
    orderBy: { connectedAt: "desc" },
    select: { id: true, phoneNumberId: true, wabaId: true, tokenCipher: true },
  });
  if (!number) throw new WaNumberError(he.whatsappAdmin.errors.notConnected);
  const token = number.tokenCipher ? openWaToken(number.tokenCipher) : null;
  if (!token) {
    await reportIssue(number.id, { code: "token_unreadable" });
    throw new WaNumberError(he.whatsappAdmin.issue.token_unreadable);
  }
  return { api, number, token };
}

export type TemplatesView =
  | { ok: true; templates: WaTemplateInfo[]; missing: string[] }
  | { ok: false; reason: "unavailable" };

/**
 * רשימת התבניות בחשבון, ואילו מתבניות המערכת חסרות בה. נקראת בזמן הרינדור,
 * ולכן כשל מחזיר "לא זמין" ואינו מפיל את המסך.
 */
export async function listWhatsappTemplates(actor: SessionUser, deps: WaNumberDeps = {}): Promise<TemplatesView> {
  assertAdmin(actor);
  try {
    const { api, number, token } = await requireConnected(deps);
    const templates = await api.listTemplates(token, number.wabaId);
    return { ok: true, templates, missing: missingSystemTemplates(templates) };
  } catch (error) {
    if (!(error instanceof WaApiError) && !(error instanceof WaNumberError)) throw error;
    logWarn("wa.templates.unavailable", { reason: error instanceof WaApiError ? error.kind : "no-number" });
    return { ok: false, reason: "unavailable" };
  }
}

export function missingSystemTemplates(templates: readonly WaTemplateInfo[]): string[] {
  return SYSTEM_TEMPLATES.filter(
    (system) => !templates.some((t) => t.name === system.name && t.language === system.language),
  ).map((system) => system.name);
}

/** "צור את תבנית הבדיקה" — יוצר את תבניות המערכת שחסרות בחשבון */
export async function createWhatsappSystemTemplates(actor: SessionUser, deps: WaNumberDeps = {}): Promise<void> {
  assertAdmin(actor);
  const { api, number, token } = await requireConnected(deps);
  try {
    const missing = new Set(missingSystemTemplates(await api.listTemplates(token, number.wabaId)));
    for (const template of SYSTEM_TEMPLATES) {
      if (!missing.has(template.name)) continue;
      const created = await api.createTemplate(token, number.wabaId, template);
      logInfo("wa.templates.created", { name: template.name, status: created.status });
    }
  } catch (error) {
    if (!(error instanceof WaApiError)) throw error;
    throw new WaNumberError(he.whatsappAdmin.templateCreateFailed(error.message));
  }
}

// ─────────────────────────────── הודעת בדיקה ───────────────────────────────

/**
 * "שלח הודעת בדיקה" (מסך 17) — תבנית הבדיקה לטלפון של מנהל המערכת המחובר.
 *
 * **תבנית ולא טקסט:** מחוץ לחלון 24 השעות וואטסאפ מתירה רק תבנית מאושרת (§7
 * שורה 111). ההודעה נרשמת כשורה יוצאת, ולכן הסטטוסים של Meta — נמסרה, נקראה, לא
 * נמסרה — מתעדכנים עליה כמו על כל הודעה שלנו, והמסך מציג אותם: אישור של ה-API
 * לבדו אינו אומר שההודעה הגיעה (בספייק של W0 הודעה התקבלה ב-200 ונכשלה אחר כך).
 */
export async function sendWhatsappTestMessage(
  actor: SessionUser,
  deps: WaNumberDeps = {},
): Promise<{ phone: string }> {
  assertAdmin(actor);
  const { api, number, token } = await requireConnected(deps);
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id }, select: { phone: true } });
  const to = toWhatsAppNumber(user.phone);
  if (!to) throw new WaNumberError(he.whatsappAdmin.testFailed(he.whatsappAdmin.adminPhoneInvalid));

  let wamid: string;
  try {
    const templates = await api.listTemplates(token, number.wabaId);
    const test = templates.find((t) => t.name === TEST_TEMPLATE.name && t.language === TEST_TEMPLATE.language);
    if (!test) throw new WaNumberError(he.whatsappAdmin.testTemplateMissing);
    if (test.status !== "APPROVED") {
      const status = he.whatsappAdmin.templateStatus[test.status] ?? test.status;
      throw new WaNumberError(he.whatsappAdmin.testTemplateNotApproved(status));
    }
    ({ wamid } = await api.sendMessage(token, number.phoneNumberId, {
      to,
      type: "template",
      template: { name: TEST_TEMPLATE.name, language: { code: TEST_TEMPLATE.language } },
    }));
  } catch (error) {
    if (!(error instanceof WaApiError)) throw error;
    throw new WaNumberError(he.whatsappAdmin.testFailed(error.message));
  }

  await db.waMessage.create({
    data: {
      direction: "OUTBOUND",
      state: "SENT",
      numberId: number.id,
      wamid,
      waId: to,
      type: "template",
      text: TEST_TEMPLATE.body,
      authorUserId: actor.id,
      sentAt: deps.now ?? new Date(),
    },
  });
  logInfo("wa.number.test_sent", { numberId: number.id, actorId: actor.id });
  return { phone: user.phone };
}

// ─────────────────────────────── המסך ───────────────────────────────

export type TestDelivery = "sent" | "delivered" | "read" | "failed";

export interface WhatsappScreen {
  /** פרטי חלון החיבור לדפדפן, או null כשהחיבור אינו מוגדר בשרת */
  signup: { appId: string; configId: string; graphVersion: string } | null;
  number: {
    displayPhone: string;
    verifiedName: string | null;
    status: "CONNECTED" | "DISCONNECTED" | "ERROR";
    issue: WaIssue | null;
    syncPending: boolean;
    lastMessageAt: Date | null;
    unidentified: number;
    lastTest: { at: Date; delivery: TestDelivery; errorCode: number | null } | null;
  } | null;
  /** הטלפון של מנהל המערכת — הנמען של הודעת הבדיקה */
  adminPhone: string;
}

/** מה שמסך 17 מציג — מהבסיס בלבד, בלי פנייה ל-Meta (התבניות נטענות בנפרד) */
export async function getWhatsappScreen(actor: SessionUser, now: Date = new Date()): Promise<WhatsappScreen> {
  assertAdmin(actor);
  const app = env.whatsapp();
  const signup = env.whatsappSignup();
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id }, select: { phone: true } });

  const row = await db.waNumber.findFirst({
    orderBy: { connectedAt: "desc" },
    select: {
      id: true,
      displayPhone: true,
      verifiedName: true,
      status: true,
      lastError: true,
      coexistence: true,
      contactsSyncedAt: true,
      historySyncedAt: true,
    },
  });

  let number: WhatsappScreen["number"] = null;
  if (row) {
    const [lastInbound, lastTest, unidentified] = await Promise.all([
      db.waMessage.findFirst({
        where: { numberId: row.id, direction: "INBOUND" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      db.waMessage.findFirst({
        where: { numberId: row.id, direction: "OUTBOUND", type: "template" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, state: true, deliveredAt: true, readAt: true, errorCode: true },
      }),
      db.waMessage.count({
        where: {
          outcome: "IGNORED_UNIDENTIFIED",
          receivedAt: { gte: new Date(now.getTime() - UNIDENTIFIED_WINDOW_MS) },
        },
      }),
    ]);
    number = {
      displayPhone: row.displayPhone,
      verifiedName: row.verifiedName,
      status: row.status,
      issue: row.status === "ERROR" ? decodeIssue(row.lastError) : null,
      syncPending: row.status === "CONNECTED" && row.coexistence && (!row.contactsSyncedAt || !row.historySyncedAt),
      lastMessageAt: lastInbound?.createdAt ?? null,
      unidentified,
      lastTest: lastTest
        ? {
            at: lastTest.createdAt,
            delivery:
              lastTest.state === "FAILED"
                ? "failed"
                : lastTest.readAt
                  ? "read"
                  : lastTest.deliveredAt
                    ? "delivered"
                    : "sent",
            errorCode: lastTest.errorCode,
          }
        : null,
    };
  }

  return {
    signup: app && signup ? { appId: signup.appId, configId: signup.configId, graphVersion: app.graphVersion } : null,
    number,
    adminPhone: user.phone,
  };
}
