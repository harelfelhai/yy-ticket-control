import { afterEach, describe, expect, it, vi } from "vitest";
import { selectEmailTransport } from "@/lib/notifier/email";

/**
 * בחירת ערוץ המייל לפי הסביבה.
 *
 * החלטה קטנה עם השלכה גדולה: מערכת שנראית עובדת אך בשקט אינה מודיעה
 * לאיש היא בדיוק הכישלון שהמערכת הזו נבנתה כדי למנוע. לכן חוסר הגדרה
 * בפרודקשן חייב לזעוק, ובפיתוח חייב דווקא **לא** לחסום עבודה.
 */

// ‏vi.stubEnv ולא השמה ישירה: NODE_ENV מוגדר לקריאה בלבד בטיפוסים של Node,
// והשחזור האוטומטי מבטיח שבדיקה אחת לא תדליף סביבה לשנייה.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("selectEmailTransport", () => {
  it("בוחר ב-Resend כשיש מפתח וכתובת שולח", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("NOTIFY_FROM_EMAIL", "no-reply@example.com");

    expect(selectEmailTransport().name).toBe("resend");
  });

  it("בפיתוח בלי מפתח — כותב ללוג ואינו חוסם", () => {
    // כך אפשר להריץ את כל צינור השליחה מקומית, בלי חשבון חיצוני ובלי
    // לשלוח דואר לאיש.
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NOTIFY_FROM_EMAIL", "");
    vi.stubEnv("NODE_ENV", "development");

    expect(selectEmailTransport().name).toBe("console");
  });

  it("בפרודקשן בלי מפתח — נכשל ברעש", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NOTIFY_FROM_EMAIL", "");
    vi.stubEnv("NODE_ENV", "production");

    expect(() => selectEmailTransport()).toThrow(/RESEND_API_KEY/);
  });

  it("מפתח בלי כתובת שולח אינו נחשב מוגדר", () => {
    // ‏Resend דוחה שליחה בלי `from` מאומת. נפילה כאן עדיפה על ג'וב אדום.
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("NOTIFY_FROM_EMAIL", "");
    vi.stubEnv("NODE_ENV", "production");

    expect(() => selectEmailTransport()).toThrow(/NOTIFY_FROM_EMAIL/);
  });
});
