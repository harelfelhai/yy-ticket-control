import type { DraftFieldName } from "@/generated/prisma/enums";
import { DRAFT_FIELDS } from "@/lib/draft/fields";
import {
  emptyReport,
  type AmbiguousItem,
  type IntakeReport,
  type NotFoundItem,
  type UpdatedItem,
} from "@/lib/email-intake/types";
import { he } from "@/lib/he";
import { normalizeName } from "@/lib/normalize";
import { paragraphText, renderIntakeReplyHtml, type ReplyParagraph, type ReplySegment } from "./render-html";

/**
 * ניסוח המייל החוזר לשולח מייל פנייה — "המיילים היוצאים לשולח" (סוף §4
 * באפיון), §7 שורות 71–72.
 *
 * **פונקציה טהורה, ומקבלת תוויות ולא מזהים.** השכבה שמעל קוראת את הטיוטה
 * בזמן השליחה, כדי שהמייל יתאר אותה כפי שהיא ולא כפי שהייתה כשהתשובה עובדה
 * (ראה `IntakeReport`), ומתרגמת מזהים לשמות. כך אפשר לבדוק כאן כל חלק של
 * המייל בלי בסיס נתונים — ומייל שיצא לאדם אמיתי אי אפשר להחזיר.
 *
 * **קלט שחסר לתבנית הוא כשל רועש.** מייל עם "undefined" במקום קישור, או
 * "פנייה #NaN", נשלח ואינו ניתן לתיקון; חסר כזה הוא באג בשכבה שמעל, והוא
 * חייב לעצור את השליחה ולהגיע ללוג ולא לתיבה של השולח.
 */

export type ReplyKind = "DRAFT" | "NO_SITE" | "NOT_PERMITTED" | "AFTER_DISPATCH" | "AFTER_DELETION";

/** מזהי הנוסחים במטריצת ההתאמה (EM-L01…EM-L09) */
export type ReplyTemplate = "L01" | "L04" | "L05" | "L06" | "L07_FIRST" | "L07_REPLY" | "L08" | "L09";

/** "מה יש בטיוטה עכשיו" — תוויות להצגה; null הוא שדה ריק ומוצג "—" (EM-A02) */
export interface DraftSummary {
  site: string | null;
  building: string | null;
  apartment: string | null;
  room: string | null;
  domain: string | null;
  description: string | null;
  recipients: string[];
}

/** שורה ב"סותר את מה שנקבע במערכת" — שני הערכים כתוויות */
export interface ConflictLine {
  field: DraftFieldName;
  emailValue: string;
  systemValue: string;
}

export interface ComposeIntakeReplyInput {
  kind: ReplyKind;
  /** מי שמקבל את המייל — השולח, או משתמש מורשה אחר שענה (5.ה3 כלל 9) */
  recipientName: string;
  originalSubject: string;
  /** המייל עונה על תשובה בשרשרת, ולא על המייל הראשון */
  isReply?: boolean;
  extractionUnavailable?: boolean;
  summary?: DraftSummary;
  /**
   * השדות החסרים (`missingFields`). **חובה להעביר גם כשהוא ריק:** בלי המידע
   * אי אפשר לדעת שלא חסר דבר, והמייל נשאר בנוסח הכללי (ראה `selectTemplate`).
   */
  missing?: DraftFieldName[];
  /** רשימת האתרים, כשהאתר חסר (EM-A03) */
  siteOptions?: string[];
  /** כמו `missing` — חובה להעביר גם כשהוא ריק */
  conflicts?: ConflictLine[];
  report?: IntakeReport;
  draftLink?: string;
  /** EM-L05 */
  ticketSeq?: number;
  /** EM-L05 */
  ticketLink?: string;
  /** EM-L08 — "אפשר לפנות ל[שם השולח]" */
  senderName?: string;
}

export interface ComposedIntakeReply {
  template: ReplyTemplate;
  subject: string;
  text: string;
  html: string;
}

const t = he.emailIntake;

/**
 * שם השדה במייל הוא השם שהמסך קורא לו — מאותם מקורות, כדי ש"דירה" במייל
 * ו"דירה" בטופס של מסך 7 יהיו אותה מילה גם אחרי שינוי נוסח.
 */
const FIELD_LABEL: Record<DraftFieldName, string> = {
  SITE: he.ticket.site,
  BUILDING: he.directory.building,
  APARTMENT: he.directory.apartment,
  ROOM: he.ticket.room,
  DOMAIN: he.directory.domain,
  DESCRIPTION: he.ticket.description,
  RECIPIENTS: he.ticket.recipients,
};

export function selectTemplate(input: ComposeIntakeReplyInput): ReplyTemplate {
  switch (input.kind) {
    case "NO_SITE":
      return "L09";
    case "NOT_PERMITTED":
      return "L08";
    case "AFTER_DISPATCH":
      return "L05";
    case "AFTER_DELETION":
      return "L06";
    case "DRAFT":
      if (input.extractionUnavailable) return input.isReply ? "L07_REPLY" : "L07_FIRST";
      // "כל הפרטים זוהו" רק כשידוע שלא חסר דבר **וידוע** שאין סתירה. רשימה
      // שלא הועברה אינה "ריקה": ניחוש לכיוון הזה היה אומר לשולח שהטיוטה
      // מוכנה כשאינה — בדיוק מה שהאפיון אוסר גם על סתירה פתוחה (EM-L04).
      // הכיוון ההפוך זול: מייל כללי על טיוטה שלמה רק מזמין להשלים אותה.
      return input.missing?.length === 0 && input.conflicts?.length === 0 ? "L04" : "L01";
  }
}

export function composeIntakeReply(input: ComposeIntakeReplyInput): ComposedIntakeReply {
  const template = selectTemplate(input);
  const paragraphs: ReplyParagraph[] = [[text(t.greeting(oneLine(input.recipientName)))], ...body(template, input)];

  return {
    template,
    subject: replySubject(input.originalSubject),
    text: paragraphs.map(paragraphText).join("\n\n"),
    html: renderIntakeReplyHtml(paragraphs),
  };
}

function body(template: ReplyTemplate, input: ComposeIntakeReplyInput): ReplyParagraph[] {
  switch (template) {
    case "L01":
    case "L04":
      return draftBody(template, input);
    case "L05": {
      const seq = input.ticketSeq;
      if (seq === undefined || !Number.isInteger(seq) || seq <= 0) throw contractError(template, "ticketSeq");
      const link = required(input.ticketLink, template, "ticketLink");
      return [withLink((slot) => t.afterDispatch(seq, slot), link)];
    }
    case "L06":
      return [[text(t.afterDeletion)]];
    case "L07_FIRST":
      return [withLink(t.extractionUnavailableFirst, required(input.draftLink, template, "draftLink"))];
    case "L07_REPLY":
      return [withLink(t.extractionUnavailableReply, required(input.draftLink, template, "draftLink"))];
    case "L08":
      return [[text(t.notPermitted(required(input.senderName, template, "senderName")))]];
    case "L09":
      return [[text(t.noSite)]];
  }
}

/**
 * המייל הכללי (EM-L01) והגרסה השלמה שלו (EM-L04).
 *
 * **"כל חלק מודגש מופיע רק כשיש בו תוכן, מלבד 'מה יש בטיוטה עכשיו'"** —
 * חלק ריק מוחזר כ-null ונשמט, כך שהשמטה אינה משאירה שורה ריקה כפולה.
 * הסדר כאן הוא הסדר שבאפיון.
 */
function draftBody(template: "L01" | "L04", input: ComposeIntakeReplyInput): ReplyParagraph[] {
  if (!input.summary) throw contractError(template, "summary");
  const link = required(input.draftLink, template, "draftLink");
  const report = input.report ?? emptyReport();

  const paragraphs: (ReplyParagraph | null)[] = [
    [text(`${t.received} `), strong(t.notSentYet)],
    [strong(t.currentHeading), text(`\n${summaryLine(input.summary)}\n${descriptionLine(input.summary)}`)],
    // "מופיע רק במייל שעונה על תשובה": במייל הראשון כל ערך "עודכן" מהמייל,
    // ורשימה כזו הייתה חוזרת על שורת הסיכום שמעליה.
    input.isReply ? updatedSection(report.updated) : null,
    missingSection(input.missing ?? [], input.siteOptions ?? [], report.notFound),
    notFoundSection(report.notFound),
    ambiguousSection(report.ambiguous),
    conflictSection(input.conflicts ?? []),
    template === "L04" ? withLink(t.ready, link) : [strong(t.howToHeading), text(" "), ...withLink(t.howTo, link)],
  ];
  return paragraphs.filter((paragraph): paragraph is ReplyParagraph => paragraph !== null);
}

/**
 * "אתר: x · בניין: x · דירה: x · חדר: x · תחום: x · נמענים: x" — **כל השדות
 * תמיד, באותו סדר** (EM-A02). שורה שהשמיטה שדות ריקים הייתה מסתירה בדיוק את
 * מה שחסר. הסדר הוא `DRAFT_FIELDS`; התיאור יורד לשורה משלו כי הוא טקסט
 * חופשי ארוך.
 */
function summaryLine(summary: DraftSummary): string {
  return DRAFT_FIELDS.filter((field) => field !== "DESCRIPTION")
    .map((field) => t.summaryItem(FIELD_LABEL[field], summaryValue(summary, field)))
    .join(t.summarySeparator);
}

function summaryValue(summary: DraftSummary, field: Exclude<DraftFieldName, "DESCRIPTION">): string {
  switch (field) {
    case "SITE":
      return display(summary.site);
    case "BUILDING":
      return display(summary.building);
    case "APARTMENT":
      return display(summary.apartment);
    case "ROOM":
      return display(summary.room);
    case "DOMAIN":
      return display(summary.domain);
    case "RECIPIENTS": {
      const names = summary.recipients.map(oneLine).filter(Boolean);
      return names.length > 0 ? names.join(t.listSeparator) : t.empty;
    }
  }
}

/**
 * התיאור הוא היחיד שירידות השורה בו נשמרות: הוא מה שהשולח כתב, ושורות
 * שהתאחו לשורה אחת היו משנות אותו. כל שאר הערכים מכווצים לשורה אחת.
 */
function descriptionLine(summary: DraftSummary): string {
  const description = (summary.description ?? "").replace(/\r\n?/g, "\n").trim();
  return t.summaryItem(FIELD_LABEL.DESCRIPTION, description || t.empty);
}

function updatedSection(items: readonly UpdatedItem[]): ReplyParagraph | null {
  const lines = byField(items).map((item) =>
    t.updatedItem(FIELD_LABEL[item.field], display(item.before), display(item.after)),
  );
  return section(t.updatedHeading, lines.join(t.listSeparator));
}

/**
 * "חסר". כשהאתר חסר, מצורפת רשימת האתרים (EM-A03) — **אלא אם היא כבר מופיעה
 * תחת "לא נמצא ברשימה"**: השולח כתב אתר שלא נמצא, ואותה רשימה פעמיים באותו
 * מייל רק מאריכה אותו. האפיון מצדיק את הרשימה ב"חסר" במקרה ש"האתר לא
 * הוזכר כלל", כלומר כשאין לה מקום אחר.
 */
function missingSection(
  missing: readonly DraftFieldName[],
  siteOptions: readonly string[],
  notFound: readonly NotFoundItem[],
): ReplyParagraph | null {
  // סדר הטיוטה ובלי כפילויות, בלי תלות בסדר שבו השכבה שמעל אספה אותם
  const fields = DRAFT_FIELDS.filter((field) => missing.includes(field));
  if (fields.length === 0) return null;

  const labels = fields
    .map((field) => (field === "RECIPIENTS" ? t.missingRecipients : FIELD_LABEL[field]))
    .join(t.listSeparator);
  const listedUnderNotFound = notFound.some(
    (item) => item.field === "SITE" && optionsSentence("SITE", item.options ?? []) !== null,
  );
  const options = fields.includes("SITE") && !listedUnderNotFound ? optionsSentence("SITE", siteOptions) : null;
  return section(t.missingHeading, options ? t.missingWithOptions(labels, options) : labels);
}

function notFoundSection(items: readonly NotFoundItem[]): ReplyParagraph | null {
  const sentences = byField(items).map((item) => {
    const sentence = t.notFoundItem(FIELD_LABEL[item.field], oneLine(item.written));
    const options = optionsSentence(item.field, item.options ?? []);
    return options ? `${sentence} ${options}` : sentence;
  });
  return section(t.notFoundHeading, sentences.join(" "));
}

function ambiguousSection(items: readonly AmbiguousItem[]): ReplyParagraph | null {
  if (items.length === 0) return null;
  // "נמצאו כמה התאמות" בלי שתי התאמות לפחות הוא באג בשכבה שמעל, והמשפט
  // היה יוצא שבור ('כתבת "יוסי" — .') — אותו כלל כמו קלט חסר לתבנית
  if (items.some((item) => item.matches.map(oneLine).filter(Boolean).length < 2)) {
    throw new Error("composeIntakeReply: \"נמצאו כמה התאמות\" דורש לפחות שתי התאמות לכל שדה");
  }
  const sentences = byField(items).map((item) =>
    t.ambiguousItem(FIELD_LABEL[item.field], oneLine(item.written), item.matches.map(oneLine).join(t.listSeparator)),
  );
  // ההנחיה פעם אחת, אחרי כל השדות — היא אותה הנחיה לכולם
  return section(t.ambiguousHeading, [...sentences, t.ambiguousHint].join(" "));
}

function conflictSection(conflicts: readonly ConflictLine[]): ReplyParagraph | null {
  if (conflicts.length === 0) return null;
  const sentences = byField(conflicts).map((line) =>
    t.conflictItem(FIELD_LABEL[line.field], display(line.emailValue), display(line.systemValue)),
  );
  return section(t.conflictHeading, [...sentences, t.conflictHint].join(" "));
}

/**
 * "התחומים הקיימים: חשמל, אינסטלציה." — רק לשדות שיש להם כותרת ב-
 * `he.emailIntake.existingOptions` (אתר, בניין, תחום; EM-L02). רשימה שהועברה
 * לשדה אחר נזרקת, ורשימה ריקה אינה מייצרת "הבניינים הקיימים: ." — עדיף
 * משפט חסר על משפט שאומר שאין כלום כשהבעיה היא בנתונים.
 */
function optionsSentence(field: DraftFieldName, options: readonly string[]): string | null {
  const headings: Partial<Record<DraftFieldName, string>> = t.existingOptions;
  const heading = headings[field];
  const names = options.map(oneLine).filter(Boolean);
  if (!heading || names.length === 0) return null;
  return t.optionsSentence(heading, names.join(t.listSeparator));
}

// ───────────────────────────── עזרי הרכבה ─────────────────────────────

function text(value: string): ReplySegment {
  return { kind: "text", text: value };
}

function strong(value: string): ReplySegment {
  return { kind: "strong", text: value };
}

/** חלק מודגש: כותרת, רווח, תוכן. בלי תוכן — אין חלק. */
function section(heading: string, content: string): ReplyParagraph | null {
  return content ? [strong(heading), text(` ${content}`)] : null;
}

/**
 * תו מהאזור הפרטי של יוניקוד, שלא יכול להופיע בנוסח של `he.ts`.
 *
 * משפט עם קישור מקבל אותו במקום הקישור, ומה שמשני צדדיו הוא הטקסט שלפני
 * ואחרי. כך הנוסח נשאר משפט אחד שנקרא כמו באפיון, וה-HTML עדיין יודע בדיוק
 * איפה ה-`<a>` — בלי לחפש כתובות בתוך טקסט.
 */
const LINK_SLOT = "";

function withLink(sentence: (link: string) => string, href: string): ReplySegment[] {
  const parts = sentence(LINK_SLOT).split(LINK_SLOT);
  if (parts.length !== 2) throw new Error("composeIntakeReply: משפט עם קישור חייב להכיל את הקישור פעם אחת בדיוק");
  const [before, after] = parts;
  return [...(before ? [text(before)] : []), { kind: "link", href }, ...(after ? [text(after)] : [])];
}

/**
 * פריטים בסדר השדות של הטיוטה. המיון יציב, ולכן שני פריטים של אותו שדה
 * (שני נמענים שלא נמצאו) נשארים בסדר שבו נכתבו.
 */
function byField<T extends { field: DraftFieldName }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => DRAFT_FIELDS.indexOf(a.field) - DRAFT_FIELDS.indexOf(b.field));
}

/**
 * ערך בתוך משפט או בשורת הסיכום עובר `oneLine` (= `normalizeName`, שמכווץ כל
 * רצף רווחים — כולל ירידות שורה — לרווח אחד). ירידת שורה במה שהשולח כתב, או
 * בשם של רשומה, הייתה שוברת את השורה באמצע — ובטקסט הפשוט גם יוצרת "פסקה"
 * חדשה. הכיווץ עצמו חי ב-`normalize.ts`, כדי שלא יהיו שתי הגדרות של "רווחים
 * מיותרים".
 */
const oneLine = normalizeName;

function display(value: string | null): string {
  return (value === null ? "" : oneLine(value)) || t.empty;
}

function required(value: string | undefined, template: ReplyTemplate, field: string): string {
  const cleaned = oneLine(value ?? "");
  if (!cleaned) throw contractError(template, field);
  return cleaned;
}

function contractError(template: ReplyTemplate, field: string): Error {
  return new Error(`composeIntakeReply: התבנית ${template} דורשת ${field}`);
}

/**
 * `Re: <הכותרת המקורית>`, ובלי קידומת כפולה בתשובה לתשובה. הכותרת נכנסת
 * לכותרת MIME, ולכן ירידת שורה בתוכה מוחלפת ברווח — אחרת היא הייתה פותחת
 * כותרת נוספת בהודעה.
 */
function replySubject(original: string): string {
  const subject = original.replace(/[\r\n]+/g, " ").trim();
  if (subject.toLowerCase().startsWith(t.replyPrefix.toLowerCase())) return subject;
  return subject ? `${t.replyPrefix} ${subject}` : t.replyPrefix;
}
