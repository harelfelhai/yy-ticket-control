import { describe, expect, it } from "vitest";
import { deliveryNote } from "@/lib/delivery";
import { he } from "@/lib/he";

/**
 * שורת מצב השליחה שמופיעה מתחת לכל נמען.
 *
 * היא קיימת כדי לשבור הנחה אחת מסוכנת: ש"נשלח" בסטטוס פירושו שמישהו יודע.
 * הבדיקות כאן מוודאות שכל מצב מקבל נוסח נכון — במיוחד המצבים שבהם **לא**
 * יצאה הודעה, כי הם היחידים שדורשים מהמנהל לעשות משהו.
 */

const at = (time: Date) => `${time.getUTCHours()}:00`;
const noon = new Date("2026-07-22T12:00:00Z");

/** ברירת המחדל של הבדיקות היא סביבה שבה **יש** ערוץ מייל — המצב בפרודקשן. */
const configured = { emailConfigured: true };

describe("deliveryNote", () => {
  it("מדווח מתי נשלח מייל בפועל", () => {
    const note = deliveryNote(
      { ...configured, notifiedAt: noon, hasEmail: true, hasPhone: true },
      at,
    );
    expect(note).toBe(he.ticket.notifiedAt("12:00"));
  });

  it("זמן השליחה גובר על כל שאר המצבים", () => {
    // גם אם הכתובת נמחקה מאז — העובדה שההודעה יצאה נשארת נכונה.
    const note = deliveryNote(
      { ...configured, notifiedAt: noon, hasEmail: false, hasPhone: false },
      at,
    );
    expect(note).toBe(he.ticket.notifiedAt("12:00"));
  });

  it("יש מייל אך טרם יצאה הודעה — בתור", () => {
    const note = deliveryNote(
      { ...configured, notifiedAt: null, hasEmail: true, hasPhone: false },
      at,
    );
    expect(note).toBe(he.ticket.notifyQueued);
  });

  it("אין מייל אבל יש טלפון — מפנה לוואטסאפ", () => {
    // זה המצב השכיח אצל קבלני משנה, ולכן הנוסח קורא לפעולה ולא רק מתאר.
    const note = deliveryNote(
      { ...configured, notifiedAt: null, hasEmail: false, hasPhone: true },
      at,
    );
    expect(note).toBe(he.ticket.notifyNoEmail);
  });

  it("אין דרך ליצור קשר — נאמר במפורש", () => {
    // שגיאת נתונים שרק המנהל יכול לתקן. בלי שורה מפורשת היא נבלעת,
    // והפנייה יושבת אצל מי שאינו יודע עליה.
    const note = deliveryNote(
      { ...configured, notifiedAt: null, hasEmail: false, hasPhone: false },
      at,
    );
    expect(note).toBe(he.notices.cannotSendNoContact);
  });

  /**
   * שלוש הבדיקות הבאות הן התקלה שדווחה מהשטח: פנייה נפתחה, נמען עם מייל
   * נוסף, ושום דבר לא הגיע אליו — בעוד שהמסך הצהיר שההודעה בדרך.
   */
  describe("אין ערוץ מייל בסביבה", () => {
    const unconfigured = { emailConfigured: false };

    it("אומר שלא נשלח, ולא 'בתור לשליחה'", () => {
      // "בתור לשליחה" על מערכת שאין לה דרך לשלוח היא הבטחה שלא תתקיים.
      const note = deliveryNote(
        { ...unconfigured, notifiedAt: null, hasEmail: true, hasPhone: false },
        at,
      );
      expect(note).toBe(he.ticket.notifyNotConfigured);
      expect(note).not.toBe(he.ticket.notifyQueued);
    });

    it("גובר גם כשיש טלפון — הנוסח ממילא מפנה לוואטסאפ", () => {
      const note = deliveryNote(
        { ...unconfigured, notifiedAt: null, hasEmail: true, hasPhone: true },
        at,
      );
      expect(note).toBe(he.ticket.notifyNotConfigured);
    });

    it("אינו מוחק היסטוריה: מייל שיצא בעבר עדיין מדווח", () => {
      // ‏`notifiedAt` הוא עובדה שקרתה. גם אם הערוץ הוסר מאז, ההודעה יצאה.
      const note = deliveryNote(
        { ...unconfigured, notifiedAt: noon, hasEmail: true, hasPhone: false },
        at,
      );
      expect(note).toBe(he.ticket.notifiedAt("12:00"));
    });
  });
});
