import type { DraftFieldName } from "@/generated/prisma/enums";
import { DRAFT_FIELDS } from "@/lib/draft/fields";
import { DRAFT_FIELD_LABEL } from "@/lib/draft/labels";
import { normalizeName } from "@/lib/normalize";
import { type AmbiguousItem, type IntakeReport, type NotFoundItem, type UpdatedItem, emptyReport } from "./types";

/**
 * המבנה של המענה לשולח — אילו חלקים יש בו, באיזה סדר ומתי כל אחד מופיע
 * ("המיילים היוצאים לשולח" בסוף §4 באפיון, ו"ההודעות היוצאות בוואטסאפ"; §7
 * שורות 71–72).
 *
 * **ערוץ אחד של כללים, שני ערוצים של נוסח.** הוואטסאפ מקבל "את התוכן של
 * המיילים היוצאים, באותם כללים", בנוסח מקוצר לצ׳אט. לכן הכללים — מתי חלק
 * מופיע, מה מוצג כשערך ריק, ואיזו תבנית נבחרת — כתובים כאן פעם אחת, והנוסח
 * מגיע כחבילת מחרוזות (`IntakeReplyTexts`) מ-`he.ts`. כל ערוץ מרנדר את
 * הפסקאות בעצמו: המייל לטקסט ול-HTML (`email-intake/reply/`), והוואטסאפ
 * להדגשה של וואטסאפ.
 *
 * **פונקציה טהורה, ומקבלת תוויות ולא מזהים.** השכבה שמעל קוראת את הטיוטה
 * בזמן השליחה, כדי שהמענה יתאר אותה כפי שהיא ולא כפי שהייתה כשההודעה עובדה
 * (ראה `IntakeReport`), ומתרגמת מזהים לשמות. כך אפשר לבדוק כאן כל חלק של
 * המענה בלי בסיס נתונים — ומענה שיצא לאדם אמיתי אי אפשר להחזיר.
 *
 * **קלט שחסר לתבנית הוא כשל רועש.** מענה עם "undefined" במקום קישור, או
 * "פנייה #NaN", נשלח ואינו ניתן לתיקון; חסר כזה הוא באג בשכבה שמעל, והוא
 * חייב לעצור את השליחה ולהגיע ללוג ולא לשולח.
 */

// ─────────────────────────────── המבנה ───────────────────────────────

export type ReplySegment =
  | { kind: "text"; text: string }
  /** כותרת חלק, או המשפט שהאפיון מדגיש ("הטיוטה עוד לא נשלחה לאיש.") */
  | { kind: "strong"; text: string }
  | { kind: "link"; href: string };

/** פסקה = רצף מקטעים. ירידת שורה בתוך מקטע נשמרת. */
export type ReplyParagraph = readonly ReplySegment[];

/** הטקסט השטוח של פסקה — אותו רצף מקטעים, בלי סימון */
export function paragraphText(paragraph: ReplyParagraph): string {
  return paragraph.map((segment) => (segment.kind === "link" ? segment.href : segment.text)).join("");
}

// ─────────────────────────────── הקלט ───────────────────────────────

/**
 * `HINT` — ההסבר החד-פעמי של וואטסאפ (WA-L10, §7 שורה 98). למייל אין מקבילה:
 * שם EM-L10 הוא הכלל "על מה לא נשלח מייל", ולכן המייל לעולם אינו מבקש אותו.
 */
export type ReplyKind = "DRAFT" | "NO_SITE" | "NOT_PERMITTED" | "AFTER_DISPATCH" | "AFTER_DELETION" | "HINT";

/** מזהי הנוסחים במטריצת ההתאמה (EM-L01…EM-L09, ו-WA-L10 של וואטסאפ בלבד) */
export type ReplyTemplate = "L01" | "L04" | "L05" | "L06" | "L07_FIRST" | "L07_REPLY" | "L08" | "L09" | "L10";

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
  /** הערך שההודעה האחרונה בערוץ הציעה */
  channelValue: string;
  systemValue: string;
}

export interface IntakeReplyInput {
  kind: ReplyKind;
  /** מי שמקבל את המענה — השולח, או משתמש מורשה אחר שענה (5.ה3 כלל 9) */
  recipientName: string;
  /** המענה עונה על תשובה בשרשרת, ולא על ההודעה הראשונה */
  isReply?: boolean;
  extractionUnavailable?: boolean;
  summary?: DraftSummary;
  /**
   * השדות החסרים (`missingFields`). **חובה להעביר גם כשהוא ריק:** בלי המידע
   * אי אפשר לדעת שלא חסר דבר, והמענה נשאר בנוסח הכללי (ראה `selectTemplate`).
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
  /** EM-L08 — "אפשר לפנות ל[שם השולח]". נדרש רק כשהנוסח של הערוץ מזכיר אותו. */
  senderName?: string;
}

/**
 * הנוסח של ערוץ אחד — `he.emailIntake`, ובהמשך גם הוואטסאפ. הכללים כאן אינם
 * יודעים איזו חבילה קיבלו.
 */
export interface IntakeReplyTexts {
  greeting: (name: string) => string;
  received: string;
  notSentYet: string;
  currentHeading: string;
  empty: string;
  summaryItem: (label: string, value: string) => string;
  summarySeparator: string;
  listSeparator: string;
  updatedHeading: string;
  updatedItem: (label: string, before: string, after: string) => string;
  missingHeading: string;
  missingRecipients: string;
  missingWithOptions: (fields: string, optionsSentence: string) => string;
  notFoundHeading: string;
  notFoundItem: (label: string, written: string) => string;
  /** כותרות רשימת האפשרויות — רק לשדות שיש להם כותרת כאן (EM-L02) */
  existingOptions: Partial<Record<DraftFieldName, string>>;
  optionsSentence: (heading: string, options: string) => string;
  ambiguousHeading: string;
  ambiguousItem: (label: string, written: string, matches: string) => string;
  ambiguousHint: string;
  conflictHeading: string;
  conflictItem: (label: string, channelValue: string, systemValue: string) => string;
  conflictHint: string;
  howToHeading: string;
  howTo: (link: string) => string;
  ready: (link: string) => string;
  afterDispatch: (seq: number, link: string) => string;
  afterDeletion: string;
  extractionUnavailableFirst: (link: string) => string;
  extractionUnavailableReply: (link: string) => string;
  /**
   * פונקציה — הנוסח מפנה לשולח המקורי בשמו (מייל, EM-L08); מחרוזת — הנוסח אינו
   * מזכיר אותו (וואטסאפ, §7 שורה 105). השם נדרש מהקלט רק במקרה הראשון.
   */
  notPermitted: string | ((senderName: string) => string);
  noSite: string;
  /** ההסבר החד-פעמי (WA-L10) — רק לערוץ שיש לו כזה */
  hint?: string;
}

// ─────────────────────────────── הכללים ───────────────────────────────

export function selectTemplate(input: IntakeReplyInput): ReplyTemplate {
  switch (input.kind) {
    case "NO_SITE":
      return "L09";
    case "NOT_PERMITTED":
      return "L08";
    case "AFTER_DISPATCH":
      return "L05";
    case "AFTER_DELETION":
      return "L06";
    case "HINT":
      return "L10";
    case "DRAFT":
      if (input.extractionUnavailable) return input.isReply ? "L07_REPLY" : "L07_FIRST";
      // "כל הפרטים זוהו" רק כשידוע שלא חסר דבר **וידוע** שאין סתירה. רשימה
      // שלא הועברה אינה "ריקה": ניחוש לכיוון הזה היה אומר לשולח שהטיוטה
      // מוכנה כשאינה — בדיוק מה שהאפיון אוסר גם על סתירה פתוחה (EM-L04).
      // הכיוון ההפוך זול: מענה כללי על טיוטה שלמה רק מזמין להשלים אותה.
      return input.missing?.length === 0 && input.conflicts?.length === 0 ? "L04" : "L01";
  }
}

/**
 * גוף המענה — הפסקאות שאחרי הפנייה בשם. הפנייה עצמה (`texts.greeting`)
 * שייכת לערוץ, כי כל ערוץ מצמיד אותה אחרת.
 */
export function buildReplyBody(
  input: IntakeReplyInput,
  texts: IntakeReplyTexts,
): { template: ReplyTemplate; paragraphs: ReplyParagraph[] } {
  const template = selectTemplate(input);
  return { template, paragraphs: body(template, input, texts) };
}

/** הפנייה בשם, בשורה אחת — `oneLine` גם על שם שנשמר עם ירידת שורה */
export function greetingText(name: string, texts: IntakeReplyTexts): string {
  return texts.greeting(oneLine(name));
}

function body(template: ReplyTemplate, input: IntakeReplyInput, t: IntakeReplyTexts): ReplyParagraph[] {
  switch (template) {
    case "L01":
    case "L04":
      return draftBody(template, input, t);
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
    case "L08": {
      const { notPermitted } = t;
      return [
        [
          text(
            typeof notPermitted === "string"
              ? notPermitted
              : notPermitted(required(input.senderName, template, "senderName")),
          ),
        ],
      ];
    }
    case "L09":
      return [[text(t.noSite)]];
    case "L10":
      // ערוץ בלי הסבר (המייל) אינו אמור לבקש אותו — ובקשה כזו היא באג, לא הודעה ריקה
      if (!t.hint) throw contractError(template, "hint");
      return [[text(t.hint)]];
  }
}

/**
 * המענה הכללי (EM-L01) והגרסה השלמה שלו (EM-L04).
 *
 * **"כל חלק מודגש מופיע רק כשיש בו תוכן, מלבד 'מה יש בטיוטה עכשיו'"** —
 * חלק ריק מוחזר כ-null ונשמט, כך שהשמטה אינה משאירה שורה ריקה כפולה.
 * הסדר כאן הוא הסדר שבאפיון.
 */
function draftBody(template: "L01" | "L04", input: IntakeReplyInput, t: IntakeReplyTexts): ReplyParagraph[] {
  if (!input.summary) throw contractError(template, "summary");
  const link = required(input.draftLink, template, "draftLink");
  const report = input.report ?? emptyReport();

  const paragraphs: (ReplyParagraph | null)[] = [
    [text(`${t.received} `), strong(t.notSentYet)],
    [strong(t.currentHeading), text(`\n${summaryLine(input.summary, t)}\n${descriptionLine(input.summary, t)}`)],
    // "מופיע רק במענה על תשובה": בהודעה הראשונה כל ערך "עודכן" ממנה, ורשימה
    // כזו הייתה חוזרת על שורת הסיכום שמעליה.
    input.isReply ? updatedSection(report.updated, t) : null,
    missingSection(input.missing ?? [], input.siteOptions ?? [], report.notFound, t),
    notFoundSection(report.notFound, t),
    ambiguousSection(report.ambiguous, t),
    conflictSection(input.conflicts ?? [], t),
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
function summaryLine(summary: DraftSummary, t: IntakeReplyTexts): string {
  return DRAFT_FIELDS.filter((field) => field !== "DESCRIPTION")
    .map((field) => t.summaryItem(DRAFT_FIELD_LABEL[field], summaryValue(summary, field, t)))
    .join(t.summarySeparator);
}

function summaryValue(
  summary: DraftSummary,
  field: Exclude<DraftFieldName, "DESCRIPTION">,
  t: IntakeReplyTexts,
): string {
  switch (field) {
    case "SITE":
      return display(summary.site, t);
    case "BUILDING":
      return display(summary.building, t);
    case "APARTMENT":
      return display(summary.apartment, t);
    case "ROOM":
      return display(summary.room, t);
    case "DOMAIN":
      return display(summary.domain, t);
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
function descriptionLine(summary: DraftSummary, t: IntakeReplyTexts): string {
  const description = (summary.description ?? "").replace(/\r\n?/g, "\n").trim();
  return t.summaryItem(DRAFT_FIELD_LABEL.DESCRIPTION, description || t.empty);
}

function updatedSection(items: readonly UpdatedItem[], t: IntakeReplyTexts): ReplyParagraph | null {
  const lines = byField(items).map((item) =>
    t.updatedItem(DRAFT_FIELD_LABEL[item.field], display(item.before, t), display(item.after, t)),
  );
  return section(t.updatedHeading, lines.join(t.listSeparator));
}

/**
 * "חסר". כשהאתר חסר, מצורפת רשימת האתרים (EM-A03) — **אלא אם היא כבר מופיעה
 * תחת "לא נמצא ברשימה"**: השולח כתב אתר שלא נמצא, ואותה רשימה פעמיים באותו
 * מענה רק מאריכה אותו. האפיון מצדיק את הרשימה ב"חסר" במקרה ש"האתר לא
 * הוזכר כלל", כלומר כשאין לה מקום אחר.
 */
function missingSection(
  missing: readonly DraftFieldName[],
  siteOptions: readonly string[],
  notFound: readonly NotFoundItem[],
  t: IntakeReplyTexts,
): ReplyParagraph | null {
  // סדר הטיוטה ובלי כפילויות, בלי תלות בסדר שבו השכבה שמעל אספה אותם
  const fields = DRAFT_FIELDS.filter((field) => missing.includes(field));
  if (fields.length === 0) return null;

  const labels = fields
    .map((field) => (field === "RECIPIENTS" ? t.missingRecipients : DRAFT_FIELD_LABEL[field]))
    .join(t.listSeparator);
  const listedUnderNotFound = notFound.some(
    (item) => item.field === "SITE" && optionsSentence("SITE", item.options ?? [], t) !== null,
  );
  const options = fields.includes("SITE") && !listedUnderNotFound ? optionsSentence("SITE", siteOptions, t) : null;
  return section(t.missingHeading, options ? t.missingWithOptions(labels, options) : labels);
}

function notFoundSection(items: readonly NotFoundItem[], t: IntakeReplyTexts): ReplyParagraph | null {
  const sentences = byField(items).map((item) => {
    const sentence = t.notFoundItem(DRAFT_FIELD_LABEL[item.field], oneLine(item.written));
    const options = optionsSentence(item.field, item.options ?? [], t);
    return options ? `${sentence} ${options}` : sentence;
  });
  return section(t.notFoundHeading, sentences.join(" "));
}

function ambiguousSection(items: readonly AmbiguousItem[], t: IntakeReplyTexts): ReplyParagraph | null {
  if (items.length === 0) return null;
  // "נמצאו כמה התאמות" בלי שתי התאמות לפחות הוא באג בשכבה שמעל, והמשפט
  // היה יוצא שבור ('כתבת "יוסי" — .') — אותו כלל כמו קלט חסר לתבנית
  if (items.some((item) => item.matches.map(oneLine).filter(Boolean).length < 2)) {
    throw new Error("buildReplyBody: \"נמצאו כמה התאמות\" דורש לפחות שתי התאמות לכל שדה");
  }
  const sentences = byField(items).map((item) =>
    t.ambiguousItem(DRAFT_FIELD_LABEL[item.field], oneLine(item.written), item.matches.map(oneLine).join(t.listSeparator)),
  );
  // ההנחיה פעם אחת, אחרי כל השדות — היא אותה הנחיה לכולם
  return section(t.ambiguousHeading, [...sentences, t.ambiguousHint].join(" "));
}

function conflictSection(conflicts: readonly ConflictLine[], t: IntakeReplyTexts): ReplyParagraph | null {
  if (conflicts.length === 0) return null;
  const sentences = byField(conflicts).map((line) =>
    t.conflictItem(DRAFT_FIELD_LABEL[line.field], display(line.channelValue, t), display(line.systemValue, t)),
  );
  return section(t.conflictHeading, [...sentences, t.conflictHint].join(" "));
}

/**
 * "התחומים הקיימים: חשמל, אינסטלציה." — רק לשדות שיש להם כותרת ב-
 * `existingOptions` (אתר, בניין, תחום; EM-L02). רשימה שהועברה לשדה אחר
 * נזרקת, ורשימה ריקה אינה מייצרת "הבניינים הקיימים: ." — עדיף משפט חסר על
 * משפט שאומר שאין כלום כשהבעיה היא בנתונים.
 */
function optionsSentence(field: DraftFieldName, options: readonly string[], t: IntakeReplyTexts): string | null {
  const heading = t.existingOptions[field];
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
 * ואחרי. כך הנוסח נשאר משפט אחד שנקרא כמו באפיון, והרינדור עדיין יודע בדיוק
 * איפה הקישור — בלי לחפש כתובות בתוך טקסט.
 */
const LINK_SLOT = "\uE000";

function withLink(sentence: (link: string) => string, href: string): ReplySegment[] {
  const parts = sentence(LINK_SLOT).split(LINK_SLOT);
  if (parts.length !== 2) throw new Error("buildReplyBody: משפט עם קישור חייב להכיל את הקישור פעם אחת בדיוק");
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

function display(value: string | null, t: IntakeReplyTexts): string {
  return (value === null ? "" : oneLine(value)) || t.empty;
}

function required(value: string | undefined, template: ReplyTemplate, field: string): string {
  const cleaned = oneLine(value ?? "");
  if (!cleaned) throw contractError(template, field);
  return cleaned;
}

function contractError(template: ReplyTemplate, field: string): Error {
  return new Error(`buildReplyBody: התבנית ${template} דורשת ${field}`);
}
