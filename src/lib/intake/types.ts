import type { DraftFieldName, Room } from "@/generated/prisma/enums";

/**
 * הטיפוסים של ליבת הקליטה — מה ששני הערוצים (מייל, אפיון §2.6; וואטסאפ,
 * §2.7) חולקים: מה המחלץ קרא מהודעה אחת, ומה מדווחים לשולח עליה.
 *
 * **הליבה אינה יודעת מאיזה ערוץ הגיעה הודעה.** כל מתאם (Gmail ב-
 * `email-intake/`, וואטסאפ ב-`whatsapp/`) מתרגם את המבנה של הספק שלו, ומכאן
 * והלאה — חילוץ, התאמה, מיזוג ומענה — הכול עובד על הטיפוסים כאן.
 */

// ─────────────────────────────── חילוץ ───────────────────────────────

/**
 * מאיפה נלקח ערך שחולץ.
 *
 * `text` — מופיע מילולית בטקסט שנקרא; נבדק בקוד, וערך שאינו מופיע נזרק.
 * `attachment` — מקובץ מצורף, ולכן אינו ניתן לבדיקה מילולית.
 */
export type MentionSource = "none" | "text" | "attachment";

/** ערך כפי שנכתב — לעולם לא מזהה. ההתאמה לרשומות נעשית בקוד (`matching.ts`). */
export interface Mention {
  text: string;
  source: MentionSource;
}

/**
 * מה שהמחלץ קרא מהודעה אחת. **פעולות על שדות, כטקסט כפי שנכתב.**
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
 * מה שעלה מעיבוד הודעה נכנסת אחת — נשמר על שורת היומן של הערוץ.
 *
 * **המצב הנוכחי של הטיוטה אינו כאן.** "מה יש בטיוטה", "חסר" ו"סותר" נקראים
 * בזמן שליחת המענה, כדי שהמענה יתאר את הטיוטה כפי שהיא ולא כפי שהייתה
 * כשההודעה עובדה. כאן רק מה שאין דרך לשחזר אחר כך: מה ההודעה הזו שינתה, ומה
 * נכתב בה ולא נמצא.
 */
export interface IntakeReport {
  updated: UpdatedItem[];
  notFound: NotFoundItem[];
  ambiguous: AmbiguousItem[];
}

export function emptyReport(): IntakeReport {
  return { updated: [], notFound: [], ambiguous: [] };
}
