import { sealData } from "iron-session";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as endSession } from "@/app/api/auth/session-ended/route";
import { SESSION_ENDED_PATH, activeSessionUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";
import { resetDb } from "../helpers/reset-db";

/**
 * שער הכניסה למסכים הפנימיים — `requireUser` — ובמיוחד מה שקורה **כשהסשן
 * כבר אינו תקף**: עובד שהושבת במסך הניהול, או סשן חתום שהמשתמש שלו נמחק.
 *
 * הבדיקות האלה קיימות בגלל תקלה אמיתית: `requireUser` קרא ל-`destroySession()`
 * בתוך רינדור של Server Component. מחיקת סשן היא כתיבת עוגייה, ו-Next מתיר
 * אותה רק ב-Server Action או ב-Route Handler — ולכן נזרקה
 * ‏"Cookies can only be modified in a Server Action or Route Handler".
 * החריגה קדמה ל-`redirect()` שאחריה, כך שבמקום הפניה למסך ההתחברות קיבל
 * העובד המושבת **500 בכל מסך במערכת**.
 *
 * לכן המוק כאן מבחין בין שלב הרינדור לשלב הפעולה, במקום להרשות כתיבה תמיד:
 * מוק סלחני היה עובר בשמחה בדיוק על הבאג שהבדיקות נועדו למנוע.
 */

/** נדרש לחתימת העוגייה. שומר על מה שכבר מוגדר, כדי לא לדרוס סביבה אמיתית. */
process.env.SESSION_SECRET ||= "test-session-secret-32-chars-min!!";

const RENDER_PHASE_ERROR =
  "Cookies can only be modified in a Server Action or Route Handler. Read more: https://nextjs.org/docs/app/api-reference/functions/cookies#options";

/** 30 יום — אותו TTL שבו `session.ts` חותם */
const TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * מצב חנות העוגיות של הבקשה המדומה.
 *
 * `phase` הוא לב העניין: `"render"` מייצג Server Component, שבו Next זורק על
 * כל כתיבה; `"action"` מייצג Server Action או Route Handler, שבהם הכתיבה
 * חוקית ונאספת ל-`written`.
 */
const cookieStore = vi.hoisted(() => ({
  value: "",
  phase: "render" as "render" | "action",
  written: [] as { name: string; value: string; maxAge?: number }[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.value ? { name, value: cookieStore.value } : undefined),
    set: (name: string, value: string, options?: { maxAge?: number }) => {
      if (cookieStore.phase === "render") throw new Error(RENDER_PHASE_ERROR);
      cookieStore.written.push({ name, value, maxAge: options?.maxAge });
    },
  }),
}));

/**
 * גיבוב קבוע במקום `hashPassword`: אף בדיקה כאן אינה מאמתת סיסמה, ו-argon2
 * הוא יקר במכוון. השדה נדרש בסכימה ותו לא.
 */
const PLACEHOLDER_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$notusedhere";

async function createUser(overrides: { active?: boolean } = {}) {
  return db.user.create({
    data: {
      role: "ADMIN",
      name: "מנהל",
      phone: "0501112222",
      passwordHash: PLACEHOLDER_HASH,
      ...overrides,
    },
  });
}

/** שם בעוגייה סשן חתום אמיתי, כפי שהדפדפן היה שולח */
async function signIn(user: { id: string; name: string; role: string; siteId: string | null }) {
  cookieStore.value = await sealData(
    { user: { id: user.id, name: user.name, role: user.role, siteId: user.siteId } },
    { password: process.env.SESSION_SECRET as string, ttl: TTL_SECONDS },
  );
}

/** מריץ ומחזיר את החריגה שנזרקה, או null אם לא נזרקה כלל */
async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
}

/**
 * מחלץ את יעד ההפניה מחריגת הבקרה של Next, או null אם אינה הפניה.
 *
 * ה-digest הוא מחרוזת בצורה `NEXT_REDIRECT;replace;/login;307;`. מאתרים את
 * הרכיב שמתחיל ב-"/" ולא לפי אינדקס קבוע, כדי שהבדיקה לא תישבר על שינוי
 * פנימי בפורמט.
 */
function redirectTarget(error: unknown): string | null {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) return null;
  return digest.split(";").find((part) => part.startsWith("/")) ?? null;
}

beforeEach(async () => {
  await resetDb();
  cookieStore.value = "";
  cookieStore.phase = "render";
  cookieStore.written = [];
});

afterAll(async () => {
  await db.$disconnect();
});

describe("requireUser בזמן רינדור", () => {
  it("משתמש פעיל עובר את השער", async () => {
    const user = await createUser();
    await signIn(user);

    const result = await requireUser();
    expect(result.id).toBe(user.id);
    expect(result.role).toBe("ADMIN");
  });

  it("משתמש שהושבת מופנה החוצה, ואינו מפיל את הבקשה", async () => {
    // התרחיש שנשבר בפועל: מנהל לוחץ "השבת" במסך הניהול, והעובד המושבת
    // קיבל מכאן ואילך 500 בכל מסך במקום לחזור למסך ההתחברות.
    const user = await createUser({ active: false });
    await signIn(user);

    const error = await thrownBy(() => requireUser());

    expect((error as Error)?.message).not.toContain("Cookies can only be modified");
    expect(redirectTarget(error)).toBe(SESSION_ENDED_PATH);
  });

  it("סשן חתום שהמשתמש שלו נמחק מופנה החוצה", async () => {
    const user = await createUser();
    await signIn(user);
    await db.user.delete({ where: { id: user.id } });

    const error = await thrownBy(() => requireUser());

    expect((error as Error)?.message).not.toContain("Cookies can only be modified");
    expect(redirectTarget(error)).toBe(SESSION_ENDED_PATH);
  });

  it("אינו נוגע בעוגייה בעצמו — גם כשהכתיבה מותרת", async () => {
    /**
     * הטענה המדויקת שנשברה: השער **אינו** מוחק את הסשן, המחיקה היא תפקידו
     * של ה-Route Handler בלבד.
     *
     * הבדיקה רצה דווקא בשלב שבו כתיבה מותרת (`action`), ולא בשלב הרינדור.
     * בשלב הרינדור כתיבה אסורה **זורקת**, ולכן "לא נכתבה עוגייה" מתקיים גם
     * בקוד השבור — והבדיקה לא הייתה מבחינה בין השניים. כאן כתיבה כזו הייתה
     * נרשמת בשקט, ולכן הרשימה הריקה היא עדות אמיתית.
     */
    const user = await createUser({ active: false });
    await signIn(user);
    cookieStore.phase = "action";

    await thrownBy(() => requireUser());
    expect(cookieStore.written).toHaveLength(0);
  });

  it("יעד ההפניה הוא Route Handler, המקום היחיד שבו מחיקת העוגייה חוקית", async () => {
    // אם מישהו יחזיר את היעד ל-"/login" בלי למחוק את הסשן, מסך ההתחברות
    // יראה עוגייה קיימת ויעביר בחזרה ללוח — לולאה אינסופית.
    expect(SESSION_ENDED_PATH.startsWith("/api/")).toBe(true);
  });
});

describe("activeSessionUser", () => {
  it("מחזיר null כשאין סשן כלל", async () => {
    expect(await activeSessionUser()).toBeNull();
  });

  it("מחזיר null למשתמש מושבת, ואת המשתמש כשהוא פעיל", async () => {
    const user = await createUser({ active: false });
    await signIn(user);
    expect(await activeSessionUser()).toBeNull();

    await db.user.update({ where: { id: user.id }, data: { active: true } });
    expect((await activeSessionUser())?.id).toBe(user.id);
  });

  it("אינו מחזיר לעולם את גיבוב הסיסמה", async () => {
    const user = await createUser();
    await signIn(user);
    expect(Object.keys((await activeSessionUser()) ?? {})).toEqual([
      "id",
      "name",
      "role",
      "siteId",
    ]);
  });
});

describe("‏Route Handler שמסיים את הסשן", () => {
  it("מוחק את עוגיית הסשן ומפנה למסך ההתחברות", async () => {
    const user = await createUser({ active: false });
    await signIn(user);
    // ב-Route Handler הכתיבה חוקית — זו כל הסיבה שהמסלול עובר דרכו.
    cookieStore.phase = "action";

    const error = await thrownBy(() => endSession());

    expect(redirectTarget(error)).toBe("/login");
    const cleared = cookieStore.written.find((c) => c.name === SESSION_COOKIE_NAME);
    expect(cleared).toBeDefined();
    expect(cleared?.value).toBe("");
    expect(cleared?.maxAge).toBe(0);
  });

  it("אינו מנתק משתמש שסשנו תקף", async () => {
    // אחרת הנתיב היה "יציאה בקישור GET": כל מי שיגרום למשתמש לפתוח אותו
    // היה מנתק אותו.
    const user = await createUser();
    await signIn(user);
    cookieStore.phase = "action";

    const error = await thrownBy(() => endSession());

    expect(redirectTarget(error)).toBe("/board");
    expect(cookieStore.written).toHaveLength(0);
  });
});
