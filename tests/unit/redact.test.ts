import { describe, expect, it } from "vitest";
import { REDACTED, redactTokens, scrubEvent } from "@/lib/observability/redact";

/**
 * קישור הקסם של הקבלן הוא סוד ללא תפוגה שיושב בכתובת עצמה, ו-Sentry אוסף
 * כתובות ללא תנאי. הבדיקות כאן מוודאות שאף נשא של כתובת אינו יוצא בלי הסרה
 * — כי דליפה כאן היא דליפה מתמשכת של אישורי גישה לשירות חיצוני.
 */

const TOKEN = "Ab3-_xYz01234567890abc";

describe("redactTokens", () => {
  it("מסיר טוקן מנתיב הפורטל", () => {
    expect(redactTokens(`https://app.example.com/p/${TOKEN}`)).toBe(
      `https://app.example.com/p/${REDACTED}`,
    );
  });

  it("שומר על צורת הנתיב כשיש המשך אחרי הטוקן", () => {
    expect(redactTokens(`https://app.example.com/p/${TOKEN}/ticket-123`)).toBe(
      `https://app.example.com/p/${REDACTED}/ticket-123`,
    );
  });

  it("מסיר טוקן מפרמטר השאילתה של המדיה", () => {
    expect(redactTokens(`/api/media/abc?t=${TOKEN}`)).toBe(`/api/media/abc?t=${REDACTED}`);
  });

  it("מסיר גם כשהפרמטר אינו ראשון, ואינו בולע פרמטרים אחרים", () => {
    expect(redactTokens(`/api/media/abc?x=1&t=${TOKEN}&y=2`)).toBe(
      `/api/media/abc?x=1&t=${REDACTED}&y=2`,
    );
  });

  it("אידמפוטנטי — הרצה חוזרת אינה משנה", () => {
    const once = redactTokens(`/p/${TOKEN}`);
    expect(redactTokens(once)).toBe(once);
  });

  it("אינו נוגע בכתובות שאין בהן טוקן", () => {
    expect(redactTokens("/board?siteId=abc")).toBe("/board?siteId=abc");
  });
});

describe("scrubEvent", () => {
  it("מנקה את כל נשאי הכתובת באירוע אחד", () => {
    const event = scrubEvent({
      transaction: `/p/${TOKEN}/ticket-1`,
      request: {
        url: `https://app.example.com/p/${TOKEN}`,
        query_string: `t=${TOKEN}`,
        headers: { Referer: `https://app.example.com/p/${TOKEN}`, "User-Agent": "x" },
      },
      breadcrumbs: [
        { message: `navigate to /p/${TOKEN}`, data: { to: `/p/${TOKEN}`, from: "/" } },
      ],
      spans: [{ description: `GET /api/media/1?t=${TOKEN}`, data: { "http.url": `/p/${TOKEN}` } }],
      contexts: { trace: { data: { "http.url": `https://app.example.com/p/${TOKEN}` } } },
    });

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(TOKEN);
    // ההסרה אינה משמידה את המידע השימושי: עדיין רואים באיזה מסך מדובר
    expect(event.transaction).toBe(`/p/${REDACTED}/ticket-1`);
    expect(event.request?.headers?.["User-Agent"]).toBe("x");
  });

  it("אינו נופל על אירוע חסר שדות", () => {
    expect(() => scrubEvent({})).not.toThrow();
    expect(() => scrubEvent({ request: {}, breadcrumbs: [], spans: [] })).not.toThrow();
  });

  it("מטפל ב-query_string שאינו מחרוזת", () => {
    const asRecord = scrubEvent({ request: { query_string: { t: TOKEN, x: "1" } } });
    expect(JSON.stringify(asRecord)).not.toContain(TOKEN);

    const asPairs = scrubEvent({ request: { query_string: [["t", `${TOKEN}`]] } });
    expect(JSON.stringify(asPairs)).not.toContain(TOKEN);
  });
});
