import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import type { GoogleClaimsVerifier } from "@/lib/google-oauth";
import type { OauthState } from "@/lib/oauth-state";
import {
  completeGoogleCallback,
  isGoogleLoginConfigured,
  resolveGoogleUser,
} from "@/lib/services/google-login";
import { resetDb } from "../helpers/reset-db";

/**
 * ההכרעה של מסלול ההתחברות בגוגל, מול בסיס נתונים אמיתי.
 *
 * ‏`completeGoogleCallback` נבדקת כאן במלואה **בלי לפנות לגוגל**: המאמת
 * מוזרק. זה בדיוק מה שפיצול המודולים קנה — כל עץ ההכרעה, כולל כל מסלול
 * דחייה, מכוסה בלי חשבון, בלי רשת ובלי דפדפן.
 */

const CALLBACK = new URL("http://localhost:3100/api/auth/google/callback");

const SAVED: OauthState = {
  state: "3f9a1c7e5b2d8046",
  nonce: "a1b2c3d4e5f60718",
  codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  next: "/board",
};

/** כתובת ה-callback כפי שגוגל מחזירה אותה — עם `code` ו-`state` */
function callbackUrl(params: Record<string, string>): URL {
  const url = new URL(CALLBACK);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

function verifierReturning(claims: Record<string, unknown> | null): GoogleClaimsVerifier {
  return vi.fn(async () => claims);
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { email: "manager@example.com", email_verified: true, ...overrides };
}

async function createUser(
  overrides: Partial<Parameters<typeof db.user.create>[0]["data"]> = {},
) {
  return db.user.create({
    data: {
      role: "ADMIN",
      name: "מנהל",
      phone: "0501112222",
      email: "manager@example.com",
      passwordHash: await hashPassword("s0d-heshbon-nakhon"),
      ...overrides,
    },
  });
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("resolveGoogleUser", () => {
  it("מאתר משתמש פעיל לפי המייל", async () => {
    const user = await createUser();

    const result = await resolveGoogleUser("manager@example.com");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.id).toBe(user.id);
  });

  it("מנרמל אותיות גדולות ורווחים", async () => {
    // אותו נרמול שמסלול הסיסמה עושה. גוגל מחזירה את הכתובת כפי שהיא רשומה
    // אצלה, והמנהל הקליד אותה במסך הניהול — שתי מקלדות, אותה תיבה.
    const user = await createUser();

    const result = await resolveGoogleUser("  Manager@Example.COM ");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.id).toBe(user.id);
  });

  it("מייל שאינו קיים נדחה", async () => {
    await createUser();

    expect(await resolveGoogleUser("someone-else@example.com")).toEqual({
      ok: false,
      code: "no_account",
    });
  });

  it("משתמש מושבת נדחה **באותה תשובה בדיוק** כמשתמש שאינו קיים", async () => {
    // זו ערובת אי-המיפוי, והיא נבדקת בהשוואה בין שני המצבים ולא בכל אחד
    // לחוד: הודעה שנפרדת ביניהם מאפשרת לגלות מי רשום במערכת.
    await createUser({ active: false });

    const inactive = await resolveGoogleUser("manager@example.com");
    const missing = await resolveGoogleUser("nobody@example.com");

    expect(inactive).toEqual({ ok: false, code: "no_account" });
    expect(inactive).toEqual(missing);
  });

  it("משתמש בלי מייל אינו נתפס על ידי מייל ריק", async () => {
    // הרגרסיה המסוכנת: `User.email` הוא `String?`, ותנאי שהופך ל-`null`
    // היה מזהה את הפונה כמשתמש ה-seed — שנוצר בלי מייל דווקא.
    await createUser({ email: null, phone: "0500000000" });

    expect((await resolveGoogleUser("")).ok).toBe(false);
    expect((await resolveGoogleUser("   ")).ok).toBe(false);
  });

  it("מחזיר בדיוק את ארבעת שדות ה-SessionUser — הגיבוב אינו יוצא", async () => {
    // אותה הצהרה שיש למסלול הסיסמה ב-`auth.test.ts`. היא מה שמונע
    // מ-`passwordHash` להגיע לעוגייה דרך שרשור לא-זהיר.
    await createUser();

    const result = await resolveGoogleUser("manager@example.com");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.user)).toEqual(["id", "name", "role", "siteId"]);
    }
  });

  it("מנהל עבודה מקבל את השיוך לאתר — ההרשאות תלויות בו", async () => {
    const site = await db.site.create({ data: { name: "אתר לדוגמה" } });
    await createUser({
      role: "SITE_MANAGER",
      siteId: site.id,
      email: "foreman@example.com",
      phone: "0503334444",
    });

    const result = await resolveGoogleUser("foreman@example.com");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.role).toBe("SITE_MANAGER");
      expect(result.user.siteId).toBe(site.id);
    }
  });
});

describe("completeGoogleCallback — מסלול מוצלח", () => {
  it("מחזיר סשן ואת היעד שנשמר בעוגייה", async () => {
    const user = await createUser();
    const verify = verifierReturning(claims());

    const outcome = await completeGoogleCallback({
      currentUrl: callbackUrl({ code: "auth-code", state: SAVED.state }),
      saved: { ...SAVED, next: "/tickets/new" },
      verify,
    });

    expect(outcome).toEqual({
      kind: "session",
      user: { id: user.id, name: "מנהל", role: "ADMIN", siteId: null },
      next: "/tickets/new",
    });
  });

  it("מעביר למאמת את שלושת הסודות מהעוגייה", async () => {
    await createUser();
    const verify = verifierReturning(claims());

    await completeGoogleCallback({
      currentUrl: callbackUrl({ code: "auth-code", state: SAVED.state }),
      saved: SAVED,
      verify,
    });

    // ה-`codeVerifier` הוא מה שהופך את קוד ההרשאה לחסר ערך למי שיירט אותו.
    // החלפה בטעות ב-`code_challenge` הייתה שוברת את PKCE בשקט.
    expect(verify).toHaveBeenCalledWith(expect.any(URL), {
      state: SAVED.state,
      nonce: SAVED.nonce,
      codeVerifier: SAVED.codeVerifier,
    });
  });
});

describe("completeGoogleCallback — דחייה בלי קריאת רשת", () => {
  it("‏access_denied הוא ביטול, ואינו מגיע למאמת", async () => {
    const verify = verifierReturning(claims());

    const outcome = await completeGoogleCallback({
      currentUrl: callbackUrl({ error: "access_denied", state: SAVED.state }),
      saved: SAVED,
      verify,
    });

    expect(outcome).toEqual({ kind: "error", code: "denied" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("שגיאה אחרת של גוגל היא תקלה ולא ביטול", async () => {
    const outcome = await completeGoogleCallback({
      currentUrl: callbackUrl({ error: "server_error", state: SAVED.state }),
      saved: SAVED,
      verify: verifierReturning(claims()),
    });

    expect(outcome).toEqual({ kind: "error", code: "unavailable" });
  });

  it("היעדר עוגייה נדחה, והמאמת אינו נקרא", async () => {
    // זהו המסלול של Login-CSRF: הדפדפן של הקורבן אינו מחזיק את העוגייה
    // שנוצרה אצל התוקף, ולכן אין `state` להשוות אליו.
    const verify = verifierReturning(claims());

    const outcome = await completeGoogleCallback({
      currentUrl: callbackUrl({ code: "auth-code", state: SAVED.state }),
      saved: null,
      verify,
    });

    expect(outcome).toEqual({ kind: "error", code: "expired" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("‏state שאינו תואם לעוגייה נדחה, והמאמת אינו נקרא", async () => {
    const verify = verifierReturning(claims());

    const outcome = await completeGoogleCallback({
      currentUrl: callbackUrl({ code: "auth-code", state: "not-the-one" }),
      saved: SAVED,
      verify,
    });

    expect(outcome).toEqual({ kind: "error", code: "expired" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("חוסר `code` או חוסר `state` בכתובת נדחה", async () => {
    const verify = verifierReturning(claims());

    expect(
      await completeGoogleCallback({
        currentUrl: callbackUrl({ state: SAVED.state }),
        saved: SAVED,
        verify,
      }),
    ).toEqual({ kind: "error", code: "expired" });

    expect(
      await completeGoogleCallback({
        currentUrl: callbackUrl({ code: "auth-code" }),
        saved: SAVED,
        verify,
      }),
    ).toEqual({ kind: "error", code: "expired" });

    expect(verify).not.toHaveBeenCalled();
  });
});

describe("completeGoogleCallback — דחייה אחרי אימות", () => {
  it("כשל אימות מול גוגל הוא תקלה", async () => {
    const outcome = await completeGoogleCallback({
      currentUrl: callbackUrl({ code: "auth-code", state: SAVED.state }),
      saved: SAVED,
      verify: verifierReturning(null),
    });

    expect(outcome).toEqual({ kind: "error", code: "unavailable" });
  });

  it("מייל שאינו מאומת אצל גוגל נדחה", async () => {
    await createUser();

    const outcome = await completeGoogleCallback({
      currentUrl: callbackUrl({ code: "auth-code", state: SAVED.state }),
      saved: SAVED,
      verify: verifierReturning(claims({ email_verified: false })),
    });

    expect(outcome).toEqual({ kind: "error", code: "no_account" });
  });

  it("מייל מאומת שאינו במערכת נדחה", async () => {
    await createUser();

    const outcome = await completeGoogleCallback({
      currentUrl: callbackUrl({ code: "auth-code", state: SAVED.state }),
      saved: SAVED,
      verify: verifierReturning(claims({ email: "stranger@example.com" })),
    });

    expect(outcome).toEqual({ kind: "error", code: "no_account" });
  });

  it("משתמש מושבת נדחה באותו קוד", async () => {
    await createUser({ active: false });

    const outcome = await completeGoogleCallback({
      currentUrl: callbackUrl({ code: "auth-code", state: SAVED.state }),
      saved: SAVED,
      verify: verifierReturning(claims()),
    });

    expect(outcome).toEqual({ kind: "error", code: "no_account" });
  });
});

describe("isGoogleLoginConfigured", () => {
  /**
   * הגטרים ב-`env.ts` עצלים במכוון, ולכן שינוי `process.env` בזמן ריצה
   * נקרא מיד ואין צורך לטעון מודול מחדש.
   */
  const original = {
    id: process.env["GOOGLE_CLIENT_ID"],
    secret: process.env["GOOGLE_CLIENT_SECRET"],
  };

  function set(id?: string, secret?: string) {
    if (id === undefined) delete process.env["GOOGLE_CLIENT_ID"];
    else process.env["GOOGLE_CLIENT_ID"] = id;

    if (secret === undefined) delete process.env["GOOGLE_CLIENT_SECRET"];
    else process.env["GOOGLE_CLIENT_SECRET"] = secret;
  }

  afterAll(() => {
    set(original.id, original.secret);
  });

  it("שני המשתנים — מוגדר", () => {
    set("client-id", "client-secret");
    expect(isGoogleLoginConfigured()).toBe(true);
  });

  it("מפתח אחד מתוך שניים מתנהג כמו אפס", () => {
    // כול-או-כלום: "כמעט מוגדר" הוא כפתור שמפנה לגוגל וחוזר בשגיאה.
    set("client-id", undefined);
    expect(isGoogleLoginConfigured()).toBe(false);

    set(undefined, "client-secret");
    expect(isGoogleLoginConfigured()).toBe(false);
  });

  it("מחרוזת ריקה נחשבת כלא-מוגדר", () => {
    // שורה ריקה ב-.env אינה מתחזה לערך — ראה `optional()` ב-env.ts.
    set("", "");
    expect(isGoogleLoginConfigured()).toBe(false);
  });

  it("אף אחד מהשניים — אינו מוגדר", () => {
    set(undefined, undefined);
    expect(isGoogleLoginConfigured()).toBe(false);
  });
});
