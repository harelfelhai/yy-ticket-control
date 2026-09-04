import { redirect, unstable_rethrow } from "next/navigation";
import { env } from "@/lib/env";
import { GOOGLE_CALLBACK_PATH } from "@/lib/google-oauth";
import { captureError, logInfo } from "@/lib/observability/log";
import { takeOauthState } from "@/lib/oauth-state";
import { safeNextPath } from "@/lib/safe-next";
import { createSession } from "@/lib/session";
import { completeGoogleCallback, isGoogleLoginConfigured } from "@/lib/services/google-login";

/**
 * מקבל את גוגל בחזרה, ומכריע: סשן או שגיאה.
 *
 * **‏Route Handler ולא Server Component, וזו אותה סיבה של `session-ended`:**
 * כתיבת עוגייה חוקית ב-Next רק ב-Server Action או ב-Route Handler, ו-Next
 * ממזג את העוגיות שהשתנו גם לתוך תשובת ההפניה — ולכן `createSession()`
 * שאחריו `redirect()` עובד כאן.
 *
 * ההכרעה עצמה אינה כאן אלא ב-`completeGoogleCallback`, ובכוונה: הקובץ הזה הוא
 * חיווט בלבד — הוא מביא את המצב, קורא לשירות, וממיר את התוצאה להפניה. כל
 * הסתעפות שראויה לבדיקה יושבת בשירות, שנבדק מול DB אמיתי בלי לפנות לגוגל.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // **ראשון וללא תנאי.** קריאה-והשמדה מבטיחה שאותו `state` אינו תקף פעמיים,
  // גם כשהניסיון הזה נכשל — כלומר אין ניסיון חוזר עם אותו קוד הרשאה.
  const saved = await takeOauthState();

  if (!isGoogleLoginConfigured()) redirect("/login?error=unavailable");

  /*
   * **הכתובת נבנית מ-`APP_BASE_URL` ולא מ-`request.url`.**
   *
   * ‏`openid-client` גוזר את ה-`redirect_uri` שהוא שולח ל-token endpoint מתוך
   * ה-URL הזה (`redirectUri = stripParams(currentUrl)` בקוד שלו). מאחורי
   * ה-proxy של Railway `request.url` יכול לשאת מארח או סכימה פנימיים, ואז
   * הכתובת אינה זהה לזו שנשלחה ב-`/start` ולזו שרשומה ב-Google Console —
   * גוגל מחזירה `redirect_uri_mismatch`, וזה כשל שמופיע בפרודקשן בלבד.
   */
  const currentUrl = new URL(
    `${GOOGLE_CALLBACK_PATH}${new URL(request.url).search}`,
    env.appBaseUrl(),
  );

  let outcome;
  try {
    outcome = await completeGoogleCallback({ currentUrl, saved });
  } catch (error) {
    // ‏`completeGoogleCallback` אינו קורא ל-`redirect()` היום, ולכן ה-rethrow
    // הוא הגנה קדימה: ברגע שהוא כן יקרא, בלעדיו ההפניה הייתה נבלעת כאן
    // והמשתמש היה מקבל "אינו זמין" במקום להגיע ליעד.
    unstable_rethrow(error);

    captureError(error, {
      tags: { route: "google-callback" },
      fingerprint: ["google-login", "callback"],
    });
    redirect("/login?error=unavailable");
  }

  if (outcome.kind === "error") redirect(`/login?error=${outcome.code}`);

  await createSession(outcome.user);

  // המזהה ולא המייל: כתובת דואר היא PII, ולוג אינו המקום שלה.
  logInfo("google_login.succeeded", { userId: outcome.user.id });

  // מעבר שני ב-`safeNextPath`. הערך כבר עבר אימות לפני שנכנס לעוגייה, וזה
  // זול — אבל המשמעות היא שערובת אי-ההפניה החוצה אינה תלויה בשלמות העוגייה.
  redirect(safeNextPath(outcome.next));
}
