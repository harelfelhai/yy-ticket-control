import { describe, expect, it } from "vitest";
import { firstLine } from "@/lib/format";

/**
 * ‏`firstLine` — השורה הראשונה מהתיאור, לתצוגה ברשימה.
 *
 * הפונקציה קיימת מאז 0.1 ומעולם לא נבדקה, משום שהיא ישבה כפונקציה **פרטית
 * בשני עותקים** — ב-`services/board.ts` וב-`services/search.ts` — ובדיקה
 * ישירה עליה לא הייתה אפשרית בלי לעבור דרך ה-DB. ב-0.5, כשהצרכן השלישי
 * (מסך התגית) היה אמור להוסיף עותק שלישי, היא חולצה ל-`lib/format.ts`.
 *
 * זה הרווח האמיתי מהחילוץ, והוא גדול מ"פחות שורות": כפילות פרטית אינה רק
 * קוד שחוזר, היא קוד שאין לו בדיקה.
 */

describe("firstLine", () => {
  it("מחזיר את השורה הראשונה בלבד", () => {
    expect(firstLine("אין חשמל בסלון\nהמפסק קופץ כל בוקר")).toBe("אין חשמל בסלון");
  });

  it("גוזם רווחים בקצוות", () => {
    expect(firstLine("  נזילה מתחת לכיור  \nגם אתמול")).toBe("נזילה מתחת לכיור");
  });

  it("טקסט בשורה אחת חוזר כמות שהוא", () => {
    expect(firstLine("אריח שבור בכניסה")).toBe("אריח שבור בכניסה");
  });

  it("מחרוזת ריקה אינה מפילה דבר", () => {
    expect(firstLine("")).toBe("");
    expect(firstLine("\n\n")).toBe("");
  });

  it("חותך ב-120 תווים ומסמן שיש המשך", () => {
    // מי שכותב הכול בשורה אחת אינו מקבל טיפול שונה: הרשימה אינה מקום
    // לקרוא בו תיאור מלא, וחיתוך בשרת מונע פסקה שלמה לכל שורה ברשת.
    const long = "א".repeat(200);
    const cut = firstLine(long);

    expect(cut).toHaveLength(120);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("בדיוק 120 תווים אינו נחתך", () => {
    // גבול, לא אזור אפור: 120 עובר, 121 נחתך.
    expect(firstLine("א".repeat(120))).toHaveLength(120);
    expect(firstLine("א".repeat(120)).endsWith("…")).toBe(false);
    expect(firstLine("א".repeat(121)).endsWith("…")).toBe(true);
  });

  it("החיתוך חל על השורה הראשונה, לא על הטקסט המלא", () => {
    const text = `${"א".repeat(50)}\n${"ב".repeat(200)}`;
    expect(firstLine(text)).toBe("א".repeat(50));
  });
});
