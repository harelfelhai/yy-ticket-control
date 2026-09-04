import { hkdfSync } from "node:crypto";
import { sealData, unsealData } from "iron-session";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_STATE_TTL_SECONDS,
  type OauthState,
  oauthStatePassword,
} from "@/lib/oauth-state";

/**
 * עוגיית ה-state של זרימת ה-OAuth.
 *
 * הקובץ בודק את מה שאפשר לבדוק בלי `next/headers` ובלי היקף בקשה: את גזירת
 * המפתח, ואת החתימה עצמה דרך `sealData`/`unsealData` — אותן פונקציות
 * ש-`getIronSession` משתמש בהן מתחת. מה שנשאר לא-מכוסה כאן (הצבת העוגייה
 * בתשובה, מחיקתה) נבדק ב-E2E מול שרת אמיתי, כי זו התנהגות של Next ולא שלנו.
 */

const SECRET = "test-session-secret-at-least-32-chars-long";

/**
 * ה-`info` של **התחום האחר** — טוקני הפורטל ב-`src/lib/tokens.ts`.
 *
 * הכפילות כאן מכוונת ואינה הפרה של "מקור אמת אחד": הבדיקה אינה צורכת את
 * הערך אלא **מוכיחה שהוא שונה**. אילו ייבאנו אותו, החלפה של אחד השניים לערך
 * זהה הייתה עוברת בשקט — וזה בדיוק הכשל שהפרדת התחומים נועדה למנוע.
 */
const PORTAL_KEY_INFO = "yy-portal-access-token-v1";

const STATE: OauthState = {
  state: "3f9a1c7e5b2d8046",
  nonce: "a1b2c3d4e5f60718",
  codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  next: "/board",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("oauthStatePassword", () => {
  it("עומד ברצפת האורך של iron-session", () => {
    // 32 תווים הוא המינימום שהספרייה דורשת. 32 בייט ב-base64url נותנים 43,
    // ולכן יש מרווח — אבל מה שנבדק הוא הרצפה, לא הנוסחה.
    expect(oauthStatePassword(SECRET).length).toBeGreaterThanOrEqual(32);
  });

  it("דטרמיניסטי — אותו סוד נותן אותו מפתח", () => {
    expect(oauthStatePassword(SECRET)).toBe(oauthStatePassword(SECRET));
  });

  it("סוד אחר נותן מפתח אחר", () => {
    expect(oauthStatePassword(SECRET)).not.toBe(oauthStatePassword(`${SECRET}!`));
  });

  it("אינו זהה ל-SESSION_SECRET עצמו", () => {
    // אילו היה — עוגיית ה-state הייתה חתומה באותו מפתח של עוגיית ההתחברות,
    // וזה בדיוק הדפוס שהגזירה נועדה למנוע.
    expect(oauthStatePassword(SECRET)).not.toBe(SECRET);
  });

  it("שונה מהמפתח של טוקני הפורטל — הפרדת התחומים אמיתית", () => {
    const portalKey = Buffer.from(
      hkdfSync("sha256", SECRET, "", PORTAL_KEY_INFO, 32),
    ).toString("base64url");

    expect(oauthStatePassword(SECRET)).not.toBe(portalKey);
  });
});

describe("חתימת המצב", () => {
  const password = oauthStatePassword(SECRET);

  it("סבב שלם מחזיר את אותו מצב", async () => {
    const seal = await sealData(STATE, { password, ttl: OAUTH_STATE_TTL_SECONDS });
    const unsealed = await unsealData<{ [K in keyof OauthState]?: OauthState[K] }>(seal, {
      password,
      ttl: OAUTH_STATE_TTL_SECONDS,
    });

    expect(unsealed).toEqual(STATE);
  });

  it("מפתח שגוי אינו מחזיר מצב שמיש", async () => {
    const seal = await sealData(STATE, { password, ttl: OAUTH_STATE_TTL_SECONDS });
    const unsealed = await unsealData<Partial<OauthState>>(seal, {
      password: oauthStatePassword(`${SECRET}-other`),
      ttl: OAUTH_STATE_TTL_SECONDS,
    });

    // ‏iron-session מחזיר אובייקט ריק במקום לזרוק, ולכן הטענה היא על
    // **היעדר** התוכן ולא על חריגה.
    expect(unsealed.state).toBeUndefined();
    expect(unsealed).toEqual({});
  });

  it("שינוי תו אחד בחתימה פוסל אותה", async () => {
    const seal = await sealData(STATE, { password, ttl: OAUTH_STATE_TTL_SECONDS });
    // התו האחרון הוא חלק ה-hmac. החלפתו היא הצורה המינימלית של חבלה.
    const last = seal.at(-1) === "a" ? "b" : "a";
    const tampered = `${seal.slice(0, -1)}${last}`;

    expect(await unsealData<Partial<OauthState>>(tampered, { password })).toEqual({});
  });

  /**
   * **‏iron מרשה 60 שניות של סחיפת שעון (`timestampSkewSec`), ולכן החלון
   * בפועל הוא `OAUTH_STATE_TTL_SECONDS` + דקה.**
   *
   * זה נמדד כאן ולא נלמד מהתיעוד: הגרסה הראשונה של הבדיקה הקדימה את השעון
   * ב-60 שניות בדיוק והחתימה נשארה תקפה. ההשלכה מקובלת — 11 דקות במקום 10
   * אינן שינוי מהותי במשטח התקיפה, שכן ה-`state` ממילא חד-פעמי — אבל היא
   * צריכה להיות כתובה, כדי שאיש לא יסיק מהקבוע שהחלון נסגר בדיוק בו.
   */
  it("חתימה שפגה נפסלת — חלון עשר הדקות אמיתי ולא דקורטיבי", async () => {
    const seal = await sealData(STATE, { password, ttl: 1 });

    // ‏`toFake: ["Date"]` בלבד: הצפנה אסינכרונית עדיין צריכה טיימרים אמיתיים.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 1_000 + 61_000);

    expect(await unsealData<Partial<OauthState>>(seal, { password, ttl: 1 })).toEqual({});
  });
});

describe("קבועי העוגייה", () => {
  it("שם העוגייה נפרד מעוגיית ההתחברות", () => {
    expect(OAUTH_STATE_COOKIE_NAME).toBe("yy_oauth");
  });

  it("החלון הוא עשר דקות", () => {
    expect(OAUTH_STATE_TTL_SECONDS).toBe(600);
  });
});
