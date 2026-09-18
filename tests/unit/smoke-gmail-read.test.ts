import { describe, expect, it } from "vitest";
import {
  checkScopes,
  formatReport,
  isHealthy,
  parseArgs,
  runSmoke,
  windowQuery,
  type SmokeReport,
} from "../../scripts/smoke-gmail-read.mjs";

/**
 * בדיקת הקריאה מול התיבה — הליבה שלה, בלי טוקן ובלי רשת.
 *
 * הסקריפט נועד לענות על שאלה אחת ("האם הטוקן קורא, ומה עוד הוא רשאי"), ושתי
 * התשובות השגויות שהוא חייב למנוע נבדקות כאן: לומר "תקין" על טוקן שאינו יכול
 * לקרוא, ולשתוק על טוקן שמסוגל לשנות את התיבה המשותפת (EM-20). בנוסף נבדק
 * שהפלט אינו נושא זהויות, כי הוא מיועד להדבקה בצ׳אט.
 */

const SINCE = new Date("2026-09-16T09:00:00.000Z");
const READONLY = "https://www.googleapis.com/auth/gmail.readonly";
const SEND = "https://www.googleapis.com/auth/gmail.send";

function fakeSource(byQuery: Record<string, string[]> = {}) {
  const queries: string[] = [];
  return {
    name: "fake",
    queries,
    getProfile: async () => ({ emailAddress: "mailbox@example.com" }),
    listIds: async (query: string) => {
      queries.push(query);
      return { ids: byQuery[query] ?? [] };
    },
    getMessage: async () => null,
    getAttachment: async () => {
      throw new Error("לא אמור להיקרא");
    },
  };
}

const baseInput = {
  tokenInfo: async () => ({ scope: `${SEND} ${READONLY}` }),
  senders: [] as string[],
  since: SINCE,
  expectedMailbox: "mailbox@example.com",
};

describe("parseArgs", () => {
  it("ברירות המחדל: חלון הסבב, בלי שולחים, הטוקן של התיבה", () => {
    expect(parseArgs([])).toEqual({ hours: 48, senders: [], tokenVar: "GMAIL_REFRESH_TOKEN" });
  });

  it("--sender מקבל רשימה מופרדת בפסיק ומנרמל", () => {
    expect(parseArgs(["--sender", "Dana@Example.com, avi@example.com"]).senders).toEqual([
      "dana@example.com",
      "avi@example.com",
    ]);
  });

  it("כתובת ששוברת את השאילתה מפילה את הריצה, ולא מייצרת ספירה שגויה", () => {
    expect(() => parseArgs(["--sender", "o'brien@example.com"])).toThrow(/חוקית/);
    // ההודעה מדווחת כמות ולא את הכתובת עצמה
    expect(() => parseArgs(["--sender", "o'brien@example.com"])).not.toThrow(/o'brien/);
  });

  it("--hours ו---token-var נקראים, ודגל לא מוכר זורק", () => {
    expect(parseArgs(["--hours", "6"]).hours).toBe(6);
    expect(parseArgs(["--token-var", "GMAIL_TEST_REFRESH_TOKEN"]).tokenVar).toBe("GMAIL_TEST_REFRESH_TOKEN");
    expect(() => parseArgs(["--hour", "6"])).toThrow(/לא מוכר/);
    expect(() => parseArgs(["--hours", "0"])).toThrow(/hours/);
  });
});

describe("EM-20 — בדיקת ההיקפים", () => {
  it("שני ההיקפים שהונפקו: קריאה ושליחה, בלי היקף משנה", () => {
    const check = checkScopes(`${SEND} ${READONLY}`);
    expect(check).toEqual({ granted: [SEND, READONLY], canRead: true, canSend: true, mutating: [], unexpected: [] });
  });

  it("בלי gmail.readonly — זה בדיוק הטוקן הישן שממשיך לשלוח ואינו קורא", () => {
    const check = checkScopes(SEND);
    expect(check.canRead).toBe(false);
    expect(check.canSend).toBe(true);
  });

  it.each([
    ["https://www.googleapis.com/auth/gmail.modify"],
    ["https://www.googleapis.com/auth/gmail.labels"],
    ["https://www.googleapis.com/auth/gmail.insert"],
    ["https://www.googleapis.com/auth/gmail.settings.basic"],
    ["https://www.googleapis.com/auth/gmail.compose"],
    ["https://mail.google.com/"],
  ])("היקף שמסוגל לשנות את התיבה (%s) מזוהה", (scope) => {
    const check = checkScopes(`${SEND} ${READONLY} ${scope}`);
    expect(check.mutating).toEqual([scope]);
    expect(check.unexpected).toEqual([scope]);
  });

  it("היקף זהות אינו 'משנה', אבל מדווח כלא-צפוי", () => {
    const check = checkScopes(`${READONLY} openid`);
    expect(check.mutating).toEqual([]);
    expect(check.unexpected).toEqual(["openid"]);
  });

  it("מחרוזת ריקה אינה מתפרשת כהיקף", () => {
    expect(checkScopes("").granted).toEqual([]);
    expect(checkScopes("  ").canRead).toBe(false);
  });
});

describe("windowQuery", () => {
  const query = windowQuery(SINCE);

  it("נגזרת משאילתת הסבב עצמה, ולכן נושאת את אותה סיומת", () => {
    expect(query).toContain("in:anywhere");
    expect(query).toContain("-in:spam");
    expect(query).toContain("-from:me");
    expect(query).toContain(`after:${Math.floor(SINCE.getTime() / 1000)}`);
  });

  it("אין בה מסנן שולחים — זו כל הנקודה: חסם עליון ולא ספירת הסבב", () => {
    expect(query).not.toContain("from:(");
    expect(query).not.toContain("example.invalid");
  });
});

describe("runSmoke", () => {
  it("בלי --sender נמדד רק החלון, ושאילתת הסבב מדווחת כלא-נמדדה", async () => {
    const source = fakeSource({ [windowQuery(SINCE)]: ["a", "b", "c"] });
    const report = await runSmoke({ ...baseInput, source });

    expect(report.mailbox).toBe("mailbox@example.com");
    expect(report.mailboxMatches).toBe(true);
    expect(report.windowCount).toBe(3);
    expect(report.pollCount).toBeNull();
    expect(report.pollQueries).toBe(0);
    expect(isHealthy(report)).toBe(true);
  });

  it("עם שולחים נספרת שאילתת הסבב האמיתית, בלי כפילויות בין שאילתות", async () => {
    const senders = Array.from({ length: 31 }, (_, at) => `user${at}@example.com`);
    const source = fakeSource();
    // 31 שולחים = שתי שאילתות (30 בכל אחת), ואותה הודעה יכולה לחזור בשתיהן
    source.listIds = async (query: string) => {
      source.queries.push(query);
      return { ids: source.queries.length === 1 ? [] : ["m1", "m2"] };
    };
    const report = await runSmoke({ ...baseInput, source, senders });

    expect(report.pollQueries).toBe(2);
    expect(report.pollCount).toBe(2);
  });

  it("טוקן בלי הרשאת קריאה אינו 'תקין', גם כשהתיבה נקראה", async () => {
    const report = await runSmoke({ ...baseInput, source: fakeSource(), tokenInfo: async () => ({ scope: SEND }) });
    expect(isHealthy(report)).toBe(false);
  });

  it("היקף שמסוגל לשנות את התיבה מפיל את הבדיקה", async () => {
    const report = await runSmoke({
      ...baseInput,
      source: fakeSource(),
      tokenInfo: async () => ({ scope: `${READONLY} https://mail.google.com/` }),
    });
    expect(isHealthy(report)).toBe(false);
  });

  it("תיבה שאינה GMAIL_USER מפילה את הבדיקה — הטוקן מצביע למקום אחר", async () => {
    const report = await runSmoke({ ...baseInput, source: fakeSource(), expectedMailbox: "other@example.com" });
    expect(report.mailboxMatches).toBe(false);
    expect(isHealthy(report)).toBe(false);
  });

  it("בלי GMAIL_USER אין מה להשוות, וזה אינו כישלון", async () => {
    const report = await runSmoke({ ...baseInput, source: fakeSource(), expectedMailbox: null });
    expect(report.mailboxMatches).toBeNull();
    expect(isHealthy(report)).toBe(true);
  });

  it("ההשוואה ל-GMAIL_USER אינה רגישה לאותיות גדולות", async () => {
    const report = await runSmoke({ ...baseInput, source: fakeSource(), expectedMailbox: " MailBox@Example.com " });
    expect(report.mailboxMatches).toBe(true);
  });
});

describe("formatReport", () => {
  const report = (over: Partial<SmokeReport> = {}): SmokeReport => ({
    mailbox: "mailbox@example.com",
    mailboxMatches: true,
    scopes: checkScopes(`${SEND} ${READONLY}`),
    since: SINCE,
    windowCount: 87,
    pollCount: 12,
    pollQueries: 1,
    ...over,
  });

  it("מדפיס את התיבה, ההיקפים והספירות", () => {
    const text = formatReport(report(), [{ method: "GET", path: "/gmail/v1/users/me/profile", status: 200 }]);
    expect(text).toContain("mailbox@example.com");
    expect(text).toContain("gmail.readonly");
    expect(text).toContain("87");
    expect(text).toContain("12");
    expect(text).toContain("כולן GET: כן");
  });

  it("אין בפלט שמות שולחים, כותרות או שמות קבצים — רק ספירות", () => {
    const text = formatReport(report({ pollCount: 4 }), []);
    expect(text).not.toMatch(/subject|נושא|מאת/i);
    // הכתובת היחידה שמותר שתופיע היא של התיבה עצמה
    expect(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g)).toEqual(["mailbox@example.com"]);
  });

  it("חוסר הרשאת קריאה נאמר במפורש ולא נקרא בין השורות", () => {
    const text = formatReport(report({ scopes: checkScopes(SEND) }), []);
    expect(text).toContain("gmail.readonly לא הוענק");
  });

  it("היקף משנה מודפס בשמו, ולא מסתתר ברשימת ה'לא צפוי'", () => {
    const text = formatReport(report({ scopes: checkScopes(`${READONLY} https://mail.google.com/`) }), []);
    expect(text).toContain("היקפים שמסוגלים לשנות את התיבה: https://mail.google.com/");
  });

  it("בלי שולחים נאמר שהסבב לא נמדד, ולא מוצג אפס שנראה כמו תשובה", () => {
    const text = formatReport(report({ pollCount: null, pollQueries: 0 }), []);
    expect(text).toContain("לא נמדדה");
  });
});
