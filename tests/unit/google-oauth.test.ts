import { describe, expect, it } from "vitest";
import {
  GOOGLE_CALLBACK_PATH,
  GOOGLE_LOGIN_ERROR_CODES,
  GOOGLE_SCOPES,
  googleRedirectUri,
  parseGoogleLoginError,
  readGoogleIdentity,
} from "@/lib/google-oauth";
import { he } from "@/lib/he";

/**
 * החלקים הטהורים של זרימת ה-OAuth.
 *
 * מה שנבדק כאן הוא בדיוק מה ש-`openid-client` **אינו** עושה בשבילנו: אימות
 * ה-claims העסקיים, גזירת כתובת ה-callback, ותרגום קוד כשל לנוסח. אימות
 * החתימה, `iss`, `aud`, `exp`, `state` ו-`nonce` הם באחריות הספרייה, ובדיקה
 * שלהם כאן הייתה בודקת אותה ולא אותנו.
 */

/** התבנית של claims שגוגל מחזירה — רק השדות שאנחנו צורכים */
function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://accounts.google.com",
    aud: "client-id.apps.googleusercontent.com",
    sub: "104928374651029384756",
    exp: 4_000_000_000,
    email: "manager@example.com",
    email_verified: true,
    ...overrides,
  };
}

describe("readGoogleIdentity", () => {
  it("מייל מאומת עובר, ומוחזר כמות שהוא", () => {
    // בלי נרמול: הנרמול הוא תפקיד שכבת השירות, שהיא גם זו שמשווה מול ה-DB.
    // פיצול בין השתיים הוא איך שנרמול נעשה פעמיים או אף פעם.
    expect(readGoogleIdentity(claims({ email: "Manager@Example.COM" }))).toEqual({
      ok: true,
      email: "Manager@Example.COM",
    });
  });

  it("מייל שאינו מאומת נדחה", () => {
    expect(readGoogleIdentity(claims({ email_verified: false }))).toEqual({
      ok: false,
      code: "no_account",
    });
  });

  it("‏`email_verified` כמחרוזת נדחה — ההשוואה קפדנית וההכרעה להיכשל-סגור", () => {
    // זו הבדיקה שמקבעת את ההחלטה. השוואה רכה (`==` או `Boolean(...)`) הייתה
    // מאשרת התחברות על סמך ערך שאינו בוליאן.
    expect(readGoogleIdentity(claims({ email_verified: "true" })).ok).toBe(false);
    expect(readGoogleIdentity(claims({ email_verified: 1 })).ok).toBe(false);
  });

  it("‏`email_verified` חסר נדחה", () => {
    const withoutVerified = claims();
    delete withoutVerified["email_verified"];

    expect(readGoogleIdentity(withoutVerified).ok).toBe(false);
  });

  it("מייל חסר, ריק או שאינו מחרוזת נדחה", () => {
    const withoutEmail = claims();
    delete withoutEmail["email"];

    expect(readGoogleIdentity(withoutEmail).ok).toBe(false);
    expect(readGoogleIdentity(claims({ email: "" })).ok).toBe(false);
    expect(readGoogleIdentity(claims({ email: "   " })).ok).toBe(false);
    expect(readGoogleIdentity(claims({ email: 42 })).ok).toBe(false);
    expect(readGoogleIdentity(claims({ email: null })).ok).toBe(false);
  });

  it("‏claims ריקים נדחים", () => {
    expect(readGoogleIdentity({}).ok).toBe(false);
  });
});

describe("googleRedirectUri", () => {
  it("מרכיב את הנתיב על הבסיס", () => {
    expect(googleRedirectUri("http://localhost:3100")).toBe(
      "http://localhost:3100/api/auth/google/callback",
    );
  });

  it("לוכסן סוגר בבסיס אינו מייצר לוכסן כפול", () => {
    // אי-התאמה של תו אחד מול הכתובת הרשומה ב-Google Console מוחזרת כשגיאה
    // של גוגל, לפני שהבקשה מגיעה אלינו — כלומר בלי שום לוג שיסביר אותה.
    expect(googleRedirectUri("https://example.com/")).toBe(
      "https://example.com/api/auth/google/callback",
    );
    expect(googleRedirectUri("https://example.com///")).toBe(
      "https://example.com/api/auth/google/callback",
    );
  });

  it("רווח בקצה אינו נכנס לכתובת", () => {
    // ‏`APP_BASE_URL` נכתב ביד ב-Railway, ורווח בסוף ההדבקה הוא תרחיש אמיתי.
    expect(googleRedirectUri("  https://example.com  ")).toBe(
      "https://example.com/api/auth/google/callback",
    );
  });
});

describe("parseGoogleLoginError", () => {
  it("כל קוד חוקי חוזר כמות שהוא", () => {
    for (const code of GOOGLE_LOGIN_ERROR_CODES) {
      expect(parseGoogleLoginError(code)).toBe(code);
    }
  });

  it("קלט שאינו קוד מוכר מוחזר כ-null", () => {
    // הפרמטר מגיע מהכתובת, כלומר מכל מי ששולח קישור.
    expect(parseGoogleLoginError(undefined)).toBeNull();
    expect(parseGoogleLoginError(null)).toBeNull();
    expect(parseGoogleLoginError("")).toBeNull();
    expect(parseGoogleLoginError("lol")).toBeNull();
    expect(parseGoogleLoginError("NO_ACCOUNT")).toBeNull();
    expect(parseGoogleLoginError("<script>")).toBeNull();
  });

  it("מערך מוחזר כ-null — ‏searchParams מחזיר מערך כשהפרמטר חוזר פעמיים", () => {
    expect(parseGoogleLoginError(["denied", "expired"])).toBeNull();
    expect(parseGoogleLoginError(["denied"])).toBeNull();
  });
});

describe("שלמות המיפוי לנוסחים", () => {
  /**
   * זו הבדיקה שנכשלת כשמישהו מוסיף קוד חמישי ושוכח את העברית.
   *
   * ה-`satisfies Record<GoogleLoginErrorCode, string>` ב-`he.ts` תופס את
   * הכיוון האחד (קוד בלי נוסח), והבדיקה כאן את הכיוון ההפוך — נוסח שנשאר
   * אחרי שהקוד שלו נמחק, מה שהמהדר אינו רואה.
   */
  it("לכל קוד יש נוסח, ואין נוסח בלי קוד", () => {
    expect(Object.keys(he.login.googleErrors).sort()).toEqual(
      [...GOOGLE_LOGIN_ERROR_CODES].sort(),
    );
  });

  it("כל נוסח הוא עברית ולא מזהה באנגלית", () => {
    for (const message of Object.values(he.login.googleErrors)) {
      expect(message).toMatch(/[֐-׿]/);
    }
  });
});

describe("גבול ההיקף", () => {
  /**
   * ההיקף הוא מה שמחזיק את הפיצ׳ר בתוך §6 של האפיון: שלושת ה-scopes
   * לא-רגישים אינם דורשים אימות אפליקציה מול גוגל — הנימוק שנרשם שם
   * לדחיית יומן גוגל. `scope-boundaries.test.ts` אוכף את אותו גבול על
   * קוד המקור; כאן זה נאכף על הערך עצמו.
   */
  it("ההיקף הוא שלושת ה-scopes הלא-רגישים בלבד", () => {
    expect(GOOGLE_SCOPES).toBe("openid email profile");
  });

  it("אין scope של יומן ואין בקשת גישה מתמשכת", () => {
    expect(GOOGLE_SCOPES).not.toMatch(/calendar|offline|drive|contacts/i);
  });

  it("נתיב ה-callback הוא מקור אמת אחד", () => {
    expect(GOOGLE_CALLBACK_PATH).toBe("/api/auth/google/callback");
  });
});
