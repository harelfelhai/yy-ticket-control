import { describe, expect, it } from "vitest";
import {
  composeIntakeReply,
  selectTemplate,
  type ComposeIntakeReplyInput,
  type DraftSummary,
  type ReplyTemplate,
} from "@/lib/email-intake/reply/compose";
import type { IntakeReport } from "@/lib/email-intake/types";
import { he } from "@/lib/he";

/**
 * המבנה של המייל החוזר לשולח: אילו חלקים מופיעים, באיזה סדר, ומה קורה
 * בקצוות. הנוסח עצמו מול האפיון נבדק ב-`tests/conformance/source/
 * email-templates.test.ts`; כאן מותר להישען על `he.ts`, כי השאלה היא
 * ההרכבה ולא המילים.
 *
 * מייל שיצא אי אפשר להחזיר. "כל הפרטים זוהו" שנשלח על טיוטה חסרה אומר
 * לשולח שהכול מוכן — ולכן בחירת התבנית נבדקת כטבלה מלאה.
 */

const t = he.emailIntake;
const LINK = "https://yy.example/tickets/abc";

const FULL: DraftSummary = {
  site: "נווה שאנן",
  building: "בניין א",
  apartment: "12",
  room: "מטבח",
  domain: "אינסטלציה",
  description: "נזילה מתחת לכיור",
  recipients: ["יוסי כהן"],
};

const EMPTY: DraftSummary = {
  site: null,
  building: null,
  apartment: null,
  room: null,
  domain: null,
  description: null,
  recipients: [],
};

function report(overrides: Partial<IntakeReport> = {}): IntakeReport {
  return { updated: [], notFound: [], ambiguous: [], ...overrides };
}

function draft(overrides: Partial<ComposeIntakeReplyInput> = {}): ComposeIntakeReplyInput {
  return {
    kind: "DRAFT",
    recipientName: "דנה",
    originalSubject: "תקלה בדירה 12",
    summary: FULL,
    missing: [],
    conflicts: [],
    draftLink: LINK,
    ...overrides,
  };
}

/** כל חלק במייל הוא פסקה; פסקאות מופרדות בשורה ריקה */
function paragraphs(text: string): string[] {
  return text.split("\n\n");
}

/** הפסקה שנפתחת בכותרת, או undefined */
function section(text: string, heading: string): string | undefined {
  return paragraphs(text).find((paragraph) => paragraph.startsWith(heading));
}

/**
 * ה-HTML חזרה לטקסט: תגיות החוצה, `<br>` לירידת שורה, פסקאות לשורה ריקה.
 * `&amp;` אחרון — אחרת `&amp;lt;` היה נפתח פעמיים.
 */
function htmlToPlain(html: string): string {
  return html
    .replace(/<\/p><p[^>]*>/g, "\n\n")
    .replace(/<br>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

describe("selectTemplate — איזה מייל יוצא", () => {
  const cases: [string, ComposeIntakeReplyInput, ReplyTemplate][] = [
    ["EM-L09 — מנהל עבודה בלי אתר", { kind: "NO_SITE", recipientName: "דנה", originalSubject: "תקלה" }, "L09"],
    [
      "EM-L08 — משתמש מורשה שאינו רשאי לערוך",
      { kind: "NOT_PERMITTED", recipientName: "דנה", originalSubject: "תקלה", senderName: "רונית" },
      "L08",
    ],
    [
      "EM-L05 — הטיוטה כבר שוגרה",
      { kind: "AFTER_DISPATCH", recipientName: "דנה", originalSubject: "תקלה", ticketSeq: 47, ticketLink: LINK },
      "L05",
    ],
    ["EM-L06 — הטיוטה נמחקה", { kind: "AFTER_DELETION", recipientName: "דנה", originalSubject: "תקלה" }, "L06"],
    ["EM-L07 — החילוץ אינו זמין, מייל ראשון", draft({ extractionUnavailable: true }), "L07_FIRST"],
    ["EM-L07 — החילוץ אינו זמין, תשובה", draft({ extractionUnavailable: true, isReply: true }), "L07_REPLY"],
    [
      "EM-L07 — החילוץ אינו זמין גובר על שדות חסרים",
      draft({ extractionUnavailable: true, missing: ["BUILDING", "DOMAIN"] }),
      "L07_FIRST",
    ],
    ["EM-L04 — לא חסר דבר ואין סתירה", draft(), "L04"],
    ["EM-L04 — גם בתשובה", draft({ isReply: true }), "L04"],
    ["EM-L01 — חסר שדה", draft({ missing: ["APARTMENT"] }), "L01"],
    [
      "EM-L04 — סתירה פתוחה משאירה את הנוסח הכללי גם כשלא חסר דבר",
      draft({ conflicts: [{ field: "APARTMENT", emailValue: "14", systemValue: "12" }] }),
      "L01",
    ],
    ["EM-L01 — `missing` שלא הועבר אינו נחשב 'לא חסר דבר'", draft({ missing: undefined }), "L01"],
    ["EM-L01 — `conflicts` שלא הועבר אינו נחשב 'אין סתירה'", draft({ conflicts: undefined }), "L01"],
    [
      "EM-L09 — סוג המייל גובר על דגל החילוץ",
      { kind: "NO_SITE", recipientName: "דנה", originalSubject: "תקלה", extractionUnavailable: true },
      "L09",
    ],
  ];

  it.each(cases)("%s", (_name, input, expected) => {
    expect(selectTemplate(input)).toBe(expected);
    expect(composeIntakeReply(input).template).toBe(expected);
  });
});

describe("EM-L01 — המייל הכללי", () => {
  it("EM-L01 — פותח בברכה ובהודעת הקבלה, ו'מה יש בטיוטה עכשיו' מופיע תמיד", () => {
    const { text } = composeIntakeReply(draft({ missing: ["RECIPIENTS"], summary: EMPTY }));
    const [greeting, received, current] = paragraphs(text);

    expect(greeting).toBe("שלום דנה,");
    expect(received).toBe(`${t.received} ${t.notSentYet}`);
    expect(current.startsWith(`${t.currentHeading}\n`)).toBe(true);
  });

  it("EM-L01 — חלק בלי תוכן אינו מופיע", () => {
    const { text } = composeIntakeReply(draft({ missing: ["RECIPIENTS"], report: report() }));

    expect(section(text, t.missingHeading)).toBeDefined();
    for (const heading of [t.updatedHeading, t.notFoundHeading, t.ambiguousHeading, t.conflictHeading]) {
      expect(text).not.toContain(heading);
    }
    // חלק שהושמט אינו משאיר אחריו שורה ריקה כפולה
    expect(text).not.toMatch(/\n{3,}/);
    expect(paragraphs(text)).toHaveLength(5);
  });

  it("EM-L01 — כל החלקים, בסדר של האפיון", () => {
    const { text } = composeIntakeReply(
      draft({
        isReply: true,
        missing: ["RECIPIENTS"],
        conflicts: [{ field: "APARTMENT", emailValue: "14", systemValue: "12" }],
        report: report({
          updated: [{ field: "ROOM", before: "מטבח", after: "חדר רחצה" }],
          notFound: [{ field: "DOMAIN", written: "מיזוג", options: ["חשמל"] }],
          ambiguous: [{ field: "RECIPIENTS", written: "יוסי", matches: ["יוסי כהן", "יוסי לוי"] }],
        }),
      }),
    );

    const headings = [
      t.received,
      t.currentHeading,
      t.updatedHeading,
      t.missingHeading,
      t.notFoundHeading,
      t.ambiguousHeading,
      t.conflictHeading,
      t.howToHeading,
    ];
    const starts = headings.map((heading) => paragraphs(text).findIndex((p) => p.startsWith(heading)));
    expect(starts).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(paragraphs(text)).toHaveLength(9);
  });

  it("EM-L01 — 'איך משלימים' הוא האחרון ומסתיים בקישור לטיוטה", () => {
    const { text } = composeIntakeReply(draft({ missing: ["DOMAIN"] }));

    expect(paragraphs(text).at(-1)).toBe(`${t.howToHeading} ${t.howTo(LINK)}`);
    expect(text.endsWith(LINK)).toBe(true);
    expect(text).not.toContain(t.ready(LINK));
  });

  it("EM-L04 — כשהטיוטה שלמה, 'כל הפרטים זוהו' מחליף את 'איך משלימים' ושאר המייל נשאר", () => {
    const { text } = composeIntakeReply(draft());

    expect(paragraphs(text).at(-1)).toBe(t.ready(LINK));
    expect(text).not.toContain(t.howToHeading);
    expect(text).toContain(t.currentHeading);
    expect(text).toContain("אתר: נווה שאנן");
  });

  it("EM-L04 — דיווח על ערך שלא נמצא עדיין מופיע גם בטיוטה שלמה", () => {
    // ערך שלא נמצא משאיר שדה ריק — אבל יכול להיות שהשדה כבר מולא בתשובה
    // קודמת. מה שהשולח כתב ולא נקלט עדיין שייך למייל.
    const { text, template } = composeIntakeReply(
      draft({ report: report({ notFound: [{ field: "ROOM", written: "מחסן", options: null }] }) }),
    );

    expect(template).toBe("L04");
    expect(section(text, t.notFoundHeading)).toBe('לא נמצא ברשימה: חדר: כתבת "מחסן".');
  });
});

describe("EM-A02 — שורת 'מה יש בטיוטה עכשיו'", () => {
  it("EM-A02 — טיוטה ריקה: כל השדות מוצגים, וריק הוא '—'", () => {
    const { text } = composeIntakeReply(draft({ summary: EMPTY, missing: ["SITE"] }));

    expect(section(text, t.currentHeading)).toBe(
      [t.currentHeading, "אתר: — · בניין: — · דירה: — · חדר: — · תחום: — · נמענים: —", "תיאור: —"].join("\n"),
    );
  });

  it("EM-A02 — טיוטה חלקית: הסדר קבוע, והשדות הריקים במקומם", () => {
    const { text } = composeIntakeReply(
      draft({
        summary: { ...EMPTY, building: "בניין ב", domain: "חשמל", recipients: ["יוסי כהן", "רונית לוי"] },
        missing: ["SITE"],
      }),
    );

    expect(text).toContain("אתר: — · בניין: בניין ב · דירה: — · חדר: — · תחום: חשמל · נמענים: יוסי כהן, רונית לוי");
  });

  it("EM-A02 — ערך של רווחים בלבד נחשב ריק", () => {
    const { text } = composeIntakeReply(draft({ summary: { ...FULL, room: "  ", description: " \n " } }));

    expect(text).toContain("חדר: — ·");
    expect(text).toContain("תיאור: —");
  });

  it("EM-A02 — תיאור בכמה שורות נשמר כפי שנכתב", () => {
    const { text, html } = composeIntakeReply(draft({ summary: { ...FULL, description: "נזילה בכיור\nוגם רטיבות בקיר" } }));

    expect(text).toContain("תיאור: נזילה בכיור\nוגם רטיבות בקיר");
    expect(html).toContain("תיאור: נזילה בכיור<br>וגם רטיבות בקיר");
  });

  it("EM-A02 — ירידת שורה בתוך שם של רשומה אינה שוברת את שורת הסיכום", () => {
    const { text } = composeIntakeReply(draft({ summary: { ...FULL, building: "בניין\nא" } }));

    expect(text).toContain("· בניין: בניין א ·");
  });
});

describe("עודכן מהתשובה שלך", () => {
  const updated = report({ updated: [{ field: "ROOM", before: "מטבח", after: "חדר רחצה" }] });

  it("EM-L01 — מופיע רק במייל שעונה על תשובה", () => {
    expect(composeIntakeReply(draft({ report: updated, isReply: false })).text).not.toContain(t.updatedHeading);
    expect(section(composeIntakeReply(draft({ report: updated, isReply: true })).text, t.updatedHeading)).toBe(
      "עודכן מהתשובה שלך: חדר (מטבח ← חדר רחצה)",
    );
  });

  it("EM-L01 — תשובה שלא שינתה דבר אינה מציגה את החלק", () => {
    expect(composeIntakeReply(draft({ report: report(), isReply: true })).text).not.toContain(t.updatedHeading);
  });

  it("EM-A02 — שדה שהיה ריק או התאפס מוצג כ-'—', והפריטים בסדר השדות", () => {
    const { text } = composeIntakeReply(
      draft({
        isReply: true,
        report: report({
          updated: [
            { field: "APARTMENT", before: "12", after: null },
            { field: "BUILDING", before: null, after: "בניין ב" },
          ],
        }),
      }),
    );

    expect(section(text, t.updatedHeading)).toBe("עודכן מהתשובה שלך: בניין (— ← בניין ב), דירה (12 ← —)");
  });
});

describe("חסר — EM-A03", () => {
  it("EM-L01 — השדות בסדר הטיוטה, בלי כפילויות, והנמענים עם ההסבר", () => {
    const { text } = composeIntakeReply(draft({ missing: ["RECIPIENTS", "BUILDING", "BUILDING"] }));

    expect(section(text, t.missingHeading)).toBe("חסר: בניין, נמענים (מי יטפל בתקלה)");
  });

  it("EM-A03 — אתר חסר: רשימת האתרים באותו מבנה כמו 'לא נמצא ברשימה'", () => {
    const { text } = composeIntakeReply(draft({ missing: ["SITE"], siteOptions: ["נווה שאנן", "רמת אביב"] }));

    expect(section(text, t.missingHeading)).toBe("חסר: אתר. האתרים הקיימים: נווה שאנן, רמת אביב.");
  });

  it("EM-A03 — אתר חסר לצד שדות נוספים: הרשימה אחרי כל השדות, לא באמצעם", () => {
    // בטיוטה בלי אתר גם הבניין והדירה ריקים תמיד. רשימת האתרים באמצע
    // ("אתר. האתרים הקיימים: א, ב. בניין, דירה") נקראת כאילו הבניין הוא אתר.
    const { text } = composeIntakeReply(
      draft({ missing: ["APARTMENT", "SITE", "BUILDING", "RECIPIENTS"], siteOptions: ["נווה שאנן"] }),
    );

    expect(section(text, t.missingHeading)).toBe(
      "חסר: אתר, בניין, דירה, נמענים (מי יטפל בתקלה). האתרים הקיימים: נווה שאנן.",
    );
  });

  it("EM-A03 — רשימת אתרים שהועברה כשהאתר אינו חסר — אינה מוצגת", () => {
    const { text } = composeIntakeReply(draft({ missing: ["DOMAIN"], siteOptions: ["נווה שאנן"] }));

    expect(section(text, t.missingHeading)).toBe("חסר: תחום");
  });

  it("EM-A03 — אתר שנכתב ולא נמצא: הרשימה מופיעה רק תחת 'לא נמצא ברשימה', לא פעמיים", () => {
    const { text } = composeIntakeReply(
      draft({
        missing: ["SITE", "BUILDING"],
        siteOptions: ["נווה שאנן", "רמת אביב"],
        report: report({ notFound: [{ field: "SITE", written: "גבעת שמואל", options: ["נווה שאנן", "רמת אביב"] }] }),
      }),
    );

    expect(section(text, t.missingHeading)).toBe("חסר: אתר, בניין");
    expect(section(text, t.notFoundHeading)).toBe(
      'לא נמצא ברשימה: אתר: כתבת "גבעת שמואל". האתרים הקיימים: נווה שאנן, רמת אביב.',
    );
  });

  it("EM-A03 — אין אתרים להציג: 'חסר: אתר' בלי משפט ריק", () => {
    expect(section(composeIntakeReply(draft({ missing: ["SITE"], siteOptions: [] })).text, t.missingHeading)).toBe(
      "חסר: אתר",
    );
    expect(section(composeIntakeReply(draft({ missing: ["SITE"] })).text, t.missingHeading)).toBe("חסר: אתר");
  });
});

describe("לא נמצא ברשימה — EM-L02", () => {
  it.each([
    ["SITE", "האתרים הקיימים"],
    ["BUILDING", "הבניינים הקיימים"],
    ["DOMAIN", "התחומים הקיימים"],
  ] as const)("EM-L02 — %s מקבל את רשימת האפשרויות", (field, heading) => {
    const { text } = composeIntakeReply(
      draft({ report: report({ notFound: [{ field, written: "ג", options: ["א", "ב"] }] }) }),
    );

    expect(section(text, t.notFoundHeading)).toContain(`כתבת "ג". ${heading}: א, ב.`);
  });

  it.each(["APARTMENT", "RECIPIENTS"] as const)(
    "EM-L02 — %s אינו מקבל רשימה, גם אם הועברה",
    (field) => {
      const { text } = composeIntakeReply(
        draft({ report: report({ notFound: [{ field, written: "99", options: ["1", "2"] }] }) }),
      );

      expect(section(text, t.notFoundHeading)).toMatch(/: כתבת "99"\.$/);
    },
  );

  it("EM-L02 — רשימה ריקה או חסרה אינה מייצרת משפט ריק", () => {
    const { text } = composeIntakeReply(
      draft({
        report: report({
          notFound: [
            { field: "BUILDING", written: "ג", options: [] },
            { field: "DOMAIN", written: "מיזוג", options: null },
          ],
        }),
      }),
    );

    expect(section(text, t.notFoundHeading)).toBe('לא נמצא ברשימה: בניין: כתבת "ג". תחום: כתבת "מיזוג".');
  });

  it("EM-L02 — אפשרות אחת: הכותרת נשארת ברבים (האפיון אינו נותן צורת יחיד)", () => {
    const { text } = composeIntakeReply(
      draft({ report: report({ notFound: [{ field: "DOMAIN", written: "מיזוג", options: ["חשמל"] }] }) }),
    );

    expect(text).toContain("התחומים הקיימים: חשמל.");
  });

  it("EM-L02 — כמה פריטים: בסדר השדות, ושני נמענים שלא נמצאו שומרים על הסדר שבו נכתבו", () => {
    const { text } = composeIntakeReply(
      draft({
        report: report({
          notFound: [
            { field: "RECIPIENTS", written: "משה", options: null },
            { field: "DOMAIN", written: "מיזוג", options: null },
            { field: "RECIPIENTS", written: "אבי", options: null },
          ],
        }),
      }),
    );

    expect(section(text, t.notFoundHeading)).toBe(
      'לא נמצא ברשימה: תחום: כתבת "מיזוג". נמענים: כתבת "משה". נמענים: כתבת "אבי".',
    );
  });

  it("EM-L02 — ירידת שורה במה שהשולח כתב מכווצת לרווח", () => {
    const { text } = composeIntakeReply(
      draft({ report: report({ notFound: [{ field: "RECIPIENTS", written: " יוסי\n כהן ", options: null }] }) }),
    );

    expect(text).toContain('נמענים: כתבת "יוסי כהן".');
  });
});

describe("נמצאו כמה התאמות — EM-L03", () => {
  it("EM-L03 — כל שדה עם ההתאמות שלו, וההנחיה פעם אחת בסוף", () => {
    const { text } = composeIntakeReply(
      draft({
        report: report({
          ambiguous: [
            { field: "RECIPIENTS", written: "יוסי", matches: ["יוסי כהן", "יוסי לוי"] },
            { field: "BUILDING", written: "א", matches: ["בניין א", "בניין א1"] },
          ],
        }),
      }),
    );

    expect(section(text, t.ambiguousHeading)).toBe(
      'נמצאו כמה התאמות: בניין: כתבת "א" — בניין א, בניין א1. נמענים: כתבת "יוסי" — יוסי כהן, יוסי לוי. כתבו בתשובה את השם המלא.',
    );
  });
});

describe("סותר את מה שנקבע במערכת", () => {
  it("EM-L01 — כל שדה בסתירה, ו'ההכרעה תיעשה במערכת' פעם אחת", () => {
    const { text } = composeIntakeReply(
      draft({
        conflicts: [
          { field: "ROOM", emailValue: "מטבח", systemValue: "" },
          { field: "APARTMENT", emailValue: "14", systemValue: "12" },
        ],
      }),
    );

    expect(section(text, t.conflictHeading)).toBe(
      "סותר את מה שנקבע במערכת: דירה: במייל 14, במערכת 12. חדר: במייל מטבח, במערכת —. ההכרעה תיעשה במערכת.",
    );
    expect(text.match(new RegExp(t.conflictHint, "g"))).toHaveLength(1);
  });
});

describe("מיילים למצבים מיוחדים — EM-L05…EM-L09", () => {
  const special: [string, ComposeIntakeReplyInput, string][] = [
    [
      "EM-L05",
      { kind: "AFTER_DISPATCH", recipientName: "דנה", originalSubject: "תקלה", ticketSeq: 47, ticketLink: LINK },
      t.afterDispatch(47, LINK),
    ],
    ["EM-L06", { kind: "AFTER_DELETION", recipientName: "דנה", originalSubject: "תקלה" }, t.afterDeletion],
    ["EM-L07 מייל ראשון", draft({ extractionUnavailable: true }), t.extractionUnavailableFirst(LINK)],
    ["EM-L07 תשובה", draft({ extractionUnavailable: true, isReply: true }), t.extractionUnavailableReply(LINK)],
    [
      "EM-L08",
      { kind: "NOT_PERMITTED", recipientName: "דנה", originalSubject: "תקלה", senderName: "רונית" },
      t.notPermitted("רונית"),
    ],
    ["EM-L09", { kind: "NO_SITE", recipientName: "דנה", originalSubject: "תקלה" }, t.noSite],
  ];

  it.each(special)("%s — ברכה ומשפט אחד, בלי סיכום הטיוטה", (_id, input, sentence) => {
    const { text } = composeIntakeReply({
      ...input,
      // גם כשהשכבה שמעל מעבירה סיכום ודיווח, המייל הזה אינו מציג אותם
      summary: FULL,
      report: report({ notFound: [{ field: "DOMAIN", written: "מיזוג", options: null }] }),
      missing: ["DOMAIN"],
    });

    expect(paragraphs(text)).toEqual(["שלום דנה,", sentence]);
  });
});

describe("כותרת המייל", () => {
  it.each([
    ["תקלה בדירה 12", "Re: תקלה בדירה 12"],
    ["Fwd: תקלה", "Re: Fwd: תקלה"],
    ["Re: תקלה", "Re: תקלה"],
    ["RE: תקלה", "RE: תקלה"],
    ["re: תקלה", "re: תקלה"],
    ["  תקלה  ", "Re: תקלה"],
    ["", "Re:"],
    // הכותרת נכנסת לכותרת MIME. ירידת שורה בתוכה הייתה פותחת כותרת נוספת.
    ["תקלה\r\nBcc: someone@example.com", "Re: תקלה Bcc: someone@example.com"],
  ])("EM-12 — '%s' ← '%s'", (original, expected) => {
    expect(composeIntakeReply(draft({ originalSubject: original })).subject).toBe(expected);
    expect(
      composeIntakeReply({ kind: "NO_SITE", recipientName: "דנה", originalSubject: original }).subject,
    ).toBe(expected);
  });
});

describe("HTML", () => {
  const everything = draft({
    isReply: true,
    missing: ["SITE", "RECIPIENTS"],
    siteOptions: ["נווה שאנן"],
    conflicts: [{ field: "APARTMENT", emailValue: "14", systemValue: "12" }],
    report: report({
      updated: [{ field: "ROOM", before: "מטבח", after: "חדר רחצה" }],
      notFound: [{ field: "DOMAIN", written: "מיזוג", options: ["חשמל"] }],
      ambiguous: [{ field: "RECIPIENTS", written: "יוסי", matches: ["יוסי כהן", "יוסי לוי"] }],
    }),
  });

  it("EM-L01 — מימין לשמאל, בסגנון מוטבע ובלי <style>", () => {
    const { html } = composeIntakeReply(everything);

    expect(html.startsWith('<div dir="rtl" lang="he" style="')).toBe(true);
    expect(html).toContain("text-align:right");
    expect(html).not.toContain("<style");
  });

  it("EM-L01 — כותרות החלקים ב-<strong>, והקישור לחיץ", () => {
    const { html } = composeIntakeReply(everything);

    for (const heading of [t.currentHeading, t.updatedHeading, t.missingHeading, t.conflictHeading, t.howToHeading]) {
      expect(html).toContain(`<strong>${heading}</strong>`);
    }
    expect(html).toContain(`<strong>${t.notSentYet}</strong>`);
    expect(html).toContain(`<a href="${LINK}">${LINK}</a>`);
  });

  it.each<[string, ComposeIntakeReplyInput]>([
    ["L01", everything],
    ["L04", draft()],
    ["L05", { kind: "AFTER_DISPATCH", recipientName: "דנה", originalSubject: "x", ticketSeq: 3, ticketLink: LINK }],
    ["L06", { kind: "AFTER_DELETION", recipientName: "דנה", originalSubject: "x" }],
    ["L07_FIRST", draft({ extractionUnavailable: true })],
    ["L07_REPLY", draft({ extractionUnavailable: true, isReply: true })],
    ["L08", { kind: "NOT_PERMITTED", recipientName: "דנה", originalSubject: "x", senderName: 'רונית "הבוסית"' }],
    ["L09", { kind: "NO_SITE", recipientName: "דנה", originalSubject: "x" }],
  ])("EM-%s — ה-HTML והטקסט נגזרים מאותו מבנה ואומרים אותו דבר", (_template, input) => {
    const { text, html } = composeIntakeReply(input);

    expect(htmlToPlain(html)).toBe(text);
  });

  it("EM-L01 — כל ערך דינמי עובר בריחה: תיאור, שם, מה שנכתב, התאמות ושם השולח", () => {
    const attack = '<script>alert("x")</script>';
    const draftMail = composeIntakeReply(
      draft({
        recipientName: attack,
        isReply: true,
        summary: { ...FULL, description: attack, recipients: [attack] },
        conflicts: [{ field: "APARTMENT", emailValue: attack, systemValue: "12" }],
        report: report({
          updated: [{ field: "ROOM", before: attack, after: "מטבח" }],
          notFound: [{ field: "DOMAIN", written: attack, options: [attack] }],
          ambiguous: [{ field: "RECIPIENTS", written: attack, matches: [attack, "יוסי לוי"] }],
        }),
      }),
    ).html;
    const notPermitted = composeIntakeReply({
      kind: "NOT_PERMITTED",
      recipientName: "דנה",
      originalSubject: "x",
      senderName: attack,
    }).html;

    for (const html of [draftMail, notPermitted]) {
      expect(html).not.toContain("<script");
      expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    }
  });

  it("EM-L01 — קישור עם תווים מיוחדים נמלט גם בתוך href", () => {
    const link = 'https://yy.example/tickets/abc?a=1&b="2"';
    const { html } = composeIntakeReply(draft({ draftLink: link }));

    expect(html).toContain(
      '<a href="https://yy.example/tickets/abc?a=1&amp;b=&quot;2&quot;">https://yy.example/tickets/abc?a=1&amp;b=&quot;2&quot;</a>',
    );
  });

  it("EM-L01 — קישור שאינו http(s) אינו הופך ל-<a>", () => {
    // הקישור נבנה מ-APP_URL ולא מקלט של משתמש, אבל ערך שגוי בהגדרה עדיין
    // לא אמור להפוך ל-`javascript:` לחיץ בתיבה של השולח.
    const { html, text } = composeIntakeReply(draft({ draftLink: "javascript:alert(1)" }));

    expect(html).not.toContain("<a ");
    expect(html).toContain("javascript:alert(1)");
    expect(text).toContain("javascript:alert(1)");
  });
});

describe("קלט שחסר לתבנית — כשל רועש ולא מייל שבור", () => {
  // מייל עם "undefined" במקום קישור נשלח לאדם אמיתי ואינו ניתן לתיקון.
  // חסר כזה הוא באג בשכבה שמעל, והוא חייב לעצור את השליחה.
  it.each<[string, ComposeIntakeReplyInput]>([
    ["L01 בלי סיכום", draft({ missing: ["DOMAIN"], summary: undefined })],
    ["L04 בלי קישור לטיוטה", draft({ draftLink: undefined })],
    ["L01 עם קישור ריק", draft({ missing: ["DOMAIN"], draftLink: "  " })],
    ["L07 בלי קישור לטיוטה", draft({ extractionUnavailable: true, draftLink: undefined })],
    ["L05 בלי מספר פנייה", { kind: "AFTER_DISPATCH", recipientName: "דנה", originalSubject: "x", ticketLink: LINK }],
    [
      "L05 עם מספר פנייה שאינו שלם",
      { kind: "AFTER_DISPATCH", recipientName: "דנה", originalSubject: "x", ticketSeq: 0, ticketLink: LINK },
    ],
    ["L05 בלי קישור לפנייה", { kind: "AFTER_DISPATCH", recipientName: "דנה", originalSubject: "x", ticketSeq: 4 }],
    ["L08 בלי שם השולח", { kind: "NOT_PERMITTED", recipientName: "דנה", originalSubject: "x" }],
    ["L08 עם שם שולח ריק", { kind: "NOT_PERMITTED", recipientName: "דנה", originalSubject: "x", senderName: " " }],
    [
      "L03 — 'נמצאו כמה התאמות' בלי התאמות",
      draft({ missing: ["RECIPIENTS"], report: report({ ambiguous: [{ field: "RECIPIENTS", written: "יוסי", matches: [] }] }) }),
    ],
    [
      "L03 — 'נמצאו כמה התאמות' עם התאמה אחת בלבד",
      draft({ missing: ["RECIPIENTS"], report: report({ ambiguous: [{ field: "RECIPIENTS", written: "יוסי", matches: ["יוסי כהן"] }] }) }),
    ],
  ])("EM-%s — זורק", (_name, input) => {
    expect(() => composeIntakeReply(input)).toThrow(/composeIntakeReply/);
  });

  it("EM-L01 — שם נמען ריק אינו מפיל: 'שלום,' בלי רווח יתום", () => {
    expect(paragraphs(composeIntakeReply(draft({ recipientName: "  " })).text)[0]).toBe("שלום,");
  });
});
