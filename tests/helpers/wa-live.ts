import type { Transcriber } from "@/lib/ai/types";
import { AiRequestError, type AiErrorKind } from "@/lib/ai/gemini";
import { db } from "@/lib/db";
import type { WaIntakeDeps } from "@/lib/services/wa-intake";
import { BURST_QUIET_MS } from "@/lib/whatsapp/burst";
import { fakeFieldExtractor } from "./fake-field-extractor";
import { type FakeMedia, fakeWaApi } from "./fake-wa-api";

/**
 * העולם של בדיקות הקליטה בוואטסאפ במצב live (W6, W7): מספר מחובר, אתר עם בניין
 * ודירה, תחום ואיש מקצוע — וההודעות כפי ש-`wa-webhook.ts` משאיר אותן ביומן.
 *
 * וואטסאפ, מנוע התמלול והמחלץ מזויפים (`liveDeps`); בסיס הנתונים אמיתי.
 */

export const T0 = new Date("2026-10-05T10:00:00Z").getTime();
export const at = (ms: number) => new Date(T0 + ms);
export const SEC = 1000;
export const AFTER_QUIET = at(BURST_QUIET_MS);

export const SITE = "נווה שאנן";
export const BUILDING = "בניין א";
export const APARTMENT = "12";
export const DOMAIN = "אינסטלציה";
export const PRO = "יוסי כהן";

/** תמונה: חתימת JPEG ואחריה בתים — כך הסיווג מזהה אותה מהתוכן, כמו בקובץ אמיתי */
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("jpeg-bytes")]);
/** מסמך Word: חתימת ZIP (`docx`) */
export const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("docx-bytes")]);
/** הקלטה: התמלול המזויף קורא את מה שאחרי `VOICE:` */
export const voice = (said: string): FakeMedia => ({ bytes: Buffer.from(`VOICE:${said}`), mimeType: "audio/ogg" });

export interface WaWorld {
  numberId: string;
  siteId: string;
  buildingId: string;
  apartmentId: string;
  domainId: string;
  professionalId: string;
}

/** מונה למספרי טלפון ול-wamid ייחודיים — מתאפס עם העולם */
let seq = 0;

/** מקים את העולם. נקרא אחרי `resetDb()` בכל בדיקה. */
export async function seedWaWorld(): Promise<WaWorld> {
  seq = 0;
  const numberId = (
    await db.waNumber.create({
      data: { phoneNumberId: "300000000000002", wabaId: "1", displayPhone: "1", tokenCipher: "x", activatedAt: at(-3600 * SEC) },
    })
  ).id;
  const siteId = (await db.site.create({ data: { name: SITE } })).id;
  const buildingId = (await db.building.create({ data: { siteId, name: BUILDING } })).id;
  const apartmentId = (await db.apartment.create({ data: { buildingId, number: APARTMENT } })).id;
  const domainId = (await db.domain.create({ data: { name: DOMAIN } })).id;
  const professionalId = (await db.professional.create({ data: { name: PRO, phone: "0501110000" } })).id;
  return { numberId, siteId, buildingId, apartmentId, domainId, professionalId };
}

export interface WaUser {
  id: string;
  name: string;
  /** הטלפון כפי שוואטסאפ מוסרת אותו (`972…`) */
  waId: string;
}

/** משתמש מורשה לפתוח פניות בוואטסאפ (המתג דלוק כברירת מחדל) */
export async function makeWaUser(
  overrides: { role?: "ADMIN" | "SITE_MANAGER"; siteId?: string | null; name?: string } = {},
): Promise<WaUser> {
  const phone = `05000000${10 + seq++}`;
  const user = await db.user.create({
    data: { role: "ADMIN", name: overrides.name ?? "דנה כהן", phone, passwordHash: "x", ...overrides },
  });
  return { id: user.id, name: user.name, waId: `972${phone.slice(1)}` };
}

export interface InboundSpec {
  text?: string | null;
  media?: { id: string; mimeType: string; voice?: boolean; filename?: string };
  contextWamid?: string;
  forwarded?: boolean;
}

/** שורה ממתינה, כפי שהרישום משאיר הודעה של משתמש מורשה */
export async function inbound(world: WaWorld, user: WaUser, offsetMs: number, spec: InboundSpec) {
  const type = spec.media
    ? spec.media.voice
      ? "audio"
      : spec.media.mimeType.split("/")[0] === "image"
        ? "image"
        : "document"
    : "text";
  return db.waMessage.create({
    data: {
      direction: "INBOUND",
      state: "PENDING",
      numberId: world.numberId,
      authorUserId: user.id,
      waId: user.waId,
      type,
      text: spec.text ?? null,
      receivedAt: at(offsetMs),
      nextAttemptAt: at(offsetMs + BURST_QUIET_MS),
      wamid: `wamid.in-${seq++}`,
      contextWamid: spec.contextWamid ?? null,
      forwarded: spec.forwarded ?? false,
      ...(spec.media
        ? {
            media: {
              create: {
                waMediaId: spec.media.id,
                mimeType: spec.media.mimeType,
                filename: spec.media.filename ?? null,
                voice: spec.media.voice ?? false,
              },
            },
          }
        : {}),
    },
  });
}

/** מנוע תמלול מזויף: מחזיר את מה ש"נאמר" בהקלטה, ורושם כל קריאה */
export function fakeTranscriber(options: { fail?: AiErrorKind; failTimes?: number } = {}): Transcriber & { calls: number } {
  let remaining = options.fail ? (options.failTimes ?? Number.POSITIVE_INFINITY) : 0;
  const transcriber = {
    name: "fake",
    calls: 0,
    async transcribe(audio: Buffer) {
      transcriber.calls += 1;
      if (options.fail && remaining > 0) {
        remaining -= 1;
        throw new AiRequestError(`תמלול נכשל (${options.fail})`, options.fail);
      }
      return audio.toString("utf8").replace(/^VOICE:/, "");
    },
  };
  return transcriber;
}

/** "תקלה" עם כל הפרטים, כתובים מילולית — שומר ההזיה בודק שהם בטקסט */
export const FULL_REPORT = `תקלה בדירה ${APARTMENT}, ${BUILDING}, באתר ${SITE}. התחום ${DOMAIN}, לשלוח את ${PRO}`;
export const FULL_EXTRACTION = {
  site: SITE,
  building: BUILDING,
  apartment: APARTMENT,
  domain: DOMAIN,
  description: "נזילה מהתקרה",
  recipientsAdd: [PRO],
} as const;

/**
 * התלויות של מצב live: וואטסאפ, מחלץ ותמלול מזויפים.
 *
 * **הזיופים שמוחזרים הם ברירות המחדל.** מי שמחליף אחד מהם (`extractor`, `api`…)
 * מחזיק את שלו ובודק אותו — `extractor` שחוזר מכאן אז אינו זה שרץ.
 */
export function liveDeps(overrides: Partial<WaIntakeDeps> & { media?: Record<string, FakeMedia> } = {}) {
  const { media, ...rest } = overrides;
  const api = fakeWaApi({ media: media ?? {} });
  const extractor = fakeFieldExtractor({ result: FULL_EXTRACTION });
  const transcriber = fakeTranscriber();
  const deps: WaIntakeDeps = { mode: "live", api, extractor, transcriber, ...rest };
  return { deps, api, extractor, transcriber };
}

export async function rowOf(id: string) {
  return db.waMessage.findUniqueOrThrow({ where: { id }, include: { media: true } });
}
