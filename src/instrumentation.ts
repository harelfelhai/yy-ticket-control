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
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
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
