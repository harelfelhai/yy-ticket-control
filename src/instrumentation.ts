/**
 * נקודת האתחול של השרת (Next.js instrumentation).
 *
 * כאן מופעל עובד התור. הוא חייב לעלות מעצמו עם השרת ולא בבקשה הראשונה:
 * שיוך שנוצר בשעה שאיש אינו גולש חייב לצאת בכל זאת.
 */
export async function register() {
  // ה-hook נטען גם ב-runtime של Edge, שם אין גישה לבסיס נתונים ואין
  // טיימרים ארוכי חיים. הייבוא הדינמי מבטיח שהקוד של העובד אפילו לא
  // ייטען שם.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startWorker } = await import("./jobs/worker");
  startWorker();
}
