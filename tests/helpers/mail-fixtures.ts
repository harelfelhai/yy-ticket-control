import { toEnvelope, type GmailMessage } from "@/lib/email-intake/gmail-source";
import type { GmailMessagePart } from "@/lib/email-intake/mime";
import type { MailEnvelope } from "@/lib/email-intake/types";

/**
 * מעטפות דואר לבדיקות של צינור הקליטה (S6) — נתוני בדיקה בלבד.
 *
 * **שום כתובת ושום תוכן כאן אינם אמיתיים.** כל הדומיינים הם תת-דומיינים של
 * `example.com`, שמורים לתיעוד ולבדיקות (RFC 2606), והתיבה האמיתית משותפת
 * עם מערכת אחרת — העתקת תוכן ממנה לקוד הייתה מכניסה לריפו הציבורי מייל של
 * לקוח.
 *
 * **המעטפה נבנית דרך `toEnvelope` ולא ביד**, מתוך הודעת Gmail מלאה. זו אינה
 * הקפדה יתרה אלא מה שמונע את הכשל השקט של fixtures: מעטפה שנכתבת ידנית
 * מתארת את מה שכותב הבדיקה *חושב* שמגיע, ולא את מה שמגיע — כותרות
 * שאינן תואמות את השדות המפוענחים, `headers` ריק שמנטרל בשקט את זיהוי
 * התשובה האוטומטית (EM-23), ומיספור חלקים שאינו סדר ה-DFS האמיתי. כאן
 * ההודעה נכתבת כפי ש-Gmail מוסר אותה, והמרתה למעטפה היא אותה המרה בדיוק
 * שרצה בפרודקשן.
 *
 * **הכותרות מקודדות כברירת מחדל** (RFC 2047, `=?UTF-8?B?...?=`), כי כך
 * מגיעים בפועל כותרת עברית ושם שולח עברי מכל לקוח דואר. הקורא רואה עברית
 * קריאה ב-`envelope.subject` וב-`envelope.from.name`, כי המתאם מפענח.
 * `encodeHeaders: false` מכבה זאת למי שבודק דווקא את הצורה הגולמית.
 *
 * הזמנים והמזהים קבועים ולא נגזרים מ"עכשיו": בדיקה שמשווה לגבול ההפעלה
 * (EM-22) או ל"מי מאוחר יותר" (§5.ה4) צריכה מספר יציב בין ריצות.
 */

// ─────────────────────────────── כתובות ───────────────────────────────

/** התיבה המשותפת שממנה קוראים. לעולם אינה שולח מורשה (§7 שורה 83). */
export const MAILBOX = "office@example.com";

/** משתמש מורשה — השולח הרגיל בבדיקות */
export const SENDER = "dana@example.com";
export const SENDER_NAME = "דנה כהן";

/** משתמש מורשה שני, לבדיקות שצריכות שני שולחים (חלוקת שאילתות, תשובה מאדם אחר) */
export const OTHER_SENDER = "yossi@example.com";
export const OTHER_SENDER_NAME = "יוסי לוי";

/** כתובת שאינה של משתמש במערכת — המסלול שאינו נקלט ואינו נענה (EM-03) */
export const STRANGER = "contractor@vendor.example.com";
export const STRANGER_NAME = "רן אינסטלציה";

/** הדומיין שבו נכתבים מזהי ההודעות הנכנסות */
const MAIL_HOST = "mail.example.com";

// ─────────────────────────────── מזהים וזמנים ───────────────────────────────

/** זמן הגעת המייל הראשון: 16.9.2026, 10:12 שעון ישראל */
export const ARRIVED_AT = new Date("2026-09-16T07:12:00.000Z");

/** זמן הגעת התשובה בשרשרת: יומיים אחרי המייל הראשון */
export const REPLY_ARRIVED_AT = new Date("2026-09-18T06:40:00.000Z");

export const FIRST_MAIL_MESSAGE_ID = `first-mail@${MAIL_HOST}`;

/**
 * ה-`Message-ID` של המייל החוזר **שלנו**.
 *
 * הוא כאן ולא בבדיקה, כי שתי בדיקות שונות נשענות עליו מהצדדים: אחת שומרת
 * אותו על השורה היוצאת, והשנייה שולחת תשובה עם `In-Reply-To` שמצביע אליו.
 * שני מזהים שונים היו הופכים את התשובה לזרה בלי ששום דבר ייכשל ברעש (EM-14).
 */
export const OUTGOING_REPLY_MESSAGE_ID = "yy-1@example.com";

export const REPLY_MESSAGE_ID = `reply-1@${MAIL_HOST}`;

// ─────────────────────────────── ערכים שבתוכן ───────────────────────────────

/**
 * הערכים שהגוף של המייל הראשון מזכיר. מיוצאים כדי שבדיקה שמכינה אתר ודירה
 * במסד ובדיקה שמאמתת מה חולץ ישאבו מאותו מקור — טקסט שיזוז בגוף ולא
 * בציפייה נראה בדיוק כמו חילוץ שנכשל.
 */
export const SAMPLE_SITE = "גני אלון";
export const SAMPLE_BUILDING = "ב";
export const SAMPLE_APARTMENT = "12";

export const FIRST_MAIL_SUBJECT = `תקלה בדירה ${SAMPLE_APARTMENT} - נזילה במטבח`;

export const FIRST_MAIL_TEXT = [
  "שלום,",
  "",
  `יש נזילה מתחת לכיור במטבח, בדירה ${SAMPLE_APARTMENT} בבניין ${SAMPLE_BUILDING} באתר ${SAMPLE_SITE}.`,
  "המים מטפטפים כבר יומיים והרצפה נרטבת.",
  "",
  "תודה,",
  SENDER_NAME,
].join("\n");

/** הטקסט **החדש** בתשובה — מה שאמור להגיע לחילוץ, בלי הציטוט (EM-13) */
export const REPLY_NEW_TEXT = "תיקון: הדירה היא 14 ולא 12, וגם הברז באמבטיה מטפטף.";

/**
 * שורת הייחוס של Gmail בעברית, כפי שהיא נכתבת בפועל. הצורה אינה שרירותית:
 * `quote.ts` מזהה אותה בתבנית `^בתאריך ... מאת ...:$`, ושורה שתנוסח אחרת
 * תיקרא כטקסט חדש — כלומר הציטוט כולו ייכנס לחילוץ.
 */
const QUOTE_ATTRIBUTION = `בתאריך יום ד', 16 בספט' 2026 ב-10:20 מאת בקרת פניות <${MAILBOX}>:`;

const QUOTED_BODY = [
  "נפתחה עבורך טיוטת פנייה מהמייל.",
  `אתר: ${SAMPLE_SITE} | בניין: ${SAMPLE_BUILDING} | דירה: ${SAMPLE_APARTMENT}`,
  "חסרים: תחום, נמענים.",
];

const REPLY_TEXT = [REPLY_NEW_TEXT, "", QUOTE_ATTRIBUTION, ...QUOTED_BODY.map((line) => `> ${line}`)].join("\n");

const REPLY_HTML = [
  `<div dir="rtl">${REPLY_NEW_TEXT}</div>`,
  '<div class="gmail_quote">',
  `<div dir="rtl">${QUOTE_ATTRIBUTION}</div>`,
  '<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">',
  QUOTED_BODY.map((line) => `<div dir="rtl">${line}</div>`).join(""),
  "</blockquote>",
  "</div>",
].join("");

// ─────────────────────────────── בתים לקבצים ───────────────────────────────

/**
 * הבתים הפותחים של כל סוג — מספיק כדי ש-`classifyAttachment` תזהה את הסוג
 * מהחתימה, ולא קובץ שניתן לפתוח. זה מה שנבדק במסלול הזה: הסיווג נשען על
 * החתימה ולא על ההצהרה, ולכן חתימה נכונה היא כל מה ש-fixture צריך לספק.
 */
export const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

export const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
]);

export const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n", "latin1");

/** ZIP, שהוא גם המבנה של `.docx` — קובץ שאינו מדיה ונשאר בהתכתבות בלבד (EM-06a) */
export const DOCX_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);

// ─────────────────────────────── מפרט ההודעה ───────────────────────────────

/**
 * קובץ בהודעה.
 *
 * **שני מסלולים, ושניהם קורים בפועל:** Gmail מוסר קובץ קטן בתוך ההודעה
 * (`data`) וקובץ גדול כהפניה בלבד (`attachmentId`), שיש להוריד בקריאה
 * נפרדת. `attachmentId` כאן מפעיל את המסלול השני, והבתים נמסרים ל-
 * `fakeMailSource` דרך `MailFixture.attachments`.
 */
export interface PartSpec {
  mimeType: string;
  bytes: Buffer;
  filename?: string | null;
  /** `inline` עם `contentId` הוא תמונה משובצת בגוף; ברירת המחדל `attachment` */
  disposition?: "attachment" | "inline";
  contentId?: string;
  /** כשהוא נתון, הבתים אינם בהודעה ויש להורידם (`MailSource.getAttachment`) */
  attachmentId?: string;
}

export interface MailSpec {
  /** מזהה ההודעה ב-Gmail */
  id?: string;
  /** מזהה השרשור; ברירת המחדל היא מזהה ההודעה — כלומר שרשור חדש */
  threadId?: string;
  receivedAt?: Date;
  /** הכתובת בכותרת `From`. `null` = הודעה בלי שולח חוקי (החזרה של שרת דואר). */
  from?: string | null;
  fromName?: string | null;
  to?: readonly string[];
  cc?: readonly string[];
  subject?: string;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: readonly string[];
  text?: string;
  html?: string | null;
  parts?: readonly PartSpec[];
  /**
   * כותרות נוספות, או דריסה של אחת שנגזרה מהשדות שלמעלה (כותרת שחוזרת —
   * האחרונה גוברת, כמו ב-`headerMap`). `null` מסיר כותרת שנגזרה, למשל
   * `Message-ID` שאינו קיים.
   */
  headers?: Record<string, string | null>;
  /** ברירת המחדל: כותרת ושם שולח בעברית נשלחים מקודדים (RFC 2047), כמו בפועל */
  encodeHeaders?: boolean;
}

/**
 * הודעה אחת כפי שהיא נמסרת לבדיקה: המעטפה, ההודעה הגולמית שממנה נבנתה,
 * והבתים של הקבצים שיש להוריד בנפרד.
 *
 * הבתים אינם בתוך המעטפה בכוונה — הם מגיעים דרך `MailSource.getAttachment`,
 * ו-`fakeMailSource` אוסף אותם מכאן כדי שהקריאה הזו תיבדק ולא תעוקף.
 */
export interface MailFixture {
  envelope: MailEnvelope;
  message: GmailMessage;
  /** בתים לפי `attachmentId` */
  attachments: Record<string, Buffer>;
}

// ─────────────────────────────── בניית ההודעה ───────────────────────────────

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * כותרת `Date` בשעון ישראל בקיץ (+0300) — ספטמבר הוא שעון קיץ.
 *
 * הכותרת נכתבת אף ש-`toEnvelope` מעדיף את `internalDate`: היא חלק ממה
 * שהודעה אמיתית נושאת, ובדיקה שתמחק את `internalDate` (שולח עם שעון מוטה,
 * EM-22) צריכה שהגיבוי יהיה שם.
 */
function rfc5322Date(date: Date): string {
  const local = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
  return `${DAYS[local.getUTCDay()]}, ${pad(local.getUTCDate())} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()} ${time} +0300`;
}

const isAscii = (value: string) => /^[\x20-\x7e]*$/.test(value);

/** `=?UTF-8?B?...?=` לטקסט שאינו ASCII. base64 ולא quoted-printable — כך שולחים בפועל בעברית. */
function encodeWord(value: string, encode: boolean): string {
  if (!encode || isAscii(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function textNode(text: string, mimeType: "text/plain" | "text/html"): GmailMessagePart {
  return {
    mimeType,
    headers: [
      { name: "Content-Type", value: `${mimeType}; charset="UTF-8"` },
      { name: "Content-Transfer-Encoding", value: "base64" },
    ],
    body: { size: Buffer.byteLength(text, "utf8"), data: Buffer.from(text, "utf8").toString("base64url") },
  };
}

function multipartNode(subtype: string, children: GmailMessagePart[]): GmailMessagePart {
  return {
    mimeType: `multipart/${subtype}`,
    headers: [{ name: "Content-Type", value: `multipart/${subtype}; boundary="----=_Part_${subtype}"` }],
    parts: children,
  };
}

function attachmentNode(part: PartSpec, encode: boolean): GmailMessagePart {
  const disposition = part.disposition ?? "attachment";
  const filename = part.filename ?? null;
  const encoded = filename === null ? null : encodeWord(filename, encode);
  const headers = [
    { name: "Content-Type", value: encoded === null ? part.mimeType : `${part.mimeType}; name="${encoded}"` },
    { name: "Content-Transfer-Encoding", value: "base64" },
    {
      name: "Content-Disposition",
      value: encoded === null ? disposition : `${disposition}; filename="${encoded}"`,
    },
  ];
  if (part.contentId) headers.push({ name: "Content-ID", value: `<${part.contentId}>` });

  return {
    mimeType: part.mimeType,
    // Gmail מוסר את `filename` כבר מפוענח; הכותרות נשארות מקודדות
    ...(filename === null ? {} : { filename }),
    headers,
    body: part.attachmentId
      ? { size: part.bytes.length, attachmentId: part.attachmentId }
      : { size: part.bytes.length, data: part.bytes.toString("base64url") },
  };
}

/**
 * מבנה ההודעה, כפי שלקוחות דואר בונים אותו: `alternative` לשתי צורות הגוף,
 * `related` סביבו כשיש תמונה משובצת, ו-`mixed` סביב הכול כשיש קובץ מצורף.
 *
 * הקינון הזה אינו קישוט: מיספור החלקים במעטפה הוא סדר ה-DFS, ומבנה שטוח
 * היה נותן לבדיקה מספרי חלקים שאינם מה שיגיע בפועל.
 */
function buildTree(spec: MailSpec): GmailMessagePart {
  const text = spec.text ?? "";
  const html = spec.html ?? null;
  const parts = spec.parts ?? [];
  const encode = spec.encodeHeaders ?? true;

  const body =
    html === null
      ? textNode(text, "text/plain")
      : multipartNode("alternative", [textNode(text, "text/plain"), textNode(html, "text/html")]);

  const inline = parts.filter((part) => part.disposition === "inline");
  const files = parts.filter((part) => part.disposition !== "inline");

  const related =
    inline.length > 0 ? multipartNode("related", [body, ...inline.map((part) => attachmentNode(part, encode))]) : body;

  return files.length > 0
    ? multipartNode("mixed", [related, ...files.map((part) => attachmentNode(part, encode))])
    : related;
}

function messageHeaders(spec: MailSpec, contentType: string, id: string): { name: string; value: string }[] {
  const encode = spec.encodeHeaders ?? true;
  const from = spec.from === undefined ? SENDER : spec.from;
  const fromName = spec.fromName === undefined ? SENDER_NAME : spec.fromName;
  const receivedAt = spec.receivedAt ?? ARRIVED_AT;
  const references = spec.references ?? [];

  const headers: { name: string; value: string }[] = [];
  const push = (name: string, value: string | null | undefined) => {
    if (value) headers.push({ name, value });
  };

  push("Delivered-To", MAILBOX);
  push("Return-Path", from ? `<${from}>` : null);
  push("Date", rfc5322Date(receivedAt));
  push("From", from ? (fromName ? `${encodeWord(fromName, encode)} <${from}>` : from) : null);
  push("To", (spec.to ?? [MAILBOX]).join(", "));
  push("Cc", (spec.cc ?? []).join(", "));
  push("Subject", encodeWord(spec.subject ?? "", encode));
  push("Message-ID", spec.messageId === null ? null : `<${spec.messageId ?? `${id}@${MAIL_HOST}`}>`);
  push("In-Reply-To", spec.inReplyTo ? `<${spec.inReplyTo}>` : null);
  push("References", references.map((id) => `<${id}>`).join(" "));
  push("MIME-Version", "1.0");
  push("Content-Type", contentType);

  // דריסות אחרונות: `headerMap` נותן ניצחון לערך האחרון, ו-`null` מסיר
  // כותרת שנגזרה (הודעה בלי `Message-ID`, למשל).
  for (const [name, value] of Object.entries(spec.headers ?? {})) {
    const lower = name.toLowerCase();
    for (let i = headers.length - 1; i >= 0; i--) {
      if (headers[i].name.toLowerCase() === lower) headers.splice(i, 1);
    }
    push(name, value);
  }

  return headers;
}

/** ההודעה כפי ש-`users.messages.get?format=full` מחזיר אותה */
export function gmailMessage(spec: MailSpec = {}): GmailMessage {
  const id = spec.id ?? "gmail-message";
  const root = buildTree(spec);
  const contentTypeHeader = (root.headers ?? []).find((header) => header.name === "Content-Type")?.value ?? "text/plain";
  // כותרות החלק העליון **הן** כותרות ההודעה: כך Gmail מוסר אותן, ולכן
  // `Content-Type` של השורש נגזר מהמבנה שנבנה ולא נכתב פעמיים. מה שאינו
  // `Content-Type` (קידוד ההעברה של גוף חד-חלקי) נשמר אחריהן.
  const inherited = (root.headers ?? []).filter((header) => header.name !== "Content-Type");

  return {
    id,
    threadId: spec.threadId ?? id,
    internalDate: String((spec.receivedAt ?? ARRIVED_AT).getTime()),
    payload: { ...root, headers: [...messageHeaders(spec, contentTypeHeader, id), ...inherited] },
  };
}

/** הודעה אחת: מעטפה, ההודעה הגולמית, והבתים שיש להוריד בנפרד */
export function mailFixture(spec: MailSpec = {}): MailFixture {
  const message = gmailMessage(spec);
  const attachments: Record<string, Buffer> = {};
  for (const part of spec.parts ?? []) {
    if (part.attachmentId) attachments[part.attachmentId] = part.bytes;
  }
  return { envelope: toEnvelope(message), message, attachments };
}

/** קיצור למי שצריך רק את המעטפה */
export function mailEnvelope(spec: MailSpec = {}): MailEnvelope {
  return mailFixture(spec).envelope;
}

// ─────────────────────────────── קבצים מוכנים ───────────────────────────────

/** תמונה משובצת בגוף (`cid:`) — נחשבת קובץ מצורף לכל דבר (EM-06a) */
export function inlineImagePart(overrides: Partial<PartSpec> = {}): PartSpec {
  return {
    mimeType: "image/png",
    bytes: PNG_BYTES,
    filename: "image001.png",
    disposition: "inline",
    contentId: `image001@${MAIL_HOST}`,
    ...overrides,
  };
}

/**
 * PDF שנמסר כהפניה בלבד — הבתים יורדים בקריאה נפרדת.
 *
 * דווקא כך ולא מוטבע: זה המסלול שיש בו קריאת רשת נוספת, ולכן זה המסלול
 * שבדיקה חייבת לכסות. שם הקובץ בעברית מפעיל את פענוח RFC 2047 של שם קובץ,
 * שבלעדיו לשם אין סיומת.
 */
export function pdfAttachmentPart(overrides: Partial<PartSpec> = {}): PartSpec {
  return {
    mimeType: "application/pdf",
    bytes: PDF_BYTES,
    filename: "דוח בדק בית.pdf",
    disposition: "attachment",
    attachmentId: "attachment-pdf",
    ...overrides,
  };
}

/** קובץ שאינו מדיה — נשמר בהתכתבות בלבד ואינו הופך ל-`MediaFile` (EM-06a) */
export function documentAttachmentPart(overrides: Partial<PartSpec> = {}): PartSpec {
  return {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: DOCX_BYTES,
    filename: "טופס.docx",
    disposition: "attachment",
    attachmentId: "attachment-docx",
    ...overrides,
  };
}

// ─────────────────────────────── ההודעות ───────────────────────────────

/** מייל ראשון תקין: הכותרת נושאת את המילה, והשולח מורשה (EM-01) */
export function firstMail(spec: MailSpec = {}): MailFixture {
  return mailFixture({
    id: "gmail-first",
    threadId: "thread-first",
    messageId: FIRST_MAIL_MESSAGE_ID,
    subject: FIRST_MAIL_SUBJECT,
    text: FIRST_MAIL_TEXT,
    ...spec,
  });
}

/**
 * אותו שולח מורשה, בלי המילה בכותרת — אינו נקלט **ואינו נענה** (EM-03).
 * הכותרת נבחרה כך שגם "תקלת" אינה בה: `תקלת` אינה עונה על הכלל (EM-A10),
 * ומי שיבדוק אותה יעשה זאת במפורש.
 */
export function mailWithoutKeyword(spec: MailSpec = {}): MailFixture {
  return mailFixture({
    id: "gmail-no-keyword",
    threadId: "thread-no-keyword",
    messageId: `no-keyword@${MAIL_HOST}`,
    subject: "שאלה על הדירה בבניין ב'",
    text: "שלום, רציתי לברר מתי מתוכננת הבדיקה השנתית בבניין. תודה.",
    ...spec,
  });
}

/**
 * תשובה בשרשרת קיימת: `In-Reply-To` מצביע על המייל החוזר **שלנו**, ואותו
 * `threadId`. הכותרת היא `Re:` ולכן מכילה את המילה — וזה בדיוק העניין:
 * תשובה מזוהה לפי השרשרת ולא לפי הכותרת, ואינה פותחת פנייה חדשה (EM-14).
 *
 * הגוף מכיל טקסט חדש **וציטוט** בשתי הצורות (טקסט ו-HTML), כדי ש-
 * `extractNewText` יוכל לעשות את עבודתו ולא יקבל טקסט נקי מראש.
 */
export function replyInThread(spec: MailSpec = {}): MailFixture {
  return mailFixture({
    id: "gmail-reply",
    threadId: "thread-first",
    messageId: REPLY_MESSAGE_ID,
    inReplyTo: OUTGOING_REPLY_MESSAGE_ID,
    references: [FIRST_MAIL_MESSAGE_ID, OUTGOING_REPLY_MESSAGE_ID],
    subject: `Re: ${FIRST_MAIL_SUBJECT}`,
    receivedAt: REPLY_ARRIVED_AT,
    text: REPLY_TEXT,
    html: REPLY_HTML,
    ...spec,
  });
}

/**
 * תשובה אוטומטית ("מחוץ למשרד") — אינה נקלטת ואינה נענית (EM-23).
 *
 * `Auto-Submitted` הוא הסימן התקני, והכותרת היא רשת הביטחון.
 * `X-Auto-Response-Suppress` נמצא כאן **בכוונה ואינו סימן**: Outlook מציב
 * אותו גם במייל שאדם כתב, וזיהוי שנשען עליו היה מפיל פניות אמיתיות.
 */
export function autoReplyMail(spec: MailSpec = {}): MailFixture {
  return mailFixture({
    id: "gmail-auto-reply",
    threadId: "thread-auto-reply",
    messageId: `auto-reply@${MAIL_HOST}`,
    subject: `Automatic reply: ${FIRST_MAIL_SUBJECT}`,
    text: "אני בחופשה עד 25 בספטמבר. לפניות דחופות אפשר לפנות למשרד.",
    headers: { "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All" },
    ...spec,
  });
}

/**
 * מייל עם תמונה משובצת ועם PDF מצורף (EM-06).
 *
 * התמונה מוטבעת בהודעה וה-PDF נמסר כהפניה — שני המסלולים שקיימים בפועל,
 * באותה הודעה, כדי שבדיקה אחת תכסה את שניהם.
 */
export function mailWithAttachments(spec: MailSpec = {}): MailFixture {
  return mailFixture({
    id: "gmail-attachments",
    threadId: "thread-attachments",
    messageId: `attachments@${MAIL_HOST}`,
    subject: "תקלה בדירה 12 - מצורפת תמונה ודוח",
    text: "מצרפת צילום של הנזילה ואת דוח בדק הבית של הדירה.",
    html: `<div dir="rtl">מצרפת צילום של הנזילה.<img src="cid:image001@${MAIL_HOST}"></div>`,
    parts: [inlineImagePart(), pdfAttachmentPart()],
    ...spec,
  });
}

/** כתובת שאינה של אף משתמש. הכותרת תקינה, ולכן הסיבה היחידה לדחייה היא השולח (EM-03). */
export function mailFromStranger(spec: MailSpec = {}): MailFixture {
  return mailFixture({
    id: "gmail-stranger",
    threadId: "thread-stranger",
    messageId: `stranger@${MAIL_HOST}`,
    from: STRANGER,
    fromName: STRANGER_NAME,
    subject: "תקלה בבניין א' - הצעת מחיר",
    text: "שלום, בהמשך לשיחתנו מצרף הצעת מחיר לתיקון.",
    ...spec,
  });
}

/**
 * מייל שהועבר (`Fwd:`) — מנהל שמעביר תלונה של דיירת.
 *
 * הבלוק המועבר הוא הדיווח עצמו (§7 שורה 73, EM-A04), ולכן במייל ראשון
 * **אין** להריץ עליו את הסרת הציטוט. ה-fixture מחזיק את הבלוק במלואו כדי
 * שבדיקה תוכל לוודא שהוא הגיע לחילוץ.
 */
export function forwardedMail(spec: MailSpec = {}): MailFixture {
  return mailFixture({
    id: "gmail-forwarded",
    threadId: "thread-forwarded",
    messageId: `forwarded@${MAIL_HOST}`,
    subject: "Fwd: תקלה במעלית בבניין א'",
    text: [
      "מעבירה אליכם תלונה של דיירת.",
      "",
      "---------- הודעה שהועברה ----------",
      "מאת: רונית לוי <ronit@resident.example.com>",
      "תאריך: יום ג', 15 בספט' 2026",
      "נושא: תקלה במעלית",
      `אל: ${SENDER_NAME} <${SENDER}>`,
      "",
      "המעלית בבניין א' נתקעת בין הקומות כבר שבוע, והדלת נפתחת באיחור.",
    ].join("\n"),
    ...spec,
  });
}
