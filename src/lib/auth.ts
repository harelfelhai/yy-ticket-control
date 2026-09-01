import { hash, verify } from "@node-rs/argon2";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "./db";
import { normalizeEmail, normalizePhone } from "./normalize";
import { clearRateLimit, consumeRateLimit, peekRateLimit } from "./rate-limit";
import { type SessionUser, getSessionUser } from "./session";

/**
 * גיבוב סיסמאות ואימות פרטי התחברות.
 *
 * ‏argon2id ולא bcrypt: הוא העמיד ביותר כיום גם מול תקיפת GPU וגם מול
 * תקיפה מבוססת זיכרון, והוא ההמלצה הנוכחית של OWASP. המימוש הוא
 * ‏`@node-rs/argon2` (Rust עם בינאריים מוכנים) ולא `argon2` (קומפילציה
 * דרך node-gyp), כי המכונה שעליה מפתחים היא Windows ובנייה מקומית שם היא
 * מקור כשלים מיותר.
 */

/**
 * פרמטרים לפי המלצת OWASP ל-argon2id (19 MiB, 2 מעברים, מקביליות 1).
 * העלות מכוונת לכ-50 מילישניות לגיבוב — כבד מספיק כדי להפוך ניחוש המוני
 * ללא כדאי, וקל מספיק כדי שההתחברות לא תרגיש תקועה.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password, ARGON2_OPTIONS);
  } catch {
    // גיבוב פגום או בפורמט לא מוכר — נכשל כמו סיסמה שגויה, בלי להפיל בקשה.
    return false;
  }
}

/**
 * מזהה התחברות: טלפון או כתובת מייל, לפי מה שנוח למשתמש.
 *
 * מחזיר את שתי הצורות ולא מנחש איזו מהן נכונה. הסיבה: מנהל עבודה שהוקלד
 * במערכת כ-"050-123-4567" ומקליד בהתחברות "0501234567" חייב להתחבר, וכך
 * גם ההפך. ניחוש לפי צורת הקלט היה נכשל בדיוק במקרים האלה.
 */
export function identifierCandidates(identifier: string): {
  phone: string;
  email: string;
} {
  return { phone: normalizePhone(identifier), email: normalizeEmail(identifier) };
}

/**
 * מאמת פרטי התחברות ומחזיר את המשתמש, או null.
 *
 * שתי הכרעות אבטחה:
 * - התשובה זהה בכל מקרה כישלון (משתמש לא קיים / מושבת / סיסמה שגויה), כדי
 *   שלא ניתן יהיה למפות מי רשום במערכת לפי הודעות השגיאה.
 * - כשהמשתמש אינו קיים עדיין מבוצע גיבוב דמה, כדי שזמן התגובה לא יסגיר
 *   את קיומו של החשבון.
 */
export async function authenticate(
  identifier: string,
  password: string,
): Promise<SessionUser | null> {
  const { phone, email } = identifierCandidates(identifier);

  const user = await db.user.findFirst({
    where: {
      OR: [
        ...(phone ? [{ phone }] : []),
        ...(email ? [{ email }] : []),
      ],
    },
  });

  if (!user || !user.active) {
    await verifyPassword(DUMMY_HASH, password);
    return null;
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    return null;
  }

  return { id: user.id, name: user.name, role: user.role, siteId: user.siteId };
}

/**
 * הגבלת קצב על התחברות — הגנה מפני ניחוש סיסמאות (brute force).
 *
 * ההגבלה נספרת **לפי מזהה ההתחברות ולא לפי IP**: היא חסינה לזיוף כותרות
 * proxy ובלתי-תלויה בתצורת הפריסה (ראה `rate-limit.ts`), ואינה נכשלת כשכל
 * המשתמשים יושבים מאחורי אותה כתובת משרד. נספרים **כשלונות בלבד**, והתחברות
 * מוצלחת מאפסת את המונה.
 *
 * הכרעה מודעת: מזהה חסום נחסם גם מול הסיסמה הנכונה עד תום החלון. זה פותח
 * וקטור נודניק — תוקף שמכיר מזהה יכול לנעול משתמש ל-15 דקות בכשלים מכוונים.
 * לכלי פנימי של 6 משתמשים זו עלות מקובלת: החסימה רכה, זמנית, ומתאפסת לבד,
 * והחלופה (הגבלה לפי IP) חלשה יותר — היא ניתנת לעקיפה בסיבוב כתובות.
 */
export const LOGIN_MAX_FAILURES = 8;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * מפתחות ההגבלה למזהה נתון — **אחד לכל מועמד שהחיפוש ב-DB עשוי להיתפס בו**.
 *
 * **למה רשימה ולא מפתח יחיד, ולמה זו הייתה פרצה.** הגרסה הקודמת בנתה מפתח
 * אחד לפי הסתעפות משלה (`identifier.includes("@")` → מייל, אחרת טלפון),
 * בעוד `authenticate` מחפש ב-DB לפי **שני** המועמדים של
 * ‏`identifierCandidates`. שתי הדרכים לנרמל את אותו קלט נפרדו זו מזו, וזה
 * הספיק כדי לרוקן את ההגבלה מתוכן: `normalizePhone` מסיר כל תו שאינו ספרה,
 * ולכן "0501234567@a", "0501234567@b" ואינסוף וריאציות אחרות נפתרות כולן
 * לאותו טלפון ומוצאות את אותו משתמש — אבל כל אחת מהן קיבלה מפתח הגבלה
 * **נפרד**, כלומר מכסה חדשה של שמונה ניסיונות. מספר הניסיונות לא היה חסום
 * כלל, וזו הגנת ה-brute-force היחידה במערכת.
 *
 * התיקון הוא מקור אמת אחד: המפתחות נגזרים מ-`identifierCandidates` עצמה,
 * אותה פונקציה שהחיפוש ב-DB נגזר ממנה. כך כל צורה שמגיעה לאותו משתמש נספרת
 * בהכרח באותו דלי — אם היא נתפסת בטלפון, היא מגדילה את מונה הטלפון.
 *
 * ההפרדה ל-`phone:`/`email:` מונעת התנגשות בין מספר טלפון לכתובת מייל
 * שבמקרה נראים זהים אחרי נרמול.
 */
export function loginRateKeys(identifier: string): string[] {
  const { phone, email } = identifierCandidates(identifier);

  const keys: string[] = [];
  if (phone) keys.push(`login:phone:${phone}`);
  if (email) keys.push(`login:email:${email}`);

  // קלט שאינו מניב אף מועמד (רווחים בלבד) עדיין נספר, כדי שלא ייווצר מסלול
  // שבו אפשר להקיש ללא הגבלה. הוא ממילא לא יתאים לאף משתמש.
  if (keys.length === 0) keys.push(`login:raw:${identifier.trim().toLowerCase()}`);

  return keys;
}

export type ThrottledAuth =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "rate_limited"; retryAfterSeconds: number };

/**
 * מאמת התחברות עם הגבלת קצב. בודק חסימה *לפני* אימות הסיסמה (כדי לא לבזבז
 * גיבוב argon2 על מזהה חסום), סופר את הכשל אחריו, ומאפס בהצלחה.
 *
 * כל המפתחות של המזהה (ראה `loginRateKeys`) מטופלים יחד: **חסימה על אחד
 * מהם מספיקה** כדי לחסום, וכשל נספר על כולם. זה מה שמונע מצורה חלופית של
 * אותו מזהה לפתוח לעצמה מכסה נפרדת.
 */
export async function authenticateThrottled(
  identifier: string,
  password: string,
  now: Date = new Date(),
): Promise<ThrottledAuth> {
  const keys = loginRateKeys(identifier);

  const gates = await Promise.all(
    keys.map((key) => peekRateLimit(key, LOGIN_MAX_FAILURES, now)),
  );
  const blocked = gates.find((gate) => !gate.allowed);
  if (blocked) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: blocked.retryAfterSeconds };
  }

  const user = await authenticate(identifier, password);
  if (!user) {
    await Promise.all(
      keys.map((key) => consumeRateLimit(key, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, now)),
    );
    return { ok: false, reason: "invalid" };
  }

  await Promise.all(keys.map((key) => clearRateLimit(key)));
  return { ok: true, user };
}

/**
 * גיבוב קבוע של מחרוזת חסרת משמעות, לשימוש במסלול "המשתמש לא נמצא".
 * נוצר פעם אחת מראש ולא בזמן ריצה, כדי לא לשלם על יצירתו בכל ניסיון כושל.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZTEy$Iq0PC7L5v8XZ3Ff8m3z8YQZ0xU6bYVQm3Yy0mSJm7hI";

/**
 * הנתיב שמסיים סשן שאינו תקף עוד. ‏Route Handler, ולא כאן.
 *
 * מחיקת סשן היא כתיבת עוגייה, ו-Next מתיר אותה רק ב-Server Action או
 * ב-Route Handler. ‏`requireUser()` רץ ברובו בתוך רינדור של Server Component
 * (ה-layout הפנימי וכל מסך מוגן), ושם `destroySession()` זורק
 * ‏"Cookies can only be modified in a Server Action or Route Handler".
 * החריגה הזו קדמה ל-`redirect()` שאמור היה לבוא אחריה, ולכן ההפניה למסך
 * ההתחברות לא בוצעה מעולם והמשתמש קיבל 500 בכל מסך — כולל התרחיש השגרתי
 * שבו מנהל משבית עובד במסך הניהול.
 */
export const SESSION_ENDED_PATH = "/api/auth/session-ended";

/**
 * טוען מחדש מה-DB את המשתמש שבעוגייה, או null אם אין סשן, המשתמש נמחק, או הושבת.
 *
 * מקור האמת היחיד לשאלה "האם הסשן הזה עדיין תקף": גם שער המסכים
 * (`requireUser`) וגם ה-Route Handler שמסיים את הסשן נשענים עליו, כך שאין
 * שתי הגדרות שיכולות להיפרד בשקט ולהכריע הפוך זו מזו.
 *
 * עטוף ב-`cache()` של React: גם ה-layout הפנימי וגם המסך שבתוכו קוראים
 * ‏`requireUser()`, ובלי זה כל ניווט שילם פעמיים פענוח עוגייה ופעמיים
 * ‏`findUnique`. ההיקף של `cache()` הוא בקשת שרת אחת, ולכן הריענון מול
 * ה-DB בכל מסך — מה שחוסם משתמש שהושבת — נשמר במלואו.
 */
export const activeSessionUser = cache(async (): Promise<SessionUser | null> => {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return null;

  const user = await db.user.findUnique({ where: { id: sessionUser.id } });
  if (!user || !user.active) return null;

  return { id: user.id, name: user.name, role: user.role, siteId: user.siteId };
});

/**
 * שער הכניסה לכל מסך פנימי: מחזיר את המשתמש המחובר או מפנה החוצה.
 *
 * הבדיקה מרעננת מול ה-DB ולא מסתפקת בעוגייה. העוגייה תקפה 30 יום, ובלי
 * הריענון הזה משתמש שהושבת או שתפקידו שונה היה ממשיך לפעול עם ההרשאות
 * הישנות עד שהעוגייה תפוג. זו גם הסיבה ש-`proxy.ts` מבצע רק בדיקה
 * אופטימית — ההכרעה האמיתית נמצאת כאן, קרוב לנתונים.
 *
 * ההפניה היא ל-`SESSION_ENDED_PATH` ולא ישירות ל-`/login`, מפני שהעוגייה
 * חייבת להימחק: מסך ההתחברות מעביר ללוח כל מי שמחזיק עוגייה (`getSessionUser`
 * קורא אותה בלי לפנות ל-DB), וסשן פגום שנשאר על מקומו היה יוצר לולאת הפניות
 * בין הלוח למסך ההתחברות.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await activeSessionUser();
  if (!user) redirect(SESSION_ENDED_PATH);

  return user;
}
