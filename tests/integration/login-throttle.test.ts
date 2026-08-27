import { beforeEach, describe, expect, it } from "vitest";
import { LOGIN_MAX_FAILURES, authenticateThrottled, hashPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { resetDb } from "../helpers/reset-db";

/**
 * הגבלת ההתחברות היא ההגנה מפני ניחוש סיסמאות. הבדיקה מריצה את המסלול
 * המלא מול DB אמיתי, כולל אימות argon2, כי כאן נבדק שילוב של שניהם: מתי
 * נחסמים, ומה מאפס.
 */

const PHONE = "0501234567";
const PASSWORD = "sod-nachon-123";
const T0 = new Date("2026-07-24T06:00:00.000Z");

beforeEach(async () => {
  await resetDb();
  await db.user.create({
    data: {
      role: "ADMIN",
      name: "מנהל",
      phone: PHONE,
      passwordHash: await hashPassword(PASSWORD),
    },
  });
});

describe("authenticateThrottled", () => {
  it("סיסמה נכונה מצליחה", async () => {
    const r = await authenticateThrottled(PHONE, PASSWORD, T0);
    expect(r.ok).toBe(true);
  });

  it("חוסם אחרי מכסת הכשלונות — ואז גם הסיסמה הנכונה חסומה עד תום החלון", async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      expect(await authenticateThrottled(PHONE, "wrong", T0)).toEqual({
        ok: false,
        reason: "invalid",
      });
    }

    const blocked = await authenticateThrottled(PHONE, PASSWORD, T0);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error("ציפינו לחסימה");
    expect(blocked.reason).toBe("rate_limited");
    if (blocked.reason === "rate_limited") {
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("התחברות מוצלחת מאפסת את מונה הכשלים", async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) {
      await authenticateThrottled(PHONE, "wrong", T0);
    }
    // הצלחה על הסף מאפסת, ולכן אינה נחסמת
    expect((await authenticateThrottled(PHONE, PASSWORD, T0)).ok).toBe(true);
    // ואחרי האיפוס אפשר שוב לטעות בלי חסימה מיידית
    expect(await authenticateThrottled(PHONE, "wrong", T0)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("צורות שונות של אותו מזהה נספרות יחד", async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      await authenticateThrottled("050-123-4567", "wrong", T0);
    }
    // אותו חשבון, מוקלד אחרת — כבר חסום
    const r = await authenticateThrottled("0501234567", PASSWORD, T0);
    expect(r.ok).toBe(false);
  });

  /**
   * רגרסיה לפרצה שבה ההגבלה הייתה ניתנת לעקיפה מלאה.
   *
   * ‏`normalizePhone` מסיר כל תו שאינו ספרה, ולכן "0501234567@כלשהו" נפתר
   * לאותו טלפון ומוצא את אותו משתמש — אבל מפתח ההגבלה נבנה קודם לכן לפי
   * הסתעפות אחרת (`includes("@")` → מייל), וכל סיומת ייחודית קיבלה מכסה
   * חדשה. כלומר מספר הניסיונות לא היה חסום כלל.
   *
   * הבדיקה שורפת את המכסה בצורה אחת ומוודאת שהווריאציות **אינן** פותחות
   * מכסה נוספת מול אותו חשבון.
   */
  it("סיומת אחרי @ אינה פותחת מכסת ניסיונות חדשה (רגרסיית עקיפה)", async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      await authenticateThrottled(PHONE, "wrong", T0);
    }

    for (const variant of [
      `${PHONE}@a`,
      `${PHONE}@b`,
      "050-123-4567@q",
      "+972501234567@k",
    ]) {
      const attempt = await authenticateThrottled(variant, PASSWORD, T0);
      expect(attempt.ok, `הווריאציה ${variant} עקפה את ההגבלה`).toBe(false);
      if (attempt.ok) throw new Error("ציפינו לחסימה");
      expect(attempt.reason, `הווריאציה ${variant} קיבלה מכסה חדשה`).toBe("rate_limited");
    }
  });

  it("חסימה חולפת אחרי חלון הזמן", async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      await authenticateThrottled(PHONE, "wrong", T0);
    }
    expect((await authenticateThrottled(PHONE, PASSWORD, T0)).ok).toBe(false);

    const later = new Date(T0.getTime() + 16 * 60 * 1000);
    expect((await authenticateThrottled(PHONE, PASSWORD, later)).ok).toBe(true);
  });
});
