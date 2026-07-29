import { describe, expect, it } from "vitest";
import { heartbeatStale, queueStuck } from "@/watchdog/predicates";

/**
 * הפרדיקטים של ה-watchdog הם עכשיו load-bearing — התראה על גיבוי שנעצר
 * תלויה בהם. לכן הם נבדקים על שני המסלולים: טרי ועבר-את-הסף.
 */

const now = new Date("2026-07-15T12:00:00.000Z");
const HOUR = 60 * 60_000;

describe("heartbeatStale", () => {
  it("פעימה טרייה — אינה ישנה", () => {
    expect(heartbeatStale(new Date(now.getTime() - 1 * HOUR), now, 26 * HOUR)).toBe(false);
  });

  it("פעימה מעבר לסף — ישנה", () => {
    expect(heartbeatStale(new Date(now.getTime() - 27 * HOUR), now, 26 * HOUR)).toBe(true);
  });

  it("בדיוק על הסף — עדיין אינה ישנה", () => {
    expect(heartbeatStale(new Date(now.getTime() - 26 * HOUR), now, 26 * HOUR)).toBe(false);
  });

  it("אין פעימה כלל (null) — ישנה", () => {
    // המקרה הקריטי: ג'וב שמעולם לא רשם פעימה נחשב ישן, לא "תקין כברירת מחדל".
    expect(heartbeatStale(null, now, 26 * HOUR)).toBe(true);
  });
});

describe("queueStuck", () => {
  it("אין עבודות באיחור — התור אינו תקוע", () => {
    expect(queueStuck(0)).toBe(false);
  });

  it("ולו עבודה אחת באיחור — התור תקוע", () => {
    expect(queueStuck(1)).toBe(true);
  });
});
