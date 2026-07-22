import { describe, expect, it } from "vitest";
import {
  decryptToken,
  encryptToken,
  generateToken,
  hashToken,
  portalUrl,
  tokensMatch,
} from "@/lib/tokens";

/** סוד בדיקה באורך שהמערכת דורשת בפועל */
const SECRET = "a".repeat(32);

describe("generateToken", () => {
  it("מייצר טוקן שונה בכל קריאה", () => {
    const tokens = new Set(Array.from({ length: 100 }, generateToken));
    expect(tokens.size).toBe(100);
  });

  it("מייצר 128 ביט של אקראיות בקידוד בטוח לכתובת", () => {
    const token = generateToken();
    // ‏base64url של 16 בתים: 22 תווים, בלי + / או =
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe("hashToken", () => {
  it("מחזיר SHA-256 בהקסדצימלי", () => {
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("אותו טוקן מייצר תמיד את אותו גיבוב", () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("הגיבוב אינו מכיל את הטוקן — דליפת DB אינה נותנת גישה", () => {
    const token = generateToken();
    expect(hashToken(token)).not.toContain(token);
  });

  it("שינוי תו אחד משנה את הגיבוב לחלוטין", () => {
    expect(hashToken("token-a")).not.toBe(hashToken("token-b"));
  });
});

describe("tokensMatch", () => {
  it("מזהה גיבובים זהים", () => {
    const hash = hashToken("x");
    expect(tokensMatch(hash, hash)).toBe(true);
  });

  it("דוחה גיבובים שונים", () => {
    expect(tokensMatch(hashToken("a"), hashToken("b"))).toBe(false);
  });

  it("דוחה קלט ריק ואינו קורס", () => {
    expect(tokensMatch("", "")).toBe(false);
    expect(tokensMatch(hashToken("a"), "")).toBe(false);
  });
});

describe("portalUrl", () => {
  it("בונה כתובת תקינה", () => {
    expect(portalUrl("https://example.com", "abc")).toBe("https://example.com/p/abc");
  });

  it("אינו יוצר סלאש כפול כשהבסיס מסתיים בסלאש", () => {
    expect(portalUrl("https://example.com/", "abc")).toBe("https://example.com/p/abc");
  });
});

/**
 * השמירה ההפיכה של הטוקן — מה שמאפשר "שלח שוב את **אותו** קישור".
 * בלעדיה כל שליחה חוזרת הורגת את ההודעה הקודמת בוואטסאפ של הקבלן.
 */
describe("encryptToken / decryptToken", () => {
  it("מחזיר את הטוקן המקורי", () => {
    const token = generateToken();
    expect(decryptToken(encryptToken(token, SECRET), SECRET)).toBe(token);
  });

  it("אינו מכיל את הטוקן כטקסט גלוי", () => {
    const token = generateToken();
    expect(encryptToken(token, SECRET)).not.toContain(token);
  });

  it("מייצר תוצאה שונה בכל הצפנה של אותו טוקן", () => {
    // ‏IV אקראי בכל פעם. בלעדיו שני קבלנים עם אותו טוקן (תיאורטית) היו
    // מקבלים אותה מחרוזת, ודפוסים חוזרים הם מה שמאפשר ניתוח.
    const token = generateToken();
    expect(encryptToken(token, SECRET)).not.toBe(encryptToken(token, SECRET));
  });

  it("אינו מפענח עם סוד אחר", () => {
    // זו התכונה שבזכותה דליפת בסיס הנתונים לבדה אינה שווה דבר:
    // המפתח נגזר מ-SESSION_SECRET, שחי במשתני הסביבה.
    const stored = encryptToken(generateToken(), SECRET);
    expect(decryptToken(stored, "b".repeat(32))).toBeNull();
  });

  it("מזהה שינוי בנתונים ומחזיר null במקום זבל", () => {
    // ‏GCM מאמת שלמות. בלי זה תו שהשתנה היה מחזיר "טוקן" שגוי בשקט.
    //
    // השינוי נעשה על הבתים ולא על תו ב-base64: התו האחרון בקידוד נושא רק
    // חלק מהביטים, והחלפתו עלולה לפענח בדיוק לאותם בתים — כך שהבדיקה
    // הייתה עוברת בלי לשנות דבר.
    const stored = encryptToken(generateToken(), SECRET);
    const [iv, cipher, tag] = stored.split(".");
    const bytes = Buffer.from(cipher, "base64url");
    bytes[0] ^= 0xff;

    expect(decryptToken(`${iv}.${bytes.toString("base64url")}.${tag}`, SECRET)).toBeNull();
  });

  it("מחזיר null על מחרוזת שאינה בפורמט, בלי לזרוק", () => {
    // רשומה שנוצרה לפני שהשדה קיים מגיעה לכאן כערך לא צפוי; התשובה הנכונה
    // היא "אי אפשר לשחזר, צור קישור חדש" ולא קריסה של המסך.
    expect(decryptToken("", SECRET)).toBeNull();
    expect(decryptToken("סתם טקסט", SECRET)).toBeNull();
    expect(decryptToken("a.b", SECRET)).toBeNull();
    expect(decryptToken("a.b.c.d", SECRET)).toBeNull();
  });
});
