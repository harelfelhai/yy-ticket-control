import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/observability/redact";

/**
 * אתחול Sentry בצד הלקוח (הדפדפן).
 *
 * שם הקובץ `instrumentation-client.ts` הוא דרישה של Turbopack — לא השם
 * הישן `sentry.client.config.ts`.
 *
 * שלוש הכרעות מותאמות לאפליקציה הזו, שסוטות מתצורת ברירת המחדל:
 *
 * 1. **בלי `replayIntegration`**: ‏Session Replay מוסיף ~50KB לחבילת הלקוח
 *    ומריץ web-worker לדחיסה — בדיוק מה שהעיצוב של האפליקציה נמנע ממנו
 *    ברשת סלולרית באתר בנייה. בנוסף מכסת ה-Replay החינמית היא 50/חודש
 *    בלבד, וזה כלי פנימי ל-6 משתמשים. תפיסת השגיאות, ה-tracing והלוגים
 *    נותנים תצפית חזקה גם בלעדיו.
 *
 * 2. **בלי `tunnelRoute`**: ה-CSP כבר מתיר `connect-src https:` (נדרש למדיה
 *    מ-R2), ולכן אירועי הלקוח מגיעים ישירות ל-Sentry בלי route proxy חדש
 *    שהיה צריך לחרוג ממנו ב-`proxy.ts`, ובלי לנתב את כל תעבורת השגיאות דרך
 *    ה-instance היחיד של השרת.
 *
 * 3. **`beforeSend`/`beforeSendTransaction`**: מסירים את קישור הקסם מהכתובת
 *    לפני השליחה. הקבלן גולש בפורטל שכתובתו **היא** הסוד שלו, והדפדפן
 *    מדווח את `location.href` בכל אירוע ובכל ניווט. אותה הסרה בדיוק רצה
 *    בשרת (`sentry.server.config.ts`), ממודול משותף אחד.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
  enableLogs: true,
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
});

// לוכד מעברי-ניווט של ה-App Router כ-spans, כדי שאיטיות בין מסכים תיראה.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
