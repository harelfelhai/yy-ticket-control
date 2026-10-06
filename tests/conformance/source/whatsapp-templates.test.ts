import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WHATSAPP_REPLY_SPEC as SPEC } from "../../../conformance/fixtures/spec-text";
import type { IntakeReplyInput } from "@/lib/intake/reply-model";
import { composeWhatsappReply } from "@/lib/whatsapp/render";
import { MAX_TEXT_LENGTH } from "@/lib/whatsapp/send";

/**
 * "ההודעות היוצאות בוואטסאפ" (סוף §4, עדכון 1.4) — ההודעה המורכבת מול נוסח האפיון.
 *
 * **הכלל של המטריצה: משווים לנוסח שהועתק מהאפיון, לעולם לא ל-`he.ts`.** ההדגשה של
 * וואטסאפ (`*…*`) מוסרת לפני ההשוואה, כמו ש-`**` מוסר מהאפיון; שבה נבדקת בנפרד,
 * כי ההדגשה היא מה שמבדיל בהודעה ארוכה בין כותרת לתוכן.
 */

const LINK = "https://yy.example/tickets/abc";

/** הטקסט כפי שנקרא, בלי סימני ההדגשה של וואטסאפ */
function plain(text: string): string {
  return text.replaceAll("*", "");
}

function textOf(input: IntakeReplyInput): string {
  return composeWhatsappReply(input).text;
}

/**
 * הדוגמה של ההודעה הכללית (שורות 701–717), עם הערכים שהאפיון עצמו בחר — אותה
 * דוגמה של המייל (`email-templates.test.ts`), כי האפיון בחר בה את אותם ערכים.
 */
const EXAMPLE: IntakeReplyInput = {
  kind: "DRAFT",
  recipientName: "דנה",
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
  conflicts: [{ field: "APARTMENT", channelValue: "14", systemValue: "12" }],
  report: {
    updated: [{ field: "ROOM", before: "מטבח", after: "חדר רחצה" }],
    notFound: [{ field: "DOMAIN", written: "מיזוג", options: ["חשמל", "אינסטלציה", "אלומיניום"] }],
    ambiguous: [{ field: "RECIPIENTS", written: "יוסי", matches: ["יוסי כהן", "יוסי לוי"] }],
  },
  draftLink: LINK,
};

describe("הנוסח ב-spec-text הועתק מהאפיון כלשונו", () => {
  const document = readFileSync(join(process.cwd(), "docs", "specs", "ticket-control-pre-plan.md"), "utf8").replaceAll(
    "**",
    "",
  );
  const value = "[ערך]";

  it.each([
    ["פתיחה", SPEC.opening("[שם]")],
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
    ["חילוץ לא זמין — תגובה", SPEC.extractionUnavailableReply("[קישור]")],
    ["אין הרשאה", SPEC.notPermitted],
    ["בלי אתר", SPEC.noSite],
    ["הסבר חד-פעמי", SPEC.hint],
  ])("WA-L01…WA-L10 — %s", (_name, line) => {
    expect(document).toContain(line);
  });
});

describe("WA-L01 — ההודעה הכללית, מול הדוגמה שבאפיון", () => {
  it("WA-L01 — הברכה פותחת את המשפט הראשון, באותה שורה", () => {
    expect(plain(textOf(EXAMPLE)).startsWith(SPEC.opening("דנה"))).toBe(true);
  });

  it("WA-L01 — 'בטיוטה עכשיו' עם כל השדות ושורת התיאור", () => {
    expect(plain(textOf(EXAMPLE))).toContain(
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
    ["עודכן מהתגובה שלך", SPEC.updatedExample],
    ["חסר", SPEC.missingExample],
    ["WA-L02 — לא נמצא ברשימה", SPEC.notFoundExample],
    ["WA-L03 — נמצאו כמה התאמות", SPEC.ambiguousExample],
    ["WA-L03 — סותר את מה שנקבע במערכת", SPEC.conflictExample],
    ["איך משלימים", SPEC.howTo(LINK)],
  ])("WA-L01 — %s", (_name, line) => {
    expect(plain(textOf(EXAMPLE))).toContain(line);
  });

  it("WA-L01 — החלקים בסדר שבאפיון, כל אחד בפסקה משלו", () => {
    const text = plain(textOf(EXAMPLE));
    const order = [
      SPEC.opening("דנה"),
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
    expect(text.split("\n\n")).toHaveLength(8);
  });

  it("WA-L01 — 'עודכן מהתגובה שלך' רק בהודעה שעונה על תגובה", () => {
    expect(textOf({ ...EXAMPLE, isReply: false })).not.toContain(SPEC.updatedHeading);
  });

  it("ההדגשה של וואטסאפ — המשפט המודגש באפיון וכל כותרת, והכוכביות צמודות לאותיות", () => {
    const text = textOf(EXAMPLE);
    for (const bold of [
      "הטיוטה עוד לא נשלחה לאיש.",
      SPEC.currentHeading,
      SPEC.updatedHeading,
      SPEC.missingHeading,
      SPEC.notFoundHeading,
      SPEC.ambiguousHeading,
      SPEC.conflictHeading,
      SPEC.howToHeading,
    ]) {
      // הכוכביות צמודות לאותיות — וואטסאפ אינה מדגישה `* כותרת*`
      expect(text).toContain(`*${bold}*`);
    }
  });

  it("בלי שם — 'שלום,' ולא 'שלום ,'", () => {
    expect(plain(textOf({ ...EXAMPLE, recipientName: "" })).startsWith("שלום, ההודעה שלך נשמרה")).toBe(true);
  });
});

describe("WA-L02 — ערכים ריקים ורשימת האתרים", () => {
  it("טיוטה ריקה: כל השדות, באותו סדר, וריק הוא '—'", () => {
    const empty = SPEC.emptyValue;
    const text = plain(
      textOf({
        ...EXAMPLE,
        isReply: false,
        summary: { site: null, building: null, apartment: null, room: null, domain: null, description: null, recipients: [] },
        report: undefined,
      }),
    );
    expect(text).toContain(
      [
        SPEC.summaryLine({ site: empty, building: empty, apartment: empty, room: empty, domain: empty, recipients: empty }),
        SPEC.descriptionLine(empty),
      ].join("\n"),
    );
  });

  it("טיוטה בלי אתר: 'חסר: אתר. האתרים הקיימים: …'", () => {
    expect(plain(textOf({ ...EXAMPLE, missing: ["SITE"], siteOptions: ["נווה שאנן", "רמת אביב"] }))).toContain(
      "חסר: אתר. האתרים הקיימים: נווה שאנן, רמת אביב.",
    );
  });
});

describe("WA-L04, WA-L07, WA-L09 — הנוסחים של W6", () => {
  it("WA-L04 — כשלא חסר דבר ואין סתירה: 'כל הפרטים זוהו' במקום 'איך משלימים'", () => {
    const text = plain(textOf({ ...EXAMPLE, isReply: false, missing: [], conflicts: [], report: undefined }));
    expect(text).toContain(SPEC.ready(LINK));
    expect(text).not.toContain(SPEC.howToHeading);
  });

  it("WA-L04 — סתירה פתוחה משאירה את הנוסח הכללי גם כשלא חסר דבר", () => {
    expect(plain(textOf({ ...EXAMPLE, missing: [] }))).toContain(SPEC.howToHeading);
  });

  it("WA-L07 — החילוץ אינו זמין, לדיווח", () => {
    const text = plain(textOf({ kind: "DRAFT", recipientName: "דנה", extractionUnavailable: true, draftLink: LINK }));
    expect(text).toBe(`שלום דנה, ${SPEC.extractionUnavailable(LINK)}`);
  });

  it("WA-L09 — מנהל עבודה שאינו משויך לאתר", () => {
    expect(plain(textOf({ kind: "NO_SITE", recipientName: "דנה" }))).toBe(`שלום דנה, ${SPEC.noSite}`);
  });
});

describe("WA-L05, WA-L06, WA-L08, WA-L10 — נוסחי התגובה וההסבר (W7)", () => {
  it.each([
    ["WA-L05", { kind: "AFTER_DISPATCH", ticketSeq: 7, ticketLink: LINK } as const, SPEC.afterDispatch(7, LINK)],
    ["WA-L06", { kind: "AFTER_DELETION" } as const, SPEC.afterDeletion],
    ["WA-L07 — תגובה", { kind: "DRAFT", isReply: true, extractionUnavailable: true, draftLink: LINK } as const, SPEC.extractionUnavailableReply(LINK)],
    // §7 שורה 105: הנוסח אינו מזכיר את השולח המקורי, ולכן אינו צריך את שמו
    ["WA-L08", { kind: "NOT_PERMITTED" } as const, SPEC.notPermitted],
    ["WA-L10", { kind: "HINT" } as const, SPEC.hint],
  ])("%s", (_name, input, line) => {
    expect(plain(textOf({ recipientName: "דנה", ...input }))).toBe(`שלום דנה, ${line}`);
  });

  it("WA-L08 — גם כשהשם הועבר, הוא אינו נכנס לנוסח", () => {
    expect(plain(textOf({ kind: "NOT_PERMITTED", recipientName: "דנה", senderName: "משה" }))).not.toContain("משה");
  });

  it("WA-L10 — תבנית נפרדת, ולא הנוסח של טיוטה", () => {
    expect(composeWhatsappReply({ kind: "HINT", recipientName: "דנה" }).template).toBe("L10");
  });
});

describe("הגג של וואטסאפ — 4096 תווים (§7 שורה 112)", () => {
  it("תיאור ארוך מקוצר ב-'…' בדיוק כדי להיכנס, וכל שאר החלקים נשארים", () => {
    const long = "נזילה ".repeat(1500);
    const text = textOf({ ...EXAMPLE, summary: { ...EXAMPLE.summary!, description: long } });
    expect(text.length).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
    expect(text.length).toBeGreaterThan(MAX_TEXT_LENGTH - 10);
    expect(text).toContain("…");
    expect(plain(text)).toContain(SPEC.howTo(LINK));
    expect(plain(text)).toContain(SPEC.conflictExample);
  });

  it("תיאור קצר — ההודעה כמו שהיא, בלי קיצור", () => {
    expect(textOf(EXAMPLE)).not.toContain("…");
  });
});
