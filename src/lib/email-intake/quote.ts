import { HTMLElement, parse, TextNode, type Node as HtmlNode } from "node-html-parser";
import { normalizeText } from "@/lib/normalize";
import { INVISIBLE_CHARS } from "./subject";

/**
 * הפרדת הטקסט החדש בתשובה במייל מהציטוט של המייל הקודם (אפיון §5.ה3 כלל 6,
 * §2.6 שלב 5, EM-13).
 *
 * למה זה לא קוסמטי: הציטוט בתשובה הוא בדרך כלל המייל החוזר שלנו, ובו "מה יש
 * בטיוטה עכשיו" — כלומר בדיוק הערכים שחולצו. מחלץ שקורא את הציטוט רואה
 * "דירה: 12" כהוראה, ובמקרה הגרוע מחזיר לשדה ערך ישן שנערך מאז במערכת ופותח
 * סתירה שאיש לא ביקש (5.ה4).
 *
 * שלוש שכבות, מהמדויקת לגסה:
 * 1. **סימוני HTML** של לקוחות הדואר (`gmail_quote`, `divRplyFwdMsg` וכו׳).
 * 2. **שורות מפריד בטקסט** ("On … wrote:", "בתאריך … מאת …:", כותרות Outlook,
 *    שורות `>`) — ללקוח שאין לו סימון HTML מוכר, ולגוף הטקסט הפשוט.
 * 3. **השוואה לגופי המיילים הקודמים בשרשרת** — ללקוח שמצטט בלי שום סימון,
 *    או מצטט מעל הטקסט החדש.
 *
 * **כיוון הטעות נבחר במכוון: בספק, טקסט נחשב ציטוט.** טקסט חדש שהוסר בטעות
 * מתגלה לשולח מיד, כי המייל החוזר אומר מה עודכן (וכלום לא עודכן). ציטוט
 * שנקרא כתיקון משנה את הטיוטה בשקט.
 *
 * **רק לתשובות.** במייל ראשון מועבר (`Fwd:`) הבלוק המועבר הוא הדיווח עצמו
 * (§7 שורה 73, EM-A04): מנהל שמעביר תלונה של דייר כותב מעליה מעט או כלום.
 * המודול הזה מסיר גם בלוק מועבר, ולכן אסור להפעיל אותו על מייל ראשון — שם
 * הגוף המלא עובר לחילוץ.
 */

// ─────────────────────────────── HTML → טקסט ───────────────────────────────

const PARSE_OPTIONS = {
  comment: false,
  // `false` = התוכן נזרק כבר בפענוח. `pre` הושמט מהרשימה בכוונה: ברירת המחדל
  // של הספרייה שומרת את תוכנו כטקסט גולמי, ואז `<br>` בתוכו היה נקרא כמחרוזת.
  blockTextElements: { script: false, style: false, noscript: false },
};

/** תגיות שתוכנן אינו חלק מהגוף הנראה (כותרת המסמך, CSS של Outlook) */
const DROPPED_TAGS = new Set(["head", "style", "script", "noscript", "title", "template"]);

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "center", "dd", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5",
  "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table",
  "tbody", "tfoot", "thead", "tr", "ul",
]);

const CELL_TAGS = new Set(["td", "th"]);

/**
 * שורה בטקסט המרונדר, עם צומתי הטקסט שבנו אותה — כדי שאפשר יהיה לחתוך או
 * להסיר ב-DOM את מה שזוהה בטקסט.
 */
interface RenderedLine {
  text: string;
  /** צומתי הטקסט שנתנו לשורה תוכן, לפי הסדר; ריק = שורה ריקה */
  nodes: HtmlNode[];
}

/**
 * מה שהספרייה אינה מזהה כתגית ומשאירה כטקסט — שהיה נכנס לחילוץ, ומשם לתיאור:
 * `<!DOCTYPE>` (Thunderbird), `<?xml:namespace …?>` (Outlook ישן), וההערות
 * המותנות ה"גלויות" של Word (`<![if !supportLists]>` … `<![endif]>`), שעוטפות
 * ב-Outlook הקלאסי כל מספור של רשימה וכל תמונה. התוכן שבין שתיהן נשאר: הוא
 * מה שהלקוח מציג.
 *
 * ההערה המותנית הרגילה (`<!--[if gte mso 9]>…<![endif]-->`) אינה נתפסת כאן —
 * אחרי `endif]` שלה בא `--` ולא `>` — והיא נזרקת כולה כהערה.
 */
const UNPARSED_MARKUP = /<!DOCTYPE[^>]*>|<\?[^>]*>|<!\[(?:if\b[^\]]*|endif)\]>/gi;

function parseHtml(html: string): HTMLElement {
  return parse(html.replace(UNPARSED_MARKUP, ""), PARSE_OPTIONS);
}

function tagOf(element: HTMLElement): string {
  // לשורש שהספרייה יוצרת אין שם תגית
  return (element.rawTagName || "").toLowerCase();
}

/**
 * מרנדר את העץ לשורות, בקירוב של `innerText` בדפדפן.
 *
 * הכלל שקובע את מספר השורות הריקות: בלוק **מבטיח** שהשורה הנוכחית נסגרה,
 * ואינו מוסיף שורה אם היא כבר סגורה; `<br>` תמיד מוסיף. כך
 * `<div>א<br></div><div>ב</div>` נותן שתי שורות ולא שורה ריקה ביניהן — כמו
 * שהדפדפן מציג, וכמו ש-Gmail כותב כל שורה.
 */
function renderLines(root: HTMLElement): RenderedLine[] {
  const lines: RenderedLine[] = [{ text: "", nodes: [] }];
  const current = () => lines[lines.length - 1];
  const newLine = () => {
    lines.push({ text: "", nodes: [] });
  };
  const closeLine = () => {
    if (current().nodes.length > 0) newLine();
  };

  const appendText = (value: string, node: HtmlNode) => {
    // רווחים רגילים מתכווצים כמו בדפדפן. NBSP אינו מתכווץ ולכן נחשב תוכן:
    // בלעדיו השורה הריקה של Outlook (`<p>&nbsp;</p>`) הייתה נעלמת. ההמרה שלו
    // לרווח נעשית בסוף, ב-`normalizeText`.
    const collapsed = value.replace(/[ \t\n\r\f]+/g, " ");
    if (!collapsed) return;
    const line = current();
    if (collapsed === " ") {
      if (line.nodes.length > 0) line.text += " ";
      return;
    }
    if (line.nodes[line.nodes.length - 1] !== node) line.nodes.push(node);
    line.text += collapsed;
  };

  const walk = (node: HtmlNode, inPre: boolean): void => {
    if (node instanceof TextNode) {
      if (!inPre) return appendText(node.text, node);
      // ב-`pre` ירידת שורה במקור היא ירידת שורה בתצוגה
      node.text.split("\n").forEach((segment, index) => {
        if (index > 0) newLine();
        appendText(segment, node);
      });
      return;
    }
    if (!(node instanceof HTMLElement)) return;

    const tag = tagOf(node);
    if (DROPPED_TAGS.has(tag)) return;
    if (tag === "br") return newLine();

    const block = BLOCK_TAGS.has(tag);
    if (block) closeLine();
    if (CELL_TAGS.has(tag)) appendText(" ", node);
    for (const child of node.childNodes) walk(child, inPre || tag === "pre");
    if (block) closeLine();
  };

  walk(root, false);
  return lines;
}

/**
 * ממיר HTML של מייל לטקסט: בלי `head`/`style`/`script`/`title`, `<br>` ובלוקים
 * לירידות שורה, ישויות מפוענחות (`&nbsp;` לרווח), רווחים מכווצים, שורה ריקה
 * אחת לכל היותר.
 *
 * `dir="rtl"` אינו משנה דבר בטקסט: הכיוון הוא עניין של תצוגה, והתווים נשמרים
 * בסדר הלוגי שבו נכתבו.
 */
export function htmlToText(html: string): string {
  return renderedText(renderLines(parseHtml(html)));
}

function renderedText(lines: readonly RenderedLine[]): string {
  // `normalizeText` מכווץ גם NBSP (הוא חלק מ-`\s`) ושומר ירידות שורה
  return normalizeText(lines.map((line) => line.text).join("\n"));
}

// ─────────────────────────────── זיהוי מפרידים ───────────────────────────────

/**
 * השורה כפי שמשווים אותה: בלי תווים בלתי נראים, רווחים מכווצים, בלי שוליים.
 *
 * Gmail בעברית עוטף בתווי כיווניות את שורת הייחוס ("בתאריך … מאת …:"),
 * ו-Outlook מפזר אותם סביב מספרים — בלי הסרה, אף ביטוי רגולרי לא היה מזהה
 * את השורה. ההסרה לצורך **השוואה בלבד**: הטקסט שמוחזר אינו משתנה.
 */
function probe(line: string): string {
  return line.replace(INVISIBLE_CHARS, "").replace(/\s+/g, " ").trim();
}

function isQuotedLine(probed: string): boolean {
  return probed.startsWith(">");
}

/**
 * תאריך או שעה. זה מה שמבדיל שורת ייחוס אמיתית ("On Wed, Sep 16, 2026 at 10:12
 * … wrote:") ממשפט של השולח שבמקרה נגמר ב"כתב:" — כל הלקוחות שנבדקו כותבים
 * בשורת הייחוס שנה או שעה, ומספר דירה לבדו ("בדירה 12") אינו אחד מהם.
 */
const DATE_OR_TIME = /\d{1,2}:\d{2}|(?<!\d)(?:19|20)\d{2}(?!\d)|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/;

/** שורות ייחוס שמותר להן להישבר לכמה שורות — Gmail שובר אותן בגוף הטקסט הפשוט */
const WRAPPING_ATTRIBUTIONS = [
  // Gmail, Apple Mail, Thunderbird באנגלית
  /^On\s.+\swrote\s?:$/i,
  // Gmail בעברית: "בתאריך יום ד׳, 16 בספט׳ 2026 ב-10:12 מאת שם <כתובת>:"
  /^בתאריך\s.+\sמאת\s.+:$/,
];

/**
 * שורות ייחוס בעברית שאינן נשברות: iOS ("ב-16 בספט׳ 2026, בשעה 10:12, שם כתב/ה:"),
 * Thunderbird ("בתאריך 16/09/2026 10:12, שם כתב:") ו-Yahoo ("ביום רביעי, 16 בספטמבר…
 * כתב:"). הפתיחה מוגבלת לצורות האלה, כדי שמשפט כמו "בדירה 12 … השכן כתב:" לא ייחתך.
 */
const HEBREW_WROTE_ATTRIBUTION = /^(?:ב[-\u05BE]?\d|בתאריך\s|ביום\s).+\sכתב(?:\/ה|ה|\(ה\))?\s?:$/;

/** "כתב:" בסוף שורה, בלי דרישת תאריך — נבדק רק כשמיד אחריו בא בלוק `>` */
const LOOSE_ATTRIBUTION = /(?:wrote|כתב(?:\/ה|ה|\(ה\))?)\s?:$/i;

/** Outlook ("-----Original Message-----"), Android ו-Gmail בהעברה */
const ORIGINAL_MESSAGE =
  /^-{2,}\s*(?:Original Message|Forwarded message|הודעה מקורית|הודעה שהועברה|הודעה מועברת)\s*-{2,}$/i;

/** הקו ש-Outlook באינטרנט ובטלפון מציב מעל כותרות המייל המצוטט */
const UNDERSCORE_RULE = /^_{10,}$/;

// `*` אופציונלי: Gmail ממיר את ההדגשה של Outlook לכוכביות בגוף הטקסט הפשוט
const HEADER_FROM = /^\*?(?:From|מאת)\s?:/i;
const HEADER_DATE = /^\*?(?:Sent|Date|נשלח|תאריך)\s?:/i;
const HEADER_TO_OR_SUBJECT = /^\*?(?:To|Subject|אל|נושא)\s?:/i;

/** בכמה שורות אחרי "From:" מחפשים את "Sent:" ו-"To:" (יש ביניהן לפעמים "Cc:") */
const HEADER_WINDOW = 6;

function nextNonEmpty(probes: readonly string[], after: number): number {
  for (let i = after + 1; i < probes.length; i++) if (probes[i]) return i;
  return -1;
}

/** אורך שורת הייחוס שמתחילה ב-`index` (1–3 שורות), או 0 אם אין כזו */
function attributionLength(probes: readonly string[], index: number): number {
  const first = probes[index];
  // Gmail שובר רק את הזנב (השם והכתובת), והתאריך תמיד בשורה הראשונה. הדרישה
  // מונעת חיבור של משפט של השולח ("On Monday the plumber came") לשורת הייחוס
  // האמיתית שמתחתיו, וחיתוך שלו יחד איתה.
  if (!DATE_OR_TIME.test(first)) return 0;
  if (HEBREW_WROTE_ATTRIBUTION.test(first)) return 1;

  let joined = "";
  for (let length = 1; length <= 3; length++) {
    const line = probes[index + length - 1];
    // השבירה של Gmail אינה משאירה שורה ריקה באמצע
    if (!line || isQuotedLine(line)) return 0;
    joined = joined ? `${joined} ${line}` : line;
    if (WRAPPING_ATTRIBUTIONS.some((shape) => shape.test(joined))) return length;
  }
  return 0;
}

/** בלוק כותרות של Outlook: "From:" ואחריו, בתוך כמה שורות, גם "Sent:" וגם "To:" */
function isHeaderBlock(probes: readonly string[], index: number): boolean {
  if (!HEADER_FROM.test(probes[index])) return false;
  let hasDate = false;
  let hasTo = false;
  let cursor = index;
  for (let seen = 0; seen < HEADER_WINDOW; seen++) {
    cursor = nextNonEmpty(probes, cursor);
    if (cursor === -1) break;
    hasDate ||= HEADER_DATE.test(probes[cursor]);
    hasTo ||= HEADER_TO_OR_SUBJECT.test(probes[cursor]);
    if (hasDate && hasTo) return true;
  }
  return false;
}

/** מפריד שאחריו הכול ציטוט, בלי סימון בתחילת כל שורה */
function isCutSeparator(probes: readonly string[], index: number): boolean {
  const line = probes[index];
  if (ORIGINAL_MESSAGE.test(line) || isHeaderBlock(probes, index)) return true;
  if (UNDERSCORE_RULE.test(line)) {
    const next = nextNonEmpty(probes, index);
    return next !== -1 && HEADER_FROM.test(probes[next]);
  }
  return false;
}

interface LineScan {
  /** שורות `>` ושורות הייחוס שלהן — מוסרות גם כשהן משולבות בטקסט החדש */
  drop: boolean[];
  /** מכאן והלאה הכול ציטוט; `lines.length` כשאין חיתוך */
  cutAt: number;
}

/**
 * סורק שורות ומחליט מה מהן ציטוט. מקור יחיד לזיהוי, שמשמש גם את הטקסט הפשוט
 * וגם את ה-HTML (חיתוך ה-DOM בשורה שנמצאה).
 *
 * שורת ייחוס מתוארכת שמיד אחריה בלוק `>` אינה חיתוך: בלקוחות שמצטטים ב-`>`
 * הציטוט נגמר איפה שהסימון נגמר, ומה שנכתב אחריו (תשובה מתחת לציטוט, או
 * תשובות בין שורות הציטוט) חדש. בלי `>` אין דרך לדעת איפה הציטוט נגמר, ולכן
 * חותכים עד הסוף.
 */
function scanLines(lines: readonly string[]): LineScan {
  const probes = lines.map(probe);
  const drop = probes.map(() => false);

  for (let i = 0; i < probes.length; i++) {
    const line = probes[i];
    if (!line) continue;
    if (isQuotedLine(line)) {
      drop[i] = true;
      continue;
    }

    const attribution = attributionLength(probes, i);
    if (attribution > 0) {
      const next = nextNonEmpty(probes, i + attribution - 1);
      if (next === -1 || !isQuotedLine(probes[next])) return { drop, cutAt: i };
      for (let k = i; k < i + attribution; k++) drop[k] = true;
      i += attribution - 1;
      continue;
    }

    if (isCutSeparator(probes, i)) return { drop, cutAt: i };

    if (LOOSE_ATTRIBUTION.test(line)) {
      const next = nextNonEmpty(probes, i);
      if (next !== -1 && isQuotedLine(probes[next])) drop[i] = true;
    }
  }
  return { drop, cutAt: probes.length };
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

/** מאחד את השורות שנשארו: בלי רצף של שורות ריקות במקום שממנו הוסר ציטוט */
function joinKept(lines: readonly string[]): string {
  return lines.join("\n").replace(/(?:[^\S\n]*\n){3,}/g, "\n\n").trim();
}

// ─────────────────────────────── ציטוט ב-HTML ───────────────────────────────

/**
 * ציטוט שהוא אלמנט סגור. מסירים את האלמנט בלבד, כי מה שנכתב אחריו (תשובה
 * מתחת לציטוט ב-Gmail או ב-Thunderbird) חדש.
 */
const QUOTE_BLOCK_SELECTORS = [
  // Gmail באינטרנט ובאנדרואיד. `gmail_quote_container` הוא העטיפה בגרסאות חדשות
  "div.gmail_quote_container",
  ".gmail_quote",
  // Apple Mail (Mac ו-iPhone), Thunderbird, Roundcube. `i` — ערך התכונה אינו
  // תלוי רישיות ב-HTML, ויש לקוחות שכותבים `type="CITE"`
  "blockquote[type=cite i]",
  // Outlook ל-Mac ו-Outlook החדש
  "#mail-editor-reference-message-container",
  ".yahoo_quoted",
];

/**
 * נקודת התחלה של ציטוט שאין לו סוף מסומן. Outlook באינטרנט, Outlook החדש
 * ו-Outlook בטלפון מדביקים את המייל הקודם **אחרי** הסימון, כאחים שלו ולא
 * בתוכו — ולכן כל מה שבא אחריו בסדר המסמך הוא ציטוט.
 */
const QUOTE_START_SELECTORS = ["#appendonsend", "#divRplyFwdMsg"];

function isAttached(node: HtmlNode, root: HTMLElement): boolean {
  let current: HtmlNode | null = node;
  while (current) {
    if (current === root) return true;
    current = current.parentNode;
  }
  return false;
}

function detach(node: HtmlNode, removed: HtmlNode[]): void {
  node.remove();
  removed.push(node);
}

/**
 * ממלא-מקום ל-`blockquote` מצוטט שהוסר: שורה אחת של `>`, כדי שזיהוי המפרידים
 * (`scanLines`) יראה ב-HTML את אותו מבנה שהוא רואה בטקסט הפשוט.
 *
 * בלעדיו שורת ייחוס שיושבת **לפני** אלמנט הציטוט ולא בתוכו (Roundcube:
 * `<p>On … wrote:</p><blockquote type="cite">`) הייתה נראית כמפריד שאחריו אין
 * סימון, והעץ היה נחתך ממנה עד הסוף — יחד עם התשובה שנכתבה מתחת לציטוט.
 * עם ממלא המקום היא שורת ייחוס שאחריה בלוק `>`, ולכן מוסרת לבדה.
 */
function quoteMarker(): HTMLElement {
  const marker = new HTMLElement("div", {});
  marker.appendChild(new TextNode("&gt;"));
  return marker;
}

/**
 * מפצל צומתי טקסט בתוך `pre` לצומת לכל שורה.
 *
 * החיתוך ב-DOM נעשה מהצומת שבו מתחילה שורת המפריד. ב-`pre` צומת אחד מחזיק
 * כמה שורות, ובלי הפיצול החיתוך היה מסיר גם את הטקסט החדש שמעל המפריד. הפיצול
 * אינו משנה את ה-HTML שמוחזר: שרשור הצמתים הוא אותו טקסט גולמי.
 */
function splitPreTextNodes(element: HTMLElement, inPre = false): void {
  element.childNodes = element.childNodes.flatMap((child): HtmlNode[] => {
    if (child instanceof HTMLElement) {
      splitPreTextNodes(child, inPre || tagOf(child) === "pre");
      return [child];
    }
    if (!inPre || !(child instanceof TextNode) || !child.rawText.includes("\n")) return [child];
    // ישות HTML אינה מכילה ירידת שורה, ולכן הפיצול אינו שובר אף אחת
    return child.rawText.split(/(?<=\n)/).map((piece) => new TextNode(piece, element));
  });
}

/**
 * מסיר את הצומת ואת כל מה שבא אחריו בסדר המסמך — האחים שאחריו, והאחים
 * שאחרי כל אחד מההורים שלו.
 *
 * "האחים שאחריו" לבד לא היו מספיקים: לקוח שעוטף את שורת הכותרות באלמנט
 * (`<div><div style="border-top…"><p>From:`) משאיר את הציטוט מחוץ לעטיפה.
 */
function cutFrom(node: HtmlNode, removed: HtmlNode[]): void {
  let current = node;
  let includeSelf = true;
  while (current.parentNode) {
    const parent: HTMLElement = current.parentNode;
    const siblings = parent.childNodes;
    const from = siblings.indexOf(current) + (includeSelf ? 0 : 1);
    for (const sibling of siblings.slice(from)) {
      sibling.parentNode = null;
      removed.push(sibling);
    }
    parent.childNodes = siblings.slice(0, from);
    current = parent;
    includeSelf = false;
  }
}

/** `cid:image001.png@01DD2A.5F3C1B20` ← `image001.png@01DD2A.5F3C1B20`, כמו `MailPart.contentId` */
function contentIdFromUrl(url: string | undefined): string | null {
  const match = url?.trim().match(/^cid:(.+)$/i);
  if (!match) return null;
  let id = match[1];
  try {
    // RFC 2392: כתובת `cid:` מקודדת כ-URL
    id = decodeURIComponent(id);
  } catch {
    // קידוד שבור — משאירים את הערך כפי שנכתב
  }
  return id.trim().replace(/^<(.*)>$/, "$1") || null;
}

function collectContentIds(nodes: readonly HtmlNode[]): string[] {
  const ids: string[] = [];
  const visit = (node: HtmlNode) => {
    if (!(node instanceof HTMLElement)) return;
    for (const attribute of ["src", "background"]) {
      const id = contentIdFromUrl(node.getAttribute(attribute));
      if (id) ids.push(id);
    }
    node.childNodes.forEach(visit);
  };
  nodes.forEach(visit);
  return ids;
}

/**
 * מסיר מ-HTML של תשובה את הציטוט של המייל הקודם.
 *
 * `quotedContentIds` — ה-`Content-ID` של תמונות שהופיעו **רק** בציטוט. תמונה
 * בציטוט אינה קובץ מצורף של התשובה, ותמונה משובצת בגוף החדש כן (§2.6 שלב 3,
 * EM-06a). מזהה שמופיע גם בחלק שנשאר (למשל לוגו שאותו לקוח משבץ בחתימה החדשה
 * ובחתימה המצוטטת) אינו מוחזר: השולח שיבץ את התמונה בגוף, וזה מה שהכלל סופר.
 *
 * אחרי הסימונים המוכרים נבדקות גם שורות המפריד בטקסט (`scanLines`), כמו
 * בטקסט הפשוט: שורות `>` ושורות ייחוס שלפני ציטוט מוסרות, והעץ נחתך בשורת
 * המפריד הראשונה. זה מה שתופס את Outlook הקלאסי, שאין בו אף מזהה — רק `div`
 * עם קו עליון ובו "From:"/"מאת:". בלי זה הטקסט היה נחתך נכון בשלב הטקסט, אבל
 * תמונה בציטוט הייתה נקלטת כקובץ מצורף.
 */
export function stripQuotedHtml(html: string): {
  html: string;
  removed: boolean;
  quotedContentIds: string[];
} {
  const root = parseHtml(html);
  const removed: HtmlNode[] = [];

  // Thunderbird: שורת הייחוס והציטוט הם שני אחים. מטופל לפני `blockquote[type=cite]`,
  // כי אחרי שהציטוט הוסר האח הבא של שורת הייחוס הוא כבר טקסט חדש.
  for (const prefix of root.querySelectorAll(".moz-cite-prefix")) {
    if (!isAttached(prefix, root)) continue;
    const next = prefix.nextElementSibling;
    detach(prefix, removed);
    if (next && tagOf(next) === "blockquote") detach(next, removed);
  }

  const markers: HTMLElement[] = [];
  for (const selector of QUOTE_BLOCK_SELECTORS) {
    for (const element of root.querySelectorAll(selector)) {
      // אלמנט מקונן בציטוט שכבר הוסר (Gmail מקנן `gmail_quote` בתוך עצמו)
      if (!isAttached(element, root)) continue;
      removed.push(element);
      // רק ל-`blockquote`: שורת הייחוס נכתבת לפניו. מכלים (`gmail_quote`,
      // `yahoo_quoted`, Outlook ל-Mac) מחזיקים אותה בתוכם, ושורה של השולח שבמקרה
      // נגמרת ב"כתב:" מעליהם אינה ייחוס — ממלא מקום היה מוחק אותה.
      if (tagOf(element) !== "blockquote") {
        element.remove();
        continue;
      }
      const marker = quoteMarker();
      element.replaceWith(marker);
      markers.push(marker);
    }
  }

  for (const selector of QUOTE_START_SELECTORS) {
    for (const element of root.querySelectorAll(selector)) {
      if (isAttached(element, root)) cutFrom(element, removed);
    }
  }

  splitPreTextNodes(root);
  const lines = renderLines(root);
  const { drop, cutAt } = scanLines(lines.map((line) => line.text));
  lines.forEach((line, index) => {
    // מסירים את צומתי הטקסט בלבד: אלמנט שנשאר ריק אינו מייצר טקסט
    if (index < cutAt && drop[index]) line.nodes.forEach((node) => detach(node, removed));
  });
  const cutNode = lines[cutAt]?.nodes[0];
  if (cutNode) cutFrom(cutNode, removed);
  for (const marker of markers) marker.remove();

  if (removed.length === 0) return { html, removed: false, quotedContentIds: [] };

  const kept = new Set(collectContentIds([root]));
  const quotedContentIds = [...new Set(collectContentIds(removed))].filter((id) => !kept.has(id));
  return { html: root.toString(), removed: true, quotedContentIds };
}

// ─────────────────────────────── ציטוט בטקסט ───────────────────────────────

/**
 * מסיר מטקסט של תשובה את הציטוט: חותך בשורת המפריד הראשונה ("On … wrote:",
 * "בתאריך … מאת …:", "-----Original Message-----", בלוק כותרות של Outlook),
 * ומסיר שורות `>` בכל מקום — גם כשהן משולבות בטקסט החדש.
 *
 * כשאין מה להסיר הטקסט מוחזר כמו שהוא, בלי נרמול.
 */
export function stripQuotedText(text: string): { text: string; removed: boolean } {
  const lines = splitLines(text);
  const { drop, cutAt } = scanLines(lines);
  const kept = lines.filter((_, index) => index < cutAt && !drop[index]);
  if (kept.length === lines.length) return { text, removed: false };
  return { text: joinKept(kept), removed: true };
}

// ─────────────────────────── ציטוט בלי סימון ───────────────────────────

/**
 * הסף להסרת טקסט שחוזר על מייל קודם: **3 שורות רצופות** (שאינן ריקות), או
 * רצף שאורכו **80 תווים** לפחות.
 *
 * הסף קיים כי מייל חדש חוזר תמיד על כמה שורות קצרות מהקודם — "תודה", שם
 * בחתימה, "נשלח מה-iPhone שלי" — ומחיקה שלהן לפי התאמה בודדת הייתה מוחקת
 * גם תיקון קצר שבמקרה זהה לשורה מהציטוט. ציטוט אמיתי ארוך מזה כמעט תמיד:
 * המייל החוזר שלנו לבדו הוא יותר משלוש שורות, ושורת הסיכום בו ארוכה מ-80.
 * הסף באורך מכסה גם שורה ארוכה שלקוח שבר לשתיים בציטוט.
 */
const MIN_RUN_LINES = 3;
const MIN_RUN_CHARS = 80;

/** השורה כפי שמשווים אותה למייל קודם; סימוני `>` אינם חלק מהתוכן */
function priorLineKey(line: string): string {
  return probe(line).replace(/^(?:>\s?)+/, "").trim();
}

/**
 * גוף מייל קודם כרצף מילים אחד. ההשוואה אינה לפי גבולות שורה, כי לקוח
 * שמצטט בטקסט פשוט שובר מחדש שורות ארוכות (בדרך כלל ב-76 תווים).
 */
function flattenPrior(body: string): string {
  return splitLines(body).map(priorLineKey).filter(Boolean).join(" ");
}

/**
 * רשת הביטחון ללקוח שמצטט בלי שום סימון, או מצטט **מעל** הטקסט החדש: מסיר
 * כל רצף שורות שמופיע ברציפות באחד מגופי המיילים הקודמים בשרשרת (לפי הסף
 * ב-`MIN_RUN_LINES`/`MIN_RUN_CHARS`).
 *
 * `priorBodies` — גופי הטקסט של ההודעות הקודמות בשרשרת: המיילים החוזרים
 * שלנו והמיילים של השולח. ההתאמה היא למילים שלמות, ולכן "דירה 12" אינה
 * נמצאת בתוך "דירה 112".
 */
export function removePriorBodies(
  text: string,
  priorBodies: readonly string[],
): { text: string; removed: boolean } {
  const lines = splitLines(text);
  const keys = lines.map(priorLineKey);
  const contentIndexes = keys.flatMap((key, index) => (key ? [index] : []));
  const priors = priorBodies.map(flattenPrior).filter(Boolean);
  if (priors.length === 0 || contentIndexes.length === 0) return { text, removed: false };
  // כל המיילים הקודמים במחרוזת אחת, מופרדים בירידת שורה. מפתח שורה אינו מכיל
  // ירידת שורה (`probe` מכווץ כל רווח), ולכן רצף שנמצא בה נמצא כולו בתוך מייל
  // אחד — וחיפוש אחד מחליף חיפוש לכל מייל.
  const haystack = priors.map((prior) => ` ${prior} `).join("\n");
  // סינון זול לפני החיפוש: שורה שאחת המילים שלה אינה באף מייל קודם אינה יכולה
  // להתחיל רצף. בלעדיו כל שורה חדשה סורקת את כל השרשרת.
  const words = new Set(haystack.split(/[ \n]/));
  const allWordsKnown = (key: string) => key.split(" ").every((word) => words.has(word));

  /** אורך הרצף הארוך ביותר שמתחיל בשורת התוכן ה-`from`, ואורכו בתווים */
  const longestRun = (from: number): { count: number; chars: number } => {
    let joined = "";
    let count = 0;
    let position = -1;
    for (let at = from; at < contentIndexes.length; at++) {
      const key = keys[contentIndexes[at]];
      if (!allWordsKnown(key)) break;
      const candidate = count ? `${joined} ${key}` : key;
      const needle = ` ${candidate} `;
      // רצף מוארך מופיע רק איפה שגם הקצר ממנו מופיע, ולכן לא לפני המופע הראשון
      // של הקצר: בודקים קודם באותו מקום, וממשיכים לחפש רק ממנו והלאה. חיפוש
      // מההתחלה בכל הארכה סרק את כל השרשרת שוב ושוב.
      if (position === -1 || !haystack.startsWith(needle, position)) {
        position = haystack.indexOf(needle, position === -1 ? 0 : position + 1);
      }
      if (position === -1) break;
      joined = candidate;
      count++;
    }
    return { count, chars: joined.length };
  };

  const drop = lines.map(() => false);
  for (let at = 0; at < contentIndexes.length; ) {
    const run = longestRun(at);
    if (run.count >= MIN_RUN_LINES || (run.count > 0 && run.chars >= MIN_RUN_CHARS)) {
      // כולל השורות הריקות שבתוך הרצף
      for (let line = contentIndexes[at]; line <= contentIndexes[at + run.count - 1]; line++) {
        drop[line] = true;
      }
      at += run.count;
    } else {
      at++;
    }
  }

  if (!drop.includes(true)) return { text, removed: false };
  return { text: joinKept(lines.filter((_, index) => !drop[index])), removed: true };
}

// ─────────────────────────────── הכול יחד ───────────────────────────────

function isBlank(text: string): boolean {
  return probe(text) === "";
}

/**
 * הטקסט החדש בתשובה — מה שעובר לחילוץ (EM-13).
 *
 * HTML קודם, כי שם הציטוט מסומן במבנה ולא רק בניחוש לפי שורות. על הטקסט
 * שהופק ממנו רצים גם זיהוי המפרידים וגם ההשוואה למיילים קודמים, כי לקוח
 * שאינו מוכר לא סימן דבר. כשמסלול ה-HTML ריק והטקסט הפשוט לא — למשל HTML
 * שכולו תמונה — נלקח הטקסט הפשוט.
 *
 * `quotedContentIds` מגיע תמיד ממסלול ה-HTML: רק שם תמונה משובצת ממוקמת,
 * בציטוט או מחוצה לו.
 */
export function extractNewText(input: {
  text: string;
  html: string | null;
  priorBodies: readonly string[];
}): { newText: string; quotedContentIds: string[] } {
  const finish = (value: string) => {
    const result = normalizeText(removePriorBodies(value, input.priorBodies).text);
    return isBlank(result) ? "" : result;
  };
  const fromText = () => finish(stripQuotedText(input.text).text);

  if (input.html === null || isBlank(input.html)) {
    return { newText: fromText(), quotedContentIds: [] };
  }

  const stripped = stripQuotedHtml(input.html);
  const fromHtml = finish(stripQuotedText(htmlToText(stripped.html)).text);
  return {
    newText: fromHtml || fromText(),
    quotedContentIds: stripped.quotedContentIds,
  };
}
