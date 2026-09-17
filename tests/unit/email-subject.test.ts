import { describe, expect, it } from "vitest";
import { isIntakeSubject, normalizeHebrew } from "@/lib/email-intake/subject";

/**
 * כלל הכותרת (אפיון §2.6 שלב 1, §5.ה3 כלל 1, §7 שורה 79).
 *
 * תווי הכיווניות נבנים מקוד התו ותווי הניקוד כתובים כ-escape, בכוונה: בקובץ
 * עצמו הם בלתי נראים, ובדיקה שקלטה נראה זהה לקלט "נקי" אינה מסבירה מה היא בודקת.
 */

const RLM = String.fromCharCode(0x200f);
const RLE = String.fromCharCode(0x202b);
const PDF = String.fromCharCode(0x202c);

describe("isIntakeSubject", () => {
  it.each([
    ["תקלה בדירה 12"],
    ["תקלות בבניין א"],
    ["יש תקלה בחדר המדרגות"],
    ["דירה 5 - תקלה"],
    ["Fwd: תקלה בחשמל"],
    ["RE: התקלה בדירה"],
    ["FW: לתקלות שנמצאו בבדק הבית"],
    ["RE:תקלה"],
    ["ולהתקלה שדיברנו עליה"],
    ["שתקלות"],
    ["מתקלה לתקלה"],
    ["(תקלה) דחוף"],
    ["\"תקלה\""],
    ["תקלה."],
    ["תקלה-חשמל"],
    ["abcתקלה"],
  ])("EM-01 — הכותרת \"%s\" נקלטת", (subject) => {
    expect(isIntakeSubject(subject)).toBe(true);
  });

  it("EM-01 — מקף עברי (U+05BE) אינו מדביק את המילה לזו שאחריה", () => {
    // U+05BE נמצא בטווח של סימני הניקוד, אבל הוא סימן פיסוק. אילו נמחק,
    // "תקלה\u05BEחשמל" הייתה הופכת למילה אחת ולא נקלטת.
    expect(isIntakeSubject("תקלה\u05BEחשמל")).toBe(true);
  });

  it("EM-01 — מילה מנוקדת נקלטת", () => {
    expect(isIntakeSubject("ת\u05BC\u05B7ק\u05BC\u05B8ל\u05B8ה ב\u05BC\u05B7ד\u05BC\u05B4יר\u05B8ה")).toBe(true);
  });

  it("EM-01 — תו כיווניות לפני המילה או בתוכה אינו מסתיר אותה", () => {
    expect(isIntakeSubject(`${RLM}תקלה בדירה`)).toBe(true);
    expect(isIntakeSubject(`RE: ${RLE}התקלה${PDF}`)).toBe(true);
    expect(isIntakeSubject(`תק${RLM}לה`)).toBe(true);
  });

  it("EM-01 — תו ברוחב אפס או מקף רך בתוך המילה אינו מפצל אותה", () => {
    // ZWNJ, ZWSP, מקף רך ו-CGJ: בלתי נראים בכותרת, ולכן "תקלה" נראית כמילה אחת
    for (const invisible of ["\u200C", "\u200B", "\u00AD", "\u034F", "\u2060"]) {
      expect(isIntakeSubject(`תק${invisible}לה בחדר`)).toBe(true);
    }
  });

  it("EM-01 — אות בצורת הצגה (ת עם דגש כתו יחיד) מנורמלת לפני ההשוואה", () => {
    // U+FB4A היא ת׳ עם דגש כתו אחד; NFKC מפרק אותה ל-ת + דגש.
    expect(isIntakeSubject("\uFB4Aקלה בבניין ב")).toBe(true);
  });

  it.each([
    ["תקלת חשמל"],
    ["התקלת"],
    ["ותקלת המזגן"],
  ])("EM-A10 — \"%s\" (סמיכות) אינה עונה על הכלל", (subject) => {
    expect(isIntakeSubject(subject)).toBe(false);
  });

  it.each([
    ["המזגן מתקלקל"],
    ["תקלהבה"],
    ["תקלותיה של המערכת"],
    ["תקל"],
    ["חשבונית מס 4411"],
    ["Takala"],
    [""],
    ["   "],
  ])("EM-03 — \"%s\" אינה כותרת של פנייה", (subject) => {
    expect(isIntakeSubject(subject)).toBe(false);
  });

  it("EM-01 — עד שלוש אותיות שימוש לפני המילה; רצף ארוך יותר אינו נקלט", () => {
    // הגבול נבחר כך: האפיון מדבר על "אות שימוש" ומדגים אחת ושתיים; שלוש
    // מכסות "ולה-", וארבע כבר מתאימות לרצפים שאינם מילה עברית.
    expect(isIntakeSubject("ולהתקלה")).toBe(true);
    expect(isIntakeSubject("וכשהתקלה")).toBe(false);
  });
});

describe("normalizeHebrew", () => {
  it("EM-01 — מסיר את כל תווי הכיווניות שמסננת ההצגה חוסמת", () => {
    const controls = String.fromCharCode(
      0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
    );
    expect(normalizeHebrew(`א${controls}ב`)).toBe("אב");
  });

  it("EM-01 — מסיר ניקוד וטעמי מקרא", () => {
    expect(normalizeHebrew("ב\u05BC\u05B0ר\u05B5אש\u05C1\u05B4\u0591ית")).toBe("בראשית");
  });

  it("EM-01 — משאיר סימני פיסוק עבריים שבטווח הניקוד (מקף, פסק, סוף פסוק)", () => {
    expect(normalizeHebrew("א\u05BEב\u05C0ג\u05C3")).toBe("א\u05BEב\u05C0ג\u05C3");
  });

  it("EM-01 — מחיל NFKC: תווים ברוחב מלא ואותיות בצורת הצגה", () => {
    expect(normalizeHebrew("ＲＥ： תקלה")).toBe("RE: תקלה");
    expect(normalizeHebrew("\uFB2Aלום")).toBe("שלום");
  });

  it("EM-01 — אינו נוגע ברווחים ובאותיות גדולות — זה תפקידו של הקורא", () => {
    expect(normalizeHebrew("  Auto  Reply  ")).toBe("  Auto  Reply  ");
  });

  it("EM-01 — טקסט נקי חוזר כמות שהוא", () => {
    expect(normalizeHebrew("תקלה בדירה 12, בניין א'")).toBe("תקלה בדירה 12, בניין א'");
  });
});
