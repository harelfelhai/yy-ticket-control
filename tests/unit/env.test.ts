import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";

/**
 * דגלי קליטת הפניות במייל (1.3).
 *
 * הפונקציות האלה הן **שומר הסף היחיד** בין קוד שכבר יודע לקרוא תיבת דואר
 * לבין התיבה המשותפת האמיתית. כל עוד S9 לא הגיע, התשובה הנכונה כמעט תמיד
 * היא `false` — ולכן הבדיקות כאן מונות בעיקר את המקרים שבהם היא **אינה**
 * מדליקה, ולא את המקרה שבו היא כן.
 *
 * `vi.stubEnv` ולא הצבה ישירה: `NODE_ENV` הוא readonly בטיפוסים, ו-Vitest
 * משחזר את הסביבה לבד ב-`unstubAllEnvs`.
 */

function setEnv(values: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("emailIntakeEnabled — הדגל שמתחיל לקרוא דואר", () => {
  it("כבוי כשאין משתנה כלל — זהו המצב עד S9", () => {
    setEnv({
      EMAIL_INTAKE_ENABLED: undefined,
      EMAIL_INTAKE_NONPROD: undefined,
      NODE_ENV: "production",
    });
    expect(env.emailIntakeEnabled()).toBe(false);
  });

  it("דלוק בפרודקשן עם EMAIL_INTAKE_ENABLED=1", () => {
    setEnv({ EMAIL_INTAKE_ENABLED: "1", EMAIL_INTAKE_NONPROD: undefined, NODE_ENV: "production" });
    expect(env.emailIntakeEnabled()).toBe(true);
  });

  it("הדגל לבדו אינו מספיק מחוץ לפרודקשן — זו התאונה שהתנאי השני מונע", () => {
    // מפתח שהעתיק את משתני הפרודקשן ל-.env.local כדי לשחזר באג מקבל איתם
    // את GMAIL_REFRESH_TOKEN של התיבה המשותפת. בלי התנאי הזה שרת הפיתוח שלו
    // היה מתחיל לקרוא דואר אמיתי ולענות לשולחים.
    setEnv({ EMAIL_INTAKE_ENABLED: "1", EMAIL_INTAKE_NONPROD: undefined, NODE_ENV: "development" });
    expect(env.emailIntakeEnabled()).toBe(false);
  });

  it("מחוץ לפרודקשן נדרש ויתור מפורש — שני המשתנים יחד", () => {
    setEnv({ EMAIL_INTAKE_ENABLED: "1", EMAIL_INTAKE_NONPROD: "1", NODE_ENV: "development" });
    expect(env.emailIntakeEnabled()).toBe(true);
  });

  it("EMAIL_INTAKE_NONPROD לבדו אינו מדליק דבר", () => {
    setEnv({ EMAIL_INTAKE_ENABLED: undefined, EMAIL_INTAKE_NONPROD: "1", NODE_ENV: "development" });
    expect(env.emailIntakeEnabled()).toBe(false);
  });

  it("test נחשב כמחוץ לפרודקשן: חבילת הבדיקות לעולם אינה מדליקה את היכולת", () => {
    setEnv({ EMAIL_INTAKE_ENABLED: "1", EMAIL_INTAKE_NONPROD: undefined, NODE_ENV: "test" });
    expect(env.emailIntakeEnabled()).toBe(false);
  });

  it.each(["true", "yes", "on", "0", "", " 1", "1 "])(
    'הערך %j אינו "1" ולכן אינו מדליק',
    (value) => {
      // השוואה מדויקת כמו ב-MEDIA_STORAGE=local: יכולת שעונה לאנשים אמיתיים
      // אינה נדלקת מטעות הקלדה או מערך שנראה נכון.
      setEnv({ EMAIL_INTAKE_ENABLED: value, EMAIL_INTAKE_NONPROD: undefined, NODE_ENV: "production" });
      expect(env.emailIntakeEnabled()).toBe(false);
    },
  );

  it("EMAIL_INTAKE_NONPROD שאינו 1 אינו פותח את הדלת", () => {
    setEnv({ EMAIL_INTAKE_ENABLED: "1", EMAIL_INTAKE_NONPROD: "true", NODE_ENV: "development" });
    expect(env.emailIntakeEnabled()).toBe(false);
  });
});

describe("emailIntakePilotAddresses — חיתוך הפיילוט", () => {
  function pilot(value: string | undefined): string[] {
    setEnv({ EMAIL_INTAKE_PILOT_ADDRESSES: value });
    return env.emailIntakePilotAddresses();
  }

  it("לא מוגדר — רשימה ריקה, כלומר בלי פיילוט", () => {
    expect(pilot(undefined)).toEqual([]);
  });

  it("מחרוזת ריקה נקראת כלא-מוגדר, ולא כרשימה עם כתובת ריקה", () => {
    // e2e/server-env.ts מאפס את המשתנה ל-"" בדיוק בהנחה הזו. רשימה עם
    // איבר ריק הייתה חיתוך שלא מתאים לאיש — כלומר קליטה שקטה של אפס מיילים.
    expect(pilot("")).toEqual([]);
  });

  it("כתובת אחת", () => {
    expect(pilot("dani@example.com")).toEqual(["dani@example.com"]);
  });

  it("מפוצל בפסיקים, מנורמל לאותיות קטנות ובלי רווחים", () => {
    // הנרמול הוא אותו `normalizeEmail` של כתובות המשתמשים. בלעדיו
    // "Dani@Example.com" בסביבה לא היה מתאים לכתובת שבבסיס הנתונים,
    // והפיילוט היה נראה כמי שאינו קולט דבר.
    expect(pilot(" Dani@Example.com , RUTI@Example.COM ")).toEqual([
      "dani@example.com",
      "ruti@example.com",
    ]);
  });

  it("פסיקים מיותרים ורווחים בלבד נזרקים", () => {
    expect(pilot(",, dani@example.com ,  , ")).toEqual(["dani@example.com"]);
  });

  it("אותה כתובת פעמיים, בכתיב שונה, נספרת פעם אחת", () => {
    expect(pilot("dani@example.com,DANI@example.com")).toEqual(["dani@example.com"]);
  });
});

describe("isProduction", () => {
  it("נגזר מ-NODE_ENV בלבד", () => {
    setEnv({ NODE_ENV: "production" });
    expect(env.isProduction()).toBe(true);

    setEnv({ NODE_ENV: "test" });
    expect(env.isProduction()).toBe(false);
  });
});
