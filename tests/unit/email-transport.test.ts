import { afterEach, describe, expect, it } from "vitest";
import { selectEmailTransport } from "@/lib/notifier/email";

/**
 * בחירת ערוץ המייל לפי הסביבה.
 *
 * החלטה קטנה עם השלכה גדולה: מערכת שנראית עובדת אך בשקט אינה מודיעה
 * לאיש היא בדיוק הכישלון שהמערכת הזו נבנתה כדי למנוע. לכן חוסר הגדרה
 * בפרודקשן חייב לזעוק, ובפיתוח חייב דווקא **לא** לחסום עבודה.
 */

const original = {
  key: process.env.RESEND_API_KEY,
  from: process.env.NOTIFY_FROM_EMAIL,
  nodeEnv: process.env.NODE_ENV,
};

afterEach(() => {
  process.env.RESEND_API_KEY = original.key;
  process.env.NOTIFY_FROM_EMAIL = original.from;
  process.env.NODE_ENV = original.nodeEnv;
});

/** ‏NODE_ENV הוא לקריאה בלבד בטיפוסים של Node; בבדיקה מותר לשנות אותו */
function setNodeEnv(value: string) {
  (process.env as Record<string, string>).NODE_ENV = value;
}

describe("selectEmailTransport", () => {
  it("בוחר ב-Resend כשיש מפתח וכתובת שולח", () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.NOTIFY_FROM_EMAIL = "no-reply@example.com";

    expect(selectEmailTransport().name).toBe("resend");
  });

  it("בפיתוח בלי מפתח — כותב ללוג ואינו חוסם", () => {
    // כך אפשר להריץ את כל צינור השליחה מקומית, בלי חשבון חיצוני ובלי
    // לשלוח דואר לאיש.
    process.env.RESEND_API_KEY = "";
    process.env.NOTIFY_FROM_EMAIL = "";
    setNodeEnv("development");

    expect(selectEmailTransport().name).toBe("console");
  });

  it("בפרודקשן בלי מפתח — נכשל ברעש", () => {
    process.env.RESEND_API_KEY = "";
    process.env.NOTIFY_FROM_EMAIL = "";
    setNodeEnv("production");

    expect(() => selectEmailTransport()).toThrow(/RESEND_API_KEY/);
  });

  it("מפתח בלי כתובת שולח אינו נחשב מוגדר", () => {
    // ‏Resend דוחה שליחה בלי `from` מאומת. נפילה כאן עדיפה על ג'וב אדום.
    process.env.RESEND_API_KEY = "re_test";
    process.env.NOTIFY_FROM_EMAIL = "";
    setNodeEnv("production");

    expect(() => selectEmailTransport()).toThrow(/NOTIFY_FROM_EMAIL/);
  });
});
