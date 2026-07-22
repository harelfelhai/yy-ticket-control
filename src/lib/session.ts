import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import type { Role } from "@/generated/prisma/enums";
import { env } from "./env";
import type { Viewer } from "./permissions";
import { SESSION_COOKIE_NAME } from "./session-cookie";

/**
 * ניהול ההתחברות של משתמשים פנימיים.
 *
 * ‏iron-session ולא ספריית auth מלאה: יש כאן כשישה משתמשים פנימיים, ללא
 * הרשמה עצמית, ללא ספקי זהות חיצוניים וללא איפוס סיסמה בדוא״ל. ספרייה
 * גדולה הייתה מוסיפה טבלאות, מסכים ותלות שאיש לא ישתמש בהם.
 *
 * העוגייה מוצפנת וחתומה, ומכילה את פרטי המשתמש כדי שבדיקת הרשאה בסיסית לא
 * תדרוש פנייה ל-DB בכל בקשה. המחיר: שינוי תפקיד או שיוך אתר נכנס לתוקף רק
 * בהתחברות הבאה — ולכן `requireUser` מרענן מול ה-DB בכל מסך מוגן.
 */

export interface SessionUser {
  id: string;
  name: string;
  role: Role;
  siteId: string | null;
}

interface AppSession {
  user?: SessionUser;
}

/** 30 יום, מתחדשים בכל בקשה — מנהל עבודה בשטח לא אמור להתחבר מחדש בכל בוקר */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function sessionOptions(): SessionOptions {
  return {
    password: env.sessionSecret(),
    cookieName: SESSION_COOKIE_NAME,
    ttl: SESSION_TTL_SECONDS,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      // ‏HTTPS בפרודקשן בלבד; בפיתוח מקומי אין תעודה ועוגייה מסומנת secure
      // פשוט לא הייתה נשמרת.
      secure: env.isProduction(),
      path: "/",
    },
  };
}

export async function getSession() {
  // ‏Next 16: cookies() אסינכרוני. גישה סינכרונית הוסרה לחלוטין.
  return getIronSession<AppSession>(await cookies(), sessionOptions());
}

/** מחזיר את המשתמש המחובר, או null. אינו זורק — לשימוש בקוד שמתנהג אחרת לאורחים. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getSession();
  return session.user ?? null;
}

export async function createSession(user: SessionUser): Promise<void> {
  const session = await getSession();
  session.user = user;
  await session.save();
}

export async function destroySession(): Promise<void> {
  const session = await getSession();
  session.destroy();
}

/** ממיר משתמש מחובר לצורה שבה `permissions.ts` בודק הרשאות */
export function toViewer(user: SessionUser): Viewer {
  return { kind: "user", id: user.id, role: user.role, siteId: user.siteId };
}
