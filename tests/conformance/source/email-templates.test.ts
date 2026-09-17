import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EMAIL_REPLY_SPEC as SPEC } from "../../../conformance/fixtures/spec-text";
import { composeIntakeReply, type ComposeIntakeReplyInput } from "@/lib/email-intake/reply/compose";

/**
 * "המיילים היוצאים לשולח" (סוף §4) — המייל המורכב מול נוסח האפיון.
 *
 * **הכלל של המטריצה: משווים לנוסח שהועתק מהאפיון, לעולם לא ל-`he.ts`.**
 * בדיקה שמייבאת את המחרוזת מהקוד מוכיחה רק שהקוד עקבי עם עצמו.
 *
 * `htmlText` מוודא שגם ה-HTML אומר את הנוסח ולא רק הטקסט: שני הפורמטים
 * נגזרים מאותו מבנה, אבל מה שהשולח קורא ב-Gmail הוא ה-HTML.
 */

const LINK = "https://yy.example/tickets/abc";

/** טקסט הקריאה של ה-HTML: תגיות החוצה, `<br>` ופסקאות לירידות שורה */
function htmlText(html: string): string {
  return html
    .replace(/<\/p><p[^>]*>/g, "\n\n")
    .replace(/<br>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** המייל, כטקסט וכ-HTML, מכיל את השורה כלשונה */
function expectBoth(input: ComposeIntakeReplyInput, line: string) {
  const { text, html } = composeIntakeReply(input);
  expect(text).toContain(line);
  expect(htmlText(html)).toContain(line);
}

/**
 * הדוגמה של המייל הכללי (שורות 534–552), עם הערכים שהאפיון עצמו בחר.
 *
 * הדוגמה היא תשובה, והסיכום נבנה כך שיהיה עקבי איתה: הנמענים ריקים ("חסר:
 * נמענים", ו"יוסי" לא הוכרע); החדר כבר "חדר רחצה" (עודכן); הדירה נשארה 12
 * (סתירה); והתחום "חשמל" נקבע קודם — "מיזוג" שלא נמצא אינו מוחק אותו.
 */
const EXAMPLE: ComposeIntakeReplyInput = {
  kind: "DRAFT",
  recipientName: "דנה",
  originalSubject: "תקלה בדירה 12",
  isReply: true,
  summary: {
    site: "נווה שאנן",
    building: "בניין א",
    apartment: "12",
    room: "חדר רחצה",
    domain: "חשמל",
    description: "נזילה מהתקרה",
    recipients: [],
  },
  missing: ["RECIPIENTS"],
  conflicts: [{ field: "APARTMENT", emailValue: "14", systemValue: "12" }],
  report: {
    updated: [{ field: "ROOM", before: "מטבח", after: "חדר רחצה" }],
    notFound: [{ field: "DOMAIN", written: "מיזוג", options: ["חשמל", "אינסטלציה", "אלומיניום"] }],
    ambiguous: [{ field: "RECIPIENTS", written: "יוסי", matches: ["יוסי כהן", "יוסי לוי"] }],
  },
  draftLink: LINK,
};

describe("הנוסח ב-spec-text הועתק מהאפיון כלשונו", () => {
  // שומר על הבדיקות שמתחת: טעות העתקה בקובץ הנוסחים הייתה הופכת כל השוואה
  // מולו לבדיקה של הטעות. ההדגשות (`**`) אינן חלק מהנוסח.
  const document = readFileSync(join(process.cwd(), "docs", "specs", "ticket-control-pre-plan.md"), "utf8").replaceAll(
    "**",
    "",
  );
  const value = "[ערך]";

  it.each([
    ["ברכה", SPEC.greeting("[שם]")],
    ["קבלה", SPEC.received],
    ["כותרת הסיכום", SPEC.currentHeading],
    [
      "שורת הסיכום",
      SPEC.summaryLine({ site: value, building: value, apartment: value, room: value, domain: value, recipients: value }),
    ],
    ["תיאור", SPEC.descriptionLine(value)],
    ["עודכן", SPEC.updatedExample],
    ["חסר", SPEC.missingExample],
    ["לא נמצא", SPEC.notFoundExample],
    ["כמה התאמות", SPEC.ambiguousExample],
    ["סותר", SPEC.conflictExample],
    ["איך משלימים", SPEC.howTo("[קישור לטיוטה]")],
    ["כל הפרטים זוהו", SPEC.ready("[קישור]")],
    ["כבר נשלחה", SPEC.afterDispatch("[מספר]", "[קישור]")],
    ["נמחקה", SPEC.afterDeletion],
    ["חילוץ לא זמין", SPEC.extractionUnavailable("[קישור]")],
    ["חילוץ לא זמין — תשובה", SPEC.extractionUnavailableReply("[קישור]")],
    ["אין הרשאה", SPEC.notPermitted("[שם השולח]")],
    ["בלי אתר", SPEC.noSite],
    ["§7 שורה 72", SPEC.missingSiteWithOptions("…")],
  ])("EM-L01…EM-L09, EM-A02, EM-A03 — %s", (_name, line) => {
    expect(document).toContain(line);
  });
});

describe("EM-L01 — המייל הכללי, מול הדוגמה שבאפיון", () => {
  it("EM-L01 — ברכה והודעת הקבלה", () => {
    expectBoth(EXAMPLE, `${SPEC.greeting("דנה")}\n\n${SPEC.received}`);
  });

  it("EM-L01 — 'מה יש בטיוטה עכשיו' עם כל השדות ושורת התיאור", () => {
    expectBoth(
      EXAMPLE,
      [
        SPEC.currentHeading,
        SPEC.summaryLine({
          site: "נווה שאנן",
          building: "בניין א",
          apartment: "12",
          room: "חדר רחצה",
          domain: "חשמל",
          recipients: SPEC.emptyValue,
        }),
        SPEC.descriptionLine("נזילה מהתקרה"),
      ].join("\n"),
    );
  });

  it.each([
    ["עודכן מהתשובה שלך", SPEC.updatedExample],
    ["חסר", SPEC.missingExample],
    ["EM-L02 — לא נמצא ברשימה", SPEC.notFoundExample],
    ["EM-L03 — נמצאו כמה התאמות", SPEC.ambiguousExample],
    ["סותר את מה שנקבע במערכת", SPEC.conflictExample],
    ["איך משלימים", SPEC.howTo(LINK)],
  ])("EM-L01 — %s", (_name, line) => {
    expectBoth(EXAMPLE, line);
  });

  it("EM-L01 — החלקים בסדר שבאפיון", () => {
    const { text } = composeIntakeReply(EXAMPLE);
    const order = [
      SPEC.received,
      SPEC.currentHeading,
      SPEC.updatedHeading,
      SPEC.missingHeading,
      SPEC.notFoundHeading,
      SPEC.ambiguousHeading,
      SPEC.conflictHeading,
      SPEC.howToHeading,
    ].map((line) => text.indexOf(line));

    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("EM-L01 — 'עודכן מהתשובה שלך' רק במייל שעונה על תשובה", () => {
    expect(composeIntakeReply({ ...EXAMPLE, isReply: false }).text).not.toContain(SPEC.updatedHeading);
  });
});

describe("EM-A02 / EM-A03 — הנחות 1.3.1", () => {
  it("EM-A02 — טיוטה ריקה: כל השדות, באותו סדר, וריק הוא '—'", () => {
    const empty = SPEC.emptyValue;
    expectBoth(
      {
        ...EXAMPLE,
        isReply: false,
        summary: {
          site: null,
          building: null,
          apartment: null,
          room: null,
          domain: null,
          description: null,
          recipients: [],
        },
        report: undefined,
      },
      [
        SPEC.summaryLine({
          site: empty,
          building: empty,
          apartment: empty,
          room: empty,
          domain: empty,
          recipients: empty,
        }),
        SPEC.descriptionLine(empty),
      ].join("\n"),
    );
  });

  it("EM-A03 — טיוטה בלי אתר: 'חסר: אתר. האתרים הקיימים: …'", () => {
    expectBoth(
      { ...EXAMPLE, missing: ["SITE"], siteOptions: ["נווה שאנן", "רמת אביב"] },
      SPEC.missingSiteWithOptions("נווה שאנן, רמת אביב."),
    );
  });
});

describe("EM-L04 — כשלא חסר דבר ואין סתירה", () => {
  const complete: ComposeIntakeReplyInput = {
    ...EXAMPLE,
    isReply: false,
    summary: { ...EXAMPLE.summary!, domain: "אינסטלציה", recipients: ["יוסי כהן"] },
    missing: [],
    conflicts: [],
    report: undefined,
  };

  it("EM-L04 — 'כל הפרטים זוהו' במקום 'איך משלימים'", () => {
    const { text } = composeIntakeReply(complete);

    expectBoth(complete, SPEC.ready(LINK));
    expect(text).not.toContain(SPEC.howToHeading);
    expect(text).toContain(SPEC.currentHeading);
  });

  it("EM-L04 — כשיש סתירה פתוחה המייל נשאר בנוסח הכללי, גם אם לא חסר דבר", () => {
    const withConflict = { ...complete, conflicts: EXAMPLE.conflicts };
    const { text } = composeIntakeReply(withConflict);

    expectBoth(withConflict, SPEC.howTo(LINK));
    expect(text).not.toContain(SPEC.ready(LINK));
  });
});

describe("מיילים למצבים מיוחדים", () => {
  const base = { recipientName: "דנה", originalSubject: "תקלה בדירה 12" };

  it.each<[string, ComposeIntakeReplyInput, string]>([
    ["EM-L05 — הטיוטה כבר נשלחה", { ...base, kind: "AFTER_DISPATCH", ticketSeq: 47, ticketLink: LINK }, SPEC.afterDispatch(47, LINK)],
    ["EM-L06 — הטיוטה נמחקה", { ...base, kind: "AFTER_DELETION" }, SPEC.afterDeletion],
    [
      "EM-L07 — החילוץ אינו זמין",
      { ...base, kind: "DRAFT", extractionUnavailable: true, draftLink: LINK },
      SPEC.extractionUnavailable(LINK),
    ],
    [
      "EM-L07 — החילוץ אינו זמין ומגיעה תשובה",
      { ...base, kind: "DRAFT", extractionUnavailable: true, isReply: true, draftLink: LINK },
      SPEC.extractionUnavailableReply(LINK),
    ],
    [
      "EM-L08 — משתמש מורשה שאינו רשאי לערוך",
      { ...base, kind: "NOT_PERMITTED", senderName: "רונית לוי" },
      SPEC.notPermitted("רונית לוי"),
    ],
    ["EM-L09 — מנהל עבודה שאינו משויך לאתר", { ...base, kind: "NO_SITE" }, SPEC.noSite],
  ])("%s", (_name, input, sentence) => {
    expectBoth(input, `${SPEC.greeting("דנה")}\n\n${sentence}`);
  });
});
