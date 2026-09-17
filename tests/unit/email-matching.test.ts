import { describe, expect, it } from "vitest";
import { he } from "@/lib/he";
import {
  type Candidate,
  type MatchResult,
  matchApartment,
  matchBuilding,
  matchName,
  matchRoom,
  mentionedIn,
  normalizeForMatch,
} from "@/lib/email-intake/matching";
import { ROOMS } from "@/lib/rooms";

type RecipientKind = "professional" | "user";

const c = (id: string, label: string): Candidate => ({ id, label });
const person = (id: string, label: string, kind: RecipientKind = "professional"): Candidate<RecipientKind> => ({
  id,
  label,
  kind,
});

/** תוצאה בצורה שקל להשוות: מזהים בלבד */
function ids(result: MatchResult): { kind: string; ids: string[] } {
  switch (result.kind) {
    case "match":
      return { kind: "match", ids: [result.candidate.id] };
    case "ambiguous":
      return { kind: "ambiguous", ids: result.candidates.map((x) => x.id) };
    case "none":
      return { kind: "none", ids: [] };
  }
}

const match = (id: string) => ({ kind: "match", ids: [id] });
const ambiguous = (...list: string[]) => ({ kind: "ambiguous", ids: list });
const none = { kind: "none", ids: [] };

// ─────────────────────────────── נרמול ───────────────────────────────

describe("normalizeForMatch", () => {
  it.each([
    ["רווחים בקצוות ורצפים", "  יוסי    כהן  ", "יוסי כהן"],
    ["אותיות לטיניות גדולות", "ABC Group", "abc group"],
    ["ניקוד", "דִּירָה", "דירה"],
    ["אות בצורת הצגה (NFKC)", "\uFB2Aמעון", "שמעון"],
    ["רוחב מלא (NFKC)", "\uFF21\uFF22", "ab"],
    ["תווי כיווניות", "\u200Fיוסי\u200E \u202Bכהן\u202C", "יוסי כהן"],
    ["תו ברוחב אפס בתוך מילה", "יוס\u200Bי", "יוסי"],
    ["פיסוק הופך לרווח", "יוסי-כהן, (אינסטלטור).", "יוסי כהן אינסטלטור"],
    ["מקף עברי מפריד מילים", "בית\u05BEשמש", "בית שמש"],
    ["מירכאות סביב הערך", '"מגדלי הים"', "מגדלי הים"],
    ["ריק", "", ""],
    ["פיסוק בלבד", " — ?! ", ""],
  ])("EM-07 — %s", (_name, input, expected) => {
    expect(normalizeForMatch(input)).toBe(expected);
  });

  it.each(["א׳", "א`", "א´", "א‘", "א’", "א'"])("EM-07 — גרש מאוחד: %s", (input) => {
    expect(normalizeForMatch(input)).toBe("א'");
  });

  it.each(["ממ״ד", "ממ“ד", "ממ”ד", "ממ''ד", 'ממ"ד', "ממ׳׳ד"])("EM-07 — גרשיים מאוחדים: %s", (input) => {
    expect(normalizeForMatch(input)).toBe('ממ"ד');
  });
});

// ─────────────────────────────── שמות ───────────────────────────────

describe("matchName", () => {
  const professionals = [
    person("p-yossi-cohen", "יוסי כהן"),
    person("p-yossi-levi", "יוסי לוי"),
    person("p-dana", "דנה אברהם"),
    person("p-shlomo", "שלמה ביטון"),
  ];
  const domains = [c("d-elec", "חשמל"), c("d-plumb", "אינסטלציה"), c("d-alu", "אלומיניום"), c("d-ac", "מיזוג אוויר")];

  it("EM-07 — שם זהה → התאמה", () => {
    expect(ids(matchName("יוסי כהן", professionals))).toEqual(match("p-yossi-cohen"));
  });

  it("EM-07 — ההתאמה מחזירה את הרשומה שהועברה, לא עותק", () => {
    const result = matchName("דנה אברהם", professionals);
    expect(result.kind === "match" && result.candidate).toBe(professionals[2]);
  });

  it("EM-07 — שם שאינו ברשימה → אין התאמה (ולא נוצר ערך)", () => {
    expect(ids(matchName("משה פרץ", professionals))).toEqual(none);
  });

  it("EM-08 — 'יוסי' כשיש שני יוסי → כמה התאמות, ואף אחת אינה נבחרת", () => {
    expect(ids(matchName("יוסי", professionals))).toEqual(ambiguous("p-yossi-cohen", "p-yossi-levi"));
  });

  it("EM-08 — שתי רשומות באותו שם בדיוק → כמה התאמות", () => {
    const twins = [person("p1", "יוסי כהן"), person("p2", "יוסי כהן")];
    expect(ids(matchName("יוסי כהן", twins))).toEqual(ambiguous("p1", "p2"));
  });

  it("EM-08 — איש מקצוע ומשתמש באותו שם הם שתי רשומות שונות", () => {
    const mixed = [person("same-id", "רונית שמש", "professional"), person("same-id", "רונית שמש", "user")];
    expect(ids(matchName("רונית שמש", mixed))).toEqual(ambiguous("same-id", "same-id"));
  });

  it("EM-08 — אותה רשומה שהועברה פעמיים אינה יוצרת עמימות", () => {
    const duplicated = [person("p1", "יוסי כהן"), person("p1", "יוסי כהן")];
    expect(ids(matchName("יוסי", duplicated))).toEqual(match("p1"));
  });

  it("EM-07 — הפונקציה שוקלת רק את מה שקיבלה: מושבת שלא הועבר אינו מועמד", () => {
    // יוסי לוי מושבת, ולכן השירות אינו מעביר אותו — ו'יוסי' מתאים ליחיד שנשאר.
    const activeOnly = professionals.filter((p) => p.id !== "p-yossi-levi");
    expect(ids(matchName("יוסי", activeOnly))).toEqual(match("p-yossi-cohen"));
  });

  it("EM-07 — רשימת מועמדים ריקה → אין התאמה", () => {
    expect(ids(matchName("יוסי כהן", []))).toEqual(none);
  });

  it.each(["", "   ", "—", "?!"])("EM-07 — ערך ריק (%j) אינו מתאים לכלום", (written) => {
    expect(ids(matchName(written, professionals))).toEqual(none);
  });

  it("EM-07 — מועמד שתוויתו ריקה אינו מתאים לשום ערך", () => {
    expect(ids(matchName("א", [c("blank", "  "), c("dash", "—")]))).toEqual(none);
  });

  it("EM-07 — ניקוד, כיווניות, רווחים ואותיות גדולות אינם מפריעים", () => {
    expect(ids(matchName("\u200F יוֹסִי   כֹּהֵן \u200E", professionals))).toEqual(match("p-yossi-cohen"));
    expect(ids(matchName("abc group", [c("s1", "ABC Group")]))).toEqual(match("s1"));
  });

  describe("אות שימוש", () => {
    it.each([
      ["לחשמל", "d-elec"],
      ["בחשמל", "d-elec"],
      ["האינסטלציה", "d-plumb"],
      ["ואלומיניום", "d-alu"],
      ["למיזוג אוויר", "d-ac"],
    ])("EM-07 — תחום עם אות שימוש: %s", (written, expected) => {
      expect(ids(matchName(written, domains))).toEqual(match(expected));
    });

    it("EM-07 — אות שימוש בכל מילה בנפרד: 'לשלמה ביטון' (ב של ביטון אינה אות שימוש)", () => {
      expect(ids(matchName("לשלמה ביטון", professionals))).toEqual(match("p-shlomo"));
    });

    it("EM-07 — שם עם אות שימוש שמוכל בשם מלא: 'ליוסי' כשיש יוסי אחד", () => {
      expect(ids(matchName("ליוסי", [person("p1", "יוסי כהן"), person("p2", "דנה אברהם")]))).toEqual(match("p1"));
    });

    it("EM-08 — 'ליוסי' כשיש שני יוסי → כמה התאמות", () => {
      expect(ids(matchName("ליוסי", professionals))).toEqual(ambiguous("p-yossi-cohen", "p-yossi-levi"));
    });

    it("EM-07 — מילה שהיא בעצמה מילה ברשימה אינה מאבדת את האות הראשונה: 'שרון' אינו 'רון'", () => {
      const list = [person("p-ron", "רון לוי"), person("p-sharon", "שרון כהן")];
      expect(ids(matchName("שרון", list))).toEqual(match("p-sharon"));
    });

    it("EM-07 — מילה של שתי אותיות אינה מקוצרת לאות אחת", () => {
      expect(ids(matchName("בא", [c("b1", "א")]))).toEqual(none);
    });

    it("EM-07 — התאמה מדויקת קודמת להסרת אות שימוש", () => {
      const list = [c("with", "לב העיר"), c("without", "ב העיר")];
      expect(ids(matchName("לב העיר", list))).toEqual(match("with"));
    });
  });

  describe("הכלה של מילים", () => {
    it("EM-07 — שם פרטי שמוכל בשם מלא יחיד", () => {
      expect(ids(matchName("דנה", professionals))).toEqual(match("p-dana"));
    });

    it("EM-07 — השם המלא מוכל בטקסט ארוך יותר: 'יוסי כהן האינסטלטור'", () => {
      expect(ids(matchName("יוסי כהן האינסטלטור", professionals))).toEqual(match("p-yossi-cohen"));
    });

    it("EM-08 — שם משפחה משותף → כמה התאמות", () => {
      const list = [person("p1", "יוסי כהן"), person("p2", "דנה כהן")];
      expect(ids(matchName("כהן", list))).toEqual(ambiguous("p1", "p2"));
    });

    it("EM-07 — התאמה מדויקת קודמת להכלה: 'יוסי' כשיש 'יוסי' ו'יוסי כהן'", () => {
      const list = [person("short", "יוסי"), person("long", "יוסי כהן")];
      expect(ids(matchName("יוסי", list))).toEqual(match("short"));
    });

    it("EM-07 — אתר שנכתב בחלקו: 'הים' מתוך 'מגדלי הים'", () => {
      const sites = [c("s-sea", "מגדלי הים"), c("s-park", "פארק הירקון")];
      expect(ids(matchName("הים", sites))).toEqual(match("s-sea"));
    });

    it("EM-07 — מילה שאינה בשם אינה מתאימה, גם כשמילה אחרת כן", () => {
      expect(ids(matchName("יוסי מזרחי", professionals))).toEqual(none);
    });
  });

  describe("בלי התאמה מקורבת", () => {
    it.each([
      ["שגיאת כתיב", "יוסי כהו"],
      ["שם מקצוע במקום תחום (EM-A09)", "אינסטלטור"],
      ["חלק ממילה", "אינסטל"],
      ["אותיות מוחלפות", "מיזוג אויר"],
    ])("EM-07 — %s → אין התאמה", (_name, written) => {
      expect(ids(matchName(written, [...professionals, ...domains]))).toEqual(none);
    });

    it("EM-07 — מספרים: '12' אינו '112', '21' אינו '12'", () => {
      const sites = [c("s12", "מגדל 12"), c("s112", "מגדל 112")];
      expect(ids(matchName("מגדל 21", sites))).toEqual(none);
      expect(ids(matchName("מגדל 12", sites))).toEqual(match("s12"));
      expect(ids(matchName("112", sites))).toEqual(match("s112"));
    });
  });
});

// ─────────────────────────────── בניינים ───────────────────────────────

describe("matchBuilding", () => {
  const buildings = [c("b-a", "בניין א"), c("b-b", "בניין ב"), c("b-12", "בניין 12"), c("b-sea", "מגדל הים")];

  it.each([
    ["א'", "b-a"],
    ["א׳", "b-a"],
    ["א", "b-a"],
    ["בניין א", "b-a"],
    ["בניין א'", "b-a"],
    ["בנין א", "b-a"],
    ["בנ' א", "b-a"],
    ["בנ׳ ב׳", "b-b"],
    ["בבניין ב", "b-b"],
    ["הבניין ב'", "b-b"],
    ["12", "b-12"],
    ["בניין 12", "b-12"],
    ["מגדל הים", "b-sea"],
    ["הים", "b-sea"],
  ])("EM-07 — '%s' → %s", (written, expected) => {
    expect(ids(matchBuilding(written, buildings))).toEqual(match(expected));
  });

  it("EM-07 — הצורה בצד הרשימה מנורמלת באותו אופן: 'בניין א' מול רשומה 'א׳'", () => {
    expect(ids(matchBuilding("בניין א", [c("x", "א׳"), c("y", "ב׳")]))).toEqual(match("x"));
  });

  it.each([["ג"], ["בניין ג"], ["בניין"], [""], ["1"], ["2"], ["112"]])(
    "EM-07 — '%s' אינו ברשימה → אין התאמה (כולל בלי מספר חלקי)",
    (written) => {
      expect(ids(matchBuilding(written, buildings))).toEqual(none);
    },
  );

  it("EM-08 — 'א' ו'בניין א' שתיהן ברשימה → כמה התאמות", () => {
    expect(ids(matchBuilding("א", [c("x", "א"), c("y", "בניין א")]))).toEqual(ambiguous("x", "y"));
  });

  it("EM-07 — המילה 'בניין' לבדה אינה מזהה בניין, גם כשיש רשומה בשם הזה", () => {
    expect(ids(matchBuilding("בניין", [c("only", "בניין"), c("b-a", "בניין א")]))).toEqual(none);
  });

  it("EM-07 — רשומה ששמה אינו אלא 'בניין' אינה מתאימה לכל ערך", () => {
    expect(ids(matchBuilding("א", [c("only", "בניין")]))).toEqual(none);
  });
});

// ─────────────────────────────── דירות ───────────────────────────────

describe("matchApartment", () => {
  const apartments = [c("a7", "7"), c("a12", "12"), c("a12a", "12א"), c("a112", "112"), c("a1", "1")];

  it.each([
    ["7", "a7"],
    ["07", "a7"],
    ["007", "a7"],
    ["12", "a12"],
    ["דירה 12", "a12"],
    ["דירת 12", "a12"],
    ["בדירה 12", "a12"],
    ["מס' 12", "a12"],
    ["מס׳ 12", "a12"],
    ["מספר 12", "a12"],
    ["דירה מס' 12", "a12"],
    ["#12", "a12"],
    ["# 12", "a12"],
    ["12.", "a12"],
    ["12א", "a12a"],
    ["דירה 12א", "a12a"],
    ["112", "a112"],
    ["\u200F12\u200E", "a12"],
  ])("EM-07 — '%s' → %s", (written, expected) => {
    expect(ids(matchApartment(written, apartments))).toEqual(match(expected));
  });

  it("EM-07 — הרשימה מנורמלת באותו אופן: דירה שנשמרה '07' מתאימה ל-'7'", () => {
    expect(ids(matchApartment("7", [c("old", "07")]))).toEqual(match("old"));
  });

  it.each([["21"], ["2"], ["13"], ["12ב"], ["1 2"], ["דירה"], [""], ["שתים עשרה"], ["12 או 14"]])(
    "EM-07 — '%s' → אין התאמה: רק מספר זהה, בלי התאמה חלקית",
    (written) => {
      expect(ids(matchApartment(written, apartments))).toEqual(none);
    },
  );

  it("EM-07 — '12' אינו '12א' ו-'12א' אינו '12'", () => {
    expect(ids(matchApartment("12", [c("a12a", "12א")]))).toEqual(none);
    expect(ids(matchApartment("12א", [c("a12", "12")]))).toEqual(none);
  });

  it("EM-08 — '7' ו-'07' ששתיהן נשמרו ברשימה → כמה התאמות", () => {
    expect(ids(matchApartment("7", [c("x", "7"), c("y", "07")]))).toEqual(ambiguous("x", "y"));
  });
});

// ─────────────────────────────── חדרים ───────────────────────────────

describe("matchRoom", () => {
  it.each(ROOMS.map((room) => [he.room[room], room] as const))(
    "EM-07 — התווית במערכת '%s' → %s",
    (label, room) => {
      expect(matchRoom(label)).toBe(room);
    },
  );

  it.each([
    ["אמבטיה", "BATHROOM"],
    ["חדר אמבטיה", "BATHROOM"],
    ["מקלחת", "BATHROOM"],
    ["ממד", "MAMAD"],
    ['ממ"ד', "MAMAD"],
    ["מרחב מוגן", "MAMAD"],
    ["חניון", "PARKING"],
    ["חנייה", "PARKING"],
    ["מדרגות", "STAIRWELL"],
    ["שטחים משותפים", "COMMON"],
    ["חדר שירותים", "WC"],
  ])("EM-07 — מילה נרדפת '%s' → %s", (written, room) => {
    expect(matchRoom(written)).toBe(room);
  });

  it.each([
    ["במטבח", "KITCHEN"],
    ["המטבח", "KITCHEN"],
    ["בחדר השינה", "BEDROOM"],
    ["בשירותים", "WC"],
    ["בממ״ד", "MAMAD"],
    ["במקלחת", "BATHROOM"],
    ["\u200Fבַּמִּטְבָּח", "KITCHEN"],
  ])("EM-07 — עם אות שימוש '%s' → %s", (written, room) => {
    expect(matchRoom(written)).toBe(room);
  });

  it("EM-07 — 'שירותים' הוא התווית של WC במערכת ולכן אינו חדר רחצה", () => {
    expect(matchRoom("שירותים")).toBe("WC");
  });

  it.each([["מחסן"], ["חדר"], ["שינה"], [""], ["kitchen"], ["מטבחון"]])("EM-07 — '%s' אינו חדר מוכר → null", (written) => {
    expect(matchRoom(written)).toBeNull();
  });
});

// ─────────────────────────────── מופיע בטקסט ───────────────────────────────

describe("mentionedIn", () => {
  describe("מספרים — מילה שלמה בלבד", () => {
    it.each([
      ["12", "הנזילה בדירה 12 בקומה 3", true],
      ["12", "דירה 12, בניין א", true],
      ["12", "בדירה 112", false],
      ["12", "בדירה 121", false],
      ["12", "דירה 12א", false],
      ["12", "טלפון 050-1234567", false],
      ["12א", "דירה 12א", true],
      ["12א", "דירה 12 א", true],
      ["12א", "דירה 12 א'", true],
      ["12 א", "דירה 12א", true],
      ["12", "דירה 12 ו-13", true],
      ["7", "דירה 07", true],
      ["07", "דירה 7", true],
      ["12", "ב-12 לחודש", true],
      ["12", "ב12 לחודש", true],
      ["21", "דירה 12", false],
    ])("EM-07 — '%s' ב-'%s' → %s", (value, haystack, expected) => {
      expect(mentionedIn(value, haystack)).toBe(expected);
    });
  });

  describe("מילים", () => {
    it.each([
      ["חשמל", "יש בעיה בחשמל בדירה", true],
      ["חשמל", "יש בעיה בחשמל,", true],
      ["יוסי כהן", "תעבירו ליוסי כהן בבקשה", true],
      ["יוסי כהן", "יוסי לוי וכהן", false],
      ["כהן יוסי", "יוסי כהן", false],
      ["כהן", "משפחת כהנא", false],
      ["אינסטלציה", "צריך אינסטלטור דחוף", false],
      ["בניין א", "בבניין א' יש נזילה", true],
      ["א", "בניין א' קומה 2", true],
      ["א", "לא ברור מה קרה", false],
      ["ממ״ד", 'נזילה בממ"ד', true],
      ["מגדלי הים", "Fwd: תקלה במגדלי הים", true],
      ["PDF", "ראו pdf מצורף", true],
      ["\u200Fיוֹסִי", "יוסי", true],
    ])("EM-07 — '%s' ב-'%s' → %s", (value, haystack, expected) => {
      expect(mentionedIn(value, haystack)).toBe(expected);
    });
  });

  it.each([
    ["", "דירה 12"],
    ["  ", "דירה 12"],
    ["—", "דירה — 12"],
    ["12", ""],
  ])("EM-07 — ערך ריק או טקסט ריק (%j, %j) → לא הוזכר", (value, haystack) => {
    expect(mentionedIn(value, haystack)).toBe(false);
  });
});
