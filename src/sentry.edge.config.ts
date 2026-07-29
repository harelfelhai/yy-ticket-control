import * as Sentry from "@sentry/nextjs";

/**
 * אתחול Sentry ב-Edge runtime.
 *
 * ה-proxy של האימות (`proxy.ts`) רץ ב-Edge, ולכן שגיאה בו לא הייתה נתפסת
 * ע"י תצורת השרת (‏Node). זהה לתצורת השרת מלבד הסביבה שבה היא נטענת.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
  enableLogs: true,
});
