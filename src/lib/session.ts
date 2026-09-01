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

/**
 * האם השירות מוגש על HTTPS — ולכן האם לסמן את העוגייה כ-`Secure`.
 *
 * **למה לא `isProduction()`, שהיה כאן עד 1.9.2026.** `NODE_ENV` מתאר את
 * **הבנייה**, ואילו `Secure` הוא מאפיין של **התובלה**. השניים
 * מסתדרים בפרודקשן ובפיתוח, ונפרדים בדיוק במקרה השלישי: בניית
 * פרודקשן המוגשת מ-`http://localhost` — מה ש-`test:e2e:prod` ו-
 * `test:conformance:prod` עושים, ומה שה-CI מריץ.
 *
 * שם העוגייה הייתה מסומנת `Secure` על חיבור לא מוצפן. כרום מתעלם
 * מזה על localhost ולכן עבר; **WebKit אינו מתעלם** — הוא מסרב לשמור
 * את העוגייה, ההתחברות לא נדבקת, והבדיקה נופלת ב-timeout שמצביע על
 * מסך הלוח ולא על העוגייה. זה היה הכשל היחיד בריצה הראשונה של
 * חבילת ה-E2E ב-CI — 168 עברו, אחת נפלה.
 *
 * **ההגנה בפרודקשן זהה במלואו:** שם `APP_BASE_URL` הוא `https://`,
 * ולכן העוגייה מסומנת בדיוק כשהייתה קודם. משתנה זה חייב
 * להיות נכון בלאו הכי — הוא הבסיס לקישורי הקסם שנשלחים לקבלנים.
 */
export function servedOverHttps(baseUrl: string): boolean {
  return baseUrl.trim().toLowerCase().startsWith("https://");
}

function sessionOptions(): SessionOptions {
  return {
    password: env.sessionSecret(),
    cookieName: SESSION_COOKIE_NAME,
    ttl: SESSION_TTL_SECONDS,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      // מופק מ-APP_BASE_URL ולא מ-NODE_ENV. ראה `servedOverHttps`.
      secure: servedOverHttps(env.appBaseUrl()),
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
