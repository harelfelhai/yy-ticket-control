import { describe, expect, it } from "vitest";
import { nextEscalationRun } from "@/jobs/schedule";

/**
 * ‏06:00 שעון ישראל, נשמר כ-UTC.
 *
 * הבדיקה מקבעת את שתי העונות, כי כאן טמון הבאג הקלאסי: קיבוע היסט (למשל
 * "תמיד UTC+2") היה מזיז את הריצה בקיץ לשעה 07:00 מקומית. עונת הקיץ בישראל
 * היא UTC+3, ולכן 06:00 מקומי הוא 03:00 UTC ולא 04:00.
 */
describe("nextEscalationRun", () => {
  it("חורף: 06:00 בישראל הוא 04:00 UTC", () => {
    // 00:00 UTC = 02:00 בישראל (לפני 06:00) → היעד הוא היום.
    expect(nextEscalationRun(new Date("2026-01-15T00:00:00Z")).toISOString()).toBe(
      "2026-01-15T04:00:00.000Z",
    );
  });

  it("חורף אחרי 06:00: היעד הוא מחר", () => {
    // 05:00 UTC = 07:00 בישראל (אחרי 06:00) → מחר.
    expect(nextEscalationRun(new Date("2026-01-15T05:00:00Z")).toISOString()).toBe(
      "2026-01-16T04:00:00.000Z",
    );
  });

  it("קיץ: 06:00 בישראל הוא 03:00 UTC", () => {
    // 00:00 UTC = 03:00 בישראל (שעון קיץ, UTC+3) → היעד הוא היום.
    expect(nextEscalationRun(new Date("2026-07-15T00:00:00Z")).toISOString()).toBe(
      "2026-07-15T03:00:00.000Z",
    );
  });

  it("קיץ אחרי 06:00: היעד הוא מחר", () => {
    expect(nextEscalationRun(new Date("2026-07-15T04:00:00Z")).toISOString()).toBe(
      "2026-07-16T03:00:00.000Z",
    );
  });

  it("התוצאה תמיד בעתיד", () => {
    const now = new Date("2026-03-20T12:34:56Z");
    expect(nextEscalationRun(now).getTime()).toBeGreaterThan(now.getTime());
  });
});
