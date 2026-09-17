import { looksLikeEmail, normalizeEmail, normalizeName } from "@/lib/normalize";
import type { MailAddress } from "./types";

/**
 * קריאת כותרות מייל (RFC 5322, RFC 2047) — פונקציות טהורות.
 *
 * שלוש החלטות של הצינור נשענות על הקובץ הזה, ובכל אחת טעות היא שקטה:
 * - **מי שלח** (EM-04): כתובת שפוענחה לא נכון אינה מותאמת למשתמש, והמייל
 *   "אינו נוגע למערכת" — בלי שגיאה ובלי תשובה.
 * - **לאיזו שרשרת שייכת תשובה** (EM-14): `Message-ID` שנורמל בשתי צורות שונות
 *   בשני הצדדים הופך תשובה לטיוטה לזרה.
 * - **המענה באותה שרשרת** (EM-12): `In-Reply-To`/`References` שנכתבו לא נכון
 *   פותחים אצל השולח שיחה חדשה.
 *
 * הקוד מקבל את מה שלקוחות דואר שולחים בפועל ולא רק את מה שהתקן מתיר, כי
 * השולחים הם אנשים עם Outlook ישן וטלפון, לא מערכות שנבדקו מול התקן.
 */

/**
 * מערך הכותרות של ה-API למפה לפי שם באותיות קטנות. כותרת שחוזרת — האחרונה גוברת.
 *
 * `Object.fromEntries` ולא השמה בלולאה: כותרת בשם `__proto__` (שכל שולח יכול
 * לכתוב) נשמרת כשדה רגיל ואינה מחליפה את אב הטיפוס של המפה.
 */
export function headerMap(headers: readonly { name: string; value: string }[]): Record<string, string> {
  return Object.fromEntries(headers.map((header) => [header.name.trim().toLowerCase(), header.value]));
}

// ───────────────────────────── Message-ID ─────────────────────────────

const BRACKETED_ID = /<([^<>]*)>/g;

/**
 * מזהה בלי רווחים. ב-`msg-id` אין רווח חוקי, ולכן כל רווח בתוכו הוא שארית
 * של קיפול שורה — ומזהה שנקרא מכותרת שקופלה במקום אחר חייב לצאת זהה לזה
 * שנשמר. כיווץ לרווח אחד (ולא מחיקה) היה משאיר שתי צורות לאותו מזהה.
 */
function compactId(raw: string): string {
  return raw.replace(/\s+/g, "");
}

function bracketedIds(value: string): string[] {
  return Array.from(value.matchAll(BRACKETED_ID), (match) => compactId(match[1])).filter(Boolean);
}

/**
 * `Message-ID` / `In-Reply-To` לצורה אחת להשוואה ולשמירה: בלי סוגריים משולשים.
 *
 * כשיש כמה אסימונים בסוגריים נלקח הראשון שאינו ריק. בלי סוגריים בכלל (לקוחות
 * שבורים כותבים `In-Reply-To: abc@x (Yossi's message)`) נלקח האסימון הראשון
 * שיש בו `@`. אותיות גדולות נשמרות: החלק שלפני ה-`@` רגיש לרישיות.
 */
export function normalizeMessageId(value: string | null | undefined): string | null {
  if (!value) return null;
  const [first] = bracketedIds(value);
  if (first) return first;
  // יש סוגריים משולשים, וכולם ריקים (`<>`): אין מזהה, ולא ננחש אחד מהטקסט שסביבם
  if (/<[^<>]*>/.test(value)) return null;

  const tokens = looseTokens(value);
  return tokens.find((token) => token.includes("@")) ?? tokens[0] ?? null;
}

function looseTokens(value: string): string[] {
  return value
    .replace(/[<>]/g, " ")
    .split(/[\s,]+/)
    .filter(Boolean);
}

/**
 * כל המזהים ב-`References` (או ב-`In-Reply-To`), לפי הסדר, בלי כפילויות.
 *
 * בלי סוגריים משולשים — רק אסימונים שיש בהם `@`, כדי שמילים כמו "Re:" או
 * תאריך שלקוח שבור השאיר בכותרת לא ייחשבו מזהים.
 */
export function parseMessageIds(value: string | null | undefined): string[] {
  if (!value) return [];
  const bracketed = bracketedIds(value);
  const hasBrackets = /<[^<>]*>/.test(value);
  const ids = hasBrackets ? bracketed : looseTokens(value).filter((token) => token.includes("@"));
  return Array.from(new Set(ids));
}

/**
 * מזהה לכתיבה בכותרת יוצאת (`Message-ID`, `In-Reply-To`, `References`).
 *
 * עובר דרך `normalizeMessageId` ולכן גם מזהה שכבר עטוף אינו נעטף פעמיים, וגם
 * ירידת שורה שהגיעה בתוך מזהה מהמייל הנכנס נמחקת — אחרת היא הייתה פותחת
 * כותרת חדשה במייל שהמערכת שולחת (header injection).
 */
export function formatMessageId(id: string): string {
  const normalized = normalizeMessageId(id);
  if (!normalized) throw new Error("formatMessageId: מזהה הודעה ריק");
  return `<${normalized}>`;
}

// ────────────────────────────── RFC 2047 ──────────────────────────────

/** `=?charset?B|Q?text?=`. ה-charset עשוי לשאת תגית שפה (`utf-8*he`, RFC 2231). */
const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;

type Piece = { kind: "text"; text: string } | { kind: "word"; raw: string; encoding: string; bytes: Uint8Array };

/**
 * מפענח מילים מקודדות בכותרת: `=?UTF-8?B?...?=`, `=?windows-1255?Q?...?=`.
 *
 * **Outlook בעברית שולח windows-1255**, ולכן הפענוח נעשה ב-`TextDecoder` לפי
 * ה-charset שבמילה ולא בהנחה של UTF-8. charset ש-`TextDecoder` אינו מכיר, או
 * מילה פגומה, נשארים כמות שהם: טקסט מקודד שנראה מוזר עדיף על ניחוש שמשבש
 * שם או כותרת בלי שאיש ידע.
 *
 * שני פרטים שמקודדים אמיתיים מחייבים:
 * - רווח בין שתי מילים מקודדות סמוכות אינו חלק מהטקסט (RFC 2047 §6.2) ונמחק.
 * - מילים סמוכות באותו charset מפוענחות **יחד**: יש מקודדים שחוצים תו UTF-8
 *   רב-בייטי בין שתי מילים, ופענוח נפרד היה מייצר שני תווי U+FFFD במקום אות.
 *
 * טקסט בלי מילים מקודדות חוזר ללא שינוי, ולכן אפשר להפעיל את הפונקציה גם על
 * ערך שכבר פוענח.
 */
export function decodeRfc2047(value: string): string {
  if (!value.includes("=?")) return value;

  const pieces: Piece[] = [];
  let cursor = 0;
  for (const match of value.matchAll(ENCODED_WORD)) {
    const index = match.index ?? 0;
    if (index > cursor) pieces.push({ kind: "text", text: value.slice(cursor, index) });
    pieces.push(parseEncodedWord(match[0], match[1], match[2], match[3]));
    cursor = index + match[0].length;
  }
  if (cursor < value.length) pieces.push({ kind: "text", text: value.slice(cursor) });

  let output = "";
  let run: { encoding: string; chunks: Uint8Array[] } | null = null;
  const flush = () => {
    if (run) output += decodeBytes(run.encoding, run.chunks);
    run = null;
  };

  pieces.forEach((piece, i) => {
    if (piece.kind === "word") {
      if (run && run.encoding !== piece.encoding) flush();
      if (!run) run = { encoding: piece.encoding, chunks: [] };
      run.chunks.push(piece.bytes);
      return;
    }
    const between = pieces[i - 1]?.kind === "word" && pieces[i + 1]?.kind === "word";
    if (between && piece.text.trim() === "") return;
    flush();
    output += piece.text;
  });
  flush();

  return output;
}

function parseEncodedWord(raw: string, charset: string, encoding: string, text: string): Piece {
  const decoder = decoderFor(charset.split("*")[0]);
  const bytes = encoding.toUpperCase() === "B" ? decodeB(text) : decodeQ(text);
  if (!decoder || !bytes) return { kind: "text", text: raw };
  return { kind: "word", raw, encoding: decoder.encoding, bytes };
}

function decoderFor(label: string): TextDecoder | null {
  try {
    return new TextDecoder(label);
  } catch {
    // RangeError: תווית שאינה ברשימת הקידודים של WHATWG
    return null;
  }
}

function decodeB(text: string): Uint8Array | null {
  // Buffer מתעלם בשקט מתווים שאינם base64; בדיקה מפורשת כדי שמילה פגומה
  // תישאר גלויה ולא תהפוך לזבל שנראה כמו טקסט.
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.replace(/=+$/, "").length % 4 === 1) return null;
  return new Uint8Array(Buffer.from(text, "base64"));
}

function decodeQ(text: string): Uint8Array | null {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "_") {
      bytes.push(0x20);
    } else if (ch === "=") {
      const hex = text.slice(i + 1, i + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) return null;
      bytes.push(Number.parseInt(hex, 16));
      i += 2;
    } else {
      const code = ch.charCodeAt(0);
      if (code > 0x7e) return null;
      bytes.push(code);
    }
  }
  return new Uint8Array(bytes);
}

function decodeBytes(encoding: string, chunks: Uint8Array[]): string {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  const decoded = new TextDecoder(encoding).decode(joined);
  // כותרת היא שורה לוגית אחת. תו בקרה שפוענח (למשל =0D=0A) היה עובר כך
  // לכותרת Subject של המייל החוזר ופותח בה כותרת חדשה — ולכן הופך לרווח.
  return Array.from(decoded, (ch) => (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f ? " " : ch)).join("");
}

// ─────────────────────────────── כתובות ───────────────────────────────

const HEBREW_LETTER = /[א-ת]/;

/**
 * אילו `"` נקראים כתו רגיל: קבוצת מיקומים, או `"all"`.
 *
 * כשהסריקה מסתיימת בתוך מירכאות, סורקים שוב כשהמירכאות שנפתחו אחרונות הן
 * תו רגיל — זה מתקן `"` בודד שלא נסגר. אם גם הסריקה השנייה אינה נסגרת, כל
 * ה-`"` נקראים כתו רגיל. **שלוש סריקות לכל היותר**: שחרור מירכאות אחת בכל
 * פעם היה ריבועי, ובקלט כמו `"\"\"\"…` (שכל שולח יכול לכתוב בכותרת) גם עמוק
 * מספיק כדי להפיל את הקליטה על חריגת מחסנית.
 */
type LiteralQuotes = ReadonlySet<number> | "all";

function nextLiteralQuotes(literal: LiteralQuotes, quoteOpenedAt: number): LiteralQuotes {
  return literal !== "all" && literal.size === 0 ? new Set([quoteOpenedAt]) : "all";
}

/**
 * האם `"` במקום `i` פותח או סוגר שם במירכאות — או שהוא תו רגיל.
 *
 * שני מקרים שבהם הוא תו רגיל, ובשניהם קריאתו כתחביר הייתה בולעת את הכתובת
 * שאחריו, והשולח לא היה מזוהה (EM-04) — מייל שנזרק בשקט:
 * - **גרשיים בתוך מילה עברית** (בע"מ, עו"ד, ד"ר). בעברית כותבים ראשי תיבות
 *   עם `"` רגיל, ושם מקודד RFC 2047 שכבר פוענח מגיע בלי מירכאות סביבו.
 *   `"` בין שתי אותיות עבריות אינו גבול של שם בשום כתיבה אמיתית.
 * - **מירכאות שלא נסגרו עד סוף הקלט** — `literal`, שנקבע בסריקה חוזרת.
 */
function isQuoteDelimiter(value: string, i: number, literal: LiteralQuotes): boolean {
  if (value.charAt(i) !== "\"" || literal === "all" || literal.has(i)) return false;
  return !(HEBREW_LETTER.test(value.charAt(i - 1)) && HEBREW_LETTER.test(value.charAt(i + 1)));
}

/**
 * מפצל רשימת כתובות לרשומות — לפי פסיק או נקודה-פסיק שמחוץ למירכאות,
 * להערות ולסוגריים משולשים.
 *
 * תחביר קבוצה (`team: a@x, b@y;`): הטקסט שלפני הנקודתיים הוא שם הקבוצה ולא
 * כתובת, ולכן נזרק; החברים נקלטים כרגיל. נקודה-פסיק מחוץ לקבוצה מתקבלת גם
 * היא כמפריד — כך מקלידים ב-Outlook, וחלק מהלקוחות משאירים אותה בכותרת.
 */
function splitAddressSegments(value: string, literal: LiteralQuotes = new Set()): string[] {
  const segments: string[] = [];
  let current = "";
  let mode: "plain" | "quote" | "comment" | "angle" = "plain";
  let depth = 0;
  let escaped = false;
  let quoteOpenedAt = -1;

  for (let i = 0; i < value.length; i++) {
    const ch = value.charAt(i);
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (mode === "quote" || mode === "comment") {
      current += ch;
      if (ch === "\\") escaped = true;
      else if (mode === "quote" && isQuoteDelimiter(value, i, literal)) mode = "plain";
      else if (mode === "comment" && ch === "(") depth++;
      else if (mode === "comment" && ch === ")" && --depth === 0) mode = "plain";
      continue;
    }
    if (mode === "angle") {
      current += ch;
      if (ch === ">") mode = "plain";
      continue;
    }
    if (ch === "," || ch === ";") {
      segments.push(current);
      current = "";
    } else if (ch === ":") {
      current = "";
    } else {
      if (isQuoteDelimiter(value, i, literal)) {
        mode = "quote";
        quoteOpenedAt = i;
      } else if (ch === "(") {
        mode = "comment";
        depth = 1;
      } else if (ch === "<") mode = "angle";
      current += ch;
    }
  }
  // מירכאות שלא נסגרו: סריקה חוזרת שבה ה-`"` הזה הוא תו רגיל (`LiteralQuotes`),
  // ולא בליעה של כל מה שאחריו — כולל כתובות תקינות בהמשך הרשימה.
  if (mode === "quote") return splitAddressSegments(value, nextLiteralQuotes(literal, quoteOpenedAt));
  segments.push(current);
  return segments.filter((segment) => segment.trim() !== "");
}

/**
 * רשומה אחת: `"שם" <כתובת>`, `שם <כתובת>`, `כתובת`, או `כתובת (שם)`.
 *
 * המירכאות מוסרות וה-escape בתוכן מפוענח כבר בסריקה, כדי ש-`<` או `,` בתוך
 * שם במירכאות לא ייקראו כתחביר. **פענוח RFC 2047 של השם נעשה רק אחרי**
 * שהרשומה בודדה: שם מקודד עשוי להכיל פסיק, ופענוח לפני הפיצול היה חוצה אותו
 * לשתי רשומות.
 */
function parseMailbox(segment: string, literal: LiteralQuotes = new Set()): MailAddress | null {
  let outside = "";
  let angle: string | null = null;
  let angleText = "";
  let commentText = "";
  const comments: string[] = [];
  let mode: "plain" | "quote" | "comment" | "angle" = "plain";
  let depth = 0;
  let escaped = false;
  let quoteOpenedAt = -1;

  for (let i = 0; i < segment.length; i++) {
    const ch = segment.charAt(i);
    if (mode === "quote") {
      if (escaped) {
        outside += ch;
        escaped = false;
      } else if (ch === "\\") escaped = true;
      else if (isQuoteDelimiter(segment, i, literal)) mode = "plain";
      else outside += ch;
    } else if (mode === "comment") {
      if (escaped) {
        commentText += ch;
        escaped = false;
      } else if (ch === "\\") escaped = true;
      else if (ch === "(") {
        depth++;
        commentText += ch;
      } else if (ch === ")" && --depth === 0) {
        comments.push(commentText);
        commentText = "";
        mode = "plain";
      } else commentText += ch;
    } else if (mode === "angle") {
      if (ch === ">") {
        angle ??= angleText;
        mode = "plain";
      } else angleText += ch;
    } else if (isQuoteDelimiter(segment, i, literal)) {
      mode = "quote";
      quoteOpenedAt = i;
    } else if (ch === "(") {
      mode = "comment";
      depth = 1;
    } else if (ch === "<") {
      mode = "angle";
      angleText = "";
    } else outside += ch;
  }
  // מירכאות שלא נסגרו — ה-`"` הוא חלק מהשם (ראו `isQuoteDelimiter`)
  if (mode === "quote") return parseMailbox(segment, nextLiteralQuotes(literal, quoteOpenedAt));
  // סוגר משולש שלא נסגר: מה שנאסף עד הסוף הוא עדיין הכתובת היחידה שיש
  if (mode === "angle") angle ??= angleText;

  const rawAddress = angle ?? outside;
  // ניתוב ישן (`<@relay:user@host>`) — הכתובת היא מה שאחרי הנקודתיים האחרונות
  const address = normalizeEmail(rawAddress.slice(rawAddress.lastIndexOf(":") + 1));
  if (!isPlainAddress(address)) return null;

  const name = (angle !== null ? cleanName(outside) : null) ?? cleanName(comments.join(" "));
  return { address, name };
}

function isPlainAddress(address: string): boolean {
  return looksLikeEmail(address) && !/[<>()",;:\\]/.test(address);
}

function cleanName(raw: string): string | null {
  let name = raw.trim();
  // Outlook עוטף לעיתים את השם במירכאות בודדות: 'Yossi Cohen' <yossi@x>
  if (name.length >= 2 && name.startsWith("'") && name.endsWith("'")) name = name.slice(1, -1);
  name = normalizeName(decodeRfc2047(name));
  return name || null;
}

/**
 * כל הכתובות החוקיות ברשימה (`To`, `Cc`, `From`), מנורמלות, לפי הסדר.
 *
 * רשומה שאין בה כתובת חוקית מדולגת בשקט ולא מפילה את הרשימה: כתובת אחת
 * שבורה ב-`Cc` אינה סיבה לא לזהות את השולח. כפילויות נשמרות — הרשימה משקפת
 * את הכותרת, וההחלטה מה לעשות בהן אצל הקורא.
 */
export function parseAddressList(value: string | null | undefined): MailAddress[] {
  if (!value) return [];
  return splitAddressSegments(value)
    .map((segment) => parseMailbox(segment))
    .filter((address): address is MailAddress => address !== null);
}

/** הכתובת החוקית הראשונה — לכותרת `From` */
export function parseAddress(value: string | null | undefined): MailAddress | null {
  return parseAddressList(value)[0] ?? null;
}
