import { decodeRfc2047, headerMap } from "./headers";
import type { MailPart } from "./types";

/**
 * פירוק עץ ה-MIME של הודעה מ-Gmail API: גוף לקריאה, וחלקים בינאריים.
 *
 * כל לקוח דואר בונה את העץ אחרת — Gmail עוטף ב-`alternative`, iPhone מפצל
 * את הטקסט סביב תמונה משובצת, Outlook מצרף `winmail.dat` — ושני הכשלים
 * האפשריים כאן **שקטים**: גוף שנקרא רק בחלקו מחלץ שדות חסרים, וקובץ שלא
 * זוהה כחלק פשוט אינו נכנס לטיוטה. אף אחד מהם אינו זורק. לכן הכלל בכל
 * מקום שבו המבנה חריג הוא לא לבלוע: חלק שאינו גוף מוחזר כחלק, גם כשאין
 * לנו מה לעשות בו כרגע, וההחלטה מה לשמור נעשית במעלה הזרם.
 *
 * המודול טהור (בלי רשת ובלי DB), ויודע רק את צורת ה-payload של Gmail: הבתים
 * של גוף כבר מפוענחים מ-transfer encoding (quoted-printable/base64) ומגיעים
 * כ-base64url ב-`body.data`, וה-charset עדיין לא הוחל עליהם.
 */

/** חלק בעץ כפי ש-`users.messages.get?format=full` מחזיר אותו */
export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailMessagePart[];
}

export interface WalkedMessage {
  /** הסוג של ההודעה כולה, בלי פרמטרים ובאותיות קטנות */
  contentType: string;
  /** חלקי ה-`text/plain` של הגוף, מפוענחים — לא HTML שהומר. `""` כשאין. */
  text: string;
  /** חלקי ה-`text/html` של הגוף, מפוענחים, או null כשאין אף אחד */
  html: string | null;
  /** קבצים מצורפים וחלקים בינאריים משובצים, בסדר DFS, ממוספרים 0..n-1 */
  parts: MailPart[];
  emptyBody: boolean;
}

export interface AttachmentClass {
  /** הסוג האמיתי אחרי פתרון — זה שנשמר, לא זה שהוצהר */
  mimeType: string;
  isMedia: boolean;
  isTnef: boolean;
}

// ─────────────────────────────── גוף ───────────────────────────────

/**
 * מפענח גוף של חלק לפי ה-charset שבכותרת `Content-Type` שלו.
 *
 * charset חסר או לא מוכר נופל ל-UTF-8 ולא זורק: הודעה שגופה נקרא עם כמה
 * תווים משובשים עדיין מחלצת את רוב השדות, והודעה שזרקה לא מחלצת כלום.
 * `windows-1255` ו-`iso-8859-8(-i)` הם מה ש-Outlook ישן ולקוחות ישראליים
 * שולחים, ו-`TextDecoder` של Node מכיר אותם (נבדק ב-S0).
 */
export function decodeBody(data: string, contentTypeHeader: string | null): string {
  if (!data) return "";
  // "base64url" של Node מקבל גם ריפוד וגם את תווי base64 הרגיל
  const bytes = Buffer.from(data, "base64url");
  return decoderFor(headerParam(contentTypeHeader, "charset")).decode(bytes);
}

function decoderFor(label: string | null): TextDecoder {
  if (label) {
    try {
      return new TextDecoder(label);
    } catch {
      // RangeError על תווית לא מוכרת — וגם על utf-7 ועל התוויות שהתקן
      // ממפה ל-"replacement", שהיו מחזירות תו שגיאה בודד במקום הטקסט
    }
  }
  return new TextDecoder("utf-8");
}

/** מה שעולה מתת-עץ: קטעי גוף בסדר הופעה. הקבצים נאספים בנפרד. */
interface Bodies {
  plain: string[];
  html: string[];
}

/**
 * מפרק את ה-payload לגוף ולחלקים.
 *
 * **החלטות מבנה:**
 * - `multipart/alternative` הוא אותו תוכן בכמה צורות, ולכן נבחרת צורה אחת
 *   מכל סוג — הראשונה שיש בה תוכן. קבצים נאספים מ**כל** החלופות: תמונה
 *   משובצת יושבת בדרך כלל רק בחלופת ה-HTML, גם כשהטקסט נלקח מחלופה אחרת.
 * - כל multipart אחר (`mixed`, `related`, `report`...) הוא רצף, וקטעי גוף
 *   באותו סוג מחוברים ב-`"\n"`. כך נראה מייל מ-iPhone עם תמונה באמצע:
 *   טקסט, תמונה, טקסט. חיבור חל גם על HTML ולא רק על הטקסט, מאותה סיבה —
 *   Apple Mail מפצל גם את ה-HTML סביב התמונה, ולקיחת הקטע הראשון בלבד
 *   הייתה מאבדת את מה שנכתב אחריה.
 * - `message/rfc822` (מייל שהועבר כקובץ מצורף) הוא **קובץ אחד שאינו מדיה**:
 *   לא יורדים לתוכו, ולכן לא הטקסט שלו ולא התמונות שבו נקלטים כחלק מההודעה.
 *   זה נדיר; ההעברה הנפוצה היא העברה בגוף, וזו מגיעה כטקסט רגיל. Gmail
 *   עשוי למסור אותו בלי `data` ובלי `attachmentId` — אז `sourceRef` ריק,
 *   והמתאם צריך להחליט אם להוריד את ההודעה הגולמית או להסתפק ברישום.
 */
export function walkPayload(payload: GmailMessagePart): WalkedMessage {
  const parts: MailPart[] = [];
  const bodies = walk(payload, parts);
  const text = bodies.plain.join("\n");
  const html = bodies.html.length > 0 ? bodies.html.join("\n") : null;

  return {
    contentType: partType(payload),
    text,
    html,
    parts,
    emptyBody: !text.trim() && !html?.trim() && parts.length === 0,
  };
}

function walk(part: GmailMessagePart, parts: MailPart[]): Bodies {
  const type = partType(part);

  if (type.startsWith("multipart/")) {
    const children = (part.parts ?? []).map((child) => walk(child, parts));
    return type === "multipart/alternative" ? pickAlternative(children) : concatenate(children);
  }

  if (!isBodyLeaf(part, type)) {
    parts.push(toMailPart(part, type, parts.length));
    return { plain: [], html: [] };
  }

  const data = part.body?.data;
  if (!data && part.body?.attachmentId) {
    // גוף גדול ש-Gmail מסר רק כהפניה. להשאיר אותו ריק היה מאבד אותו בלי
    // סימן; כחלק הוא לפחות נשמר בהתכתבות, והמתאם יכול להוריד אותו.
    parts.push(toMailPart(part, type, parts.length));
    return { plain: [], html: [] };
  }

  const decoded = decodeBody(data ?? "", headerValue(part, "content-type"));
  return type === "text/html" ? { plain: [], html: [decoded] } : { plain: [decoded], html: [] };
}

function pickAlternative(children: Bodies[]): Bodies {
  return {
    plain: firstWithContent(children.map((child) => child.plain)),
    html: firstWithContent(children.map((child) => child.html)),
  };
}

/** חלופה ריקה (Outlook שולח לפעמים `text/plain` ריק לצד HTML מלא) אינה נבחרת כשיש חלופה מלאה */
function firstWithContent(options: string[][]): string[] {
  return (
    options.find((segments) => segments.join("").trim() !== "") ??
    options.find((segments) => segments.length > 0) ??
    []
  );
}

function concatenate(children: Bodies[]): Bodies {
  return {
    plain: children.flatMap((child) => child.plain),
    html: children.flatMap((child) => child.html),
  };
}

/**
 * גוף = `text/plain` או `text/html` בלי שם קובץ ובלי `Content-Disposition: attachment`.
 *
 * כל השאר הוא חלק: קובץ `.txt` מצורף הוא `text/plain` עם שם, והוא אינו
 * חלק ממה שהשולח כתב. גם `text/calendar` של הזמנה או `message/delivery-status`
 * של דוח מסירה אינם גוף — הם נשמרים כחלקים שאינם מדיה.
 */
function isBodyLeaf(part: GmailMessagePart, type: string): boolean {
  if (type !== "text/plain" && type !== "text/html") return false;
  if (filenameOf(part)) return false;
  return dispositionOf(part) !== "attachment";
}

function toMailPart(part: GmailMessagePart, type: string, index: number): MailPart {
  // Gmail מוסר קובץ קטן בתוך ההודעה (`data`, בלי `attachmentId`) וקובץ גדול
  // כהפניה בלבד. שני המקרים נפוצים, ולכן שני השדות נשמרים כמו שהם.
  const data = part.body?.data ? Buffer.from(part.body.data, "base64url") : null;
  return {
    index,
    filename: filenameOf(part),
    mimeType: type,
    sizeBytes: part.body?.size ?? data?.length ?? 0,
    contentId: contentIdOf(part),
    disposition: dispositionOf(part),
    data,
    sourceRef: part.body?.attachmentId || null,
  };
}

// ─────────────────────────────── כותרות החלק ───────────────────────────────

/**
 * כותרת של החלק לפי שם באותיות קטנות. דרך `headerMap`, כדי שכלל הרישיות
 * וכלל "כותרת שחוזרת — האחרונה גוברת" יהיו אותם כללים של כותרות ההודעה.
 */
function headerValue(part: GmailMessagePart, lowerName: string): string | null {
  return headerMap(part.headers ?? [])[lowerName] ?? null;
}

function baseType(value: string | null | undefined): string {
  return (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/**
 * הסוג של חלק: `mimeType` של Gmail, ואחריו הכותרת.
 *
 * כשאין אף אחד — `text/plain`, ברירת המחדל של RFC 2045 §5.2; אלא אם יש
 * לחלק ילדים, ואז הוא מיכל, כדי שהילדים לא ייבלעו בגלל כותרת חסרה.
 */
function partType(part: GmailMessagePart): string {
  const declared = baseType(part.mimeType) || baseType(headerValue(part, "content-type"));
  if (declared) return declared;
  return part.parts && part.parts.length > 0 ? "multipart/mixed" : "text/plain";
}

/**
 * פרמטר מכותרת מובנית (`charset`, `filename`, `name`), עם או בלי מירכאות.
 *
 * הערך מוחזר כפי שהוא, בלי פענוח: `charset` אינו מקודד, ושם קובץ מפוענח
 * ב-`filenameOf`.
 */
function headerParam(value: string | null, name: string): string | null {
  if (!value) return null;
  const match = new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|([^;]*))`, "i").exec(value);
  if (!match) return null;
  const raw = match[1] !== undefined ? match[1].replace(/\\(.)/g, "$1") : (match[2] ?? "");
  return raw.trim() || null;
}

/**
 * שם הקובץ: השדה `filename` של Gmail, שמגיע כבר מפוענח; ובלעדיו — הכותרות.
 *
 * בכותרות השם עדיין מקודד (`name="=?UTF-8?B?...?="`, כך שולחים שם עברי),
 * ולכן הוא עובר `decodeRfc2047`. בלי זה לשם אין סיומת, ו-PDF שהוצהר
 * `application/octet-stream` מסווג כקובץ שאינו מדיה ונשאר מחוץ לטיוטה.
 * שם בתחביר RFC 2231 (`filename*=`) אינו נקרא בגיבוי, שנועד רק למקרה שהשדה
 * `filename` של Gmail ריק.
 */
function filenameOf(part: GmailMessagePart): string | null {
  if (part.filename && part.filename.trim()) return part.filename;
  const raw =
    headerParam(headerValue(part, "content-disposition"), "filename") ??
    headerParam(headerValue(part, "content-type"), "name");
  return raw === null ? null : decodeRfc2047(raw).trim() || null;
}

function dispositionOf(part: GmailMessagePart): MailPart["disposition"] {
  const value = baseType(headerValue(part, "content-disposition"));
  return value === "attachment" || value === "inline" ? value : null;
}

/** בלי `<>`, כי כך הוא מופיע ב-`src="cid:..."` של ה-HTML שמפנה אליו */
function contentIdOf(part: GmailMessagePart): string | null {
  const value = headerValue(part, "content-id");
  if (!value) return null;
  return value.trim().replace(/^<|>$/g, "").trim() || null;
}

// ─────────────────────────────── סיווג קובץ ───────────────────────────────

const OCTET_STREAM = "application/octet-stream";
const TNEF = "application/ms-tnef";

/** הצהרות שאומרות "לא יודע מה זה" — לא ניתן לסמוך עליהן לשום החלטה */
const GENERIC_TYPES: ReadonlySet<string> = new Set([
  "",
  OCTET_STREAM,
  "binary/octet-stream",
  "application/binary",
  "application/unknown",
  "application/x-unknown",
  "application/download",
  "application/x-download",
  "application/force-download",
]);

/** כינויים לא תקניים שלקוחות שולחים בפועל. בלעדיהם `image/jpg` אינו עובר את רשימת ההיתר של האחסון. */
const ALIASES: Readonly<Record<string, string>> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
  "audio/mp3": "audio/mpeg",
  "audio/x-mp3": "audio/mpeg",
  "audio/mpeg3": "audio/mpeg",
  "audio/x-mpeg": "audio/mpeg",
  "audio/x-mpeg-3": "audio/mpeg",
  "audio/m4a": "audio/mp4",
  "audio/x-m4a": "audio/mp4",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "audio/x-aac": "audio/aac",
  "video/x-quicktime": "video/quicktime",
  "application/x-pdf": "application/pdf",
  "application/acrobat": "application/pdf",
  "application/vnd.ms-tnef": TNEF,
};

const BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  // .opus של WhatsApp הוא Opus בתוך Ogg
  opus: "audio/ogg",
  wav: "audio/wav",
  aac: "audio/aac",
  amr: "audio/amr",
  "3gp": "video/3gpp",
};

/**
 * מה שהחתימה אומרת: סוג, ו**משפחת הסוגים שהחתימה אינה סותרת**.
 *
 * המשפחה קיימת כי חתימה מזהה מיכל ולא תוכן. `1A 45 DF A3` הוא WebM, אבל
 * הקלטה מהדפדפן היא `audio/webm` בדיוק באותה חתימה; אילו כל הבדל בין ההצהרה
 * לחתימה נחשב סתירה, ההקלטה הייתה הופכת לווידאו ומדלגת על התמלול.
 */
interface Sniffed {
  type: string;
  family: readonly string[];
}

const ISO_BMFF_AV = [
  "video/mp4",
  "audio/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/3gpp",
  "audio/3gpp",
  "video/3gpp2",
  "audio/3gpp2",
] as const;
const HEIF_IMAGE = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"] as const;
const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);

function startsWith(head: Uint8Array, bytes: readonly number[], offset = 0): boolean {
  if (head.length < offset + bytes.length) return false;
  return bytes.every((byte, i) => head[offset + i] === byte);
}

const latin1 = (text: string) => [...text].map((ch) => ch.charCodeAt(0));

function sniff(head: Uint8Array): Sniffed | null {
  if (startsWith(head, latin1("%PDF"))) return { type: "application/pdf", family: ["application/pdf"] };
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { type: "image/jpeg", family: ["image/jpeg"] };
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return { type: "image/png", family: ["image/png"] };
  if (startsWith(head, latin1("GIF8"))) return { type: "image/gif", family: ["image/gif"] };
  if (startsWith(head, latin1("RIFF"))) {
    if (startsWith(head, latin1("WEBP"), 8)) return { type: "image/webp", family: ["image/webp"] };
    if (startsWith(head, latin1("WAVE"), 8)) return { type: "audio/wav", family: ["audio/wav"] };
    return null;
  }
  if (startsWith(head, latin1("OggS"))) {
    return { type: "audio/ogg", family: ["audio/ogg", "video/ogg", "application/ogg", "audio/opus"] };
  }
  // ID3 הוא תגית שיכולה להקדים גם AAC, ולכן אינה סותרת הצהרת AAC
  if (startsWith(head, latin1("ID3"))) return { type: "audio/mpeg", family: ["audio/mpeg", "audio/aac"] };
  if (head[0] === 0xff && (head[1] === 0xfb || head[1] === 0xf3 || head[1] === 0xf2)) {
    return { type: "audio/mpeg", family: ["audio/mpeg"] };
  }
  if (head[0] === 0xff && (head[1] === 0xf1 || head[1] === 0xf9)) return { type: "audio/aac", family: ["audio/aac"] };
  if (startsWith(head, latin1("#!AMR"))) return { type: "audio/amr", family: ["audio/amr"] };
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { type: "video/webm", family: ["video/webm", "audio/webm", "video/x-matroska", "audio/x-matroska"] };
  }
  if (startsWith(head, latin1("ftyp"), 4) && head.length >= 12) {
    const brand = String.fromCharCode(...head.subarray(8, 12));
    if (HEIF_BRANDS.has(brand)) return { type: "image/heic", family: HEIF_IMAGE };
    if (brand === "avif" || brand === "avis") return { type: "image/avif", family: ["image/avif"] };
    // M4A/M4B/M4P הם מותגים של אודיו בלבד, ולכן משפחתם אינה כוללת וידאו: הצהרת
    // `video/mp4` או סיומת `.mp4` על קובץ כזה סותרות את החתימה. זה חשוב כי
    // וידאו אינו מתומלל (`services/media.ts`) — הקלטה שסווגה כווידאו מאבדת את
    // הטקסט שממנו מחולצים השדות.
    if (brand === "M4A " || brand === "M4B " || brand === "M4P ") return { type: "audio/mp4", family: ["audio/mp4"] };
    if (brand === "qt  ") return { type: "video/quicktime", family: ISO_BMFF_AV };
    return { type: "video/mp4", family: ISO_BMFF_AV };
  }
  if (startsWith(head, [0x78, 0x9f, 0x3e, 0x22])) return { type: TNEF, family: [TNEF] };
  return null;
}

function canonicalType(mimeType: string): string {
  const base = baseType(mimeType);
  return ALIASES[base] ?? base;
}

function basename(filename: string | null): string {
  return (filename ?? "").split(/[\\/]/).pop()?.trim() ?? "";
}

function extensionType(filename: string | null): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(basename(filename));
  return match ? (BY_EXTENSION[match[1]!.toLowerCase()] ?? null) : null;
}

/**
 * הסוג האמיתי של קובץ מצורף, והאם הוא מדיה (§2.6 שלב 3, EM-06a).
 *
 * **סדר האמון:** הבתים, אחר כך הצהרה ספציפית, אחר כך הסיומת.
 * - הצהרה כללית (`application/octet-stream`, ריקה) אינה אומרת דבר — קורה
 *   בפועל עם PDF מסורק ועם HEIC מ-iPhone — ולכן הסוג נפתר מהחתימה, ובלעדיה
 *   מהסיומת.
 * - הצהרה ספציפית גוברת על הסיומת: הסיומת היא חלק מהשם, שהשולח שולט בו.
 * - חתימה שסותרת את ההצהרה גוברת עליה, כי קובץ שיישלח לתמלול או לחילוץ
 *   בסוג הלא נכון ייכשל שם. "סותרת" פירושו מחוץ למשפחה של החתימה (`Sniffed`).
 * - בתוך משפחה, סיומת מאותה משפחה מדייקת את החתימה (`voice.m4a` עם `isom`
 *   הוא אודיו ולא וידאו).
 *
 * `head` הוא תחילת הקובץ, כשהבתים בידינו; בלעדיו ההחלטה נשענת על ההצהרה
 * והשם בלבד. חתימה שאינה מוכרת כאן (ZIP, למשל) אינה נחשבת סתירה.
 *
 * **מדיה** = תמונה, וידאו, אודיו או PDF (§3.1). SVG אינו נחשב מדיה למרות
 * `image/*`: הוא מסמך XML שיכול להריץ סקריפט כשמוגש מהדומיין של המערכת,
 * ורשימת ההיתר של האחסון (`ALLOWED_MIME_TYPES`) דוחה אותו ממילא.
 * **TNEF** (`winmail.dat` של Outlook) הוא מעטפה קניינית שהקבצים האמיתיים
 * בתוכה; הוא מסומן כדי שמעלה הזרם יוכל לדווח עליו, ואינו מדיה.
 */
export function classifyAttachment(
  part: { filename: string | null; mimeType: string },
  head?: Buffer | null,
): AttachmentClass {
  const declared = canonicalType(part.mimeType);
  const byName = extensionType(part.filename);
  const sniffed = head && head.length > 0 ? sniff(head) : null;
  const resolved = resolveType(declared, byName, sniffed);

  if (resolved === TNEF || basename(part.filename).toLowerCase() === "winmail.dat") {
    return { mimeType: TNEF, isMedia: false, isTnef: true };
  }
  return { mimeType: resolved, isMedia: isMediaType(resolved), isTnef: false };
}

function resolveType(declared: string, byName: string | null, sniffed: Sniffed | null): string {
  const generic = GENERIC_TYPES.has(declared);

  if (sniffed) {
    if (!generic && sniffed.family.includes(declared)) return declared;
    return byName && sniffed.family.includes(byName) ? byName : sniffed.type;
  }
  if (!generic) return declared;
  return byName ?? OCTET_STREAM;
}

function isMediaType(mimeType: string): boolean {
  if (mimeType === "image/svg+xml") return false;
  return (
    mimeType.startsWith("image/") ||
    mimeType.startsWith("video/") ||
    mimeType.startsWith("audio/") ||
    mimeType === "application/pdf"
  );
}
