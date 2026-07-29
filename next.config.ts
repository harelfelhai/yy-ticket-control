import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./src/lib/security-headers";

/**
 * כותרות האבטחה מוגדרות במקור אחד (`src/lib/security-headers.ts`) ומוחלות
 * כאן על כל נתיב. ‏NODE_ENV נקבע על ידי Next: `next dev` → development,
 * `next build && next start` → production. כך ה-CSP ב-production מחמיר,
 * ו-dev מקבל את ההקלות שה-HMR דורש.
 */
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders(process.env.NODE_ENV !== "production"),
      },
    ];
  },
};

/**
 * עטיפת Sentry.
 *
 * `org`/`project`: נקראים בזמן הבנייה להעלאת source-maps. מקומית הם ריקים,
 * ולכן הפלאגין מדלג על ההעלאה בשקט — בניית הפיתוח וה-E2E אינן מנסות להעלות.
 * בפרודקשן (Railway) הם מוגדרים כ-Variables יחד עם `SENTRY_AUTH_TOKEN`,
 * ואז הבנייה מעלה source-maps כדי ש-stack traces יהיו קריאים.
 *
 * שתי סטיות מברירת המחדל (מתועדות ב-`instrumentation-client.ts`):
 * אין `tunnelRoute` (ה-CSP כבר מתיר https) ואין ניטור-אוטומטי של Vercel
 * (הפריסה היא Railway; ה-cron monitor היחיד שמור ל-watchdog).
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // שקט מחוץ ל-CI: לוגי הפלאגין לא רלוונטיים בפיתוח.
  silent: !process.env.CI,
  // מרחיב את העלאת ה-source-maps גם לקבצי הלקוח, ל-stack traces קריאים משני
  // הצדדים.
  widenClientFileUpload: true,
});
