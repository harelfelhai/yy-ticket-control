import { afterEach, describe, expect, it, vi } from "vitest";
import { isEmailConfigured, selectEmailTransport } from "@/lib/notifier/email";

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

/**
 * הדגל שמפריד בין "נשלח" ל"נכתב ללוג".
 *
 * בלעדיו `sendNotification` סימנה `notifiedAt` גם על ערוץ הקונסולה, והמסך
 * הכריז "נשלח מייל" על הודעה שאיש לא קיבל.
 */
describe("simulated", () => {
  it("ערוץ הקונסולה מצהיר על עצמו כמדומה", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NOTIFY_FROM_EMAIL", "");
    vi.stubEnv("NODE_ENV", "development");

    expect(selectEmailTransport().simulated).toBe(true);
  });

  it("ערוץ אמיתי אינו מדומה", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("NOTIFY_FROM_EMAIL", "no-reply@example.com");

    expect(selectEmailTransport().simulated).toBeFalsy();
  });
});

/**
 * ‏`isEmailConfigured` ו-`selectEmailTransport` חייבים להסכים על אותו תנאי:
 * אם הממשק חושב שיש ערוץ והשליחה חושבת שאין, המסך משקר שוב — רק הפוך.
 */
describe("isEmailConfigured", () => {
  it("מסכים עם בחירת הערוץ בשני הכיוונים", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("NOTIFY_FROM_EMAIL", "no-reply@example.com");
    expect(isEmailConfigured()).toBe(true);
    expect(selectEmailTransport().simulated).toBeFalsy();

    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(isEmailConfigured()).toBe(false);
    expect(selectEmailTransport().simulated).toBe(true);
  });

  it("מפתח בלי כתובת שולח אינו 'מוגדר'", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("NOTIFY_FROM_EMAIL", "");

    expect(isEmailConfigured()).toBe(false);
  });
});
