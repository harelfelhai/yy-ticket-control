import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/observability/redact";

/**
 * אתחול Sentry בצד השרת (‏Node runtime).
 *
 * נטען מ-`instrumentation.ts` בעליית השרת, לפני כל בקשה. בלי DSN (למשל
 * בבדיקות E2E שאינן מזריקות אותו) ה-init הופך ל-no-op שקט — Sentry פשוט
 * מושבת, בלי לשבור דבר.
 *
 * `enableLogs`: משתף את ה-Logs של Sentry כמאגר הלוגים היחיד (ראה
 * `src/lib/observability/log.ts`), כדי שאירועים עסקיים יהיו חיפושיים לצד
 * השגיאות באותו dashboard.
 *
 * `tracesSampleRate: 1.0`: כלי פנימי ל-6 משתמשים — נפח ה-spans רחוק ממכסת
 * ה-5M/חודש, ודגימה מלאה נותנת תמונת ביצועים שלמה בלי חורים.
 *
 * `beforeSend`/`beforeSendTransaction`: מסירים את קישורי הקסם של הקבלנים
 * מהכתובות לפני השליחה. **חובה, ולא הידור:** הטוקן יושב בנתיב ובפרמטר
 * השאילתה, ‏Sentry אוסף כתובות ללא תנאי, ודגימת ה-1.0 שלמעלה פירושה שזה
 * היה קורה בכל בקשה לפורטל ולא רק בשגיאה. ראה `lib/observability/redact.ts`.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
  enableLogs: true,
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
});
