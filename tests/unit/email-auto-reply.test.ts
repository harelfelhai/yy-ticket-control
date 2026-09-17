import { describe, expect, it } from "vitest";
import { autoReplySignal, isAutoReply, type AutoReplyInput } from "@/lib/email-intake/auto-reply";

/**
 * תשובה אוטומטית אינה נקלטת ואינה נענית (EM-23, אפיון §5.ה3 כלל 7).
 *
 * הבסיס של כל בדיקה הוא מייל אנושי אמיתי במבנה של Outlook: כולל
 * `X-Auto-Response-Suppress`, שמופיע במייל רגיל ואסור שיסווג אותו כאוטומטי.
 */

const RLM = String.fromCharCode(0x200f);

function human(overrides: Partial<AutoReplyInput> = {}): AutoReplyInput {
  return {
    headers: {
      from: "יוסי כהן <yossi@example.co.il>",
      to: "tickets@example.co.il",
      subject: "תקלה בדירה 12",
      "message-id": "<CAB123@mail.gmail.com>",
      "return-path": "<yossi@example.co.il>",
      "x-auto-response-suppress": "All",
      "content-type": "multipart/alternative; boundary=\"abc\"",
    },
    subject: "תקלה בדירה 12",
    from: { address: "yossi@example.co.il", name: "יוסי כהן" },
    contentType: "multipart/alternative",
    ...overrides,
  };
}

function withHeaders(extra: Record<string, string>): AutoReplyInput {
  const base = human();
  return { ...base, headers: { ...base.headers, ...extra } };
}

describe("isAutoReply — מייל אנושי", () => {
  it("EM-23 — מייל רגיל מאדם אינו תשובה אוטומטית", () => {
    expect(isAutoReply(human())).toBe(false);
    expect(autoReplySignal(human())).toBeNull();
  });

  it("EM-23 — X-Auto-Response-Suppress לבדו אינו סימן לתשובה אוטומטית", () => {
    // Outlook מוסיף אותו למיילים רגילים כדי לבקש ממשיבים אוטומטיים לא לענות.
    expect(isAutoReply(withHeaders({ "x-auto-response-suppress": "DR, RN, NRN, OOF, AutoReply" }))).toBe(false);
  });

  it("EM-23 — אדם שעונה למייל החוזר של המערכת אינו תשובה אוטומטית", () => {
    // המייל החוזר שלנו נושא Auto-Submitted: auto-replied; התשובה של האדם לא.
    const reply = withHeaders({
      subject: "RE: תקלה בדירה 12",
      "in-reply-to": "<intake-1@yy.example>",
      references: "<CAB123@mail.gmail.com> <intake-1@yy.example>",
    });
    expect(isAutoReply({ ...reply, subject: "RE: תקלה בדירה 12" })).toBe(false);
  });

  it("EM-23 — אדם שעונה לתשובה אוטומטית (\"RE: Automatic reply\") אינו אוטומטי", () => {
    expect(isAutoReply(human({ subject: "RE: Automatic reply: תקלה בדירה 12" }))).toBe(false);
  });

  it("EM-23 — מילה דומה לקידומת באמצע הכותרת אינה סימן", () => {
    expect(isAutoReply(human({ subject: "תקלה בדירה 12 — Out of Office עד יום א" }))).toBe(false);
    expect(isAutoReply(human({ subject: "Automation panel תקלה" }))).toBe(false);
  });
});

describe("isAutoReply — המייל החוזר של המערכת עצמה", () => {
  it("EM-23 — מייל שנושא Auto-Submitted: auto-replied (כמו המייל החוזר שלנו) מסווג כאוטומטי", () => {
    // כך לולאה בין שתי מערכות שקולטות מיילים נעצרת גם אם המייל שלנו חוזר לתיבה.
    const ours = withHeaders({ "auto-submitted": "auto-replied" });
    expect(isAutoReply({ ...ours, subject: "Re: תקלה בדירה 12" })).toBe(true);
    expect(autoReplySignal(ours)).toBe("auto-submitted");
  });
});

describe("isAutoReply — Auto-Submitted (RFC 3834)", () => {
  it.each([
    ["auto-replied"],
    ["auto-generated"],
    ["auto-notified"],
    ["Auto-Replied"],
    ["  AUTO-REPLIED  "],
    ["auto-replied; owner-email=\"boss@example.com\""],
    ["auto-generated (vacation)"],
  ])("EM-23 — Auto-Submitted: %s", (value) => {
    expect(isAutoReply(withHeaders({ "auto-submitted": value }))).toBe(true);
  });

  it.each([["no"], ["No"], [" NO "], ["no (sent by a person)"], [""], ["   "]])(
    "EM-23 — Auto-Submitted: \"%s\" אינו סימן",
    (value) => {
      expect(isAutoReply(withHeaders({ "auto-submitted": value }))).toBe(false);
    },
  );
});

describe("isAutoReply — כותרות X-Autoreply למיניהן", () => {
  it.each([
    ["x-autoreply", "yes"],
    ["x-autorespond", "Out of office"],
    ["x-autoresponse", "1"],
    ["x-autoreply", "TRUE"],
  ])("EM-23 — %s: %s", (name, value) => {
    expect(isAutoReply(withHeaders({ [name]: value }))).toBe(true);
    expect(autoReplySignal(withHeaders({ [name]: value }))).toBe("x-autoreply");
  });

  it.each([
    ["x-autoreply", "no"],
    ["x-autorespond", "false"],
    ["x-autoresponse", " False "],
    ["x-autoreply", ""],
  ])("EM-23 — %s: \"%s\" אינו סימן", (name, value) => {
    expect(isAutoReply(withHeaders({ [name]: value }))).toBe(false);
  });
});

describe("isAutoReply — Precedence", () => {
  it.each([["bulk"], ["junk"], ["list"], ["auto_reply"], ["Bulk"], [" LIST "]])(
    "EM-23 — Precedence: %s",
    (value) => {
      expect(isAutoReply(withHeaders({ precedence: value }))).toBe(true);
    },
  );

  it.each([["first-class"], ["normal"], ["urgent"], [""]])("EM-23 — Precedence: \"%s\" אינו סימן", (value) => {
    expect(isAutoReply(withHeaders({ precedence: value }))).toBe(false);
  });
});

describe("isAutoReply — החזרת דואר (bounce)", () => {
  it.each([["<>"], ["< >"], ["  <>  "]])("EM-23 — Return-Path ריק \"%s\"", (value) => {
    expect(isAutoReply(withHeaders({ "return-path": value }))).toBe(true);
    expect(autoReplySignal(withHeaders({ "return-path": value }))).toBe("return-path");
  });

  it.each([
    ["multipart/report"],
    ["MULTIPART/REPORT"],
    ["multipart/report; report-type=delivery-status; boundary=\"x\""],
  ])("EM-23 — Content-Type %s", (contentType) => {
    expect(isAutoReply(human({ contentType }))).toBe(true);
  });

  it("EM-23 — multipart/mixed רגיל אינו סימן", () => {
    expect(isAutoReply(human({ contentType: "multipart/mixed" }))).toBe(false);
  });

  it.each([
    ["mailer-daemon@googlemail.com"],
    ["MAILER-DAEMON@mx.example.co.il"],
    ["postmaster@example.co.il"],
    ["PostMaster@example.co.il"],
  ])("EM-23 — מאת %s", (address) => {
    expect(isAutoReply(human({ from: { address, name: "Mail Delivery Subsystem" } }))).toBe(true);
    expect(autoReplySignal(human({ from: { address, name: null } }))).toBe("from");
  });

  it.each([["daemon@example.co.il"], ["postmaster.office@example.co.il"], ["yossi.postmaster@example.co.il"]])(
    "EM-23 — מאת %s אינו סימן",
    (address) => {
      expect(isAutoReply(human({ from: { address, name: null } }))).toBe(false);
    },
  );

  it("EM-23 — MAILER-DAEMON בלי דומיין מזוהה מהכותרת הגולמית גם כשלא פוענחה כתובת", () => {
    // "From: MAILER-DAEMON" אינו כתובת חוקית, ולכן `from` מגיע null.
    const input = human({ from: null });
    expect(isAutoReply({ ...input, headers: { ...input.headers, from: "Mail Delivery System <MAILER-DAEMON>" } })).toBe(true);
    expect(isAutoReply({ ...input, headers: { ...input.headers, from: "MAILER-DAEMON" } })).toBe(true);
  });

  it("EM-23 — MAILER-DAEMON בלי דומיין ועם הערה בסוגריים (תחביר RFC 5322 חוקי) מזוהה גם הוא", () => {
    const input = human({ from: null });
    expect(autoReplySignal({ ...input, headers: { ...input.headers, from: "MAILER-DAEMON (Mail Delivery System)" } })).toBe("from");
    expect(autoReplySignal({ ...input, headers: { ...input.headers, from: "(Mail Delivery System) postmaster" } })).toBe("from");
  });

  it("EM-23 — בלי שולח ובלי כותרת From אין סימן משולח", () => {
    const input = human({ from: null });
    const headers = { ...input.headers };
    delete headers.from;
    expect(isAutoReply({ ...input, headers })).toBe(false);
  });
});

describe("isAutoReply — קידומת בכותרת", () => {
  it.each([
    ["Automatic reply: תקלה בדירה 12"],
    ["automatic reply: RE: תקלה"],
    ["Auto: תקלה בדירה 12"],
    ["AutoReply: תקלה"],
    ["Auto-Reply: תקלה"],
    ["Out of Office: תקלה"],
    ["Out of Office AutoReply: תקלה"],
    ["Undeliverable: תקלה בדירה 12"],
    ["Delivery Status Notification (Failure)"],
    ["Mail Delivery Failure"],
    ["Undelivered Mail Returned to Sender"],
    ["Mail delivery failed: returning message to sender"],
    ["תשובה אוטומטית: תקלה בדירה 12"],
    ["מחוץ למשרד: תקלה"],
    ["לא ניתן היה למסור: תקלה"],
    ["  Automatic   reply:  תקלה"],
  ])("EM-23 — \"%s\"", (subject) => {
    expect(isAutoReply(human({ subject }))).toBe(true);
    expect(autoReplySignal(human({ subject }))).toBe("subject");
  });

  it("EM-23 — תו כיווניות בתחילת כותרת עברית אינו מסתיר את הקידומת", () => {
    expect(isAutoReply(human({ subject: `${RLM}תשובה אוטומטית: תקלה` }))).toBe(true);
  });
});

describe("autoReplySignal", () => {
  it("EM-23 — מחזיר את הסימן הראשון לפי סדר הבדיקה, כדי שהיומן יאמר למה ההודעה דולגה", () => {
    const input = withHeaders({ "auto-submitted": "auto-replied", precedence: "bulk" });
    expect(autoReplySignal({ ...input, subject: "Automatic reply: x" })).toBe("auto-submitted");
    expect(autoReplySignal(withHeaders({ precedence: "junk" }))).toBe("precedence");
    expect(autoReplySignal(human({ contentType: "multipart/report" }))).toBe("content-type");
  });
});
