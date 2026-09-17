import type { DraftFieldName, Room } from "@/generated/prisma/enums";

/**
 * הטיפוסים של צינור קליטת המייל (אפיון §2.6, §5.ה3).
 *
 * **הליבה אינה יודעת מאיזה ערוץ הגיעה הודעה.** המתאם ל-Gmail
 * (`gmail-source.ts`) הוא המקום היחיד שמכיר את מבנה ה-API; הוא מייצר
 * `MailEnvelope`, ומכאן והלאה — סיווג, חילוץ, מיזוג ומענה — הכול עובד על
 * המעטפה. ערוץ נוסף בעתיד הוא מתאם נוסף, לא שינוי בליבה.
 */

/** כתובת מנורמלת (`normalizeEmail`) ושם תצוגה, אם היה */
export interface MailAddress {
  address: string;
  name: string | null;
}

/**
 * חלק בינארי בהודעה: קובץ מצורף או תמונה משובצת.
 *
 * **הבתים אינם כאן בהכרח.** Gmail מחזיר חלק קטן כ-`body.data` בתוך ההודעה
 * וחלק גדול כ-`attachmentId` שיש להוריד בנפרד. `data` מאוכלס כשהבתים כבר
 * בידינו, ו-`sourceRef` הוא מה שהמתאם צריך כדי להוריד אותם אחרת.
 */
export interface MailPart {
  /** מיקום החלק בעץ ה-MIME, בסדר הופעה. יציב בין קריאות של אותה הודעה. */
  index: number;
  filename: string | null;
  /** הסוג כפי שהוצהר בכותרת, מנורמל לאותיות קטנות ובלי פרמטרים */
  mimeType: string;
  sizeBytes: number;
  /** `Content-ID` בלי סוגריים משולשים */
  contentId: string | null;
  disposition: "attachment" | "inline" | null;
  data: Buffer | null;
  sourceRef: string | null;
}

export interface MailEnvelope {
  /** מזהה ההודעה במקור (Gmail message id) */
  sourceId: string;
  /** מזהה השרשור במקור (Gmail thread id) */
  sourceThreadId: string;
  /** `Message-ID`, מנורמל — ראה `normalizeMessageId` */
  rfcMessageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  receivedAt: Date;
  /** כל הכותרות של החלק העליון, בשמות באותיות קטנות. ערך אחרון גובר. */
  headers: Record<string, string>;
  /** `Content-Type` של ההודעה כולה, מנורמל (למשל `multipart/report`) */
  contentType: string;
  /** הגוף כטקסט פשוט, מפוענח לפי ה-charset */
  text: string;
  /** הגוף כ-HTML, אם היה */
  html: string | null;
  parts: MailPart[];
}

// ─────────────────────────────── חילוץ ───────────────────────────────

/**
 * מאיפה נלקח ערך שחולץ.
 *
 * `text` — מופיע מילולית בכותרת או בטקסט שנקרא; נבדק בקוד, וערך שאינו
 * מופיע נזרק. `attachment` — מקובץ מצורף, ולכן אינו ניתן לבדיקה מילולית.
 */
export type MentionSource = "none" | "text" | "attachment";

/** ערך כפי שנכתב — לעולם לא מזהה. ההתאמה לרשומות נעשית בקוד (`matching.ts`). */
export interface Mention {
  text: string;
  source: MentionSource;
}

/**
 * מה שהמחלץ קרא ממייל אחד. **פעולות על שדות, כטקסט כפי שנכתב.**
 *
 * המחלץ אינו מחליט דבר על הטיוטה: הוא אינו יודע מה ערכה הנוכחי, אינו
 * בוחר מזהים, ואינו יודע אם יש סתירה. כל אלה בקוד — כי מודל שפה שמתבקש
 * "לבחור מהרשימה" בוחר גם כשהקלט אינו מתאים לאף פריט.
 */
export interface FieldExtraction {
  site: Mention;
  building: Mention;
  apartment: Mention;
  room: { value: Room | null; source: MentionSource };
  domain: Mention;
  description: { op: "none" | "set" | "append" | "replace"; text: string };
  recipients: { add: Mention[]; remove: Mention[] };
}

// ───────────────────────────── דיווח לשולח ─────────────────────────────

/** ערך שנכתב ולא נמצא ברשימה (EM-07) */
export interface NotFoundItem {
  field: DraftFieldName;
  written: string;
  /** האפשרויות הקיימות — רק לאתר, לבניין ולתחום (EM-L02) */
  options: string[] | null;
}

/** ערך שנכתב ומתאים ליותר מרשומה אחת (EM-08) */
export interface AmbiguousItem {
  field: DraftFieldName;
  written: string;
  matches: string[];
}

/** שדה שעודכן מהתשובה — "עודכן מהתשובה שלך: חדר (מטבח ← חדר רחצה)" */
export interface UpdatedItem {
  field: DraftFieldName;
  /** תוויות להצגה; ריק מוצג כ-"—" (§7 שורה 71) */
  before: string | null;
  after: string | null;
}

/**
 * מה עלה מעיבוד הודעה נכנסת אחת — נשמר ב-`MailboxMessage.report`.
 *
 * **המצב הנוכחי של הטיוטה אינו כאן.** "מה יש בטיוטה", "חסר" ו"סותר" נקראים
 * בזמן שליחת המייל החוזר, כדי שהמייל יתאר את הטיוטה כפי שהיא ולא כפי שהייתה
 * כשהתשובה עובדה. כאן רק מה שאין דרך לשחזר אחר כך: מה המייל הזה שינה, ומה
 * נכתב בו ולא נמצא.
 */
export interface IntakeReport {
  updated: UpdatedItem[];
  notFound: NotFoundItem[];
  ambiguous: AmbiguousItem[];
}

export function emptyReport(): IntakeReport {
  return { updated: [], notFound: [], ambiguous: [] };
}
