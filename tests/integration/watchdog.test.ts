import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JOB_TYPES } from "@/jobs/types";
import { db } from "@/lib/db";
import { checks } from "@/watchdog/checks";
import { HEARTBEAT, setHeartbeat } from "@/watchdog/heartbeat";
import { resetDb } from "../helpers/reset-db";

/**
 * ה-checks של ה-watchdog מול DB אמיתי: הם הרשת שתופסת כשל שקט, ולכן חייבים
 * לעבור כשהמצב תקין ולזרוק כשהוא לא — שני המסלולים.
 */

const now = new Date("2026-07-15T12:00:00.000Z");
const HOUR = 60 * 60_000;

function check(name: string) {
  const found = checks.find((c) => c.name === name);
  if (!found) throw new Error(`אין check בשם ${name}`);
  return found;
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("escalation-heartbeat", () => {
  it("פעימה טרייה עוברת", async () => {
    await setHeartbeat(HEARTBEAT.escalation, new Date(now.getTime() - HOUR));
    await expect(check("escalation-heartbeat").run(now)).resolves.toBeUndefined();
  });

  it("פעימה חסרה זורקת", async () => {
    await expect(check("escalation-heartbeat").run(now)).rejects.toThrow();
  });

  it("פעימה ישנה מ-26 שעות זורקת", async () => {
    await setHeartbeat(HEARTBEAT.escalation, new Date(now.getTime() - 30 * HOUR));
    await expect(check("escalation-heartbeat").run(now)).rejects.toThrow();
  });
});

describe("backup-heartbeat", () => {
  it("פעימה טרייה עוברת", async () => {
    await setHeartbeat(HEARTBEAT.backup, new Date(now.getTime() - HOUR));
    await expect(check("backup-heartbeat").run(now)).resolves.toBeUndefined();
  });

  it("פעימה ישנה מ-27 שעות זורקת", async () => {
    await setHeartbeat(HEARTBEAT.backup, new Date(now.getTime() - 30 * HOUR));
    await expect(check("backup-heartbeat").run(now)).rejects.toThrow();
  });
});

describe("queue-not-stuck", () => {
  it("תור נקי עובר", async () => {
    await expect(check("queue-not-stuck").run(now)).resolves.toBeUndefined();
  });

  it("PENDING באיחור מעל הסף זורק — לולאת ה-poll כנראה מתה", async () => {
    await db.job.create({
      data: {
        type: JOB_TYPES.notify,
        payload: {},
        status: "PENDING",
        runAt: new Date(now.getTime() - HOUR),
      },
    });
    await expect(check("queue-not-stuck").run(now)).rejects.toThrow();
  });

  it("PENDING עתידי (backoff של retry) אינו נחשב תקוע", async () => {
    await db.job.create({
      data: {
        type: JOB_TYPES.notify,
        payload: {},
        status: "PENDING",
        runAt: new Date(now.getTime() + 5 * 60_000),
      },
    });
    await expect(check("queue-not-stuck").run(now)).resolves.toBeUndefined();
  });
});

/**
 * ה-check שנולד מהכשל האמיתי: 14 ג'ובי מייל ו-32 ג'ובי גיבוי נכשלו סופית
 * בפרודקשן לאורך חודש, ואף אחת משלוש הבדיקות הקודמות לא ראתה אותם —
 * התור לא היה תקוע, וההסלמה המשיכה לרשום פעימות.
 */
describe("jobs-not-failing", () => {
  async function failed(type: string, runAt: Date) {
    await db.job.create({
      data: { type, payload: {}, status: "FAILED", attempts: 3, runAt },
    });
  }

  it("אין כשלים — עובר", async () => {
    await expect(check("jobs-not-failing").run(now)).resolves.toBeUndefined();
  });

  it("כשל סופי בחלון זורק, וההודעה נוקבת בסוג", async () => {
    await failed(JOB_TYPES.notify, new Date(now.getTime() - 2 * HOUR));
    await expect(check("jobs-not-failing").run(now)).rejects.toThrow(JOB_TYPES.notify);
  });

  it("כשל ישן מ-24 שעות מתיישן ואינו מתריע עוד", async () => {
    // אזעקה שאי אפשר לכבות נלמדת להתעלם. כשל בודד שנפתר חייב להיסגר מעצמו.
    await failed(JOB_TYPES.notify, new Date(now.getTime() - 30 * HOUR));
    await expect(check("jobs-not-failing").run(now)).resolves.toBeUndefined();
  });

  it("ג'וב שנכשל זמנית וממתין לניסיון חוזר אינו נחשב כשל", async () => {
    // ‏PENDING עם `lastError` הוא retry בדרך, לא עבודה שאבדה.
    await db.job.create({
      data: {
        type: JOB_TYPES.notify,
        payload: {},
        status: "PENDING",
        attempts: 1,
        lastError: "timeout",
        runAt: new Date(now.getTime() + 60_000),
      },
    });
    await expect(check("jobs-not-failing").run(now)).resolves.toBeUndefined();
  });
});

/**
 * ‏invariant של **תצורה** ולא של מצב (1.2).
 *
 * זהו הכשל שאף אחד מארבעת ה-checks האחרים אינו תופס: התחברות בגוגל שאינה
 * מוגדרת אינה ג׳וב, ולכן היא אינה מייצרת כשל, לא פעימה ישנה ולא תור תקוע.
 * היא פשוט **אינה קורית** — והכפתור שאינו מוצג אינו מדווח על עצמו.
 */
describe("google-login-configured", () => {
  /**
   * ‏`vi.stubEnv` ולא הצבה ישירה: `process.env` ב-Node אינו מקבל
   * ‏`defineProperty` חלקי, ו-`NODE_ENV` הוא readonly בטיפוסים. ‏Vitest
   * מטפל בשניהם ומשחזר לבד ב-`unstubAllEnvs`.
   */
  function setEnv(id: string | undefined, secret: string | undefined, nodeEnv: string) {
    vi.stubEnv("GOOGLE_CLIENT_ID", id);
    vi.stubEnv("GOOGLE_CLIENT_SECRET", secret);
    vi.stubEnv("NODE_ENV", nodeEnv);
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("פרודקשן עם שני המשתנים — עובר", async () => {
    setEnv("client-id", "client-secret", "production");
    await expect(check("google-login-configured").run(now)).resolves.toBeUndefined();
  });

  it("פרודקשן בלי תצורה — זורק", async () => {
    setEnv(undefined, undefined, "production");
    await expect(check("google-login-configured").run(now)).rejects.toThrow(
      /GOOGLE_CLIENT_ID/,
    );
  });

  it("פרודקשן עם מפתח אחד מתוך שניים — זורק", async () => {
    // כול-או-כלום: "כמעט מוגדר" הוא כפתור שמפנה לגוגל וחוזר בשגיאה.
    setEnv("client-id", undefined, "production");
    await expect(check("google-login-configured").run(now)).rejects.toThrow();
  });

  it("מחוץ לפרודקשן היעדר תצורה אינו כשל", async () => {
    // בפיתוח ובבדיקות זה המצב הרגיל, וההתחברות בסיסמה מכסה את הכול.
    setEnv(undefined, undefined, "development");
    await expect(check("google-login-configured").run(now)).resolves.toBeUndefined();
  });
});
