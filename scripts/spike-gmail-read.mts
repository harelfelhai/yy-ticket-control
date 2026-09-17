/**
 * Spike (S0, פתיחת פנייה במייל): מה Gmail API מחזיר בפועל מהתיבה, **בקריאה
 * בלבד**.
 *
 * התכנון נשען על כמה הנחות על התנהגות Gmail שאינן מתועדות במלואן, וכל אחת
 * מהן, אם היא שגויה, מאבדת מיילים בשקט:
 *
 * 1. `after:<epoch>` מסנן לפי שניות ולא לפי יום (אחרת גבול ההפעלה, EM-22,
 *    מדויק רק ליום).
 * 2. `in:anywhere -in:spam -from:me` מחזיר גם מיילים שכבר נקראו או הועברו
 *    לארכיון (EM-21) — כלומר אינו תלוי ב"לא נקרא" של EasyInv.
 * 3. חיפוש עברית בכותרת (`subject:תקלה`) אינו אמין, ולכן ההתאמה נעשית בקוד.
 * 4. `rfc822msgid:` מוצא הודעה לפי ה-Message-ID שלה (אידמפוטנטיות תשובה).
 * 5. מבנה ה-MIME: חלקים עם `filename` ו-`body.data` **בלי** `attachmentId`
 *    (קבצים קטנים), charset‏ `windows-1255`, תמונות משובצות עם `Content-ID`.
 * 6. `In-Reply-To` של תשובה מצביע על הודעה שנמצאת באותו `threadId`.
 * 7. (רק עם `--send-test`) האם Gmail שומר את ה-Message-ID שהמערכת קובעת
 *    בשליחה, והאם `threadId` מצרף את התשובה לשרשרת.
 *
 * **מה הסקריפט אינו עושה:** אינו משנה דבר בתיבה — כל הקריאות הן GET, ו-
 * `gmailGet` זורק על כל שיטה אחרת. אינו מדפיס כותרות, כתובות או תוכן: רק
 * ספירות ומבנה. החריג היחיד הוא `--send-test`, ששולח מייל אחד לכתובת
 * שנמסרה במפורש — מיועד לחשבון הבדיקות, לא לתיבה המשותפת.
 *
 * הרצה:
 *   npx tsx scripts/spike-gmail-read.mts [--token-var NAME] [--hours 48]
 *   npx tsx scripts/spike-gmail-read.mts --token-var GMAIL_TEST_REFRESH_TOKEN --send-test <כתובת>
 */

import { config } from "dotenv";

config({ path: ".env.local" });
config();

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const tokenVar = flag("--token-var") ?? "GMAIL_REFRESH_TOKEN";
const hours = Number(flag("--hours") ?? "48");
const sendTo = flag("--send-test");

const clientId = process.env["GOOGLE_CLIENT_ID"];
const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];
const refreshToken = process.env[tokenVar];
if (!clientId || !clientSecret || !refreshToken) {
  console.error(`✖ חסרים GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / ${tokenVar}`);
  process.exit(1);
}

// ──────────────────────── אימות ────────────────────────

const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }),
});
const token = (await tokenResponse.json()) as { access_token?: string; scope?: string; error?: string };
if (!token.access_token) {
  console.error(`✖ הנפקת access token נכשלה: ${token.error ?? tokenResponse.status}`);
  process.exit(1);
}
console.log(`היקפים שהוענקו: ${token.scope}`);

/** קריאה בלבד. שיטה אחרת היא באג בסקריפט הזה, לא אפשרות. */
async function gmailGet<T>(path: string, params: Record<string, string | string[]> = {}): Promise<T> {
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(params)) {
    for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, v);
  }
  const response = await fetch(url, {
    method: "GET",
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${path} → ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

interface ListResponse {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

async function listAll(q: string, maxPages = 10): Promise<{ ids: { id: string; threadId: string }[]; pages: number; saturated: boolean }> {
  const ids: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const page = await gmailGet<ListResponse>("/messages", {
      q,
      maxResults: "500",
      ...(pageToken ? { pageToken } : {}),
    });
    ids.push(...(page.messages ?? []));
    pageToken = page.nextPageToken;
    pages++;
  } while (pageToken && pages < maxPages);
  return { ids, pages, saturated: Boolean(pageToken) };
}

// ──────────────────────── 1. התיבה ────────────────────────

const profile = await gmailGet<{ emailAddress: string; messagesTotal: number; threadsTotal: number }>("/profile");
console.log(`\n[1] תיבה: ${profile.emailAddress} · ${profile.messagesTotal} הודעות · ${profile.threadsTotal} שרשורים`);
const gmailUser = process.env["GMAIL_USER"];
if (gmailUser) {
  console.log(`    GMAIL_USER תואם: ${gmailUser.trim().toLowerCase() === profile.emailAddress.toLowerCase()}`);
}

// ──────────────────────── 2. שאילתות ────────────────────────

const nowSec = Math.floor(Date.now() / 1000);
const sinceSec = nowSec - hours * 3600;
const main = `after:${sinceSec} in:anywhere -in:spam -from:me`;

const queries: Record<string, string> = {
  main,
  "newer_than(ימים)": `newer_than:${Math.ceil(hours / 24)}d in:anywhere -in:spam -from:me`,
  "בלי in:anywhere": `after:${sinceSec} -in:spam -from:me`,
  "רק לא-נקרא": `after:${sinceSec} is:unread -in:spam -from:me`,
  "באשפה": `after:${sinceSec} in:trash -from:me`,
  "from:me": `after:${sinceSec} from:me`,
  "subject:תקלה (Gmail)": `after:${sinceSec} in:anywhere -in:spam -from:me subject:תקלה`,
  "after: שעה אחרונה": `after:${nowSec - 3600} in:anywhere -in:spam -from:me`,
};

console.log(`\n[2] ספירות לחלון של ${hours} שעות:`);
const lists: Record<string, Awaited<ReturnType<typeof listAll>>> = {};
for (const [name, q] of Object.entries(queries)) {
  lists[name] = await listAll(q);
  console.log(`    ${name}: ${lists[name].ids.length} (עמודים: ${lists[name].pages}${lists[name].saturated ? ", רוויה" : ""})`);
}

// ──────────────────────── 3. כותרות ────────────────────────

interface Header {
  name: string;
  value: string;
}
interface MessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Header[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: MessagePart[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  sizeEstimate?: number;
  payload?: MessagePart;
}

const header = (m: GmailMessage | MessagePart, name: string) =>
  ("payload" in m ? m.payload?.headers : (m as MessagePart).headers)?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  )?.value;

const SUBJECT = /(?<![א-ת])[והבכלמש]{0,3}תקל(?:ה|ות)(?![א-ת])/;
const META_HEADERS = [
  "Subject",
  "From",
  "Message-ID",
  "In-Reply-To",
  "References",
  "Auto-Submitted",
  "Precedence",
  "X-Autoreply",
  "X-Autorespond",
  "Return-Path",
  "Content-Type",
];

const sample = lists["main"]!.ids.slice(0, 300);
const metas: GmailMessage[] = [];
for (const { id } of sample) {
  metas.push(await gmailGet<GmailMessage>(`/messages/${id}`, { format: "metadata", metadataHeaders: META_HEADERS }));
}

const count = (predicate: (m: GmailMessage) => boolean) => metas.filter(predicate).length;
const outOfWindow = count((m) => Number(m.internalDate) / 1000 < sinceSec);
console.log(`\n[3] כותרות (${metas.length} הודעות):`);
console.log(`    internalDate מחוץ לחלון after: ${outOfWindow}`);
console.log(`    כותרת תואמת את הביטוי בקוד: ${count((m) => SUBJECT.test((header(m, "Subject") ?? "").normalize("NFKC")))}`);
console.log(`    subject:תקלה של Gmail החזיר: ${lists["subject:תקלה (Gmail)"]!.ids.length}`);
console.log(`    עם Message-ID: ${count((m) => Boolean(header(m, "Message-ID")))}`);
console.log(`    עם In-Reply-To: ${count((m) => Boolean(header(m, "In-Reply-To")))}`);
console.log(`    עם References: ${count((m) => Boolean(header(m, "References")))}`);
console.log(`    Auto-Submitted≠no: ${count((m) => { const v = header(m, "Auto-Submitted"); return Boolean(v) && v!.toLowerCase() !== "no"; })}`);
console.log(`    Precedence bulk/junk/list: ${count((m) => /bulk|junk|list/i.test(header(m, "Precedence") ?? ""))}`);
console.log(`    Return-Path <>: ${count((m) => (header(m, "Return-Path") ?? "").trim() === "<>")}`);
console.log(`    UNREAD: ${count((m) => m.labelIds?.includes("UNREAD") ?? false)} · INBOX: ${count((m) => m.labelIds?.includes("INBOX") ?? false)}`);
console.log(`    שולחים שונים: ${new Set(metas.map((m) => (header(m, "From") ?? "").toLowerCase())).size}`);

// ──────────────────────── 4. rfc822msgid ────────────────────────

console.log("\n[4] rfc822msgid:");
for (const m of metas.filter((x) => header(x, "Message-ID")).slice(0, 3)) {
  const raw = header(m, "Message-ID")!.trim();
  const bare = raw.replace(/^<|>$/g, "");
  const withBrackets = await listAll(`rfc822msgid:${raw}`, 1);
  const withoutBrackets = await listAll(`rfc822msgid:${bare}`, 1);
  console.log(
    `    עם <>: ${withBrackets.ids.some((x) => x.id === m.id)} (${withBrackets.ids.length}) · בלי: ${withoutBrackets.ids.some((x) => x.id === m.id)} (${withoutBrackets.ids.length})`,
  );
}

// ──────────────────────── 5. שרשור ────────────────────────

const replies = metas.filter((m) => header(m, "In-Reply-To")).slice(0, 10);
let sameThread = 0;
let found = 0;
for (const m of replies) {
  const parent = header(m, "In-Reply-To")!.trim();
  const hits = await listAll(`rfc822msgid:${parent} in:anywhere`, 1);
  if (hits.ids.length > 0) found++;
  if (hits.ids.some((h) => h.threadId === m.threadId)) sameThread++;
}
console.log(`\n[5] In-Reply-To: ${replies.length} נבדקו · ההורה נמצא בתיבה: ${found} · באותו threadId: ${sameThread}`);

// ──────────────────────── 6. מבנה MIME ────────────────────────

const census = {
  messages: 0,
  multipart: new Map<string, number>(),
  charsets: new Map<string, number>(),
  filenameWithDataNoAttachmentId: 0,
  filenameWithAttachmentId: 0,
  inlineWithContentId: 0,
  dispositionAttachmentWithContentId: 0,
  octetStreamPdfByName: 0,
  tnef: 0,
  emptyBody: 0,
  attachmentMime: new Map<string, number>(),
};
const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

function walk(part: MessagePart) {
  const mime = (part.mimeType ?? "").toLowerCase();
  if (mime.startsWith("multipart/")) bump(census.multipart, mime);
  const contentType = header(part, "Content-Type") ?? "";
  const charset = /charset="?([^";\s]+)/i.exec(contentType)?.[1]?.toLowerCase();
  if (charset) bump(census.charsets, charset);
  const disposition = (header(part, "Content-Disposition") ?? "").toLowerCase();
  const contentId = header(part, "Content-ID");
  if (part.filename) {
    bump(census.attachmentMime, mime);
    if (part.body?.attachmentId) census.filenameWithAttachmentId++;
    else if (part.body?.data) census.filenameWithDataNoAttachmentId++;
    if (/\.pdf$/i.test(part.filename) && mime === "application/octet-stream") census.octetStreamPdfByName++;
    if (/winmail\.dat$/i.test(part.filename) || mime === "application/ms-tnef") census.tnef++;
  }
  if (contentId && disposition.startsWith("inline")) census.inlineWithContentId++;
  if (contentId && disposition.startsWith("attachment")) census.dispositionAttachmentWithContentId++;
  for (const child of part.parts ?? []) walk(child);
}

let firstAttachment: { messageId: string; attachmentId: string; size: number } | null = null;
for (const { id } of sample.slice(0, 80)) {
  const full = await gmailGet<GmailMessage>(`/messages/${id}`, { format: "full" });
  census.messages++;
  if (!full.payload) continue;
  walk(full.payload);
  const stack = [full.payload];
  while (stack.length) {
    const p = stack.pop()!;
    if (!firstAttachment && p.body?.attachmentId && p.filename) {
      firstAttachment = { messageId: id, attachmentId: p.body.attachmentId, size: p.body.size ?? 0 };
    }
    stack.push(...(p.parts ?? []));
  }
}
console.log(`\n[6] MIME (${census.messages} הודעות, format=full):`);
console.log(`    multipart: ${JSON.stringify(Object.fromEntries(census.multipart))}`);
console.log(`    charsets: ${JSON.stringify(Object.fromEntries(census.charsets))}`);
console.log(`    קובץ עם body.data בלי attachmentId: ${census.filenameWithDataNoAttachmentId} · עם attachmentId: ${census.filenameWithAttachmentId}`);
console.log(`    inline+Content-ID: ${census.inlineWithContentId} · attachment+Content-ID: ${census.dispositionAttachmentWithContentId}`);
console.log(`    PDF לפי שם עם octet-stream: ${census.octetStreamPdfByName} · TNEF: ${census.tnef}`);
console.log(`    סוגי קבצים: ${JSON.stringify(Object.fromEntries(census.attachmentMime))}`);

if (firstAttachment) {
  const attachment = await gmailGet<{ size: number; data: string }>(
    `/messages/${firstAttachment.messageId}/attachments/${firstAttachment.attachmentId}`,
  );
  const bytes = Buffer.from(attachment.data, "base64url");
  console.log(`    attachments.get: גודל מדווח ${firstAttachment.size}, פוענח ${bytes.byteLength}, תואם: ${bytes.byteLength === firstAttachment.size}`);
}

// ──────────────────────── 7. שליחה (חשבון בדיקות בלבד) ────────────────────────

if (sendTo) {
  console.log(`\n[7] שליחת בדיקה אל ${sendTo} — משנה את התיבה (Sent). חשבון בדיקות בלבד.`);
  const nodemailer = (await import("nodemailer")).default;
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const ourId = `<yy-spike-${Date.now()}@yy-ticket-control.local>`;

  const first = await composer.sendMail({
    from: profile.emailAddress,
    to: sendTo,
    subject: "בדיקת spike — תקלה",
    text: "מייל ראשון",
    messageId: ourId,
    headers: { "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All" },
  });
  const sent = await send((first.message as Buffer).toString("base64url"));
  const stored = await gmailGet<GmailMessage>(`/messages/${sent.id}`, { format: "metadata", metadataHeaders: ["Message-ID"] });
  console.log(`    Message-ID נשמר כפי שנקבע: ${header(stored, "Message-ID") === ourId} (${header(stored, "Message-ID")})`);

  const second = await composer.sendMail({
    from: profile.emailAddress,
    to: sendTo,
    subject: "Re: בדיקת spike — תקלה",
    text: "תשובה באותה שרשרת",
    inReplyTo: ourId,
    references: [ourId],
  });
  const reply = await send((second.message as Buffer).toString("base64url"), sent.threadId);
  console.log(`    threadId של התשובה זהה: ${reply.threadId === sent.threadId}`);
  const byId = await listAll(`rfc822msgid:${ourId} in:anywhere`, 1);
  console.log(`    rfc822msgid מוצא את ההודעה שנשלחה: ${byId.ids.some((x) => x.id === sent.id)}`);
}

async function send(raw: string, threadId?: string): Promise<{ id: string; threadId: string }> {
  const response = await fetch(`${API}/messages/send`, {
    method: "POST",
    headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`send → ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as { id: string; threadId: string };
}

console.log("\nהסתיים. לא בוצע שום שינוי בתיבה" + (sendTo ? " מלבד שליחת הבדיקה." : "."));
