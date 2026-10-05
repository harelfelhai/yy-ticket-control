"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/message";
import { he } from "@/lib/he";
import { useAction } from "@/lib/use-action";
import { type SignupEvent, isFacebookOrigin, parseSignupMessage } from "@/lib/whatsapp/signup";
import { connectWhatsappAction } from "./actions";

/**
 * "חבר מספר" (מסך 17) — חלון החיבור של Meta (Embedded Signup v4).
 *
 * שני ערוצים מהחלון, ושניהם נדרשים: **הקוד** מגיע ב-callback של `FB.login`,
 * ו**החשבון שנבחר** מגיע ב-`postMessage` מ-facebook.com. כשהקוד מגיע, ההודעה
 * בדרך כלל כבר כאן; אם לא — ממתינים לה מעט, כי **הקוד תקף 30 שניות** בלבד, וההחלפה
 * בטוקן נעשית מיד בשרת (`connectWhatsappAction`).
 *
 * **ה-SDK נטען רק כאן.** ה-CSP של המסך הזה בלבד מתיר את connect.facebook.net
 * (`FACEBOOK_SDK_PATHS`), ולכן כל קישור למסך הוא טעינת מסמך מלאה.
 */

interface FacebookSdk {
  init(options: Record<string, unknown>): void;
  login(callback: (response: { authResponse?: { code?: string } | null }) => void, options: Record<string, unknown>): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
  }
}

const SDK_URL = "https://connect.facebook.net/en_US/sdk.js";

/** כמה לחכות להודעה מהחלון אחרי שה-callback חזר — חלק קטן מ-30 השניות של הקוד */
const SESSION_WAIT_MS = 5_000;

export function ConnectButton({
  appId,
  configId,
  graphVersion,
  variant = "primary",
}: {
  appId: string;
  configId: string;
  graphVersion: string;
  variant?: "primary" | "secondary";
}) {
  const action = useAction();
  const [sdkReady, setSdkReady] = useState(false);
  const [windowOpen, setWindowOpen] = useState(false);
  const session = useRef<SignupEvent | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!isFacebookOrigin(event.origin)) return;
      const parsed = parseSignupMessage(event.data);
      if (parsed) session.current = parsed;
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function finish(code: string | null) {
    const deadline = Date.now() + (code ? SESSION_WAIT_MS : 1_000);
    while (!session.current && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    setWindowOpen(false);
    const info = session.current;
    if (info?.kind === "error") {
      action.setError(he.whatsappAdmin.errors.signupError(info.message || "—"));
      return;
    }
    if (!code || info?.kind !== "finish") {
      action.setError(he.whatsappAdmin.errors.signupClosed);
      return;
    }
    action.run(() =>
      connectWhatsappAction({
        code,
        wabaId: info.wabaId,
        phoneNumberId: info.phoneNumberId,
        coexistence: info.coexistence,
      }),
    );
  }

  function connect() {
    action.setError(null);
    const sdk = window.FB;
    if (!sdk || !sdkReady) {
      action.setError(he.whatsappAdmin.errors.sdkUnavailable);
      return;
    }
    session.current = null;
    setWindowOpen(true);
    // החלון נפתח מתוך הלחיצה עצמה — אחרת חוסם החלונות הקופצים של הדפדפן עוצר אותו
    sdk.login((response) => void finish(response.authResponse?.code ?? null), {
      config_id: configId,
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {} },
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Script
        src={SDK_URL}
        strategy="afterInteractive"
        crossOrigin="anonymous"
        onReady={() => {
          window.FB?.init({ appId, autoLogAppEvents: true, xfbml: false, version: graphVersion });
          setSdkReady(Boolean(window.FB));
        }}
      />
      <div>
        <Button variant={variant} onClick={connect} disabled={action.busy || windowOpen}>
          {he.whatsappAdmin.connect}
        </Button>
      </div>
      {action.error ? <FormError>{action.error}</FormError> : null}
    </div>
  );
}
