import { describe, expect, it } from "vitest";
import { he } from "@/lib/he";
import { composeNotification, renderEmailHtml, ticketLocation } from "@/lib/notifier/compose";
import type { ComposeInput, TicketSummary } from "@/lib/notifier/types";

/**
 * ניסוח ההודעות היוצאות.
 *
 * זו הבדיקה הצפופה ביותר מחוץ ללוגיקת הסטטוסים, מסיבה אחת: הודעה שנשלחה
 * לקבלן אמיתי אי אפשר לבטל. שגיאה כאן אינה באג במסך — היא טלפון של מנהל
 * שמתנצל, או קבלן שנוסע לדירה הלא נכונה.
 */

const ticket: TicketSummary = {
  seq: 47,
  buildingName: "בניין א",
  apartmentNumber: "3",
  domainName: "חשמל",
  description: "אין חשמל בסלון מאז אתמול",
};

function input(overrides: Partial<ComposeInput> = {}): ComposeInput {
  return {
    event: "ASSIGNED",
    toName: "יוסי",
    ticket,
    link: "https://yy.example/p/abc123",
    ...overrides,
  };
}

describe("ticketLocation", () => {
  it("מרכיב בניין, דירה ותחום לשורה אחת", () => {
    expect(ticketLocation(ticket)).toBe("בניין א דירה 3, חשמל");
  });

  it("אינו מציג 'דירה null' כשהמיקום חסר", () => {
    // פנייה יכולה להישלח בלי מיקום מלא רק בתרחישי קצה, אבל אם קרה —
    // ההודעה חייבת להישאר קריאה ולא לחשוף ערכים ריקים לקבלן.
    const partial = { ...ticket, buildingName: null, apartmentNumber: null, domainName: null };
    expect(ticketLocation(partial)).toBe("ללא בניין ודירה, ללא תחום");
  });
});

describe("שיוך לפנייה", () => {
  it("פותח בשם הנמען ובשם החברה, ומסיים בקישור", () => {
    const message = composeNotification(input());

    expect(message.subject).toBe("פנייה חדשה — בניין א דירה 3, חשמל");
    expect(message.body).toContain("שלום יוסי");
    expect(message.body).toContain(he.app.company);
    expect(message.body).toContain("בניין א דירה 3, חשמל");
    // הקישור אחרון תמיד: זה מה שהעין מחפשת, וגם מה שוואטסאפ הופך ללחיץ.
    expect(message.body.trim().endsWith("https://yy.example/p/abc123")).toBe(true);
  });

  it("מצרף את תיאור הפנייה", () => {
    // הקבלן קורא את זה בוואטסאפ לפני שהוא פותח קישור, ומחליט מה לקחת איתו.
    expect(composeNotification(input()).body).toContain("אין חשמל בסלון מאז אתמול");
  });

  it("אינו משאיר שורות ריקות כשהתיאור ריק", () => {
    const message = composeNotification(
      input({ ticket: { ...ticket, description: "   " } }),
    );
    expect(message.body).not.toMatch(/\n\n\n/);
    expect(message.body).toContain("לצפייה וטיפול:");
  });
});

describe("פתיחה מחדש", () => {
  it("אומר במפורש שהעבודה לא הושלמה", () => {
    // בלי המשפט הזה הקבלן מקבל הודעה זהה לשיוך חדש ולא מבין למה חזרו אליו.
    const message = composeNotification(input({ event: "REOPENED" }));

    expect(message.subject).toContain("נפתחה מחדש");
    expect(message.body).toContain("לא הושלמה");
  });
});

describe("שאלה מהנמען", () => {
  it("נושא את שם השואל ואת מספר הפנייה, ומצרף את השאלה", () => {
    const message = composeNotification(
      input({
        event: "MESSAGE",
        toName: "דוד",
        actorName: "יוסי",
        note: "איפה הכניסה לדירה?",
      }),
    );

    expect(message.subject).toBe("יוסי כתב הודעה — בניין א דירה 3, חשמל");
    expect(message.body).toContain("פנייה #47");
    expect(message.body).toContain("איפה הכניסה לדירה?");
  });

  it("אינו מצרף את תיאור הפנייה לפותח", () => {
    // הוא כתב אותו בעצמו; חזרה עליו רק מרחיקה את ההודעה מתחילת המייל.
    const message = composeNotification(
      input({ event: "MESSAGE", actorName: "יוסי", note: "שאלה" }),
    );
    expect(message.body).not.toContain("אין חשמל בסלון");
  });
});

describe("סימון טופל", () => {
  it("מבהיר שהפנייה ממתינה לאישור ולא נסגרה", () => {
    // הנמען אינו סוגר (אפיון §5.א). מנהל שיקרא "טופל" בלבד עלול להניח שסגור.
    const message = composeNotification(
      input({ event: "DONE", toName: "דוד", actorName: "יוסי" }),
    );

    expect(message.subject).toBe("יוסי סימן שטופל — בניין א דירה 3, חשמל");
    expect(message.body).toContain("ממתינה לאישור");
  });
});

describe("renderEmailHtml", () => {
  it("עוטף בכיווניות RTL עם סגנון מוטבע", () => {
    const html = renderEmailHtml(composeNotification(input()));

    expect(html).toContain('dir="rtl"');
    expect(html).toContain("text-align:right");
    // ‏<style> נמחק על ידי לקוחות מייל רבים, ואז העברית מוצגת הפוך.
    expect(html).not.toContain("<style");
  });

  it("בורח מתווי HTML שהגיעו מתיאור שהמשתמש הקליד", () => {
    const html = renderEmailHtml(
      composeNotification(
        input({ ticket: { ...ticket, description: '<img src=x onerror="alert(1)">' } }),
      ),
    );

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("שומר על פסקאות ועל ירידות שורה בתוך פסקה", () => {
    const html = renderEmailHtml(
      composeNotification(input({ ticket: { ...ticket, description: "שורה א\nשורה ב" } })),
    );

    expect(html).toContain("שורה א<br>שורה ב");
    expect(html.match(/<p /g)?.length).toBeGreaterThan(2);
  });
});
