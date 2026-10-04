/**
 * Spike (W0, פתיחת פנייה בוואטסאפ): מה ה-Cloud API של Meta שולח ומקבל בפועל.
 *
 * התכנון נשען על הנחות שהתיעוד של Meta מתאר בחלקן, וכל אחת מהן, אם היא
 * שגויה, מאבדת הודעות בשקט:
 *
 * 1. החתימה `X-Hub-Signature-256` מחושבת על הגוף **הגולמי** עם ה-App Secret.
 * 2. תגובה (Reply) של המשתמש להודעה **שלנו** מגיעה עם `context.id` ששווה
 *    ל-`wamid` שקיבלנו בשליחה — זה כל מנגנון ההשלמה (אפיון §2.7 שלב 5).
 * 3. `from` מגיע כספרות בלבד (`972…`), ו-`normalizePhone` של המערכת מתאים
 *    אותו לטלפון שבכרטיס.
 * 4. הורדת מדיה היא שתי קפיצות, **עם הטוקן בשתיהן**, והכתובת פגה תוך דקות.
 * 5. הקלטה קולית מגיעה כ-`audio/ogg` עם `voice: true`; כיתוב של תמונה מגיע
 *    ב-`image.caption`; הודעה מועברת מסומנת ב-`context.forwarded`.
 * 6. סטטוסים (`sent` / `delivered` / `read` / `failed`) מגיעים בנפרד מההודעות.
 *
 * שלוש פקודות:
 *
 *   npx tsx scripts/spike-wa.mts serve [--port 3199]
 *     מקלט webhook זמני מאחורי המנהרה. מאמת חתימה, ושומר כל מסירה כמות
 *     שהיא ל-`.wa-spike/payloads/` (ב-gitignore) — משם נגזרים ה-fixtures
 *     האנונימיים. **לפלט נכתבים רק סוגים ומזהים, לעולם לא תוכן.**
 *
 *   npx tsx scripts/spike-wa.mts send --to 9725XXXXXXXX --text "…" [--context <wamid>]
 *   npx tsx scripts/spike-wa.mts send --to 9725XXXXXXXX --template hello_world [--lang en_US]
 *     שולח ממספר הבדיקה ומדפיס את ה-`wamid` שחזר. עם `--context` ההודעה
 *     יוצאת כתגובה להודעה הנכנסת — כך תיראה הודעת האישור של המערכת.
 *
 *   npx tsx scripts/spike-wa.mts media --id <media-id>
 *     מוריד מדיה בשתי הקפיצות, משווה sha256, ומנסה את הקפיצה השנייה גם בלי
 *     טוקן — כדי לראות במו עינינו שהיא נכשלת.
 *
 * משתנים (ב-`.env.local`, לעולם לא בצ'אט): `WHATSAPP_APP_SECRET`,
 * `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_DEV_ACCESS_TOKEN`,
 * `WHATSAPP_DEV_PHONE_NUMBER_ID`, ואופציונלית `WHATSAPP_GRAPH_VERSION`.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

const OUT_DIR = ".wa-spike";
const GRAPH_VERSION = process.env["WHATSAPP_GRAPH_VERSION"] || "v25.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

const [command, ...rest] = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
}

function need(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`✖ ${name} אינו מוגדר ב-.env.local`);
    process.exit(1);
  }
  return value;
}

// ─────────────────────────────── חתימה ───────────────────────────────

/** HMAC-SHA256 על הגוף הגולמי, בהשוואה בזמן קבוע. כותרת חסרה — לא תקין. */
function signatureValid(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ─────────────────────────────── serve ───────────────────────────────

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * תקציר בלי תוכן: לכל שינוי — השדה, וסוגי ההודעות והסטטוסים שבו. די בזה כדי
 * לדעת מה לאסוף, בלי שטקסט של מישהו ייכנס ליומן הטרמינל.
 */
function summarize(body: unknown): string {
  const parts: string[] = [];
  const entries = (body as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries as { changes?: { field?: string; value?: Record<string, unknown> }[] }[]) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const messages = (value["messages"] as { type?: string; context?: unknown }[] | undefined) ?? [];
      const statuses = (value["statuses"] as { status?: string }[] | undefined) ?? [];
      const types = messages.map((m) => `${m.type}${m.context ? "+context" : ""}`);
      const states = statuses.map((s) => `status:${s.status}`);
      parts.push(`${change.field}[${[...types, ...states].join(",") || "—"}]`);
    }
  }
  return parts.join(" ") || "(ללא שינויים)";
}

function serve(): void {
  const secret = need("WHATSAPP_APP_SECRET");
  const verifyToken = need("WHATSAPP_VERIFY_TOKEN");
  const port = Number(flag("--port") ?? "3199");
  const dir = join(OUT_DIR, "payloads");
  mkdirSync(dir, { recursive: true });
  let seq = 0;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    // לחיצת היד של Meta בשמירת כתובת ה-callback: מחזירים את האתגר כטקסט.
    if (req.method === "GET") {
      const ok = url.searchParams.get("hub.mode") === "subscribe"
        && url.searchParams.get("hub.verify_token") === verifyToken;
      console.log(`GET ${url.pathname} — אימות ${ok ? "הצליח" : "נדחה"}`);
      res.writeHead(ok ? 200 : 403, { "content-type": "text/plain" });
      res.end(ok ? url.searchParams.get("hub.challenge") ?? "" : "");
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }

    const raw = await readBody(req);
    const header = req.headers["x-hub-signature-256"];
    const valid = signatureValid(raw, Array.isArray(header) ? header[0] : header, secret);

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      parsed = null;
    }

    seq += 1;
    const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${seq}.json`);
    writeFileSync(file, JSON.stringify({ receivedAt: new Date().toISOString(), signatureValid: valid, body: parsed ?? raw.toString("utf8") }, null, 2));
    console.log(`POST #${seq} חתימה=${valid ? "תקינה" : "שגויה"} ${parsed ? summarize(parsed) : "(גוף שאינו JSON)"} → ${file}`);

    // כמו בנתיב האמיתי: חתימה שגויה היא 401, וכל השאר 200 מיד.
    res.writeHead(valid ? 200 : 401).end();
  });

  server.listen(port, () => console.log(`מקלט ה-spike מאזין ל-http://localhost:${port} (Ctrl+C לעצירה)`));
}

// ─────────────────────────────── send ───────────────────────────────

async function send(): Promise<void> {
  const token = need("WHATSAPP_DEV_ACCESS_TOKEN");
  const phoneNumberId = need("WHATSAPP_DEV_PHONE_NUMBER_ID");
  const to = flag("--to");
  const text = flag("--text");
  const template = flag("--template");
  const context = flag("--context");
  if (!to || (!text && !template)) {
    console.error("שימוש: send --to 9725XXXXXXXX (--text \"…\" | --template שם) [--context wamid] [--lang en_US]");
    process.exit(1);
  }

  const message: Record<string, unknown> = { messaging_product: "whatsapp", recipient_type: "individual", to };
  if (template) {
    message["type"] = "template";
    message["template"] = { name: template, language: { code: flag("--lang") ?? "en_US" } };
  } else {
    message["type"] = "text";
    message["text"] = { body: text, preview_url: false };
  }
  if (context) message["context"] = { message_id: context };

  const response = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(message),
  });
  const body = await response.json();
  console.log(`HTTP ${response.status}`);
  console.log(JSON.stringify(body, null, 2));
}

// ─────────────────────────────── media ───────────────────────────────

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
};

async function media(): Promise<void> {
  const token = need("WHATSAPP_DEV_ACCESS_TOKEN");
  const id = flag("--id");
  if (!id) {
    console.error("שימוש: media --id <media-id>");
    process.exit(1);
  }

  // קפיצה 1: המטא-דאטה, כולל כתובת זמנית.
  const metaResponse = await fetch(`${GRAPH}/${id}`, { headers: { authorization: `Bearer ${token}` } });
  const meta = (await metaResponse.json()) as { url?: string; mime_type?: string; sha256?: string; file_size?: number };
  console.log(`קפיצה 1: HTTP ${metaResponse.status} mime=${meta.mime_type} size=${meta.file_size} sha256=${meta.sha256}`);
  if (!meta.url) process.exit(1);

  // הקפיצה השנייה בלי טוקן — הציפייה היא כשל, וזה מה שהספייק מאמת.
  const anonymous = await fetch(meta.url);
  console.log(`קפיצה 2 בלי טוקן: HTTP ${anonymous.status}`);

  const binResponse = await fetch(meta.url, { headers: { authorization: `Bearer ${token}` } });
  const bytes = Buffer.from(await binResponse.arrayBuffer());
  const hex = createHash("sha256").update(bytes).digest("hex");
  const b64 = createHash("sha256").update(bytes).digest("base64");
  console.log(`קפיצה 2 עם טוקן: HTTP ${binResponse.status} bytes=${bytes.length}`);
  console.log(`sha256 של הבתים: hex=${hex} base64=${b64} — תואם למטא-דאטה: ${meta.sha256 === hex || meta.sha256 === b64}`);

  const dir = join(OUT_DIR, "media");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.${EXT[(meta.mime_type ?? "").split(";")[0] ?? ""] ?? "bin"}`);
  writeFileSync(file, bytes);
  console.log(`נשמר: ${file}`);
}

// ─────────────────────────────── ניתוב ───────────────────────────────

if (command === "serve") serve();
else if (command === "send") await send();
else if (command === "media") await media();
else {
  console.error("פקודות: serve | send | media (ראה את ההערה בראש הקובץ)");
  process.exit(1);
}
