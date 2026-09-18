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

/**
 * שלוש הבדיקות של קליטת הפניות במייל (1.3).
 *
 * כולן שומרות על אותה הבטחה — **EM-12**, מייל חוזר תוך חמש דקות — משלושה
 * כיוונים שאף אחד מארבעת ה-checks הקודמים אינו רואה: טיימר שמת, הודעה
 * שנקלטה ואיש לא הכריע בה, ותצורה חסרה שמשתיקה את הצינור כולו.
 */

/** מדליק/מכבה את דגלי הקליטה. שלושתם יחד, כדי ששארית מבדיקה קודמת לא תדליף. */
function setIntakeEnv(values: {
  enabled?: string;
  nonprod?: string;
  nodeEnv?: string;
  gmailUser?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  gemini?: string;
}) {
  vi.stubEnv("EMAIL_INTAKE_ENABLED", values.enabled);
  vi.stubEnv("EMAIL_INTAKE_NONPROD", values.nonprod);
  vi.stubEnv("NODE_ENV", values.nodeEnv ?? "test");
  vi.stubEnv("GMAIL_USER", values.gmailUser);
  vi.stubEnv("GOOGLE_CLIENT_ID", values.clientId);
  vi.stubEnv("GOOGLE_CLIENT_SECRET", values.clientSecret);
  vi.stubEnv("GMAIL_REFRESH_TOKEN", values.refreshToken);
  vi.stubEnv("GEMINI_API_KEY", values.gemini);
}

describe("EM-12 — email-poll-heartbeat", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** דולק מחוץ לפרודקשן דורש את שני הדגלים — ראה `env.emailIntakeEnabled` */
  function enable() {
    setIntakeEnv({ enabled: "1", nonprod: "1" });
  }

  it("היכולת כבויה — פעימה חסרה אינה כשל", async () => {
    // עד S9 זהו המצב בכל הסביבות: אין טיימר, ולכן אין למה לצפות.
    setIntakeEnv({});
    await expect(check("email-poll-heartbeat").run(now)).resolves.toBeUndefined();
  });

  it("היכולת דלוקה ופעימה טרייה — עובר", async () => {
    enable();
    await setHeartbeat(HEARTBEAT.emailPoll, new Date(now.getTime() - 2 * 60_000));
    await expect(check("email-poll-heartbeat").run(now)).resolves.toBeUndefined();
  });

  it("היכולת דלוקה ופעימה בת 20 דקות — זורק", async () => {
    // הטיימר רץ כל 60 שניות; 20 דקות הן עשרים סבבים שלא קרו.
    enable();
    await setHeartbeat(HEARTBEAT.emailPoll, new Date(now.getTime() - 20 * 60_000));
    await expect(check("email-poll-heartbeat").run(now)).rejects.toThrow();
  });

  it("היכולת דלוקה ואין פעימה כלל — זורק", async () => {
    // המקרה שהזריעה בעליית ה-worker (`seedHeartbeat`) קיימת בשבילו: בלעדיה
    // הפריסה הראשונה הייתה מתריעה על שווא, ועם זריעה בלבד — טיימר שמעולם
    // לא עלה מתגלה אחרי רבע שעה.
    enable();
    await expect(check("email-poll-heartbeat").run(now)).rejects.toThrow(/מעולם לא רץ/);
  });

  it("הפעימה של המייל אינה מתבלבלת עם פעימות ההסלמה והגיבוי", async () => {
    // שלוש פעימות בטבלה אחת, ולכן שם שגוי היה נקרא כרעננות של מישהו אחר.
    enable();
    await setHeartbeat(HEARTBEAT.escalation, now);
    await setHeartbeat(HEARTBEAT.backup, now);
    await expect(check("email-poll-heartbeat").run(now)).rejects.toThrow();
  });
});

describe("EM-12 — email-intake-not-stuck", () => {
  async function mail(data: {
    direction?: "INBOUND" | "OUTBOUND";
    state?: "PENDING" | "DONE" | "SENT";
    ageMinutes: number;
    nextAttemptAt?: Date;
  }) {
    await db.mailboxMessage.create({
      data: {
        direction: data.direction ?? "INBOUND",
        state: data.state ?? "PENDING",
        createdAt: new Date(now.getTime() - data.ageMinutes * 60_000),
        nextAttemptAt: data.nextAttemptAt ?? null,
      },
    });
  }

  it("אין הודעות — עובר", async () => {
    await expect(check("email-intake-not-stuck").run(now)).resolves.toBeUndefined();
  });

  it("הודעה נכנסת שממתינה 40 דקות — זורקת", async () => {
    // קריסה בין claim ל-complete משאירה בדיוק את זה: שורה PENDING בלי ג׳וב
    // שיטפל בה. `queue-not-stuck` מביט בטבלת Job ואינו רואה אותה.
    await mail({ ageMinutes: 40 });
    await expect(check("email-intake-not-stuck").run(now)).rejects.toThrow(/1/);
  });

  it("הודעה בת 5 דקות היא הודעה בדרך, לא תקועה", async () => {
    await mail({ ageMinutes: 5 });
    await expect(check("email-intake-not-stuck").run(now)).resolves.toBeUndefined();
  });

  it("הודעה ישנה עם nextAttemptAt עתידי היא backoff מתוכנן ואינה תקועה", async () => {
    // כשל זמני מול Gmail דוחה עד שעה. אזעקה על המתנה מתוכננת היא בדיוק
    // האזעקה שלומדים להתעלם ממנה.
    await mail({ ageMinutes: 40, nextAttemptAt: new Date(now.getTime() + 10 * 60_000) });
    await expect(check("email-intake-not-stuck").run(now)).resolves.toBeUndefined();
  });

  it("הודעה ישנה שמועד הניסיון החוזר שלה כבר עבר — זורקת", async () => {
    await mail({ ageMinutes: 40, nextAttemptAt: new Date(now.getTime() - 60_000) });
    await expect(check("email-intake-not-stuck").run(now)).rejects.toThrow();
  });

  it("הודעה נכנסת שהוכרעה אינה נספרת", async () => {
    await mail({ ageMinutes: 40, state: "DONE" });
    await expect(check("email-intake-not-stuck").run(now)).resolves.toBeUndefined();
  });

  it("תשובה יוצאת שלא נשלחה 40 דקות — זורקת גם היא", async () => {
    // שני הכיוונים באותה בדיקה: בנכנס מישהו כתב ולא הוכרע, ביוצא הוכרע
    // ולא נענה. מבחינת השולח שני המקרים זהים — שקט.
    await mail({ direction: "OUTBOUND", ageMinutes: 40 });
    await expect(check("email-intake-not-stuck").run(now)).rejects.toThrow();
  });

  it("תשובה שנשלחה אינה נספרת", async () => {
    await mail({ direction: "OUTBOUND", state: "SENT", ageMinutes: 40 });
    await expect(check("email-intake-not-stuck").run(now)).resolves.toBeUndefined();
  });
});

describe("EM-12 — email-intake-configured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const FULL = {
    enabled: "1",
    nodeEnv: "production",
    gmailUser: "office@example.com",
    clientId: "client-id",
    clientSecret: "client-secret",
    refreshToken: "refresh-token",
    gemini: "gemini-key",
  };

  it("פרודקשן עם תצורה מלאה — עובר", async () => {
    setIntakeEnv(FULL);
    await expect(check("email-intake-configured").run(now)).resolves.toBeUndefined();
  });

  it("היכולת כבויה בפרודקשן — היעדר תצורה אינו כשל", async () => {
    // יכולת כבויה אינה "תצורה חסרה" אלא החלטה, וזה המצב עד S9.
    setIntakeEnv({ nodeEnv: "production" });
    await expect(check("email-intake-configured").run(now)).resolves.toBeUndefined();
  });

  it("בלי refresh token — זורק ונוקב בשם המשתנה", async () => {
    setIntakeEnv({ ...FULL, refreshToken: undefined });
    await expect(check("email-intake-configured").run(now)).rejects.toThrow(
      /GMAIL_REFRESH_TOKEN/,
    );
  });

  it("בלי כתובת התיבה — זורק", async () => {
    // בלי GMAIL_USER אין מול מה לאמת שקוראים את התיבה הנכונה, והסבב נעצר.
    setIntakeEnv({ ...FULL, gmailUser: undefined });
    await expect(check("email-intake-configured").run(now)).rejects.toThrow(/GMAIL_USER/);
  });

  it("בלי מפתח החילוץ — זורק", async () => {
    // בלי Gemini כל מייל נוחת במסלול "החילוץ אינו זמין" (EM-11): המערכת
    // "עובדת" ויוצרת טיוטות ריקות מתוכן. החריג הופך לכלל, בשקט.
    setIntakeEnv({ ...FULL, gemini: undefined });
    await expect(check("email-intake-configured").run(now)).rejects.toThrow(/GEMINI_API_KEY/);
  });

  it("מכונת פיתוח שהדליקה את היכולת ביודעין אינה נחשבת תקלת תצורה", async () => {
    setIntakeEnv({ enabled: "1", nonprod: "1", nodeEnv: "development" });
    await expect(check("email-intake-configured").run(now)).resolves.toBeUndefined();
  });
});
