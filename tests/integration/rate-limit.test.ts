import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  cleanupRateLimits,
  clearRateLimit,
  consumeRateLimit,
  peekRateLimit,
} from "@/lib/rate-limit";
import { PORTAL_ACTION_LIMIT, allowPortalAction } from "@/lib/services/portal";
import { resetDb } from "../helpers/reset-db";

/**
 * מגביל הקצב נבדק מול Postgres אמיתי ולא מול mock: האטומיות שעליה הוא נשען
 * (‏INSERT ... ON CONFLICT) היא התנהגות של בסיס הנתונים, ובדיקה מול זיכרון
 * הייתה מאמתת משהו אחר לגמרי.
 */

const WINDOW = 60_000;
const T0 = new Date("2026-07-24T06:00:00.000Z");

beforeEach(async () => {
  await resetDb();
});

describe("consumeRateLimit", () => {
  it("מתיר בדיוק limit אירועים ואז חוסם", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await consumeRateLimit("k", 3, WINDOW, T0)).allowed).toBe(true);
    }
    const blocked = await consumeRateLimit("k", 3, WINDOW, T0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("מתאפס אחרי שהחלון פג", async () => {
    await consumeRateLimit("k", 1, WINDOW, T0);
    expect((await consumeRateLimit("k", 1, WINDOW, T0)).allowed).toBe(false);

    const afterWindow = new Date(T0.getTime() + WINDOW + 1);
    expect((await consumeRateLimit("k", 1, WINDOW, afterWindow)).allowed).toBe(true);
  });

  it("מפתחות שונים נספרים בנפרד", async () => {
    expect((await consumeRateLimit("a", 1, WINDOW, T0)).allowed).toBe(true);
    expect((await consumeRateLimit("b", 1, WINDOW, T0)).allowed).toBe(true);
  });

  it("ספירה מקבילה אטומית — בדיוק limit מתירים גם ב-race", async () => {
    // עשר בקשות בו-זמנית על אותו מפתח: אילו הספירה הייתה קריאה-אז-כתיבה,
    // כמה מהן היו קוראות את אותו ערך ומתירות יחד. ON CONFLICT מסדר אותן.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => consumeRateLimit("race", 4, WINDOW, T0)),
    );
    expect(results.filter((r) => r.allowed).length).toBe(4);
  });
});

describe("peekRateLimit", () => {
  it("אינו סופר — בדיקה חוזרת אינה מזיזה את המונה", async () => {
    await consumeRateLimit("k", 1, WINDOW, T0); // מונה = 1, כבר בגבול
    expect((await peekRateLimit("k", 1, T0)).allowed).toBe(false);
    expect((await peekRateLimit("k", 1, T0)).allowed).toBe(false);
    expect((await db.rateLimit.findUnique({ where: { key: "k" } }))?.count).toBe(1);
  });

  it("מפתח שאינו קיים אינו חסום", async () => {
    expect((await peekRateLimit("nope", 5, T0)).allowed).toBe(true);
  });
});

describe("clearRateLimit / cleanupRateLimits", () => {
  it("clear מאפס מפתח בודד", async () => {
    await consumeRateLimit("k", 1, WINDOW, T0);
    await clearRateLimit("k");
    expect((await consumeRateLimit("k", 1, WINDOW, T0)).allowed).toBe(true);
  });

  it("cleanup מוחק רק חלונות שפגו", async () => {
    await consumeRateLimit("old", 5, WINDOW, T0);
    await consumeRateLimit("fresh", 5, WINDOW, new Date(T0.getTime() + WINDOW * 2));

    const now = new Date(T0.getTime() + WINDOW + 1); // אחרי old, לפני fresh
    expect(await cleanupRateLimits(now)).toBe(1);
    expect(await db.rateLimit.findUnique({ where: { key: "old" } })).toBeNull();
    expect(await db.rateLimit.findUnique({ where: { key: "fresh" } })).not.toBeNull();
  });
});

describe("allowPortalAction", () => {
  it("מתיר עד PORTAL_ACTION_LIMIT פעולות ואז חוסם", async () => {
    let allowed = 0;
    for (let i = 0; i < PORTAL_ACTION_LIMIT + 3; i++) {
      if (await allowPortalAction("prof-1", T0)) allowed++;
    }
    expect(allowed).toBe(PORTAL_ACTION_LIMIT);
  });
});
