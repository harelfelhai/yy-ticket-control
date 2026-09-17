import { describe, expect, it } from "vitest";
import {
  POLL_LOOKBACK_HOURS,
  SENDERS_PER_QUERY,
  buildPollQueries,
  isQueryableAddress,
  pollWindowStart,
} from "@/lib/email-intake/query";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-09-17T12:00:00.000Z");
const hoursBefore = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

describe("pollWindowStart", () => {
  it("EM-21 — בלי סבב מוצלח קודם החלון הוא 48 השעות האחרונות", () => {
    const start = pollWindowStart({ activatedAt: hoursBefore(500), lastPollOkAt: null, now: NOW });
    expect(start).toEqual(hoursBefore(POLL_LOOKBACK_HOURS));
  });

  it("EM-21 — סבב מוצלח לפני דקות אינו מקצר את החלון: כל סבב סורק לפחות 48 שעות", () => {
    const start = pollWindowStart({
      activatedAt: hoursBefore(500),
      lastPollOkAt: new Date(NOW.getTime() - 5 * 60 * 1000),
      now: NOW,
    });
    expect(start).toEqual(hoursBefore(48));
  });

  it("EM-21 — סבבים שהוחמצו: החלון נפתח שעה לפני הסבב המוצלח האחרון", () => {
    const start = pollWindowStart({ activatedAt: hoursBefore(500), lastPollOkAt: hoursBefore(72), now: NOW });
    expect(start).toEqual(hoursBefore(73));
  });

  it("EM-21 — סבב מוצלח לפני 47 שעות: השעה החופפת מביאה את החלון בדיוק ל-48", () => {
    const start = pollWindowStart({ activatedAt: hoursBefore(500), lastPollOkAt: hoursBefore(47), now: NOW });
    expect(start).toEqual(hoursBefore(48));
  });

  it("EM-22 — ההפעלה היא רצפה: לא נסרק דבר שהגיע לפניה, גם בלי סבב קודם", () => {
    const activatedAt = hoursBefore(2);
    expect(pollWindowStart({ activatedAt, lastPollOkAt: null, now: NOW })).toEqual(activatedAt);
  });

  it("EM-22 — ההפעלה היא רצפה גם כשהסבב המוצלח האחרון ישן", () => {
    const activatedAt = hoursBefore(60);
    expect(pollWindowStart({ activatedAt, lastPollOkAt: hoursBefore(100), now: NOW })).toEqual(activatedAt);
  });

  it("EM-22 — הפעלה שקרתה לפני תחילת החלון אינה מרחיבה אותו", () => {
    const start = pollWindowStart({ activatedAt: hoursBefore(80), lastPollOkAt: hoursBefore(72), now: NOW });
    expect(start).toEqual(hoursBefore(73));
  });

  it("EM-21 — סבב מוצלח 'בעתיד' (שעון מוטה) אינו מזיז את החלון קדימה", () => {
    const start = pollWindowStart({ activatedAt: hoursBefore(500), lastPollOkAt: hoursBefore(-3), now: NOW });
    expect(start).toEqual(hoursBefore(48));
  });

  it("EM-22 — מחזיר מופע חדש ואינו משנה את הקלט", () => {
    const activatedAt = hoursBefore(1);
    const start = pollWindowStart({ activatedAt, lastPollOkAt: null, now: NOW });
    expect(start).not.toBe(activatedAt);
    expect(activatedAt).toEqual(hoursBefore(1));
  });

  it.each([
    ["activatedAt", { activatedAt: new Date("x"), lastPollOkAt: null, now: NOW }],
    ["now", { activatedAt: hoursBefore(1), lastPollOkAt: null, now: new Date(Number.NaN) }],
    ["lastPollOkAt", { activatedAt: hoursBefore(1), lastPollOkAt: new Date("x"), now: NOW }],
  ])("EM-22 — תאריך לא תקין (%s) זורק ולא מייצר חלון פתוח", (_name, input) => {
    expect(() => pollWindowStart(input)).toThrow(RangeError);
  });
});

describe("buildPollQueries", () => {
  const SINCE = new Date("2026-09-15T12:00:00.999Z");
  const SINCE_SEC = Math.floor(SINCE.getTime() / 1000);

  it("EM-21 — שאילתה לשולח יחיד, במחרוזת המדויקת", () => {
    expect(buildPollQueries(["dana@example.com"], SINCE)).toEqual([
      `from:(dana@example.com) after:${SINCE_SEC} in:anywhere -in:spam -from:me`,
    ]);
  });

  it("EM-21 — כמה שולחים מחוברים ב-OR, ממוינים", () => {
    expect(buildPollQueries(["yossi@b.co.il", "avi@a.co.il"], SINCE)).toEqual([
      `from:(avi@a.co.il OR yossi@b.co.il) after:${SINCE_SEC} in:anywhere -in:spam -from:me`,
    ]);
  });

  it("EM-22 — after הוא שניות מהאפוק, מעוגל כלפי מטה כדי לא לאבד את השנייה של תחילת החלון", () => {
    const [query] = buildPollQueries(["a@x.com"], new Date(1_700_000_000_999));
    expect(query).toContain("after:1700000000 ");
  });

  it("EM-21 — לעולם אין is:unread: מייל שכבר נפתח (בידי EasyInv) נקלט", () => {
    const senders = Array.from({ length: 75 }, (_, i) => `user${i}@example.com`);
    const queries = buildPollQueries(senders, SINCE);
    for (const query of queries) {
      expect(query).not.toMatch(/is:unread|is:read|label:unread/i);
      expect(query).toContain("in:anywhere");
      expect(query).toContain("-in:spam");
      expect(query).toContain("-from:me");
    }
  });

  it("EM-21 — נרמול וכפילויות: אותה כתובת באותיות שונות וברווחים נספרת פעם אחת", () => {
    expect(buildPollQueries(["  Dana@Example.com ", "dana@example.com", "DANA@EXAMPLE.COM"], SINCE)).toEqual([
      `from:(dana@example.com) after:${SINCE_SEC} in:anywhere -in:spam -from:me`,
    ]);
  });

  it("EM-21 — ערכים שאינם כתובת פשוטה אינם נכנסים לשאילתה ואינם שוברים אותה", () => {
    const queries = buildPollQueries(
      [
        "ok@example.com",
        "no-at-sign",
        "two words@example.com",
        '"quoted"@example.com',
        "o'brien@example.com",
        "a@b.com) OR (x@y.com",
        "{a@b.com}",
        "-a@b.com",
        "",
        "   ",
      ],
      SINCE,
    );
    expect(queries).toEqual([`from:(ok@example.com) after:${SINCE_SEC} in:anywhere -in:spam -from:me`]);
  });

  it("EM-21 — בלי שולחים אין שאילתה: שאילתה בלי from הייתה קוראת את כל התיבה", () => {
    expect(buildPollQueries([], SINCE)).toEqual([]);
    expect(buildPollQueries(["not-an-address", " "], SINCE)).toEqual([]);
  });

  it(`EM-21 — בדיוק ${SENDERS_PER_QUERY} שולחים נכנסים לשאילתה אחת`, () => {
    const senders = Array.from({ length: SENDERS_PER_QUERY }, (_, i) => `u${String(i).padStart(2, "0")}@x.com`);
    const queries = buildPollQueries(senders, SINCE);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.match(/@x\.com/g)).toHaveLength(SENDERS_PER_QUERY);
  });

  it("EM-21 — 61 שולחים מתחלקים ל-30, 30 ו-1, בלי לאבד ובלי לכפול אף שולח", () => {
    const senders = Array.from({ length: 61 }, (_, i) => `u${String(i).padStart(2, "0")}@x.com`);
    const queries = buildPollQueries([...senders].reverse(), SINCE);
    expect(queries).toHaveLength(3);

    const perQuery = queries.map((q) => (/^from:\((.*)\) after:/.exec(q)?.[1] ?? "").split(" OR "));
    expect(perQuery.map((list) => list.length)).toEqual([30, 30, 1]);
    expect(perQuery.flat()).toEqual(senders);
    for (const query of queries) {
      expect(query.endsWith(`after:${SINCE_SEC} in:anywhere -in:spam -from:me`)).toBe(true);
    }
  });

  it("EM-22 — תאריך לא תקין זורק, ולא נשלח after:NaN שהיה פותח את כל ההיסטוריה", () => {
    expect(() => buildPollQueries(["a@x.com"], new Date("x"))).toThrow(RangeError);
  });
});

describe("isQueryableAddress", () => {
  it.each([
    ["dana@example.com", true],
    ["first.last+tag@sub.example.co.il", true],
    ["no-at", false],
    ["a b@example.com", false],
    ['"a"@example.com', false],
    ["o'brien@example.com", false],
    ["(a@b.com)", false],
    ["{a@b.com}", false],
    ["-a@b.com", false],
    // `from:(@example.com)` היה מרחיב את השאילתה לכל הדומיין
    ["@example.com", false],
    ["a@", false],
    ["a@b@c.com", false],
    ["", false],
  ])("EM-21 — %s → %s", (value, expected) => {
    expect(isQueryableAddress(value)).toBe(expected);
  });
});
