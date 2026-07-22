import { describe, expect, it } from "vitest";
import { toWhatsAppNumber, waShareUrl } from "@/lib/notifier/wa-share";

/**
 * המרת מספר לפורמט wa.me.
 *
 * זו נקודת כשל שקטה במיוחד: מספר שגוי אינו מחזיר שגיאה — הוא פותח וואטסאפ
 * עם איש קשר לא קיים, המנהל לוחץ "שלח", והפנייה פשוט לא מגיעה לאיש.
 */

describe("toWhatsAppNumber", () => {
  it("ממיר מספר ישראלי מקומי לקידומת בינלאומית", () => {
    expect(toWhatsAppNumber("0501234567")).toBe("972501234567");
  });

  it("מתעלם ממקפים ומרווחים", () => {
    // כך מקלידים בפועל, וכך זה נשמר במערכת.
    expect(toWhatsAppNumber("054-123 4567")).toBe("972541234567");
  });

  it("מקבל מספר שכבר נשמר בצורה בינלאומית", () => {
    expect(toWhatsAppNumber("+972501234567")).toBe("972501234567");
    expect(toWhatsAppNumber("00972501234567")).toBe("972501234567");
  });

  it("שומר קידומת זרה כמות שהיא", () => {
    // קבלן זר אינו תרחיש עיקרי, אבל מספר תקין לא אמור להפוך לישראלי שגוי.
    expect(toWhatsAppNumber("+13125551234")).toBe("13125551234");
  });

  it("מחזיר null כשאין מה להמיר", () => {
    expect(toWhatsAppNumber(null)).toBeNull();
    expect(toWhatsAppNumber(undefined)).toBeNull();
    expect(toWhatsAppNumber("")).toBeNull();
    expect(toWhatsAppNumber("   ")).toBeNull();
  });

  it("דוחה מספר קצר מדי במקום לייצר כתובת שבורה", () => {
    expect(toWhatsAppNumber("03-1234")).toBeNull();
  });
});

describe("waShareUrl", () => {
  it("מקודד את ההודעה בכתובת", () => {
    const url = waShareUrl("0501234567", "שלום יוסי, נשלחה אליך פנייה חדשה");

    expect(url).toContain("https://wa.me/972501234567?text=");
    // עברית ורווחים חייבים לעבור קידוד — בלעדיו הכתובת נחתכת ברווח הראשון.
    expect(url).not.toContain(" ");
    expect(decodeURIComponent(url as string)).toContain("שלום יוסי");
  });

  it("מקודד גם קישור שמופיע בתוך ההודעה", () => {
    // ההודעה מכילה קישור עם ? ו-/ — בלי קידוד הם נבלעים בפרמטרים של wa.me.
    const url = waShareUrl("0501234567", "לצפייה: https://a.example/p/x?y=1");
    expect(url).toContain("https%3A%2F%2Fa.example%2Fp%2Fx%3Fy%3D1");
  });

  it("מחזיר null בלי טלפון — הכפתור פשוט לא יוצג", () => {
    expect(waShareUrl(null, "טקסט")).toBeNull();
  });
});
