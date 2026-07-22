/**
 * שמירה מקומית של טופס הפנייה, בדפדפן, עד שהשרת אישר.
 *
 * זהו המימוש של הכלל הקשיח באפיון: **פנייה לא הולכת לאיבוד.** מנהל עבודה
 * עומד מול דירה בקומה תשע, מקליד תיאור, לוחץ "שלח" — ואין קליטה. בלי
 * שמירה מקומית מה שהקליד נעלם, והוא לומד לא לסמוך על המערכת. עם שמירה,
 * הוא רואה "נשמר מקומית — ממתין לחיבור" והמשלוח יוצא כשהחיבור חוזר.
 *
 * ‏IndexedDB ולא localStorage: הוא אסינכרוני ואינו חוסם את הממשק בזמן
 * הכתיבה, והמכסה שלו נמדדת במאות מגה־בייטים ולא בחמישה. השנייה תהיה
 * חשובה כשגם המדיה תישמר כאן.
 *
 * ‏IndexedDB גולמי ולא ספריית עטיפה: מדובר בחנות אחת עם ערך אחד, וספרייה
 * הייתה מוסיפה עשרות קילובייטים לחבילה שנטענת ברשת סלולרית איטית — בדיוק
 * התנאי שבגללו הקוד הזה קיים.
 */

const DB_NAME = "yy-ticket-control";
const DB_VERSION = 1;
const STORE = "drafts";

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
  /** מתי נשמרה — כדי שנוכל להתעלם מטיוטה עתיקה */
  savedAt: number;
  /** האם היא ממתינה לשיגור חוזר, להבדיל מהקלדה שוטפת */
  pending: boolean;
}

/** טיוטה ישנה מזה כנראה נזנחה, ושחזור שלה מבלבל יותר משהוא עוזר */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * כל הפעולות בולעות שגיאות ומחזירות ערך ניטרלי.
 *
 * דפדפן בגלישה פרטית, מכסה שנגמרה, או הרשאה שנחסמה — כל אלה אינם סיבה
 * למנוע ממנהל לפתוח פנייה. השמירה המקומית היא רשת ביטחון, ורשת ביטחון
 * שמפילה את המסך גרועה מאין רשת כלל.
 */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
  fallback: T,
): Promise<T> {
  if (typeof indexedDB === "undefined") return fallback;

  try {
    const db = await openDb();
    return await new Promise<T>((resolve) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => resolve(fallback);
      transaction.oncomplete = () => db.close();
    });
  } catch {
    return fallback;
  }
}

export async function saveDraft(draft: OfflineDraft): Promise<void> {
  await withStore("readwrite", (store) => store.put(draft, DRAFT_KEY), undefined);
}

export async function loadDraft(now: number = Date.now()): Promise<OfflineDraft | null> {
  const draft = await withStore<OfflineDraft | undefined>(
    "readonly",
    (store) => store.get(DRAFT_KEY),
    undefined,
  );

  if (!draft) return null;
  if (now - draft.savedAt > MAX_AGE_MS) {
    await clearDraft();
    return null;
  }
  return draft;
}

export async function clearDraft(): Promise<void> {
  await withStore("readwrite", (store) => store.delete(DRAFT_KEY), undefined);
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
