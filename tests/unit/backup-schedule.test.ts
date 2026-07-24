import { describe, expect, it } from "vitest";
import { nextBackupRun } from "@/jobs/schedule";

/**
 * ‏03:00 שעון ישראל, נשמר כ-UTC. אותו חישוב DST כמו ההסלמה, שעה שקטה אחרת.
 * חורף (UTC+2): 03:00 מקומי = 01:00 UTC. קיץ (UTC+3): 03:00 מקומי = 00:00 UTC.
 */
describe("nextBackupRun", () => {
  it("חורף: 03:00 בישראל הוא 01:00 UTC", () => {
    // 00:00 UTC = 02:00 בישראל (לפני 03:00) → היעד הוא היום.
    expect(nextBackupRun(new Date("2026-01-15T00:00:00Z")).toISOString()).toBe(
      "2026-01-15T01:00:00.000Z",
    );
  });

  it("חורף אחרי 03:00: היעד הוא מחר", () => {
    // 02:00 UTC = 04:00 בישראל (אחרי 03:00) → מחר.
    expect(nextBackupRun(new Date("2026-01-15T02:00:00Z")).toISOString()).toBe(
      "2026-01-16T01:00:00.000Z",
    );
  });

  it("קיץ: 03:00 בישראל הוא 00:00 UTC", () => {
    // 22:00 UTC (14/7) = 01:00 בישראל בקיץ (15/7, לפני 03:00) → היעד היום (15/7).
    expect(nextBackupRun(new Date("2026-07-14T22:00:00Z")).toISOString()).toBe(
      "2026-07-15T00:00:00.000Z",
    );
  });

  it("התוצאה תמיד בעתיד", () => {
    const now = new Date("2026-03-20T12:34:56Z");
    expect(nextBackupRun(now).getTime()).toBeGreaterThan(now.getTime());
  });
});
