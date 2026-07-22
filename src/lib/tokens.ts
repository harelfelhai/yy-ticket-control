import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * "קישורי קסם" — הטוקן שבאמצעותו קבלן משנה נכנס למערכת בלי סיסמה.
 *
 * שלוש הכרעות אבטחה, וכל אחת נובעת מהמציאות של המשתמשים:
 *
 * 1. **טוקן לאיש מקצוע, לא לפנייה.** קבלן מקבל עשרות פניות; קישור נפרד
 *    לכל אחת היה מציף אותו בקישורים ומייצר עשרות סודות לנהל. קישור אחד
 *    פותח לו לוח אישי עם כל הפניות שלו.
 * 2. **נשמר מגובב (SHA-256) ולעולם לא כטקסט.** דליפה של בסיס הנתונים לא
 *    נותנת גישה לאף פורטל. SHA-256 ולא argon2 בכוונה: זהו סוד אקראי
 *    ב-128 ביט ולא סיסמה שאדם בחר, ואין מה להגן עליו מפני ניחוש מילוני —
 *    הגיבוב האיטי היה רק מוסיף השהיה לכל בקשה.
 * 3. **ההרשאה נבדקת דינמית בכל בקשה** מול השיוכים הפעילים, ולא נגזרת
 *    מהטוקן. זו הסיבה שאפשר להשאיר את הקישור ללא תפוגה: ברגע שמנהל מסיר
 *    קבלן מפנייה, אותו קישור מפסיק לפתוח אותה.
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
