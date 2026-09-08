import { afterEach, describe, expect, it, vi } from "vitest";
import { isEmailConfigured, selectEmailTransport } from "@/lib/notifier/email";

/**
 * בחירת ערוץ המייל לפי הסביבה.
 *
 * החלטה קטנה עם השלכה גדולה: מערכת שנראית עובדת אך בשקט אינה מודיעה
 * לאיש היא בדיוק הכישלון שהמערכת הזו נבנתה כדי למנוע. לכן חוסר הגדרה
 * בפרודקשן חייב לזעוק, ובפיתוח חייב דווקא **לא** לחסום עבודה.
 *
 * **הערוץ עבר ל-SMTP של Gmail ב-1.9.2026** (ראה `email.ts`), ואיתו שני
 * המשתנים. הבדיקות כאן על **הבחירה**, לא על השליחה עצמה — ולכן הן לא
 * השתנו במהותן, רק בשמות.
 *
 * **ומ-7.9.2026 יש מסלול שני שקודם לו: Gmail API מעל HTTPS.** SMTP יוצא
 * חסום ב-Railway (נמדד — ראה `gmail-api.ts`), ולכן הסדר בין השניים אינו
 * טעם אלא ההבדל בין ערוץ שעובד לערוץ שאינו.
 */

// ‏vi.stubEnv ולא השמה ישירה: NODE_ENV מוגדר לקריאה בלבד בטיפוסים של Node,
// והשחזור האוטומטי מבטיח שבדיקה אחת לא תדליף סביבה לשנייה.
afterEach(() => {
  vi.unstubAllEnvs();
});

/** רק SMTP — הדרך שעבדה עד 7.9.2026, ושנשארה כמסלול שני */
function configured() {
  vi.stubEnv("GMAIL_USER", "office@example.com");
  vi.stubEnv("GMAIL_APP_PASSWORD", "abcd efgh ijkl mnop");
  vi.stubEnv("GMAIL_REFRESH_TOKEN", "");
}

/** רק Gmail API — המסלול של הפרודקשן */
function apiConfigured() {
  vi.stubEnv("GMAIL_USER", "office@example.com");
  vi.stubEnv("GMAIL_APP_PASSWORD", "");
  vi.stubEnv("GOOGLE_CLIENT_ID", "client.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  vi.stubEnv("GMAIL_REFRESH_TOKEN", "refresh-token");
}

function unconfigured() {
  vi.stubEnv("GMAIL_USER", "");
  vi.stubEnv("GMAIL_APP_PASSWORD", "");
  vi.stubEnv("GMAIL_REFRESH_TOKEN", "");
}

describe("selectEmailTransport", () => {
  it("בוחר ב-Gmail כשיש חשבון וסיסמת אפליקציה", () => {
    configured();

    expect(selectEmailTransport().name).toBe("gmail");
  });

  it("בפיתוח בלי הגדרה — כותב ללוג ואינו חוסם", () => {
    // כך אפשר להריץ את כל צינור השליחה מקומית, בלי חשבון חיצוני ובלי
    // לשלוח דואר לאיש.
    unconfigured();
    vi.stubEnv("NODE_ENV", "development");

    expect(selectEmailTransport().name).toBe("console");
  });

  it("בפרודקשן בלי הגדרה — נכשל ברעש", () => {
    unconfigured();
    vi.stubEnv("NODE_ENV", "production");

    expect(() => selectEmailTransport()).toThrow(/GMAIL_USER/);
  });

  it("חשבון בלי סיסמת אפליקציה אינו נחשב מוגדר", () => {
    // סיסמת החשבון הרגילה נדחית ע"י Gmail; חצי הגדרה היא ג'וב אדום.
    vi.stubEnv("GMAIL_USER", "office@example.com");
    vi.stubEnv("GMAIL_APP_PASSWORD", "");
    vi.stubEnv("NODE_ENV", "production");

    expect(() => selectEmailTransport()).toThrow(/GMAIL_APP_PASSWORD/);
  });

  it("‏NOTIFY_FROM_EMAIL אופציונלי — בלעדיו השולח הוא החשבון עצמו", () => {
    // ‏Gmail מתיר לשלוח רק מהחשבון המאומת, ולכן ברירת המחדל הזו היא
    // הערך היחיד שאינו יכול להיכשל.
    configured();
    vi.stubEnv("NOTIFY_FROM_EMAIL", "");

    expect(selectEmailTransport().name).toBe("gmail");
    expect(isEmailConfigured()).toBe(true);
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
    unconfigured();
    vi.stubEnv("NODE_ENV", "development");

    expect(selectEmailTransport().simulated).toBe(true);
  });

  it("ערוץ אמיתי אינו מדומה", () => {
    configured();

    expect(selectEmailTransport().simulated).toBeFalsy();
  });
});

/**
 * ‏`isEmailConfigured` ו-`selectEmailTransport` חייבים להסכים על אותו תנאי:
 * אם הממשק חושב שיש ערוץ והשליחה חושבת שאין, המסך משקר שוב — רק הפוך.
 */
describe("isEmailConfigured", () => {
  it("מסכים עם בחירת הערוץ בשני הכיוונים", () => {
    configured();
    expect(isEmailConfigured()).toBe(true);
    expect(selectEmailTransport().simulated).toBeFalsy();

    unconfigured();
    vi.stubEnv("NODE_ENV", "development");
    expect(isEmailConfigured()).toBe(false);
    expect(selectEmailTransport().simulated).toBe(true);
  });

  it("חשבון בלי סיסמת אפליקציה אינו 'מוגדר'", () => {
    vi.stubEnv("GMAIL_USER", "office@example.com");
    vi.stubEnv("GMAIL_APP_PASSWORD", "");

    expect(isEmailConfigured()).toBe(false);
  });
});

/**
 * המסלול שנוסף ב-7.9.2026, אחרי שנמדד ש-Railway חוסם SMTP יוצא.
 *
 * מה שנבדק כאן הוא **הבחירה בלבד**. השליחה עצמה אינה נבדקת ביחידה בכוונה:
 * היא שתי קריאות רשת אל גוגל, ובדיקה שמדמה אותן מוכיחה רק שה-mock נכתב
 * לפי מה שהקוד עושה. האימות שלה הוא `scripts/smoke-mail.mts` מול חשבון
 * אמיתי — הרצה בפועל, לא הדמיה.
 */
describe("Gmail API מעל HTTPS", () => {
  it("נבחר כשיש refresh token", () => {
    apiConfigured();

    expect(selectEmailTransport().name).toBe("gmail-api");
    expect(isEmailConfigured()).toBe(true);
  });

  /**
   * **הסדר הוא ההבדל בין ערוץ שעובד לערוץ שאינו.** בפרודקשן שני המסלולים
   * מוגדרים — סיסמת האפליקציה נשארה מ-1.9 — ו-SMTP שם פשוט נבלע ב-firewall.
   */
  it("גובר על SMTP כששניהם מוגדרים", () => {
    apiConfigured();
    vi.stubEnv("GMAIL_APP_PASSWORD", "abcd efgh ijkl mnop");

    expect(selectEmailTransport().name).toBe("gmail-api");
  });

  it("אינו מדומה — הוא באמת שולח", () => {
    apiConfigured();

    expect(selectEmailTransport().simulated).toBeFalsy();
  });

  /**
   * כול-או-כלום, כמו `r2()`: `refresh token` בלי זוג המפתחות אינו "כמעט
   * מוגדר" אלא בקשה שתחזור עם `invalid_client`.
   */
  it("refresh token בלי זוג המפתחות אינו נחשב מוגדר", () => {
    apiConfigured();
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");

    expect(isEmailConfigured()).toBe(false);
    expect(() => selectEmailTransport()).toThrow(/GMAIL_REFRESH_TOKEN|GMAIL_APP_PASSWORD/);
  });

  /**
   * `GMAIL_USER` נדרש **גם** במסלול ה-API, והסיבה שונה משל SMTP: שם הוא
   * שם המשתמש לאימות, וכאן הוא כתובת השולח. Gmail דוחה הודעה שנשלחת
   * בשם כתובת אחרת, ולכן בלעדיו אין מה לשלוח ממנו.
   */
  it("בלי GMAIL_USER אין ערוץ, גם עם refresh token", () => {
    apiConfigured();
    vi.stubEnv("GMAIL_USER", "");
    vi.stubEnv("NOTIFY_FROM_EMAIL", "");
    vi.stubEnv("NODE_ENV", "development");

    expect(isEmailConfigured()).toBe(false);
    expect(selectEmailTransport().name).toBe("console");
  });
});
