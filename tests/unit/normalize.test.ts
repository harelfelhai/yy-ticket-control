import { describe, expect, it } from "vitest";
import {
  looksLikeEmail,
  compareApartmentNumbers,
  normalizeApartmentNumber,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizeText,
} from "@/lib/normalize";

describe("normalizeName", () => {
  it("מסיר רווחים בקצוות", () => {
    expect(normalizeName("  בניין א  ")).toBe("בניין א");
  });

  it("מאחד רצף רווחים לאחד", () => {
    expect(normalizeName("בניין    א")).toBe("בניין א");
  });

  it("מטפל גם בטאב ובירידת שורה שמגיעים מהדבקה", () => {
    expect(normalizeName("בניין\tא\nב")).toBe("בניין א ב");
  });
});

describe("normalizePhone", () => {
  it.each([
    ["0501234567", "0501234567"],
    ["050-123-4567", "0501234567"],
    ["050 123 4567", "0501234567"],
    ["+972501234567", "0501234567"],
    ["+972-50-123-4567", "0501234567"],
    ["+972 50 123 4567", "0501234567"],
    ["00972501234567", "0501234567"],
    ["972501234567", "0501234567"],
  ])("מאחד %s לצורה מקומית", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it("שומר מספר בינלאומי שאינו ישראלי עם הקידומת", () => {
    expect(normalizePhone("+1 415 555 0123")).toBe("+14155550123");
  });

  it("מחזיר מחרוזת ריקה על קלט ריק או ללא ספרות", () => {
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone("   ")).toBe("");
    expect(normalizePhone("אין מספר")).toBe("");
  });

  it("אינו הופך מספר קצר שמתחיל ב-972 לצורה מקומית", () => {
    // ‏972123 אינו מספר בינלאומי; המרה שגויה שלו הייתה יוצרת מספר מומצא.
    expect(normalizePhone("972123")).toBe("972123");
  });

  it("שני ניסוחים של אותו מספר מגיעים לאותה תוצאה", () => {
    // זה הכלל שמונע קבלן כפול עם שני קישורי גישה שונים.
    expect(normalizePhone("054-1234567")).toBe(normalizePhone("+972 54 123 4567"));
  });
});

describe("normalizeApartmentNumber", () => {
  it.each([
    ["7", "7"],
    ["07", "7"],
    ["007", "7"],
    [" 12 ", "12"],
    ["0", "0"],
    ["12א", "12א"],
    ["0א", "0א"],
  ])("מאחד %s ל-%s", (input, expected) => {
    expect(normalizeApartmentNumber(input)).toBe(expected);
  });

  it("שתי צורות של אותה דירה מגיעות לאותה תוצאה", () => {
    expect(normalizeApartmentNumber("07")).toBe(normalizeApartmentNumber("7"));
  });
});

describe("compareApartmentNumbers — סדר טבעי", () => {
  it("ממיין לפי ערך מספרי ולא לפי תו ראשון", () => {
    // הסדר הלקסיקוגרפי של Postgres הוא 1, 10, 11, 12, 2, 20 — נסבל בשלוש
    // דירות, בלתי-שמיש בחמישים (סדר הגודל שהאפיון נוקב בו).
    const sorted = ["10", "2", "1", "20", "11"].sort(compareApartmentNumbers);
    expect(sorted).toEqual(["1", "2", "10", "11", "20"]);
  });

  it("מספר עם אות בא אחרי המספר הנקי", () => {
    expect(["12א", "12", "2"].sort(compareApartmentNumbers)).toEqual(["2", "12", "12א"]);
  });

  it("ערך שאינו מתחיל בספרה נדחק לסוף", () => {
    // "מחסן" הוא ערך חוקי בשדה חופשי, ואין לו מקום טבעי בין המספרים.
    expect(["מחסן", "3", "1"].sort(compareApartmentNumbers)).toEqual(["1", "3", "מחסן"]);
  });

  it("יציב: שני ערכים זהים אינם מחליפים מקום", () => {
    expect(compareApartmentNumbers("7", "7")).toBe(0);
  });
});

describe("normalizeText — טקסט חופשי", () => {
  it("שומר ירידות שורה, שהן חלק מהמידע", () => {
    // תיאור שנכתב בשלוש שורות בשטח אינו אמור להתמוטט לשורה אחת.
    expect(normalizeText("אין חשמל\nבסלון\nוגם במטבח")).toBe("אין חשמל\nבסלון\nוגם במטבח");
  });

  it("מכווץ רווחים וטאבים בתוך שורה", () => {
    expect(normalizeText("אין   חשמל\tבסלון")).toBe("אין חשמל בסלון");
  });

  it("מסיר רווחים בקצוות של כל שורה", () => {
    expect(normalizeText("  שורה א  \n   שורה ב  ")).toBe("שורה א\nשורה ב");
  });

  it("מצמצם רצף שורות ריקות לשורה ריקה אחת", () => {
    expect(normalizeText("א\n\n\n\nב")).toBe("א\n\nב");
  });

  it("מנרמל סופי שורה של Windows", () => {
    expect(normalizeText("א\r\nב")).toBe("א\nב");
  });

  it("טקסט של רווחים בלבד הופך למחרוזת ריקה", () => {
    expect(normalizeText("  \n \t \n ")).toBe("");
  });
});

describe("normalizeEmail", () => {
  it("מאחד אותיות ומסיר רווחים", () => {
    expect(normalizeEmail("  Yossi@Example.COM ")).toBe("yossi@example.com");
  });
});

describe("looksLikeEmail", () => {
  it.each(["a@b.co", "yossi.levi@example.co.il"])("%s נראה כמו מייל", (value) => {
    expect(looksLikeEmail(value)).toBe(true);
  });

  it.each(["0501234567", "yossi", "a@b", "a b@c.co", ""])("%s אינו מייל", (value) => {
    expect(looksLikeEmail(value)).toBe(false);
  });
});
