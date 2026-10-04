import { z } from "zod";

/**
 * פענוח משלוח webhook של וואטסאפ לפריטים שהצינור מבין.
 *
 * **הפענוח סובלני, והכשל שלו מפורש.** Meta מוסיפה סוגי הודעות ושדות בלי
 * הודעה מוקדמת, ולכן שדה שאינו מוכר נזרק בשקט וסוג שאינו מוכר עובר כמחרוזת
 * — הסולם מכריע עליו (`IGNORED_UNSUPPORTED`). אבל הודעה שאינה עומדת במבנה
 * המינימלי (אין מזהה, אין זמן) **אינה נעלמת**: היא חוזרת כפריט `invalid`
 * עם הסיבה, וה-route משאיר את הגוף הגולמי שמור עם השגיאה. משלוח שכולו אינו
 * עומד במבנה זורק `WebhookParseError` — מאותה סיבה.
 *
 * המבנה נמדד על משלוחים אמיתיים בספייק W0 (`tests/fixtures/whatsapp/`).
 */

export class WebhookParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookParseError";
  }
}

/** קובץ בהודעה נכנסת — רק מזהה; הכתובת להורדה פגה תוך דקות ואינה נשמרת */
export interface WaInboundMedia {
  mediaId: string;
  mimeType: string;
  /** sha256 בקידוד hex. ה-webhook מוסר base64 — ההמרה כאן, כדי שיהיה קידוד אחד. */
  sha256: string | null;
  filename: string | null;
  /** הקלטה קולית (`voice: true`), להבדיל מקובץ אודיו שצורף */
  voice: boolean;
}

export interface WaInboundMessage {
  phoneNumberId: string;
  wabaId: string;
  /** מזהה ההודעה. **מכיל את הטלפון של השולח** — אינו נרשם בלוגים. */
  wamid: string;
  /** `from` — הטלפון בצורה `972…`, או null כשוואטסאפ הסתירה אותו */
  waId: string | null;
  /** `from_user_id` — המזהה שוואטסאפ מצמידה לשולח מול העסק (BSUID) */
  bsuid: string | null;
  profileName: string | null;
  /** מתי ההודעה נכתבה (`timestamp`, בשניות) */
  sentAt: Date;
  /** הסוג כפי שנמסר — text, image, audio, sticker, reaction... */
  type: string;
  /** טקסט ההודעה או הכיתוב של הקובץ */
  text: string | null;
  /** תגובה (Reply): ההודעה שצוטטה */
  contextWamid: string | null;
  forwarded: boolean;
  media: WaInboundMedia | null;
}

export interface WaStatusUpdate {
  phoneNumberId: string;
  wabaId: string;
  /** ההודעה **שלנו** שהסטטוס מדווח עליה */
  wamid: string;
  /** sent, delivered, read, failed — ומה שיתווסף */
  status: string;
  at: Date;
  errorCode: number | null;
  errorTitle: string | null;
}

export type WebhookItem =
  | { kind: "message"; message: WaInboundMessage }
  | { kind: "status"; status: WaStatusUpdate }
  /** שדה אחר (`account_update`, `message_template_status_update`...) — רק השם */
  | { kind: "other"; field: string; wabaId: string; phoneNumberId: string | null }
  /** הודעה או סטטוס שאינם עומדים במבנה המינימלי — אינם נבלעים */
  | { kind: "invalid"; field: string; reason: string; phoneNumberId: string | null };

// ─────────────────────────────── הסכימה ───────────────────────────────

const MEDIA_TYPES = ["image", "audio", "video", "document", "sticker"] as const;

const mediaSchema = z.object({
  id: z.string().min(1),
  mime_type: z.string().min(1),
  sha256: z.string().optional(),
  caption: z.string().optional(),
  filename: z.string().optional(),
  voice: z.boolean().optional(),
});

const messageSchema = z.object({
  id: z.string().min(1),
  from: z.string().optional(),
  from_user_id: z.string().optional(),
  timestamp: z.string().regex(/^\d+$/),
  type: z.string().min(1),
  text: z.object({ body: z.string() }).optional(),
  image: mediaSchema.optional(),
  audio: mediaSchema.optional(),
  video: mediaSchema.optional(),
  document: mediaSchema.optional(),
  sticker: mediaSchema.optional(),
  context: z
    .object({
      id: z.string().optional(),
      forwarded: z.boolean().optional(),
      frequently_forwarded: z.boolean().optional(),
    })
    .optional(),
});

const statusSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  timestamp: z.string().regex(/^\d+$/),
  errors: z
    .array(z.object({ code: z.number(), title: z.string().optional(), message: z.string().optional() }))
    .optional(),
});

const contactSchema = z.object({
  wa_id: z.string().optional(),
  user_id: z.string().optional(),
  profile: z.object({ name: z.string().optional() }).optional(),
});

const valueSchema = z.object({
  metadata: z.object({ phone_number_id: z.string().min(1) }).optional(),
  contacts: z.array(contactSchema).optional(),
  messages: z.array(z.unknown()).optional(),
  statuses: z.array(z.unknown()).optional(),
});

const payloadSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(z.object({ field: z.string(), value: z.unknown() })),
    }),
  ),
});

// ─────────────────────────────── הפענוח ───────────────────────────────

/** מפענח את גוף המשלוח (כטקסט, כפי שנשמר). זורק `WebhookParseError` על מבנה שבור. */
export function parseWebhook(rawBody: string): WebhookItem[] {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new WebhookParseError("גוף ה-webhook אינו JSON");
  }

  const payload = payloadSchema.safeParse(json);
  if (!payload.success) throw new WebhookParseError(`גוף ה-webhook אינו במבנה של Meta: ${payload.error.message.slice(0, 300)}`);

  const items: WebhookItem[] = [];
  for (const entry of payload.data.entry) {
    for (const change of entry.changes) {
      items.push(...parseChange(entry.id, change.field, change.value));
    }
  }
  return items;
}

function parseChange(wabaId: string, field: string, raw: unknown): WebhookItem[] {
  const value = valueSchema.safeParse(raw);
  const phoneNumberId = value.success ? (value.data.metadata?.phone_number_id ?? null) : null;

  if (field !== "messages") return [{ kind: "other", field, wabaId, phoneNumberId }];
  if (!value.success || !phoneNumberId) {
    return [{ kind: "invalid", field, reason: "אין phone_number_id", phoneNumberId: null }];
  }

  const contacts = value.data.contacts ?? [];
  const items: WebhookItem[] = [];

  for (const rawMessage of value.data.messages ?? []) {
    const parsed = messageSchema.safeParse(rawMessage);
    if (!parsed.success) {
      items.push({ kind: "invalid", field, reason: `הודעה: ${parsed.error.issues[0]?.message ?? "מבנה"}`, phoneNumberId });
      continue;
    }
    items.push({ kind: "message", message: toMessage(parsed.data, contacts, phoneNumberId, wabaId) });
  }

  for (const rawStatus of value.data.statuses ?? []) {
    const parsed = statusSchema.safeParse(rawStatus);
    if (!parsed.success) {
      items.push({ kind: "invalid", field, reason: `סטטוס: ${parsed.error.issues[0]?.message ?? "מבנה"}`, phoneNumberId });
      continue;
    }
    const error = parsed.data.errors?.[0];
    items.push({
      kind: "status",
      status: {
        phoneNumberId,
        wabaId,
        wamid: parsed.data.id,
        status: parsed.data.status,
        at: fromSeconds(parsed.data.timestamp),
        errorCode: error?.code ?? null,
        errorTitle: error?.title ?? error?.message ?? null,
      },
    });
  }

  return items;
}

type ParsedMessage = z.infer<typeof messageSchema>;
type ParsedContact = z.infer<typeof contactSchema>;

function toMessage(
  message: ParsedMessage,
  contacts: readonly ParsedContact[],
  phoneNumberId: string,
  wabaId: string,
): WaInboundMessage {
  const media = mediaOf(message);
  const contact =
    contacts.find((c) => (message.from && c.wa_id === message.from) || (message.from_user_id && c.user_id === message.from_user_id)) ??
    (contacts.length === 1 ? contacts[0] : undefined);

  return {
    phoneNumberId,
    wabaId,
    wamid: message.id,
    waId: message.from || null,
    bsuid: message.from_user_id || null,
    profileName: contact?.profile?.name || null,
    sentAt: fromSeconds(message.timestamp),
    type: message.type,
    text: message.text?.body ?? media?.caption ?? null,
    contextWamid: message.context?.id || null,
    forwarded: message.context?.forwarded === true || message.context?.frequently_forwarded === true,
    media: media?.media ?? null,
  };
}

/** הקובץ של ההודעה, לפי הסוג שלה — לכל הודעה קובץ אחד לכל היותר */
function mediaOf(message: ParsedMessage): { media: WaInboundMedia; caption: string | null } | null {
  for (const type of MEDIA_TYPES) {
    const media = message[type];
    if (!media || message.type !== type) continue;
    return {
      media: {
        mediaId: media.id,
        mimeType: media.mime_type,
        sha256: base64ToHex(media.sha256),
        filename: media.filename ?? null,
        voice: media.voice === true,
      },
      caption: media.caption ?? null,
    };
  }
  return null;
}

/** sha256 מה-webhook (base64) → hex. ערך שאינו 32 בתים אינו גיבוב, ונזרק. */
function base64ToHex(value: string | undefined): string | null {
  if (!value) return null;
  const bytes = Buffer.from(value, "base64");
  return bytes.length === 32 ? bytes.toString("hex") : null;
}

function fromSeconds(timestamp: string): Date {
  return new Date(Number(timestamp) * 1000);
}
