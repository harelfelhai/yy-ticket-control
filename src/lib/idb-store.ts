/**
 * שכבת גישה גנרית ל-IndexedDB — מקור אמת אחד לשמירה מקומית בדפדפן.
 *
 * שני צרכנים יושבים מעליה: `offline-draft.ts` (טיוטת טופס היצירה) ו-
 * `draft-completion-store.ts` (מצב השלמת טיוטה, פר-פנייה). שניהם צריכים
 * בדיוק את אותו דבר — חנות מפתח↔ערך שאינה חוסמת את הממשק, בולעת שגיאות,
 * ושורדת סגירת דפדפן — ולכן הפתיחה, הטרנזקציה ובליעת השגיאות מוגדרות פעם
 * אחת כאן ולא משוכפלות בכל צרכן.
 *
 * ‏IndexedDB ולא localStorage: הוא אסינכרוני ואינו חוסם את הממשק בזמן
 * הכתיבה, והמכסה שלו נמדדת במאות מגה־בייטים ולא בחמישה — חשוב כשגם המדיה
 * תישמר כאן. ‏IndexedDB גולמי ולא ספריית עטיפה: חנות אחת פשוטה, וספרייה
 * הייתה מוסיפה עשרות קילובייטים לחבילה שנטענת ברשת סלולרית איטית — בדיוק
 * התנאי שבגללו הקוד הזה קיים.
 */

const DB_NAME = "yy-ticket-control";
const DB_VERSION = 1;
const STORE = "drafts";

/**
 * טיוטה ישנה מזה כנראה נזנחה, ושחזור שלה מבלבל יותר משהוא עוזר.
 * משותף לכל הצרכנים כדי שמדיניות ההתיישנות תהיה אחידה ובמקום אחד.
 */
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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

/** קורא ערך לפי מפתח, או `undefined` אם אין (או אם הקריאה נכשלה). */
export function idbGet<T>(key: string): Promise<T | undefined> {
  return withStore<T | undefined>("readonly", (store) => store.get(key), undefined);
}

/** כותב ערך תחת מפתח, דורס ערך קודם. כשל נבלע בשקט. */
export async function idbPut(key: string, value: unknown): Promise<void> {
  await withStore("readwrite", (store) => store.put(value, key), undefined);
}

/** מוחק ערך לפי מפתח. כשל נבלע בשקט. */
export async function idbDelete(key: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(key), undefined);
}
