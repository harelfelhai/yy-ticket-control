import { hash, verify } from "@node-rs/argon2";
import { redirect } from "next/navigation";
import { db } from "./db";
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

/** מזהה התחברות: טלפון או כתובת מייל. המשתמש בוחר לפי מה שנוח לו. */
export function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
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
  const value = normalizeIdentifier(identifier);

  const user = await db.user.findFirst({
    where: { OR: [{ phone: value }, { email: value }] },
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
