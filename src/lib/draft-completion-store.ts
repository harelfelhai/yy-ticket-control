/**
 * שמירה מקומית של מצב מסך השלמת הטיוטה, פר-פנייה.
 *
 * הבעיה שזה פותר: מה שמנהל העבודה מקליד במסך ההשלמה — תחום, תיאור, נמען
 * שנוצר תוך כדי — חי רק בזיכרון של רכיב הלקוח. רענון דף (משיכה-לרענון או
 * קריסה במובייל, ניווט בטעות) מוחק אותו, והמנהל צריך למלא הכול מחדש. אותו
 * כלל קשיח כמו טופס היצירה: **מה שהוקלד לא הולך לאיבוד.** לכן המצב נשמר
 * ל-IndexedDB ומשוחזר בעלייה.
 *
 * מפתח פר-פנייה (`ticketId`): כמה טיוטות עשויות להיות פתוחות בכרטיסיות
 * שונות, לכל אחת מצב השלמה משלה. השרברוב עצמו ב-`idb-store.ts` (משותף עם
 * `offline-draft`).
 *
 * נשמרות רק ה**בחירות** (מזהים וטקסט), לא רשימות האפשרויות: פריט שנוצר תוך
 * כדי (בניין/תחום/איש-מקצוע חדש) כבר נכתב לשרת ברגע יצירתו, ולכן יחזור
 * ברשימות ה-`initial` בעלייה הבאה — די לשמור את המזהה שנבחר.
 */

import { DRAFT_MAX_AGE_MS, idbDelete, idbGet, idbPut } from "@/lib/idb-store";

export interface DraftCompletionSnapshot {
  /** מזהה הפנייה — הוא גם מרכיב המפתח */
  ticketId: string;
  buildingId: string | null;
  apartmentId: string | null;
  domainId: string | null;
  description: string;
  recipientIds: { kind: "professional" | "user"; id: string }[];
  /** מתי נשמר — כדי להתעלם ממצב עתיק של טיוטה שנזנחה */
  savedAt: number;
}

/** מפריד מרחב-שמות מטיוטת טופס-היצירה (`new-ticket`) באותה חנות IndexedDB */
function completionKey(ticketId: string): string {
  return `complete:${ticketId}`;
}

export async function saveCompletion(snapshot: DraftCompletionSnapshot): Promise<void> {
  await idbPut(completionKey(snapshot.ticketId), snapshot);
}

export async function loadCompletion(
  ticketId: string,
  now: number = Date.now(),
): Promise<DraftCompletionSnapshot | null> {
  const snapshot = await idbGet<DraftCompletionSnapshot>(completionKey(ticketId));

  if (!snapshot) return null;
  if (now - snapshot.savedAt > DRAFT_MAX_AGE_MS) {
    await clearCompletion(ticketId);
    return null;
  }
  return snapshot;
}

/** מנקה את ה-snapshot — לאחר שיגור מוצלח או מחיקת טיוטה */
export async function clearCompletion(ticketId: string): Promise<void> {
  await idbDelete(completionKey(ticketId));
}

/**
 * האם המצב ריק — אין בו דבר ששווה לשמור מעבר למה שכבר בשרת.
 *
 * בלי הבדיקה כל כניסה למסך הייתה כותבת snapshot מיותר. שים לב:
 * בניין/דירה מגיעים לרוב מהשרת (הם קיימים בטיוטה) ולכן נחשבים "תוכן" —
 * וזה בסדר: שחזור שלהם לערך הזהה למה שבשרת אינו מזיק, ובכל מקרה השיגור
 * כותב רק שדות שעדיין חסרים.
 */
export function isEmptyCompletion(snapshot: DraftCompletionSnapshot): boolean {
  return (
    !snapshot.buildingId &&
    !snapshot.apartmentId &&
    !snapshot.domainId &&
    snapshot.description.trim().length === 0 &&
    snapshot.recipientIds.length === 0
  );
}
