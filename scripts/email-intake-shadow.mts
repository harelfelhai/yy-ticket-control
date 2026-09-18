import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { autoReplySignal, type AutoReplySignal } from "../src/lib/email-intake/auto-reply";
import { classifyAttachment, type GmailMessagePart } from "../src/lib/email-intake/mime";
import { POLL_LOOKBACK_HOURS, buildPollQueries, isQueryableAddress, pollWindowStart } from "../src/lib/email-intake/query";
import { extractNewText, htmlToText, removePriorBodies, stripQuotedHtml, stripQuotedText } from "../src/lib/email-intake/quote";
import type { MailSource } from "../src/lib/email-intake/source";
import type { GoogleOAuthConfig } from "../src/lib/google/gmail-token";
import { isIntakeSubject } from "../src/lib/email-intake/subject";
import type { MailAddress, MailEnvelope } from "../src/lib/email-intake/types";
import { normalizeEmail } from "../src/lib/normalize";

/**
 * ריצת צל על התיבה האמיתית — **השער של S5** (תכנית פתיחת פנייה במייל).
 *
 * **מה זה בודק, ולמה בדיקות אינן מספיקות.** כל הליבה של S3 נבדקה על מיילים
 * שכתבנו בעצמנו, ולכן היא נכונה בדיוק לגבי מה שדמיינו. מה שאי אפשר לדמיין
 * הוא התיבה עצמה: איזה לקוח דואר שולח בפועל, איזה charset, אילו קידומות
 * כותרת, כמה מהמיילים בכלל עונים לכלל, וכמה מהתשובות מצטטות בצורה שהמסיר
 * שלנו אינו מזהה. ריצת הצל מריצה את **הליבה הטהורה בלבד** על התיבה
 * האמיתית ומדפיסה מפקד — כדי שההחלטה להפעיל את הצינור (S6) תישען על מספרים
 * ולא על הערכה.
 *
 * **שלוש הבטחות, ושלושתן נאכפות במנגנון ולא במשמעת:**
 *
 * 1. **אינו משנה דבר בתיבה** (EM-20). כל התעבורה עוברת ב-`guardedFetch`,
 *    שזורק על כל שיטה שאינה GET — גם אם מודול המקור ישתנה מתחתינו. הבקשות
 *    נספרות ומודפסות בסוף, כך שהקורא רואה שלא הייתה אף בקשה אחרת.
 * 2. **אינו כותב לבסיס הנתונים.** החיבור נפתח מ-`SHADOW_READONLY_DATABASE_URL`
 *    — משתנה נפרד, **לא** `DATABASE_URL` ולא הלקוח של האפליקציה — עם
 *    `default_transaction_read_only=on` ובתוך `BEGIN TRANSACTION READ ONLY`.
 *    כתיבה בשוגג נדחית בבסיס (שגיאה 25006), לא בקוד שלנו.
 * 3. **אינו שולח דבר.** אין כאן ייבוא של ערוץ המייל בכלל.
 *
 * **הפלט הוא ספירות בלבד.** התיבה משותפת עם מערכת אחרת, והפלט הזה מגיע
 * לצ׳אט ולדוחות: אין בו כותרות, כתובות, שמות או תוכן. מי שצריך את המבנה
 * עצמו מבקש `--out`, שכותב מתקנים **מעוקרי זהות** — ראה `anonymize`.
 *
 * הרצה:
 *   npx tsx scripts/email-intake-shadow.mts [--limit 200] [--since 7d] [--out .shadow/]
 */

// ─────────────────────────────── ארגומנטים ───────────────────────────────

export interface ShadowOptions {
  /** כמה הודעות להביא במלואן. הרשימה עצמה נקראת בלי גבול — היא זולה */
  limit: number;
  /** תחילת החלון, או null: אז הוא נגזר מ-`pollWindowStart` כמו בצינור עצמו */
  since: Date | null;
  /** תיקיית מתקנים מעוקרי זהות, או null */
  outDir: string | null;
}

const DEFAULT_LIMIT = 200;

/**
 * `--since` מקבל גם משך (`7d`, `48h`) וגם תאריך ISO.
 *
 * המשך הוא מה שמקלידים בפועל, והתאריך הוא מה שנדרש כדי לחזור על ריצה
 * קודמת בדיוק. תאריך שאינו נקרא **זורק ולא נופל לברירת מחדל**: חלון שקט
 * ושגוי היה מייצר מפקד שנראה תקין ואינו מתאר את מה שנבדק.
 */
export function parseSince(value: string, now: Date): Date {
  const duration = /^(\d+)([dh])$/.exec(value.trim());
  if (duration) {
    const amount = Number(duration[1]);
    const hours = duration[2] === "d" ? amount * 24 : amount;
    return new Date(now.getTime() - hours * 60 * 60 * 1000);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`--since לא נקרא: "${value}". צורות מותרות: 7d, 48h, או תאריך ISO`);
  }
  return parsed;
}

/**
 * דגל לא מוכר **מפיל את הריצה**, ואינו מתעלם בשקט: `--limit 50` שהוקלד
 * `--limits 50` היה מריץ על 200 הודעות ומדפיס מפקד שאינו מה שהתבקש.
 */
export function parseArgs(argv: readonly string[], now: Date): ShadowOptions {
  const options: ShadowOptions = { limit: DEFAULT_LIMIT, since: null, outDir: null };

  for (let at = 0; at < argv.length; at++) {
    const flag = argv[at];
    const value = argv[at + 1];
    if (flag === "--limit") {
      const limit = Number(value);
      if (!Number.isInteger(limit) || limit <= 0) throw new Error(`--limit דורש מספר שלם חיובי, התקבל "${value}"`);
      options.limit = limit;
      at++;
    } else if (flag === "--since") {
      if (value === undefined) throw new Error("--since דורש ערך");
      options.since = parseSince(value, now);
      at++;
    } else if (flag === "--out") {
      if (value === undefined) throw new Error("--out דורש נתיב תיקייה");
      options.outDir = value;
      at++;
    } else {
      throw new Error(`דגל לא מוכר: ${flag}`);
    }
  }
  return options;
}

// ─────────────────────────────── קריאה בלבד ───────────────────────────────

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RequestRecord {
  method: string;
  /** הנתיב בלבד, בלי הפרמטרים: בשאילתה יושבות כתובות של שולחים */
  path: string;
  status: number;
}

/**
 * העטיפה שמבטיחה שריצת הצל אינה נוגעת בתיבה (EM-20).
 *
 * המקור (`gmail-source.ts`) בנוי כך שאין בו מסלול שמייצר שיטה אחרת, וזו
 * השכבה השנייה: **הסקריפט אינו סומך על כך**, כי הוא רץ ביד מול תיבה חיה
 * שמשותפת עם מערכת אחרת, ושינוי עתידי במקור אינו אמור להיות מסוגל להפוך
 * ריצת אבחון לפעולה. הזריקה היא לפני היציאה לרשת, ולכן בקשה כזו לעולם
 * אינה נשלחת.
 *
 * ה-URL נרשם **בלי ה-query**: שם יושבות כתובות השולחים של השאילתה, והיומן
 * הזה מודפס.
 */
export function guardedFetch(inner: FetchLike, log: RequestRecord[]): FetchLike {
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (method !== "GET") {
      throw new Error(`ריצת הצל היא קריאה בלבד — נחסמה בקשת ${method} אל ${url.pathname}`);
    }
    const response = await inner(input, init);
    log.push({ method, path: url.pathname, status: response.status });
    return response;
  };
}

/** נתיב של הודעה בודדת (`.../messages/{id}`), ולא של הרשימה ולא של קובץ מצורף */
const MESSAGE_PATH = /\/messages\/[^/]+$/;

export interface ShadowSourceDeps {
  /** לבדיקות בלבד: התעבורה בפועל. ברירת המחדל היא `fetch` הגלובלי */
  fetch?: FetchLike;
  /** יומן הבקשות אל התיבה — מה שמודפס בסוף כהוכחה שכולן היו GET */
  requests: RequestRecord[];
  /** ה-JSON הגולמי של כל הודעה, ל-charsets. לא נאסף כשלא נמסרה מפה */
  rawPayloads?: Map<string, GmailMessagePart>;
}

/**
 * חיווט המקור לריצה אמיתית — **ולמה הוא פונקציה ולא שורות בתוך `main`.**
 *
 * הנפקת ה-access token היא בקשת POST אל `oauth2.googleapis.com`, ולא אל
 * התיבה. שומר ה-GET הוא הבטחה על **התיבה** (EM-20), ולכן הוא עוטף את תעבורת
 * Gmail בלבד; מסירת אותו שומר גם לספק הטוקן חוסמת את הבקשה הראשונה של הריצה,
 * וריצת הצל מתה לפני הקריאה הראשונה. זה קרה בפועל, ולא נראה באף בדיקה — כי
 * החיווט ישב ב-`main`, שאיש אינו מריץ. מכאן שהוא כאן, ונבדק.
 *
 * ה-JSON הגולמי נלכד בדרך חזרה, בלי בקשה נוספת ובלי לפתוח את המקור: `clone`
 * קורא את אותה תשובה פעמיים, והמקור מקבל אותה שלמה.
 */
export async function createShadowSource(
  oauth: GoogleOAuthConfig,
  deps: ShadowSourceDeps,
): Promise<MailSource> {
  const { createAccessTokenProvider } = await import("../src/lib/google/gmail-token");
  const { gmailSource } = await import("../src/lib/email-intake/gmail-source");

  const call: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const rawPayloads = deps.rawPayloads;

  const capturing: FetchLike = async (input, init) => {
    const response = await call(input, init);
    if (!rawPayloads) return response;
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (response.ok && MESSAGE_PATH.test(url.pathname)) {
      const message = (await response.clone().json()) as { id?: string; payload?: GmailMessagePart };
      if (message.id && message.payload) rawPayloads.set(message.id, message.payload);
    }
    return response;
  };

  return gmailSource(oauth, {
    fetch: guardedFetch(capturing, deps.requests),
    getAccessToken: createAccessTokenProvider(oauth, deps.fetch ? { fetch: deps.fetch } : {}),
  });
}

// ─────────────────────────────── הכרעה ───────────────────────────────

/**
 * ההכרעה שהצינור היה מגיע אליה. אוצר המילים הוא של `MailOutcome` בסכימה,
 * כדי שהמפקד יהיה בר-השוואה למה שיירשם ביומן כשהצינור יפעל — למעט אחד:
 *
 * **`REPLY_UNKNOWN_THREAD` אינו קיים ב-`MailOutcome`.** תשובה מזוהה בצינור
 * מול `MailThread`, וטבלה זו ריקה כל עוד המערכת לא שלחה מייל אחד; בצל אין
 * שום דרך לדעת אם ההודעה שהתשובה מפנה אליה היא שלנו. לכן כל הודעה עם
 * `In-Reply-To` נספרת בנפרד, ולא מנוחשת כ-`REPLY_APPLIED`.
 */
export type ShadowVerdict =
  | "IGNORED_BEFORE_ACTIVATION"
  | "IGNORED_OWN_MESSAGE"
  | "IGNORED_AUTO_REPLY"
  | "IGNORED_UNAUTHORIZED"
  | "IGNORED_SUBJECT"
  | "REPLY_UNKNOWN_THREAD"
  | "DRAFT_CREATED";

export interface ClassifyContext {
  /** כתובת התיבה, כפי ש-`getProfile` החזיר */
  mailbox: string;
  /** כתובות מורשות, מנורמלות. הערך אינו בשימוש בהכרעה — רק המפתח */
  senders: ReadonlySet<string>;
  /** רצפת ההפעלה מ-`MailChannelState`, או null כשהערוץ טרם הופעל */
  activatedAt: Date | null;
}

export interface Classification {
  verdict: ShadowVerdict;
  signal: AutoReplySignal | null;
  isReply: boolean;
  subjectMatches: boolean;
}

/**
 * סדר הבדיקות, ולמה דווקא הוא.
 *
 * הרצפה והמייל-של-עצמנו ראשונים, כי הם אינם "החלטה" אלא גבולות הקלט. אחריהם
 * התשובה האוטומטית ורק אז ההרשאה, אף שבאפיון ההרשאה היא שלב 2: משיב אוטומטי
 * שעונה למייל שלנו הוא בדיוק המקרה שהזיהוי נועד לו, ולעיתים קרובות הוא מגיע
 * **מכתובת מורשה** — לתייג אותו "שולח לא מורשה" היה מסתיר את הסימן המעניין.
 * ההכרעה הסופית של הסדר היא של S6; כאן הוא נבחר לפי מה שמלמד יותר, ותיוג
 * שונה בין שני הסדרים אפשרי רק בהודעה שנפסלת בשני המקרים ממילא.
 */
export function classify(envelope: MailEnvelope, context: ClassifyContext): Classification {
  const signal = autoReplySignal({
    headers: envelope.headers,
    subject: envelope.subject,
    from: envelope.from,
    contentType: envelope.contentType,
  });
  const isReply = envelope.inReplyTo !== null || envelope.references.length > 0;
  const subjectMatches = isIntakeSubject(envelope.subject);
  const sender = envelope.from ? normalizeEmail(envelope.from.address) : "";
  const decide = (): ShadowVerdict => {
    if (context.activatedAt && envelope.receivedAt < context.activatedAt) return "IGNORED_BEFORE_ACTIVATION";
    if (sender && sender === normalizeEmail(context.mailbox)) return "IGNORED_OWN_MESSAGE";
    if (signal) return "IGNORED_AUTO_REPLY";
    if (!context.senders.has(sender)) return "IGNORED_UNAUTHORIZED";
    if (isReply) return "REPLY_UNKNOWN_THREAD";
    return subjectMatches ? "DRAFT_CREATED" : "IGNORED_SUBJECT";
  };
  return { verdict: decide(), signal, isReply, subjectMatches };
}

// ─────────────────────────────── מפקד ───────────────────────────────

/**
 * איך יצא ניקוי הציטוט בתשובה (EM-13).
 *
 * `clean` אינו "הוסר משהו" אלא **הוסר ונשאר טקסט**: תשובה שכל גופה נמחק
 * היא כשל שקט — הצינור היה מחלץ ממנה ריק ומדווח לשולח שלא הבין. `none`
 * הוא הכשל ההפוך: הציטוט לא זוהה, והחילוץ היה קורא גם את המייל הקודם.
 */
export type QuoteOutcome = "clean" | "none" | "emptied";

/**
 * איך יצא ניקוי הציטוט — לפי מה ש**זוהה והוסר**, ולא לפי אורך הטקסט שנשאר.
 *
 * ההבחנה הזו אינה עקרונית אלא נמדדת: `extractNewText` מעדיף את מסלול ה-HTML,
 * ורוב לקוחות הדואר שולחים תשובה שהגוף הפשוט שלה ריק והציטוט מסומן במבנה
 * ה-HTML. השוואה של אורך הטקסט החדש מול הגוף הפשוט הייתה מדווחת על כל אחת
 * מהן "הציטוט לא זוהה" — כלומר המדד המרכזי של השער היה יוצא הפוך דווקא
 * במקרה השכיח.
 *
 * הבדיקה חוזרת על המסירים עצמם (`stripQuotedHtml`, `stripQuotedText`,
 * `removePriorBodies`), כי `extractNewText` אינו מחזיר את דגלי ה-`removed`
 * שלהם. זו עלות זניחה על מאתיים הודעות, והיא נשענת על אותו קוד בדיוק שהצינור
 * יריץ — ולא על שחזור שלו.
 *
 * **וחשוב מכך: על אותו טקסט.** ההשוואה למיילים הקודמים היא השכבה שנכתבה
 * ללקוח שמצטט בלי שום סימון, ובתשובה כזו הגוף הפשוט ריק והציטוט יושב ב-HTML.
 * הרצה שלה על הגוף הפשוט תחזיר תמיד "לא הוסר", והמפקד היה מדווח "הציטוט לא
 * זוהה" דווקא על המקרה שבגללו השכבה קיימת. לכן כל מסיר נבדק על הטקסט
 * שבמסלולו — בדיוק כפי ש-`extractNewText` מפעיל אותו.
 */
function removedFromText(text: string, priorBodies: readonly string[]): boolean {
  const stripped = stripQuotedText(text);
  return stripped.removed || removePriorBodies(stripped.text, priorBodies).removed;
}

export function quoteOutcome(
  body: { text: string; html: string | null },
  priorBodies: readonly string[],
  newText: string,
): QuoteOutcome {
  // ריק הוא ריק בלי קשר לסיבה: זה מה שהחילוץ היה מקבל, וזה הכשל השקט שמעניין.
  if (newText === "") return "emptied";

  const html = body.html !== null && body.html.trim() !== "" ? body.html : null;
  if (html !== null) {
    const stripped = stripQuotedHtml(html);
    if (stripped.removed || removedFromText(htmlToText(stripped.html), priorBodies)) return "clean";
  }
  // גם כשיש HTML נבדק הגוף הפשוט: `extractNewText` נופל אליו כשמסלול ה-HTML
  // יצא ריק, ואז הוא זה שהפיק את הטקסט החדש.
  return removedFromText(body.text, priorBodies) ? "clean" : "none";
}

export interface Census {
  queries: number;
  listed: number;
  fetched: number;
  gone: number;
  errors: Map<string, number>;
  verdicts: Map<ShadowVerdict, number>;
  signals: Map<AutoReplySignal, number>;
  subjectMatches: number;
  replies: number;
  quotes: Map<QuoteOutcome, number>;
  quotedInlineImages: number;
  contentTypes: Map<string, number>;
  charsets: Map<string, number>;
  /** הסוג כפי שהוצהר בכותרת מול הסוג ש-`classifyAttachment` פתר */
  declaredTypes: Map<string, number>;
  resolvedTypes: Map<string, number>;
  inlineImages: number;
  tnef: number;
  attachmentsInline: number;
  attachmentsByRef: number;
  emptyText: number;
}

export function newCensus(): Census {
  return {
    queries: 0,
    listed: 0,
    fetched: 0,
    gone: 0,
    errors: new Map(),
    verdicts: new Map(),
    signals: new Map(),
    subjectMatches: 0,
    replies: 0,
    quotes: new Map(),
    quotedInlineImages: 0,
    contentTypes: new Map(),
    charsets: new Map(),
    declaredTypes: new Map(),
    resolvedTypes: new Map(),
    inlineImages: 0,
    tnef: 0,
    attachmentsInline: 0,
    attachmentsByRef: 0,
    emptyText: 0,
  };
}

function bump<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** מפה כטקסט, מהנפוץ לנדיר. ריקה מוצגת כ-"—" ולא כשורה ריקה שנקראת כשגיאה */
function formatMap<K extends string>(map: Map<K, number>): string {
  if (map.size === 0) return "—";
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([key, count]) => `${key} ${count}`)
    .join(" · ");
}

/**
 * ה-charset של כל חלק טקסט, מתוך ה-JSON הגולמי של Gmail.
 *
 * המעטפה אינה נושאת charset בכוונה — `mime.ts` כבר פיענח לפיו, ומעלה הזרם
 * אין לו שימוש. במפקד דווקא כן: charset שאינו מוכר הוא הסיבה המרכזית לטקסט
 * עברי משובש, וחלק מהערך של הריצה הזו הוא לדעת אילו מופיעים בתיבה בפועל.
 * ה-JSON נאסף מ-`guardedFetch` בלי אף בקשה נוספת.
 */
export function collectCharsets(payload: GmailMessagePart, into: Map<string, number>): void {
  const header = payload.headers?.find((h) => h.name.toLowerCase() === "content-type")?.value ?? "";
  const charset = /charset="?([^";\s]+)/i.exec(header)?.[1]?.toLowerCase();
  if (charset) bump(into, charset);
  for (const child of payload.parts ?? []) collectCharsets(child, into);
}

// ─────────────────────────────── עיקור זהות ───────────────────────────────

/**
 * ספר הכינויים: אותה כתובת מקבלת אותו כינוי בכל המתקנים שנכתבו באותה ריצה.
 *
 * יציבות היא מה שהופך מתקן לשימושי — שרשור בין שתי הודעות, שולח שחוזר,
 * תמונה משובצת שמופיעה גם בציטוט — ורשימת המקור לעולם אינה נכתבת לדיסק.
 */
export interface Book {
  /**
   * מפה לכל סוג כינוי בנפרד (`user`, `person`, `msg`, `thr`, `mid`, `cid`): מקור ← כינוי.
   *
   * נפרדות ולא מפה אחת עם מפתח משורשר: שרשור דורש מפריד שאינו יכול להופיע
   * בשם או בכתובת, וכל מועמד לתפקיד הזה הוא או תו בלתי נראה בקוד או הימור. המונה
   * לכל סוג הוא גודל המפה שלו, ולכן `msg-1` ו-`thr-1` הם ההודעה והשרשור הראשונים.
   */
  aliases: Map<string, Map<string, string>>;
  /** שמות אנשים מבסיס הנתונים: משתמשים, אנשי מקצוע ודיירים */
  known: readonly string[];
}

export function createBook(known: readonly string[]): Book {
  return {
    aliases: new Map(),
    // הארוך קודם: "ישראל ישראלי" חייב להיות מוחלף לפני "ישראל", אחרת נשאר
    // חצי שם אמיתי במתקן
    known: [...known].filter((name) => name.trim().length >= 2).sort((a, b) => b.length - a.length),
  };
}

function alias(book: Book, key: string, prefix: string): string {
  let bucket = book.aliases.get(prefix);
  if (!bucket) {
    bucket = new Map();
    book.aliases.set(prefix, bucket);
  }
  const existing = bucket.get(key);
  if (existing) return existing;
  const value = `${prefix}-${bucket.size + 1}`;
  bucket.set(key, value);
  return value;
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** מספר ישראלי בכל צורה שמוקלדת בחתימה: 050-1234567, 0501234567, +972-50-1234567 */
const PHONE_PATTERN = /(?:\+972[-\s]?|\b0)(?:[-\s]?\d){8,9}\b/g;
/**
 * תמונה שהוטבעה בגוף ה-HTML כ-`data:` URI.
 *
 * זו הדרך היחידה שבה בתים של קובץ נכנסים למתקן אף ש-`anonymize` מדלג על
 * `parts` בכוונה: הם אינם צרופה אלא חלק מה-HTML עצמו, שנכתב כמו שהוא. צילום
 * מסך של דירה מתיבה אמיתית אינו יכול להיכנס לריפו ציבורי, וגם אינו "מבנה".
 */
const DATA_URI_PATTERN = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi;

/**
 * מסיר מטקסט כל מה שמזהה אדם, ומשאיר את המבנה.
 *
 * ארבע שכבות, ולכל אחת סיבה נפרדת: בתים שהוטבעו ב-`data:` URI, הכתובות (גם
 * בגוף, לא רק בכותרות), השמות המוכרים מבסיס הנתונים (שם דייר בתוך משפט אינו
 * נראה ככתובת), וטלפונים (החתימה של כמעט כל מייל). מה שנשאר — "יש תקלה בדירה
 * 12" — הוא בדיוק מה שהמתקן אמור לשמר.
 *
 * ה-`data:` ראשון: אחריו אין בטקסט בלוק base64 ארוך שדפוס הטלפון יכול לחתוך
 * באמצע ולהשאיר ממנו שארית.
 */
export function redactPersonal(text: string, book: Book): string {
  let out = text.replace(DATA_URI_PATTERN, (match) => {
    // הקידומת נשמרת (`data:image/png;base64,`) ואיתה אורך המטען: כמה תמונות
    // הוטבעו ומאיזה סוג הן בדיוק מה שהמתקן נועד לספר.
    const head = match.slice(0, match.indexOf(",") + 1);
    return `${head}redacted-${match.length - head.length}`;
  });
  out = out.replace(EMAIL_PATTERN, (match) => `${alias(book, match.toLowerCase(), "user")}@example.invalid`);
  for (const name of book.known) {
    out = out.split(name).join(alias(book, name, "person"));
  }
  return out.replace(PHONE_PATTERN, "0500000000");
}

function redactAddress(address: MailAddress, book: Book): MailAddress {
  return {
    address: `${alias(book, normalizeEmail(address.address), "user")}@example.invalid`,
    name: address.name === null ? null : alias(book, address.name, "person"),
  };
}

/** כותרות שהמבנה שלהן מעניין. השאר (DKIM, Received, X-*) הוא רעש שנושא זהויות */
const KEPT_HEADERS = [
  "content-type",
  "content-transfer-encoding",
  "auto-submitted",
  "precedence",
  "return-path",
  "x-autoreply",
  "x-autorespond",
  "x-autoresponse",
  "x-auto-response-suppress",
  "date",
];

/**
 * שם קובץ כמתקן: כינוי, והסיומת כפי שהייתה.
 *
 * `redactPersonal` לבדו אינו מספיק כאן — הוא מכיר כתובות, שמות מבסיס הנתונים
 * וטלפונים, ושם של צרופה נושא לא פעם שם שאינו באף רשימה ("דוח ליקויים - דירה
 * 12 - משפחת כהן.pdf"). המתקנים נועדו להיכנס לריפו, והריפו ציבורי.
 *
 * הסיומת **נשמרת**, ולא במקרה: `classifyAttachment` נשען עליה כדי לפתור סוג
 * שהוצהר `octet-stream`, וזה בדיוק מה שמתקן כזה נועד לבדוק. השם עצמו אינו
 * מבנה.
 */
function redactFilename(filename: string, book: Book): string {
  const dot = filename.lastIndexOf(".");
  const extension = dot > 0 ? filename.slice(dot) : "";
  return `${alias(book, filename, "file")}${extension}`;
}

/**
 * המעטפה כמתקן: אותו מבנה, בלי אף פרט מזהה ובלי אף בית של קובץ.
 *
 * הבתים אינם נכתבים גם כשהם בידינו: מתקן אמור להיבדק בעין ולהיכנס לריפו,
 * ותמונה מתיבה אמיתית אינה יכולה. מה שנשמר הוא הגודל והסוג — מה שהבדיקות
 * צריכות.
 */
export function anonymize(envelope: MailEnvelope, book: Book, extra: Record<string, unknown>): Record<string, unknown> {
  const messageId = (value: string | null) => (value === null ? null : `<${alias(book, value, "mid")}@example.invalid>`);
  const text = (value: string) => redactPersonal(value, book);

  return {
    sourceId: alias(book, envelope.sourceId, "msg"),
    sourceThreadId: alias(book, envelope.sourceThreadId, "thr"),
    rfcMessageId: messageId(envelope.rfcMessageId),
    inReplyTo: messageId(envelope.inReplyTo),
    references: envelope.references.map((value) => messageId(value)),
    from: envelope.from ? redactAddress(envelope.from, book) : null,
    to: envelope.to.map((address) => redactAddress(address, book)),
    cc: envelope.cc.map((address) => redactAddress(address, book)),
    subject: text(envelope.subject),
    receivedAt: envelope.receivedAt.toISOString(),
    contentType: envelope.contentType,
    headers: Object.fromEntries(
      KEPT_HEADERS.filter((name) => envelope.headers[name] !== undefined).map((name) => [name, text(envelope.headers[name])]),
    ),
    text: text(envelope.text),
    html: envelope.html === null ? null : text(envelope.html),
    parts: envelope.parts.map((part) => ({
      index: part.index,
      filename: part.filename === null ? null : redactFilename(part.filename, book),
      mimeType: part.mimeType,
      sizeBytes: part.sizeBytes,
      contentId: part.contentId === null ? null : alias(book, part.contentId, "cid"),
      disposition: part.disposition,
      hasData: part.data !== null,
      hasSourceRef: part.sourceRef !== null,
    })),
    ...extra,
  };
}

// ─────────────────────────────── הריצה ───────────────────────────────

export interface ShadowInput {
  source: MailSource;
  /** כתובות מורשות מבסיס הנתונים, מנורמלות */
  senders: ReadonlySet<string>;
  /** כתובות מורשות שנדחו מהשאילתה (`isQueryableAddress`) — אובדן שקט אילו הצינור רץ */
  rejected: readonly string[];
  activatedAt: Date | null;
  names: readonly string[];
  options: ShadowOptions;
  now: Date;
  /** ה-JSON הגולמי של הודעה, לצורך ה-charset. ריק כשלא נאסף */
  rawPayload?: (sourceId: string) => GmailMessagePart | null;
}

export interface ShadowResult {
  census: Census;
  mailbox: string;
  since: Date;
  fixtures: Record<string, unknown>[];
}

/**
 * כל המזהים של שאילתה אחת, על פני כל העמודים.
 *
 * מיוצא כי `smoke-gmail-read.mts` סופר בדיוק אותו דבר: עמוד שנשכח מחזיר
 * ספירה קטנה מהאמת, וזו טעות שאין דרך לראות בפלט — ולכן לשני הסקריפטים
 * לולאת דפדוף אחת.
 */
export async function listAllIds(source: MailSource, query: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await source.listIds(query, pageToken ? { pageToken } : undefined);
    ids.push(...page.ids);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return ids;
}

/** קוד השגיאה של `MailSourceError`, בלי לייבא את המחלקה — הסקריפט אינו תלוי בה */
function errorKind(error: unknown): string {
  const kind = (error as { kind?: unknown })?.kind;
  return typeof kind === "string" ? kind : "unknown";
}

/**
 * הליבה: מקבלת `MailSource` מוזרק ומחזירה מפקד.
 *
 * מוזרק כדי שהבדיקות יריצו את אותו מסלול בדיוק על מקור מזויף — בלי רשת,
 * בלי טוקן ובלי התיבה. `main` הוא המקום היחיד שבונה מקור אמיתי.
 */
export async function runShadow(input: ShadowInput): Promise<ShadowResult> {
  const census = newCensus();
  const book = createBook(input.names);
  const fixtures: Record<string, unknown>[] = [];

  const profile = await input.source.getProfile();
  const since =
    input.options.since ??
    pollWindowStart({
      activatedAt: input.activatedAt ?? new Date(input.now.getTime() - POLL_LOOKBACK_HOURS * 60 * 60 * 1000),
      lastPollOkAt: null,
      now: input.now,
    });

  // רשימת המזהים לפני ההבאה: היא זולה, והספירה שלה היא המספר שמעניין
  // ("כמה בכלל היו") גם כשההבאה מוגבלת ב-`--limit`.
  const queries = buildPollQueries([...input.senders], since);
  census.queries = queries.length;
  const ids: string[] = [];
  for (const query of queries) ids.push(...(await listAllIds(input.source, query)));
  // אותה הודעה יכולה לחזור בשתי שאילתות (שולח בקבוצה אחרת) — הצינור מזהה
  // כפילות ביומן, וכאן די ב-Set
  const unique = [...new Set(ids)];
  census.listed = unique.length;

  const context: ClassifyContext = {
    mailbox: profile.emailAddress,
    senders: input.senders,
    activatedAt: input.activatedAt,
  };

  // שרשור: גופי ההודעות של אותו שרשור, לפי סדר ההבאה. `removePriorBodies`
  // הוא רשת הביטחון ללקוח שמצטט בלי סימון, והוא שווה משהו רק כשיש לו מה
  // להשוות מולו. בצינור אלה ההודעות מהיומן; כאן — מה שהובא בריצה הזו.
  const bodiesByThread = new Map<string, string[]>();

  for (const id of unique.slice(0, input.options.limit)) {
    let envelope: MailEnvelope | null;
    try {
      envelope = await input.source.getMessage(id);
    } catch (error) {
      bump(census.errors, errorKind(error));
      continue;
    }
    if (envelope === null) {
      census.gone++;
      continue;
    }
    census.fetched++;

    const decision = classify(envelope, context);
    bump(census.verdicts, decision.verdict);
    if (decision.signal) bump(census.signals, decision.signal);
    if (decision.subjectMatches) census.subjectMatches++;
    bump(census.contentTypes, envelope.contentType);

    const raw = input.rawPayload?.(envelope.sourceId) ?? null;
    if (raw) collectCharsets(raw, census.charsets);

    for (const part of envelope.parts) {
      bump(census.declaredTypes, part.mimeType);
      // הבתים הראשונים מאפשרים ל-`classifyAttachment` לזהות סוג אמיתי מול
      // הצהרה גנרית (PDF שהוצהר octet-stream). חלק שיושב מאחורי `attachmentId`
      // אינו מורד: הורדת קבצים מתיבה אמיתית אינה נחוצה למפקד.
      const resolved = classifyAttachment(part, part.data ? part.data.subarray(0, 64) : null);
      bump(census.resolvedTypes, resolved.mimeType);
      if (resolved.isTnef) census.tnef++;
      if (part.data) census.attachmentsInline++;
      if (part.sourceRef) census.attachmentsByRef++;
      // **לפי ה-Content-ID בלבד** (EM-06a): "תמונה משובצת בגוף" היא תמונה
      // שה-HTML מפנה אליה ב-`cid:`, וזו הכותרת היחידה שמאפשרת את ההפניה.
      // `Content-Disposition` אינו חלק מהכלל, ו-Outlook שולח תמונה משובצת גם
      // כ-`attachment` וגם בלי הכותרת כלל — דרישה של `inline` הייתה מדווחת
      // "אין תמונות משובצות" על התיבה שרובה Outlook.
      if (part.contentId && resolved.mimeType.startsWith("image/")) census.inlineImages++;
    }

    const prior = bodiesByThread.get(envelope.sourceThreadId) ?? [];
    if (envelope.text.trim() === "" && (envelope.html ?? "").trim() === "") census.emptyText++;

    // **רק בתשובות.** `quote.ts` אוסר במפורש להריץ את המסיר על מייל ראשון:
    // בהעברה (`Fwd:`) הבלוק המועבר הוא הדיווח עצמו (§7 שורה 73, EM-A04), ושם
    // הגוף המלא עובר לחילוץ. הרצה עליו הייתה סופרת תמונה שהצינור דווקא שומר,
    // ומדווחת עליה תחת שורת התשובות.
    let quote: QuoteOutcome | null = null;
    let newText: string | null = null;
    if (decision.isReply) {
      census.replies++;
      const extracted = extractNewText({ text: envelope.text, html: envelope.html, priorBodies: prior });
      newText = extracted.newText;
      census.quotedInlineImages += extracted.quotedContentIds.length;
      quote = quoteOutcome(envelope, prior, extracted.newText);
      bump(census.quotes, quote);
    }
    bodiesByThread.set(envelope.sourceThreadId, [...prior, envelope.text]);

    if (input.options.outDir) {
      fixtures.push(
        anonymize(envelope, book, {
          verdict: decision.verdict,
          autoReplySignal: decision.signal,
          isReply: decision.isReply,
          subjectMatches: decision.subjectMatches,
          quote,
          // null במייל ראשון, ולא שכפול של `text`: שם אין "טקסט חדש" — הגוף
          // כולו הוא מה שעובר לחילוץ.
          newText: newText === null ? null : redactPersonal(newText, book),
        }),
      );
    }
  }

  return { census, mailbox: profile.emailAddress, since, fixtures };
}

/** המפקד כטקסט. נפרד מהריצה כדי שבדיקה תוכל לאשר מה נאמר ומה לא נאמר */
export function formatCensus(result: ShadowResult, input: { rejected: readonly string[]; senders: ReadonlySet<string>; requests: readonly RequestRecord[]; options: ShadowOptions }): string {
  const { census } = result;
  const lines = [
    `[1] תיבה: ${result.mailbox}`,
    `    חלון: מאז ${result.since.toISOString()} · שולחים מורשים: ${input.senders.size}` +
      (input.rejected.length ? ` · נדחו מהשאילתה: ${input.rejected.length}` : ""),
    `[2] רשימה: ${census.queries} שאילתות · ${census.listed} מזהים ייחודיים · הובאו ${census.fetched}` +
      (census.listed > input.options.limit ? ` (מוגבל ב---limit ${input.options.limit})` : "") +
      (census.gone ? ` · נמחקו מהתיבה: ${census.gone}` : "") +
      (census.errors.size ? ` · שגיאות: ${formatMap(census.errors)}` : ""),
    `[3] הכרעות: ${formatMap(census.verdicts)}`,
    `    כותרת עונה לכלל: ${census.subjectMatches} · סימני תשובה אוטומטית: ${formatMap(census.signals)}`,
    `[4] ציטוט בתשובות (${census.replies}): ${formatMap(census.quotes)}`,
    `    מזהי תמונות שהוסרו עם הציטוט: ${census.quotedInlineImages}`,
    `[5] מבנה: ${formatMap(census.contentTypes)}`,
    `    charsets: ${formatMap(census.charsets)}`,
    `    הוצהר: ${formatMap(census.declaredTypes)}`,
    `    נפתר: ${formatMap(census.resolvedTypes)}`,
    `    תמונות משובצות: ${census.inlineImages} · בתים בהודעה: ${census.attachmentsInline} · להורדה בנפרד: ${census.attachmentsByRef} · TNEF: ${census.tnef} · גוף ריק: ${census.emptyText}`,
    `[6] בקשות: ${input.requests.length} · שיטות: ${formatMap(countMethods(input.requests))}`,
  ];
  return lines.join("\n");
}

function countMethods(requests: readonly RequestRecord[]): Map<string, number> {
  const methods = new Map<string, number>();
  for (const request of requests) bump(methods, request.method);
  return methods;
}

/**
 * כותב את המתקנים, קובץ להודעה.
 *
 * ההכרעה בשם הקובץ ולא רק בתוכן: מי שמחפש "תשובה שהציטוט בה לא זוהה" רואה
 * אותה ברשימת הקבצים. המספור מרופד באפסים כדי שמיון לפי שם ישמור על סדר
 * ההבאה, שהוא גם סדר השרשור.
 */
export function writeFixtures(dir: string, fixtures: readonly Record<string, unknown>[]): string[] {
  mkdirSync(dir, { recursive: true });
  return fixtures.map((fixture, index) => {
    const name = `${String(index + 1).padStart(3, "0")}-${String(fixture.verdict).toLowerCase()}.json`;
    writeFileSync(join(dir, name), `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
    return name;
  });
}

// ─────────────────────────────── בסיס הנתונים ───────────────────────────────

export interface ShadowLists {
  senders: Set<string>;
  rejected: string[];
  names: string[];
  activatedAt: Date | null;
}

/**
 * קריאת הרשימות מעותק **קריאה בלבד** של בסיס הנתונים.
 *
 * `SHADOW_READONLY_DATABASE_URL` ולא `DATABASE_URL`: ההפרדה היא מה שמונע
 * הרצה בשוגג מול הפרודקשן. שתי שכבות נוספות מוודאות שגם חיבור שהופנה בטעות
 * אינו יכול לכתוב — פרמטר הפעלה על החיבור, וטרנזאקציה שהוכרזה קריאה בלבד.
 *
 * הלקוח של האפליקציה (`src/lib/db.ts`) אינו בשימוש כאן בכוונה: הוא singleton
 * שקורא את `DATABASE_URL` ומריץ hooks של Prisma, וסקריפט אבחון אינו צריך
 * דבר מזה — רק חמש שאילתות SELECT.
 */
async function loadLists(connectionString: string): Promise<ShadowLists> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString, options: "-c default_transaction_read_only=on" });
  await client.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");

    const users = await client.query<{ email: string | null; name: string }>(
      `SELECT email, name FROM "User" WHERE active AND "emailIntakeEnabled"`,
    );
    const aliases = await client.query<{ address: string }>(
      `SELECT a.address FROM "UserEmailAlias" a JOIN "User" u ON u.id = a."userId" WHERE u.active AND u."emailIntakeEnabled"`,
    );
    const professionals = await client.query<{ name: string }>(`SELECT name FROM "Professional"`);
    const residents = await client.query<{ residentName: string }>(
      `SELECT "residentName" FROM "Apartment" WHERE "residentName" IS NOT NULL`,
    );

    // הטבלה נוספה במיגרציה של פתיחת פנייה במייל, וגיבוי ישן עשוי לא להכיל
    // אותה. שאילתה על טבלה חסרה מבטלת את כל הטרנזאקציה, ולכן נבדק קודם
    const state = (await tableExists(client, "MailChannelState"))
      ? // לפי הערוץ ולא השורה הראשונה: `channel` הוא המפתח הראשי, ובעתיד
        // תשב שם גם שורת הוואטסאפ — ורצפת ההפעלה שלה אינה של המייל
        await client.query<{ activatedAt: Date }>(
          `SELECT "activatedAt" FROM "MailChannelState" WHERE "channel" = $1`,
          ["EMAIL"],
        )
      : { rows: [] as { activatedAt: Date }[] };

    const addresses = [
      ...users.rows.map((row) => row.email).filter((email): email is string => Boolean(email)),
      ...aliases.rows.map((row) => row.address),
    ].map(normalizeEmail);

    await client.query("ROLLBACK");
    return {
      senders: new Set(addresses.filter(isQueryableAddress)),
      rejected: addresses.filter((address) => !isQueryableAddress(address)),
      names: [...users.rows.map((row) => row.name), ...professionals.rows.map((row) => row.name), ...residents.rows.map((row) => row.residentName)],
      activatedAt: state.rows[0]?.activatedAt ?? null,
    };
  } finally {
    await client.end();
  }
}

async function tableExists(client: { query: (sql: string) => Promise<{ rows: { exists: string | null }[] }> }, name: string): Promise<boolean> {
  const result = await client.query(`SELECT to_regclass('"${name}"') AS exists`);
  return result.rows[0]?.exists !== null;
}

// ─────────────────────────────── main ───────────────────────────────

async function main(): Promise<void> {
  const { config } = await import("dotenv");
  config({ path: ".env.local" });
  config();

  const now = new Date();
  const options = parseArgs(process.argv.slice(2), now);

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const databaseUrl = process.env.SHADOW_READONLY_DATABASE_URL;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("חסרים GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GMAIL_REFRESH_TOKEN");
  }
  if (!databaseUrl) {
    throw new Error(
      "SHADOW_READONLY_DATABASE_URL אינו מוגדר. ריצת הצל קוראת עותק משוחזר של בסיס הנתונים, ולא את בסיס האפליקציה",
    );
  }

  const lists = await loadLists(databaseUrl);
  if (lists.senders.size === 0) {
    throw new Error("אין שולחים מורשים בבסיס הנתונים — בלעדיהם אין שאילתה, והריצה לא הייתה בודקת דבר");
  }

  const requests: RequestRecord[] = [];
  const rawPayloads = new Map<string, GmailMessagePart>();
  const source = await createShadowSource({ clientId, clientSecret, refreshToken }, { requests, rawPayloads });

  const result = await runShadow({
    source,
    senders: lists.senders,
    rejected: lists.rejected,
    activatedAt: lists.activatedAt,
    names: lists.names,
    options,
    now,
    rawPayload: (id) => rawPayloads.get(id) ?? null,
  });

  console.log("ריצת צל על התיבה — קריאה בלבד, בלי כתיבה לבסיס ובלי שליחה\n");
  console.log(formatCensus(result, { ...lists, requests, options }));

  if (options.outDir) {
    const written = writeFixtures(options.outDir, result.fixtures);
    console.log(`\nנכתבו ${written.length} מתקנים מעוקרי זהות אל ${options.outDir}`);
  }
}

/**
 * רץ רק כשמפעילים את הקובץ, ולא כשמייבאים אותו.
 *
 * הבדיקות מייבאות מכאן את הליבה הטהורה (`classify`, `runShadow`, `anonymize`),
 * ובלי התנאי הזה עצם הייבוא היה פונה לרשת ולבסיס הנתונים.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
