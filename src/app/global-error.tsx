"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { he } from "@/lib/he";

/**
 * גבול השגיאה העליון של האפליקציה.
 *
 * שגיאת רינדור של React שנמלטת מכל שאר גבולות השגיאה מגיעה לכאן — ובלי
 * `captureException` היא הייתה נעלמת בלי עקבות ב-Sentry. ה-UI נשאר מינימלי
 * בכוונה: כשגם ה-layout נשבר, אסור להישען על שום דבר מהאפליקציה.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="he" dir="rtl">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          padding: "1.5rem",
          textAlign: "center",
        }}
      >
        <div>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 700 }}>
            {he.common.genericError}
          </h2>
        </div>
      </body>
    </html>
  );
}
