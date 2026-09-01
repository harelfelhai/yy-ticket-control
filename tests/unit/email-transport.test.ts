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
 */

// ‏vi.stubEnv ולא השמה ישירה: NODE_ENV מוגדר לקריאה בלבד בטיפוסים של Node,
// והשחזור האוטומטי מבטיח שבדיקה אחת לא תדליף סביבה לשנייה.
afterEach(() => {
  vi.unstubAllEnvs();
});

function configured() {
  vi.stubEnv("GMAIL_USER", "office@example.com");
  vi.stubEnv("GMAIL_APP_PASSWORD", "abcd efgh ijkl mnop");
}

function unconfigured() {
  vi.stubEnv("GMAIL_USER", "");
  vi.stubEnv("GMAIL_APP_PASSWORD", "");
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
