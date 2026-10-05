/**
 * תקלה בחיבור המספר העסקי — מה מסך 17 אומר למנהל, ומה שמור ב-`WaNumber.lastError`.
 *
 * **נשמר קוד, לא נוסח.** הנוסח נגזר מהקוד בזמן התצוגה (`he.whatsappAdmin.issue`),
 * מאותו נימוק של מטען הג׳ובים שמכיל מזהים בלבד: תיקון ניסוח חל מיד גם על תקלה
 * שכבר נרשמה, וה-he.ts נשאר מקור האמת היחיד לטקסט.
 *
 * כל קוד הוא "תקלה" (`WaNumberStatus.ERROR`) שאומרת מה לעשות — לחבר מחדש. אין כאן
 * כשל חולף מול Meta: בדיקה תקופתית שלא הגיעה לתשובה אינה משנה את המצב, ומדווחת
 * בלוג בלבד (אפיון מסך 17).
 */
export type WaIssue =
  /** Graph דחה את הטוקן — למשל האפליקציה הוסרה בהגדרות העסק אצל Meta */
  | { code: "token_revoked" }
  /** הטוקן השמור אינו ניתן לפענוח — `SESSION_SECRET` הוחלף */
  | { code: "token_unreadable" }
  /** האפליקציה שלנו אינה מנויה על החשבון, או שהכתובת שלה הופנתה למקום אחר */
  | { code: "subscription_lost" }
  /** המספר אינו קיים עוד בחשבון */
  | { code: "number_missing" }
  /** המספר כבר אינו פעיל באפליקציה בטלפון */
  | { code: "not_on_app" }
  /** Meta הודיעה על ניתוק (`account_update`). הסיבה כפי שנמסרה, או null. */
  | { code: "partner_removed"; reason: string | null }
  /** הסנכרון שהחיבור מחייב לא הושלם תוך 24 שעות */
  | { code: "sync_overdue" };

export type WaIssueCode = WaIssue["code"];

const CODES: ReadonlySet<string> = new Set<WaIssueCode>([
  "token_revoked",
  "token_unreadable",
  "subscription_lost",
  "number_missing",
  "not_on_app",
  "partner_removed",
  "sync_overdue",
]);

/** `partner_removed:PRIMARY_INACTIVITY` — הקוד, ואחרי נקודתיים הסיבה כשיש */
export function encodeIssue(issue: WaIssue): string {
  return issue.code === "partner_removed" && issue.reason ? `${issue.code}:${issue.reason}` : issue.code;
}

/** הפענוח ההפוך. ערך שאינו קוד מוכר (שורה מגרסה אחרת) — null, כלומר "בלי פירוט". */
export function decodeIssue(value: string | null | undefined): WaIssue | null {
  if (!value) return null;
  const separator = value.indexOf(":");
  const code = separator === -1 ? value : value.slice(0, separator);
  if (!CODES.has(code)) return null;
  if (code === "partner_removed") {
    const reason = separator === -1 ? "" : value.slice(separator + 1);
    return { code, reason: reason || null };
  }
  return { code } as WaIssue;
}
