import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";
import { type SenderMatch, cheapDecision } from "@/lib/whatsapp/decision";

/**
 * הדגלים של קליטת הוואטסאפ (1.4), וההכרעה הזולה שברישום ההודעה.
 *
 * הדגל הוא **שומר הסף** בין קוד שיודע לקלוט מהמספר העסקי לבין המספר האמיתי,
 * ולכן — כמו במייל (`env.test.ts`) — הבדיקות מונות בעיקר מתי הוא **אינו**
 * מדליק.
 */

function setEnv(values: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("whatsapp — הצד של Meta, כול-או-כלום", () => {
  it("בלי סוד או בלי verify token — אין תצורה, וה-webhook מחזיר 404", () => {
    setEnv({ WHATSAPP_APP_SECRET: undefined, WHATSAPP_VERIFY_TOKEN: "v" });
    expect(env.whatsapp()).toBeUndefined();
    setEnv({ WHATSAPP_APP_SECRET: "s", WHATSAPP_VERIFY_TOKEN: "" });
    expect(env.whatsapp()).toBeUndefined();
  });

  it("עם שניהם — התצורה, וגרסת ה-Graph ברירת מחדל v25.0", () => {
    setEnv({ WHATSAPP_APP_SECRET: "s", WHATSAPP_VERIFY_TOKEN: "v", WHATSAPP_GRAPH_VERSION: undefined });
    expect(env.whatsapp()).toEqual({ appSecret: "s", verifyToken: "v", graphVersion: "v25.0" });
    setEnv({ WHATSAPP_GRAPH_VERSION: "v26.0" });
    expect(env.whatsapp()?.graphVersion).toBe("v26.0");
  });
});

describe("whatsappIntakeEnabled — הדגל שמתחיל לקלוט מהמספר העסקי", () => {
  it("כבוי כשאין משתנה כלל", () => {
    setEnv({ WHATSAPP_INTAKE_ENABLED: undefined, WHATSAPP_INTAKE_NONPROD: undefined, NODE_ENV: "production" });
    expect(env.whatsappIntakeEnabled()).toBe(false);
  });

  it("דלוק בפרודקשן עם WHATSAPP_INTAKE_ENABLED=1", () => {
    setEnv({ WHATSAPP_INTAKE_ENABLED: "1", WHATSAPP_INTAKE_NONPROD: undefined, NODE_ENV: "production" });
    expect(env.whatsappIntakeEnabled()).toBe(true);
  });

  it("הדגל לבדו אינו מספיק מחוץ לפרודקשן — שרת פיתוח עם משתני פרודקשן אינו קולט", () => {
    setEnv({ WHATSAPP_INTAKE_ENABLED: "1", WHATSAPP_INTAKE_NONPROD: undefined, NODE_ENV: "development" });
    expect(env.whatsappIntakeEnabled()).toBe(false);
    setEnv({ NODE_ENV: "test" });
    expect(env.whatsappIntakeEnabled()).toBe(false);
  });

  it("מחוץ לפרודקשן נדרש ויתור מפורש — שני המשתנים יחד", () => {
    setEnv({ WHATSAPP_INTAKE_ENABLED: "1", WHATSAPP_INTAKE_NONPROD: "1", NODE_ENV: "development" });
    expect(env.whatsappIntakeEnabled()).toBe(true);
  });

  it.each(["true", "yes", "0", "", " 1"])('הערך %j אינו "1" ולכן אינו מדליק', (value) => {
    setEnv({ WHATSAPP_INTAKE_ENABLED: value, NODE_ENV: "production" });
    expect(env.whatsappIntakeEnabled()).toBe(false);
  });
});

describe("whatsappPilotPhones — חיתוך הפיילוט", () => {
  it("ריק — בלי פיילוט", () => {
    setEnv({ WHATSAPP_INTAKE_PILOT_PHONES: undefined });
    expect(env.whatsappPilotPhones()).toEqual([]);
  });

  it("מנורמל לצורה שבכרטיס, בלי כפילויות ובלי ריקים", () => {
    setEnv({ WHATSAPP_INTAKE_PILOT_PHONES: "050-1234567, +972501234567,,0521112222" });
    expect(env.whatsappPilotPhones()).toEqual(["0501234567", "0521112222"]);
  });
});

describe("cheapDecision — מה מוכרע כבר ברישום", () => {
  const CONNECTED = { status: "CONNECTED", activatedAt: new Date("2026-10-04T10:00:00Z") };
  const USER: SenderMatch = { kind: "user", userId: "u1" };
  const after = new Date("2026-10-04T11:00:00Z");

  function decide(overrides: Partial<Parameters<typeof cheapDecision>[0]> = {}) {
    return cheapDecision({
      enabled: true,
      number: CONNECTED,
      message: { sentAt: after, type: "text", text: "תקלה בדירה 12" },
      sender: USER,
      ...overrides,
    });
  }

  it("משתמש מורשה, סוג שנקלט — ממתין לקיבוץ (null)", () => {
    expect(decide()).toBeNull();
    for (const type of ["image", "audio", "video", "document"]) {
      expect(decide({ message: { sentAt: after, type, text: null } })).toBeNull();
    }
  });

  it("WA-19 — קליטה כבויה, או מספר שאינו מחובר: IGNORED_DISABLED, לפני כל בדיקה אחרת", () => {
    expect(decide({ enabled: false })).toBe("IGNORED_DISABLED");
    expect(decide({ number: { ...CONNECTED, status: "ERROR" } })).toBe("IGNORED_DISABLED");
    expect(decide({ enabled: false, sender: { kind: "unauthorized" } })).toBe("IGNORED_DISABLED");
  });

  it("WA-14 — הודעה שנכתבה לפני החיבור: היסטוריה, לא קלט", () => {
    expect(decide({ message: { sentAt: new Date("2026-10-04T09:59:59Z"), type: "text", text: "תקלה" } })).toBe(
      "IGNORED_BEFORE_ACTIVATION",
    );
  });

  it("WA-03 — מספר שאינו של משתמש מורשה: IGNORED_UNAUTHORIZED, גם כשיש בהודעה \"תקלה\"", () => {
    expect(decide({ sender: { kind: "unauthorized" } })).toBe("IGNORED_UNAUTHORIZED");
  });

  it("WA-21 — טלפון מוסתר ומזהה לא מוכר: נספר רק כשיש \"תקלה\" בטקסט או בכיתוב", () => {
    expect(decide({ sender: { kind: "unidentified" } })).toBe("IGNORED_UNIDENTIFIED");
    expect(decide({ sender: { kind: "unidentified" }, message: { sentAt: after, type: "text", text: "מה נשמע" } })).toBe(
      "IGNORED_UNAUTHORIZED",
    );
    // הקלטה של מי שאינו מזוהה אינה מתומללת (§7 שורה 95)
    expect(decide({ sender: { kind: "unidentified" }, message: { sentAt: after, type: "audio", text: null } })).toBe(
      "IGNORED_UNAUTHORIZED",
    );
  });

  it("WA-06 — סטיקר, תגובת אימוג'י, מיקום, איש קשר וסוג לא מוכר: IGNORED_UNSUPPORTED", () => {
    for (const type of ["sticker", "reaction", "location", "contacts", "unsupported", "something_new"]) {
      expect(decide({ message: { sentAt: after, type, text: null } })).toBe("IGNORED_UNSUPPORTED");
    }
  });

  it("השולח נבדק לפני הסוג: על סטיקר של זר לא נרשם שהוא סטיקר", () => {
    expect(decide({ sender: { kind: "unauthorized" }, message: { sentAt: after, type: "sticker", text: null } })).toBe(
      "IGNORED_UNAUTHORIZED",
    );
  });
});
