import { hash, verify } from "@node-rs/argon2";
import { redirect } from "next/navigation";
import { db } from "./db";
import { normalizeEmail, normalizePhone } from "./normalize";
import { clearRateLimit, consumeRateLimit, peekRateLimit } from "./rate-limit";
import { type SessionUser, destroySession, getSessionUser } from "./session";

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
 * מפתח ההגבלה, מנורמל כך שצורות שונות של אותו מזהה נספרות יחד: "0501234567"
 * ו-"050-123-4567" הן אותו חשבון, ואסור שכל צורה תקבל מכסת ניסיונות משלה.
 */
export function loginRateKey(identifier: string): string {
  const trimmed = identifier.trim().toLowerCase();
  if (trimmed.includes("@")) return `login:${normalizeEmail(identifier)}`;
  return `login:${normalizePhone(identifier) || trimmed}`;
}

export type ThrottledAuth =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "rate_limited"; retryAfterSeconds: number };

/**
 * מאמת התחברות עם הגבלת קצב. בודק חסימה *לפני* אימות הסיסמה (כדי לא לבזבז
 * גיבוב argon2 על מזהה חסום), סופר את הכשל אחריו, ומאפס בהצלחה.
 */
export async function authenticateThrottled(
  identifier: string,
  password: string,
  now: Date = new Date(),
): Promise<ThrottledAuth> {
  const key = loginRateKey(identifier);

  const gate = await peekRateLimit(key, LOGIN_MAX_FAILURES, now);
  if (!gate.allowed) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: gate.retryAfterSeconds };
  }

  const user = await authenticate(identifier, password);
  if (!user) {
    await consumeRateLimit(key, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, now);
    return { ok: false, reason: "invalid" };
  }

  await clearRateLimit(key);
  return { ok: true, user };
}

/**
 * גיבוב קבוע של מחרוזת חסרת משמעות, לשימוש במסלול "המשתמש לא נמצא".
 * נוצר פעם אחת מראש ולא בזמן ריצה, כדי לא לשלם על יצירתו בכל ניסיון כושל.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZTEy$Iq0PC7L5v8XZ3Ff8m3z8YQZ0xU6bYVQm3Yy0mSJm7hI";

/**
 * שער הכניסה לכל מסך פנימי: מחזיר את המשתמש המחובר או מפנה למסך ההתחברות.
 *
 * הבדיקה מרעננת מול ה-DB ולא מסתפקת בעוגייה. העוגייה תקפה 30 יום, ובלי
 * הריענון הזה משתמש שהושבת או שתפקידו שונה היה ממשיך לפעול עם ההרשאות
 * הישנות עד שהעוגייה תפוג. זו גם הסיבה ש-`proxy.ts` מבצע רק בדיקה
 * אופטימית — ההכרעה האמיתית נמצאת כאן, קרוב לנתונים.
 */
export async function requireUser(): Promise<SessionUser> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  const user = await db.user.findUnique({ where: { id: sessionUser.id } });
  if (!user || !user.active) {
    await destroySession();
    redirect("/login");
  }

  return { id: user.id, name: user.name, role: user.role, siteId: user.siteId };
}
