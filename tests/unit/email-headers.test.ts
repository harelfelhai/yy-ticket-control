import { describe, expect, it } from "vitest";
import {
  decodeRfc2047,
  formatMessageId,
  headerMap,
  normalizeMessageId,
  parseAddress,
  parseAddressList,
  parseMessageIds,
} from "@/lib/email-intake/headers";

/**
 * כותרות המייל: זיהוי השרשרת (EM-14), זיהוי השולח לפי כתובת (EM-04),
 * ומענה באותה שרשרת (EM-12).
 *
 * הקידודים כאן הועתקו מהצורה שבה לקוחות דואר שולחים אותם בפועל: Gmail
 * ו-Apple Mail מקודדים UTF-8 ב-B, Outlook בעברית שולח windows-1255 ב-Q.
 */

describe("headerMap", () => {
  it("EM-23 — שמות הכותרות באותיות קטנות, כך שהבדיקות אינן תלויות באיות השולח", () => {
    const map = headerMap([
      { name: "Auto-Submitted", value: "auto-replied" },
      { name: "MESSAGE-ID", value: "<a@x>" },
    ]);
    expect(map).toEqual({ "auto-submitted": "auto-replied", "message-id": "<a@x>" });
  });

  it("EM-23 — כותרת שחוזרת — האחרונה גוברת", () => {
    const map = headerMap([
      { name: "Received", value: "first" },
      { name: "received", value: "second" },
    ]);
    expect(map.received).toBe("second");
  });

  it("EM-23 — רשימה ריקה — מפה ריקה; רווחים סביב השם מוסרים", () => {
    expect(headerMap([])).toEqual({});
    expect(headerMap([{ name: " Subject ", value: "תקלה" }])).toEqual({ subject: "תקלה" });
  });

  it("EM-23 — כותרת בשם __proto__ נשמרת כשדה רגיל ואינה משנה את אב הטיפוס", () => {
    const map = headerMap([{ name: "__proto__", value: "x" }]);
    expect(Object.getPrototypeOf(map)).toBe(Object.prototype);
    expect(Object.keys(map)).toEqual(["__proto__"]);
  });
});

describe("normalizeMessageId", () => {
  it.each([
    ["<CAB+x=Q9@mail.gmail.com>", "CAB+x=Q9@mail.gmail.com"],
    ["  <abc@example.com>  ", "abc@example.com"],
    ["abc@example.com", "abc@example.com"],
    ["<abc@example.com> <def@example.com>", "abc@example.com"],
    ["<abc\r\n @example.com>", "abc@example.com"],
    ["abc@example.com (Yossi's message)", "abc@example.com"],
    ["<abc@example.com", "abc@example.com"],
    ["\"Yossi Cohen\"'s message of 1 Jan 2026 <abc@example.com>", "abc@example.com"],
  ])("EM-14 — \"%s\" ← \"%s\"", (input, expected) => {
    expect(normalizeMessageId(input)).toBe(expected);
  });

  it("EM-14 — אותיות גדולות נשמרות: מזהה הודעה רגיש לרישיות", () => {
    expect(normalizeMessageId("<ABC@Example.COM>")).toBe("ABC@Example.COM");
  });

  it.each([[""], ["   "], ["<>"], ["< >"], [null], [undefined]])("EM-14 — ערך ריק (%s) ← null", (input) => {
    expect(normalizeMessageId(input)).toBeNull();
  });
});

describe("parseMessageIds", () => {
  it("EM-14 — References מקופל על כמה שורות: כל המזהים, לפי הסדר", () => {
    expect(parseMessageIds("<a@x.com> <b@y.com>\r\n\t<c@z.com>")).toEqual(["a@x.com", "b@y.com", "c@z.com"]);
  });

  it("EM-14 — מזהה שחוזר נספר פעם אחת, במקומו הראשון", () => {
    expect(parseMessageIds("<a@x.com> <b@y.com> <a@x.com>")).toEqual(["a@x.com", "b@y.com"]);
  });

  it("EM-14 — מופרדים בפסיקים או צמודים", () => {
    expect(parseMessageIds("<a@x.com>,<b@y.com><c@z.com>")).toEqual(["a@x.com", "b@y.com", "c@z.com"]);
  });

  it("EM-14 — בלי סוגריים משולשים: אסימונים שיש בהם @", () => {
    expect(parseMessageIds("a@x.com b@y.com")).toEqual(["a@x.com", "b@y.com"]);
    expect(parseMessageIds("re: a@x.com, noise b@y.com")).toEqual(["a@x.com", "b@y.com"]);
  });

  it("EM-14 — מזהה ריק בתוך הרשימה מדולג", () => {
    expect(parseMessageIds("<> <a@x.com> < >")).toEqual(["a@x.com"]);
  });

  it.each([[""], [null], [undefined], ["no ids here"]])("EM-14 — ריק (%s) ← רשימה ריקה", (input) => {
    expect(parseMessageIds(input)).toEqual([]);
  });
});

describe("formatMessageId", () => {
  it("EM-12 — עוטף בסוגריים משולשים", () => {
    expect(formatMessageId("intake-1@yy.example")).toBe("<intake-1@yy.example>");
  });

  it("EM-12 — מזהה שכבר עטוף אינו נעטף פעמיים", () => {
    expect(formatMessageId("<intake-1@yy.example>")).toBe("<intake-1@yy.example>");
  });

  it("EM-12 — הלוך-חזור עם normalizeMessageId שומר על המזהה", () => {
    const id = "CAB+x=Q9@mail.gmail.com";
    expect(normalizeMessageId(formatMessageId(id))).toBe(id);
  });

  it("EM-12 — ירידת שורה במזהה אינה יכולה להזריק כותרת נוספת", () => {
    const formatted = formatMessageId("abc@x.com\r\nBcc: attacker@evil.example");
    expect(formatted).not.toMatch(/[\r\n]/);
  });

  it("EM-12 — מזהה ריק הוא באג אצל הקורא — נזרקת שגיאה ולא נכתב `<>`", () => {
    expect(() => formatMessageId("  ")).toThrow();
  });
});

describe("decodeRfc2047", () => {
  it("EM-01 — UTF-8 בקידוד B (Gmail, Apple Mail)", () => {
    expect(decodeRfc2047("=?UTF-8?B?16rXp9ec15Qg15HXk9eZ16jXlCAxMg==?=")).toBe("תקלה בדירה 12");
  });

  it("EM-01 — UTF-8 בקידוד Q, עם קו תחתון כרווח", () => {
    expect(decodeRfc2047("=?utf-8?Q?=D7=AA=D7=A7=D7=9C=D7=94_=D7=91=D7=93=D7=99=D7=A8=D7=94?=")).toBe("תקלה בדירה");
  });

  it("EM-01 — windows-1255 בקידוד Q (Outlook בעברית)", () => {
    expect(decodeRfc2047("=?windows-1255?Q?=FA=F7=EC=E4_=E1=E3=E9=F8=E4?=")).toBe("תקלה בדירה");
  });

  it("EM-01 — windows-1255 בקידוד B", () => {
    expect(decodeRfc2047("=?Windows-1255?B?+vfs5CDh4+n45A==?=")).toBe("תקלה בדירה");
  });

  it.each([["iso-8859-8"], ["ISO-8859-8-I"]])("EM-01 — %s בקידוד Q (לקוחות ישנים)", (charset) => {
    expect(decodeRfc2047(`=?${charset}?Q?=FA=F7=EC=E4?=`)).toBe("תקלה");
  });

  it("EM-01 — b/q באותיות קטנות", () => {
    expect(decodeRfc2047("=?utf-8?b?16rXp9ec15Q=?=")).toBe("תקלה");
    expect(decodeRfc2047("=?utf-8?q?abc?=")).toBe("abc");
  });

  it("EM-01 — רווח בין שתי מילים מקודדות סמוכות נמחק (RFC 2047 §6.2)", () => {
    expect(decodeRfc2047("=?UTF-8?B?16rXp9ec15Q=?= =?UTF-8?B?IA==?=\r\n =?UTF-8?Q?12?=")).toBe("תקלה 12");
  });

  it("EM-01 — תו UTF-8 שנחצה בין שתי מילים מקודדות מפוענח שלם", () => {
    // שלושת הבתים הראשונים הם ת׳ ובית ראשון של ק׳ — מקודדים מפצלים כך כותרות ארוכות.
    expect(decodeRfc2047("=?UTF-8?B?16rX?= =?UTF-8?B?p9ec15Qg15HXk9eZ16jXlA==?=")).toBe("תקלה בדירה");
  });

  it("EM-01 — שתי מילים סמוכות בשני קידודים שונים", () => {
    expect(decodeRfc2047("=?windows-1255?Q?=FA=F7=EC=E4?= =?UTF-8?Q?_12?=")).toBe("תקלה 12");
  });

  it("EM-01 — טקסט רגיל סביב מילה מקודדת נשמר, כולל הרווחים שלצידה", () => {
    expect(decodeRfc2047("RE: =?UTF-8?B?16rXp9ec15Q=?= בדירה 12")).toBe("RE: תקלה בדירה 12");
  });

  it("EM-01 — תגית שפה (RFC 2231) אחרי ה-charset", () => {
    expect(decodeRfc2047("=?UTF-8*he?B?16rXp9ec15Q=?=")).toBe("תקלה");
  });

  it("EM-01 — קידוד Q עם תו שמור מקודד (=3F הוא סימן שאלה)", () => {
    expect(decodeRfc2047("=?UTF-8?Q?=D7=AA=D7=A7=D7=9C=D7=94=3F?=")).toBe("תקלה?");
  });

  it("EM-01 — charset לא מוכר — המילה נשארת כמות שהיא, והרווח שלצידה נשמר כטקסט רגיל", () => {
    expect(decodeRfc2047("=?x-unknown?B?YWJj?=")).toBe("=?x-unknown?B?YWJj?=");
    expect(decodeRfc2047("RE: =?x-unknown?B?YWJj?= =?UTF-8?Q?ok?=")).toBe("RE: =?x-unknown?B?YWJj?= ok");
  });

  it("EM-01 — תו בקרה (ירידת שורה) שפוענח ממילה מקודדת הופך לרווח — כותרת היא שורה אחת", () => {
    // =0D=0A בתוך הכותרת היה מגיע כך לכותרת Subject של המייל החוזר.
    expect(decodeRfc2047("=?UTF-8?Q?a=0D=0ABcc:_x@evil.example?=")).toBe("a  Bcc: x@evil.example");
  });

  it("EM-01 — קידוד פגום — המילה נשארת כמות שהיא", () => {
    expect(decodeRfc2047("=?UTF-8?B?not*base64?=")).toBe("=?UTF-8?B?not*base64?=");
    expect(decodeRfc2047("=?UTF-8?Q?=ZZ?=")).toBe("=?UTF-8?Q?=ZZ?=");
    expect(decodeRfc2047("=?UTF-8?X?abc?=")).toBe("=?UTF-8?X?abc?=");
  });

  it.each([["תקלה בדירה 12"], ["a =? b ?= c"], [""], ["Fwd: price = 5?"]])(
    "EM-01 — טקסט שכבר מפוענח אינו משתנה: \"%s\"",
    (input) => {
      expect(decodeRfc2047(input)).toBe(input);
    },
  );
});

describe("parseAddressList", () => {
  it("EM-04 — שם עם פסיק בתוך מירכאות אינו מפצל את הרשימה", () => {
    expect(parseAddressList("\"Cohen, Yossi\" <Yossi@Example.co.il>")).toEqual([
      { address: "yossi@example.co.il", name: "Cohen, Yossi" },
    ]);
  });

  it("EM-04 — הכתובת מנורמלת (אותיות קטנות, בלי רווחים)", () => {
    expect(parseAddress("Yossi Cohen < YOSSI@Example.CO.IL >")).toEqual({
      address: "yossi@example.co.il",
      name: "Yossi Cohen",
    });
  });

  it("EM-04 — כתובת בלי שם, עם ובלי סוגריים משולשים", () => {
    expect(parseAddressList("yossi@example.co.il")).toEqual([{ address: "yossi@example.co.il", name: null }]);
    expect(parseAddressList("<yossi@example.co.il>")).toEqual([{ address: "yossi@example.co.il", name: null }]);
  });

  it("EM-04 — רשימה מעורבת, מקופלת על כמה שורות", () => {
    expect(
      parseAddressList("\"Cohen, Yossi\" <a@example.co.il>,\r\n Dana Levi <d@example.co.il>, e@example.co.il"),
    ).toEqual([
      { address: "a@example.co.il", name: "Cohen, Yossi" },
      { address: "d@example.co.il", name: "Dana Levi" },
      { address: "e@example.co.il", name: null },
    ]);
  });

  it("EM-04 — שם עברי בלי מירכאות", () => {
    expect(parseAddress("יוסי כהן <yossi@example.co.il>")).toEqual({
      address: "yossi@example.co.il",
      name: "יוסי כהן",
    });
  });

  it("EM-04 — שם מקודד RFC 2047, עם ובלי מירכאות", () => {
    expect(parseAddress("=?UTF-8?B?15nXldeh15kg15vXlNef?= <yossi@example.co.il>")?.name).toBe("יוסי כהן");
    expect(parseAddress("\"=?UTF-8?B?15nXldeh15kg15vXlNef?=\" <yossi@example.co.il>")?.name).toBe("יוסי כהן");
  });

  it("EM-04 — שם מקודד windows-1255 (Outlook בעברית)", () => {
    expect(parseAddress("=?windows-1255?B?6eXx6SDr5O8=?= <Yossi@Example.co.il>")).toEqual({
      address: "yossi@example.co.il",
      name: "יוסי כהן",
    });
  });

  it("EM-04 — שם מקודד שמכיל פסיק אינו מפצל את הרשימה (מפוענח רק אחרי הפיצול)", () => {
    expect(parseAddressList("=?UTF-8?B?15vXlNefLCDXmdeV16HXmQ==?= <yossi@example.co.il>, b@example.co.il")).toEqual([
      { address: "yossi@example.co.il", name: "כהן, יוסי" },
      { address: "b@example.co.il", name: null },
    ]);
  });

  it("EM-04 — תחביר קבוצה: החברים נקלטים, שם הקבוצה לא", () => {
    expect(parseAddressList("team: a@example.co.il, \"B, C\" <b@example.co.il>;, d@example.co.il")).toEqual([
      { address: "a@example.co.il", name: null },
      { address: "b@example.co.il", name: "B, C" },
      { address: "d@example.co.il", name: null },
    ]);
  });

  it("EM-04 — קבוצה ריקה (undisclosed-recipients) ← רשימה ריקה", () => {
    expect(parseAddressList("undisclosed-recipients:;")).toEqual([]);
  });

  it("EM-04 — רשומות לא חוקיות מדולגות, החוקיות נשארות", () => {
    expect(parseAddressList("not-an-address, a@example.co.il, <broken>, Name Only, @x.com, b@")).toEqual([
      { address: "a@example.co.il", name: null },
    ]);
  });

  it("EM-04 — הערה בסוגריים משמשת כשם כשאין שם אחר (תחביר ישן)", () => {
    expect(parseAddress("yossi@example.co.il (Yossi Cohen)")).toEqual({
      address: "yossi@example.co.il",
      name: "Yossi Cohen",
    });
    expect(parseAddress("Yossi <yossi@example.co.il> (work)")).toEqual({
      address: "yossi@example.co.il",
      name: "Yossi",
    });
  });

  it("EM-04 — מירכאות מוברחות בתוך השם", () => {
    expect(parseAddress("\"Yossi \\\"The Plumber\\\" Cohen\" <yossi@example.co.il>")?.name).toBe(
      "Yossi \"The Plumber\" Cohen",
    );
  });

  it("EM-04 — שם במירכאות בודדות (Outlook) והשם שהוא הכתובת עצמה", () => {
    expect(parseAddress("'Yossi Cohen' <yossi@example.co.il>")?.name).toBe("Yossi Cohen");
    expect(parseAddress("\"a@example.co.il\" <b@example.co.il>")).toEqual({
      address: "b@example.co.il",
      name: "a@example.co.il",
    });
  });

  it("EM-04 — נקודה-פסיק כמפריד, ופסיק בסוף הרשימה", () => {
    expect(parseAddressList("a@example.co.il; b@example.co.il,").map((a) => a.address)).toEqual([
      "a@example.co.il",
      "b@example.co.il",
    ]);
  });

  it("EM-04 — שם ריק במירכאות ← name null", () => {
    expect(parseAddress("\"\" <yossi@example.co.il>")).toEqual({ address: "yossi@example.co.il", name: null });
  });

  it("EM-04 — גרשיים בשם עברי שכבר פוענח (בע\"מ, עו\"ד) אינם פותחים מירכאות ואינם מעלימים את הכתובת", () => {
    // שם מקודד RFC 2047 שפוענח לפני הקריאה (בידי Gmail או בידי המתאם) מגיע בלי
    // מירכאות סביבו. ה-" שבתוך בע"מ נקרא אז כפתיחת שם שלא נסגר, והשולח לא זוהה.
    expect(parseAddress("משה לוי בע\"מ <Moshe@Example.co.il>")).toEqual({
      address: "moshe@example.co.il",
      name: "משה לוי בע\"מ",
    });
    expect(parseAddressList("אחזקות בע\"מ <a@example.co.il>, עו\"ד דנה לוי <d@example.co.il>")).toEqual([
      { address: "a@example.co.il", name: "אחזקות בע\"מ" },
      { address: "d@example.co.il", name: "עו\"ד דנה לוי" },
    ]);
    expect(parseAddress("\"ד\"ר יוסי כהן\" <y@example.co.il>")).toEqual({ address: "y@example.co.il", name: "ד\"ר יוסי כהן" });
  });

  it("EM-04 — מירכאות שלא נסגרו אינן בולעות את הכתובת שאחריהן ואת שאר הרשימה", () => {
    expect(parseAddress("Yossi \"The Plumber <yossi@example.co.il>")).toEqual({
      address: "yossi@example.co.il",
      name: "Yossi \"The Plumber",
    });
    expect(parseAddressList("\"Yossi <y@example.co.il>, b@example.co.il").map((a) => a.address)).toEqual([
      "y@example.co.il",
      "b@example.co.il",
    ]);
  });

  it("EM-04 — כותרת עוינת עם אלפי מירכאות מוברחות אינה מפילה את הקליטה ואינה איטית", () => {
    // שחרור מירכאות אחת בכל סריקה חוזרת היה ריבועי ורקורסיבי: על קלט כזה
    // הוא נכשל בחריגת מחסנית, והמייל הזה היה מפיל כל ריצת קליטה.
    const hostile = "\"\\".repeat(20_000) + " <yossi@example.co.il>";
    const started = performance.now();
    expect(parseAddress(hostile)?.address).toBe("yossi@example.co.il");
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it.each([[""], ["   "], [null], [undefined]])("EM-04 — ריק (%s) ← רשימה ריקה", (input) => {
    expect(parseAddressList(input)).toEqual([]);
    expect(parseAddress(input)).toBeNull();
  });
});

describe("parseAddress", () => {
  it("EM-04 — הכתובת החוקית הראשונה", () => {
    expect(parseAddress("broken, Dana <d@example.co.il>, e@example.co.il")).toEqual({
      address: "d@example.co.il",
      name: "Dana",
    });
  });

  it("EM-04 — אין כתובת חוקית ← null", () => {
    expect(parseAddress("MAILER-DAEMON")).toBeNull();
  });
});
