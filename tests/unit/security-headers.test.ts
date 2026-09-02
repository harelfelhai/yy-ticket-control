import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
} from "@/lib/security-headers";

/**
 * ה-headers הם הכרזה על מדיניות; הבדיקה מקבעת שההכרזה לא נשחקת בטעות —
 * שב-production ה-CSP באמת מחמיר, ושכותרות הליבה קיימות בערכים שנקבעו.
 */

describe("buildContentSecurityPolicy", () => {
  it("ב-production אינו כולל את ההקלות של ה-HMR", () => {
    const csp = buildContentSecurityPolicy(false);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("ws:");
  });

  it("ב-dev כולל את ההקלות שה-HMR דורש", () => {
    const csp = buildContentSecurityPolicy(true);
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("ws:");
  });

  it.each([true, false])(
    "כולל את דירקטיבות ההגנה המשמעותיות (dev=%s)",
    (isDev) => {
      const csp = buildContentSecurityPolicy(isDev);
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
      // המדיה מ-R2 עוברת ב-https, ולכן חייבת להיות מותרת לתמונות ולחיבור.
      expect(csp).toContain("img-src 'self' data: blob: https:");
      /**
       * ‏`frame-src` מפורש — **חייב להיכתב, גם אם הוא מרשה פחות מ-`default-src`.**
       *
       * בהיעדרו חלה נסיגה ל-`default-src 'self'`, ואז ה-`<iframe>` של דוח
       * הבדק במסך 5 נחסם **בשקט**: הדוח פשוט אינו מופיע, בלי שגיאה בממשק
       * ובלי שבדיקה פונקציונלית נכשלת. הבדיקה כאן היא מה שיתפוס מחיקה
       * "מנקה" של השורה הזו.
       *
       * ‏`https:` **אינו** ברשימה, בשונה מ-`img-src`: אין לנו הטמעה של אתר
       * חיצוני, ורק המקור שלנו ו-blob: מקומי מותרים.
       */
      expect(csp).toContain("frame-src 'self' blob:");
      expect(csp).not.toContain("frame-src 'self' blob: https:");
    },
  );
});

describe("buildSecurityHeaders", () => {
  const headers = buildSecurityHeaders(false);
  const byKey = (key: string) => headers.find((h) => h.key === key)?.value;

  it("כולל את כל כותרות הליבה", () => {
    expect(byKey("Content-Security-Policy")).toBeTruthy();
    expect(byKey("Strict-Transport-Security")).toContain("max-age=");
    expect(byKey("X-Frame-Options")).toBe("DENY");
    expect(byKey("X-Content-Type-Options")).toBe("nosniff");
    expect(byKey("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("מתיר מצלמה ומיקרופון ל-self (המערכת מצלמת ומקליטה) וחוסם מיקום", () => {
    const permissions = byKey("Permissions-Policy") ?? "";
    expect(permissions).toContain("camera=(self)");
    expect(permissions).toContain("microphone=(self)");
    expect(permissions).toContain("geolocation=()");
  });
});
