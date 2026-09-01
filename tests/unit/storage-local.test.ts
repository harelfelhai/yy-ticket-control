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
    // ‏`/` מוחלט בשתי המערכות: על Windows הוא מפנה לשורש הכונן הנוכחי, ולכן
    // יוצא מתיקיית המדיה שם בדיוק כמו על Linux.
    expect(() => resolveKey("/etc/passwd")).toThrow(/אינו חוקי/);
  });

  /**
   * אות כונן היא נתיב מוחלט **ב-Windows בלבד**.
   *
   * הבדיקה הזו נכתבה על Windows והייתה ללא תנאי, ונכשלה בריצה הראשונה של
   * ה-CI על Linux: שם `C:` הוא שם תיקייה חוקי לגמרי, `path.resolve` משאיר
   * אותו בתוך `.localmedia/`, ואין מה לדחות. כלומר לא באג בקוד אלא הנחה על
   * מערכת ההפעלה שהוטמעה בבדיקה — ההגנה עצמה נכונה בשתי המערכות.
   */
  it.runIf(process.platform === "win32")("דוחה אות כונן ב-Windows", () => {
    expect(() => resolveKey("C:/Windows/System32/config")).toThrow(/אינו חוקי/);
  });
});
