/**
 * שמירה מקומית של טופס הפנייה, בדפדפן, עד שהשרת אישר.
 *
 * זהו המימוש של הכלל הקשיח באפיון: **פנייה לא הולכת לאיבוד.** מנהל עבודה
 * עומד מול דירה בקומה תשע, מקליד תיאור, לוחץ "שלח" — ואין קליטה. בלי
 * שמירה מקומית מה שהקליד נעלם, והוא לומד לא לסמוך על המערכת. עם שמירה,
 * הוא רואה "נשמר מקומית — ממתין לחיבור" והמשלוח יוצא כשהחיבור חוזר.
 *
 * שרברוב ה-IndexedDB עצמו יושב ב-`idb-store.ts` (מקור אמת אחד, משותף עם
 * `draft-completion-store.ts`); כאן נותרת רק הסמנטיקה של טיוטת-היצירה:
 * המפתח הקבוע, ההתיישנות, וההבחנה בין טיוטה ריקה למלאה.
 */

import { DRAFT_MAX_AGE_MS, idbDelete, idbGet, idbPut } from "@/lib/idb-store";

/** מפתח קבוע: יש טיוטה מקומית אחת בכל רגע, של הטופס הפתוח */
const DRAFT_KEY = "new-ticket";

export interface OfflineDraft {
  siteId: string;
  buildingId: string | null;
  apartmentId: string | null;
  domainId: string | null;
  room: string | null;
  description: string;
  recipientIds: { kind: "professional" | "user"; id: string }[];
  mediaIds: string[];
  /** תגיות שנבחרו. אופציונלי לשחזור סובלני של טיוטות מלפני שהשדה קיים. */
  tagIds?: string[];
  /** מתי נשמרה — כדי שנוכל להתעלם מטיוטה עתיקה */
  savedAt: number;
  /** האם היא ממתינה לשיגור חוזר, להבדיל מהקלדה שוטפת */
  pending: boolean;
}

export async function saveDraft(draft: OfflineDraft): Promise<void> {
  await idbPut(DRAFT_KEY, draft);
}

export async function loadDraft(now: number = Date.now()): Promise<OfflineDraft | null> {
  const draft = await idbGet<OfflineDraft>(DRAFT_KEY);

  if (!draft) return null;
  if (now - draft.savedAt > DRAFT_MAX_AGE_MS) {
    await clearDraft();
    return null;
  }
  return draft;
}

export async function clearDraft(): Promise<void> {
  await idbDelete(DRAFT_KEY);
}

/**
 * האם הטיוטה ריקה — כלומר אין בה דבר ששווה לשחזר.
 *
 * בלי הבדיקה הזו כל כניסה למסך הייתה כותבת טיוטה ריקה, וכל כניסה הבאה
 * הייתה "משחזרת" אותה ומציגה באנר על לא כלום.
 */
export function isEmptyDraft(draft: OfflineDraft): boolean {
  return (
    !draft.buildingId &&
    !draft.apartmentId &&
    !draft.domainId &&
    !draft.room &&
    draft.description.trim().length === 0 &&
    draft.recipientIds.length === 0 &&
    draft.mediaIds.length === 0
  );
}

/**
 * האם הכישלון הוא כשל תקשורת, להבדיל משגיאה עסקית.
 *
 * ההבחנה קובעת מה קורה אחר כך: כשל תקשורת שומר את הטופס ומנסה שוב, ואילו
 * "לא ניתן לשגר — חסר תחום" הוא משהו שרק המשתמש יכול לתקן, וניסיון חוזר
 * עליו הוא לולאה אינסופית שקטה.
 */
export function isNetworkFailure(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  // ‏fetch שנכשל ברמת הרשת זורק TypeError, ללא קשר לדפדפן.
  return error instanceof TypeError;
}
