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

export default nextConfig;
