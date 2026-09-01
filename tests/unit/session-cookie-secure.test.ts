import { describe, expect, it } from "vitest";
import { servedOverHttps } from "@/lib/session";

/**
 * מתי עוגיית ההתחברות מסומנת `Secure`.
 *
 * עד 1.9.2026 התנאי היה `env.isProduction()`. זו הייתה טעות קטגוריה:
 * `NODE_ENV` מתאר את **הבנייה**, ו-`Secure` הוא מאפיין של **התובלה**.
 * ההבדל אינו תיאורטי — הוא הפיל את בדיקת ה-WebKit היחידה בריצה הראשונה
 * של ה-E2E ב-CI, שרצה על בניית פרודקשן המוגשת מ-`http://localhost`.
 *
 * הבדיקה הזו קיימת כדי שהחזרה לתנאי הישן תיתפס: היא נכשלת בשני הכיוונים
 * — גם אם הסימון ייעלם מפרודקשן, וגם אם יחזור למקום שאין בו HTTPS.
 */
describe("servedOverHttps", () => {
  it("כתובת פרודקשן — העוגייה מסומנת", () => {
    expect(servedOverHttps("https://web-production-6875c.up.railway.app")).toBe(true);
  });

  it("שרת מקומי — אינה מסומנת, אחרת WebKit לא ישמור אותה", () => {
    expect(servedOverHttps("http://localhost:3100")).toBe(false);
    expect(servedOverHttps("http://localhost:3101")).toBe(false);
  });

  it("אינו נופל על רווח או על אותיות גדולות", () => {
    // ‏`APP_BASE_URL` נכתב ביד ב-Railway. תו רווח בסוף ההדבקה אינו סיבה
    // לאבד את סימון האבטחה בפרודקשן.
    expect(servedOverHttps("  https://example.com  ")).toBe(true);
    expect(servedOverHttps("HTTPS://example.com")).toBe(true);
  });

  it("‏http שמכיל את המחרוזת https אינו נחשב מאובטח", () => {
    expect(servedOverHttps("http://https.example.com")).toBe(false);
  });
});
