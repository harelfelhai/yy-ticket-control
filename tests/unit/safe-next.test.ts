import { describe, expect, it } from "vitest";
import { DEFAULT_NEXT, safeNextPath } from "@/lib/safe-next";

/**
 * ‏`?next=` מגיע מכתובת שכל אחד יכול לשלוח. הבדיקות מפרידות בין מה שחייב
 * לעבור (יעד פנימי, כולל פרמטרים) לבין כל צורה שהדפדפן מנרמל ליציאה
 * מהאפליקציה — כולל הצורה שהמימוש הקודם החמיץ.
 */

describe("safeNextPath — יעדים פנימיים עוברים", () => {
  it.each([
    ["/board", "/board"],
    ["/tickets/abc", "/tickets/abc"],
    ["/board?siteId=1&status=OPEN", "/board?siteId=1&status=OPEN"],
    ["/tags/5#chat", "/tags/5#chat"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe("safeNextPath — יציאה מהאפליקציה נחסמת", () => {
  it.each([
    // רגרסיה: עבר את הבדיקה הקודמת (`startsWith("/")` ולא `//`), והדפדפן
    // פותר אותו ל-https://evil.com/ כי לוכסן הפוך מנורמל ללוכסן קדימה.
    ["/\\evil.com"],
    ["/\\\\evil.com"],
    ["//evil.com"],
    ["https://evil.com"],
    ["http://evil.com/path"],
    ["//evil.com/board"],
    ["javascript:alert(1)"],
  ])("%s נדחה", (input) => {
    expect(safeNextPath(input)).toBe(DEFAULT_NEXT);
  });

  it("קלט ריק או חסר מחזיר את ברירת המחדל", () => {
    expect(safeNextPath(undefined)).toBe(DEFAULT_NEXT);
    expect(safeNextPath(null)).toBe(DEFAULT_NEXT);
    expect(safeNextPath("")).toBe(DEFAULT_NEXT);
  });

  it("היעד המוחזר לעולם אינו נפתר לדומיין זר", () => {
    for (const attack of ["/\\evil.com", "//evil.com", "https://evil.com"]) {
      const resolved = new URL(safeNextPath(attack), "https://app.example.com");
      expect(resolved.origin).toBe("https://app.example.com");
    }
  });
});
