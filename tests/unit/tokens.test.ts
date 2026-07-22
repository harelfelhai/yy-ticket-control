import { describe, expect, it } from "vitest";
import { generateToken, hashToken, portalUrl, tokensMatch } from "@/lib/tokens";

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
