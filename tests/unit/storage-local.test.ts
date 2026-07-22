import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveKey } from "@/lib/storage/local";

/**
 * מניעת יציאה מתיקיית המדיה.
 *
 * המפתח מגיע מהכתובת שהלקוח ביקש. בלי הבדיקה הזו ה-route של ההעלאה היה
 * כותב לכל מקום בדיסק — כולל `.env` — ושל ההורדה היה מגיש כל קובץ בפרויקט.
 * זו בדיקה קצרה שמכסה פרצה שלמה.
 */

describe("resolveKey", () => {
  it("מחזיר נתיב בתוך תיקיית המדיה", () => {
    const resolved = resolveKey("media/2026/07/abc.jpg");
    expect(resolved).toContain(path.join(".localmedia", "media", "2026", "07"));
  });

  it("דוחה יציאה מהתיקייה", () => {
    for (const key of [
      "../.env",
      "../../secrets.txt",
      "media/../../.env",
      "media/2026/../../../package.json",
    ]) {
      expect(() => resolveKey(key)).toThrow(/אינו חוקי/);
    }
  });

  it("דוחה נתיב מוחלט", () => {
    // ‏path.resolve מתעלם מהבסיס כשהארגומנט השני מוחלט — זו בדיוק המלכודת.
    expect(() => resolveKey("C:/Windows/System32/config")).toThrow(/אינו חוקי/);
    expect(() => resolveKey("/etc/passwd")).toThrow(/אינו חוקי/);
  });
});
