import * as Sentry from "@sentry/nextjs";

/**
 * נקודת האתחול של השרת (Next.js instrumentation).
 *
 * שתי אחריות:
 * 1. **אתחול Sentry** לפי ה-runtime (‏Node/Edge) — חייב לרוץ ראשון, כדי
 *    שגם שגיאה בעליית העובד עצמו תיתפס.
 * 2. **הפעלת עובד התור**. הוא חייב לעלות מעצמו עם השרת ולא בבקשה הראשונה:
 *    שיוך שנוצר בשעה שאיש אינו גולש חייב לצאת בכל זאת.
 */
export async function register() {
  // בפיתוח Sentry לא מאותחל כלל: דגימת 100% של כל בקשה היא תקורה מצטברת על
  // שרת dev ארוך-ריצה (אבחון 27.8.2026 — שרת שרץ יממות הגיע ל-5-7 שניות
  // לבקשה). ‏`onRequestError` וה-loggers סובלים init חסר (no-op), כך שדילוג
  // על הייבוא בטוח. ‏SENTRY_DEV=1 מחזיר את האתחול כשמדבגים את Sentry עצמו.
  const sentryEnabled =
    process.env.NODE_ENV !== "development" || process.env.SENTRY_DEV === "1";

  if (sentryEnabled && process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (sentryEnabled && process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }

  // ה-hook נטען גם ב-runtime של Edge, שם אין גישה לבסיס נתונים ואין
  // טיימרים ארוכי חיים. הייבוא הדינמי מבטיח שהקוד של העובד אפילו לא
  // ייטען שם.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startWorker } = await import("./jobs/worker");
  startWorker();
}

/**
 * לוכד שגיאות של Server Components, route handlers, ו-proxy — מחלקה שלמה
 * של שגיאות שרת שאחרת נבלעת בשקט (Next אינו מדווח עליהן לבד).
 */
export const onRequestError = Sentry.captureRequestError;
