import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * "קישורי קסם" — הטוקן שבאמצעותו קבלן משנה נכנס למערכת בלי סיסמה.
 *
 * ארבע הכרעות אבטחה, וכל אחת נובעת מהמציאות של המשתמשים:
 *
 * 1. **טוקן לאיש מקצוע, לא לפנייה.** קבלן מקבל עשרות פניות; קישור נפרד
 *    לכל אחת היה מציף אותו בקישורים ומייצר עשרות סודות לנהל. קישור אחד
 *    פותח לו לוח אישי עם כל הפניות שלו.
 * 2. **האימות נעשה מול גיבוב (SHA-256) בלבד.** מסלול הכניסה לפורטל אינו
 *    מפענח דבר: הוא מגבב את הטוקן שהגיע ומחפש התאמה. SHA-256 ולא argon2
 *    בכוונה — זהו סוד אקראי ב-128 ביט ולא סיסמה שאדם בחר, ואין מה להגן
 *    עליו מפני ניחוש מילוני; גיבוב איטי היה רק מוסיף השהיה לכל בקשה.
 * 3. **ההרשאה נבדקת דינמית בכל בקשה** מול השיוכים הפעילים, ולא נגזרת
 *    מהטוקן. זו הסיבה שאפשר להשאיר את הקישור ללא תפוגה: ברגע שמנהל מסיר
 *    קבלן מפנייה, אותו קישור מפסיק לפתוח אותה.
 * 4. **הטוקן נשמר גם מוצפן (AES-256-GCM), כדי שאפשר יהיה לשלוח אותו שוב.**
 *    זו הכרעה שהשתנתה מול M1, ובכוונה. קודם נשמר רק הגיבוב, ולכן כל שליחה
 *    הייתה חייבת להנפיק טוקן חדש ולהרוג את הקודם — כלומר קבלן שגולל אחורה
 *    בוואטסאפ ולוחץ על הודעה מלפני שבוע היה מקבל "הקישור אינו בתוקף"
 *    ומרים טלפון. זה בדיוק החיכוך שהמערכת נועדה להסיר.
 *
 *    ההצפנה אינה מחלישה את מסלול האימות: הוא ממשיך לעבוד מול הגיבוב, ומי
 *    שמשיג העתק של בסיס הנתונים בלבד עדיין אינו יכול להיכנס לשום פורטל —
 *    המפתח נגזר מ-SESSION_SECRET, שחי במשתני הסביבה ולא בבסיס הנתונים.
 */

/** 128 ביט של אקראיות — מרחב שאי אפשר לסרוק */
const TOKEN_BYTES = 16;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * השוואה בזמן קבוע.
 *
 * החיפוש ב-DB נעשה לפי הגיבוב, ולכן זו הגנה משלימה בלבד — אבל השוואת
 * מחרוזות רגילה נעצרת בתו הראשון שנבדל, וזמן התגובה מדליף מידע על הגיבוב
 * הנכון. העלות כאן אפסית.
 */
export function tokensMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "hex");
  const bufferB = Buffer.from(b, "hex");
  if (bufferA.length !== bufferB.length || bufferA.length === 0) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** בונה את הכתובת שנשלחת לקבלן */
export function portalUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/p/${token}`;
}

// ─────────────────── שמירה הפיכה של הטוקן (ראה הערה 4) ───────────────────

const CIPHER_ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
/** אורך ה-IV התקני ל-GCM. סטייה ממנו פוגעת בביטחון המצב. */
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

/**
 * מפריד תחומים: המפתח להצפנת הטוקנים נגזר מ-SESSION_SECRET אבל אינו זהה לו.
 *
 * ‏SESSION_SECRET משמש כבר להצפנת עוגיית ההתחברות. שימוש חוזר באותו מפתח
 * בדיוק לשתי מטרות שונות הוא דפוס שגוי מוכר — הוא יוצר תלות שבה חולשה
 * במנגנון אחד נשפכת לשני. HKDF עם `info` קבוע מייצר מפתח נפרד מאותו סוד,
 * בלי להוסיף עוד משתנה סביבה שמישהו ישכח להגדיר.
 */
const KEY_INFO = "yy-portal-access-token-v1";

function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "", KEY_INFO, KEY_BYTES));
}

/**
 * מצפין טוקן לשמירה. הפורמט: `iv.ciphertext.tag`, הכול base64url.
 *
 * ‏GCM ולא CBC: הוא כולל אימות שלמות מובנה, ולכן שינוי של תו אחד בבסיס
 * הנתונים מתגלה בפענוח במקום להחזיר זבל שנראה כמו טוקן.
 */
export function encryptToken(token: string, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER_ALGORITHM, deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);

  return [iv, encrypted, cipher.getAuthTag()]
    .map((part) => part.toString("base64url"))
    .join(".");
}

/**
 * מפענח טוקן שנשמר, או null אם אי אפשר.
 *
 * מחזיר null ואינו זורק, כי כל מצבי הכשל כאן הם מצבים לגיטימיים שהממשק
 * צריך להתמודד איתם: SESSION_SECRET הוחלף, הרשומה נוצרה לפני שהשדה קיים,
 * או שמישהו נגע בנתונים. בכל אלה התשובה הנכונה למנהל היא "אי אפשר לשחזר
 * את הקישור, צור חדש" — ולא מסך שגיאה.
 */
export function decryptToken(stored: string, secret: string): string | null {
  const parts = stored.split(".");
  if (parts.length !== 3) return null;

  try {
    const [iv, encrypted, tag] = parts.map((part) => Buffer.from(part, "base64url"));
    if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES) return null;

    const decipher = createDecipheriv(CIPHER_ALGORITHM, deriveKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
