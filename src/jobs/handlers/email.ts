import { selectMailSource } from "@/lib/email-intake";
import { selectFieldExtractor } from "@/lib/email-intake/extraction";
import {
  type EmailIntakeDeps,
  type EmailIntakeOutcome,
  handleEmailIntake,
} from "@/lib/services/email-intake";
import type { EmailIntakeJobPayload } from "../types";

/**
 * נקודת הכניסה של ג׳וב `EMAIL_INTAKE` לתור.
 *
 * **הקובץ דק בכוונה**: כל ההכרעות יושבות ב-`services/email-intake.ts`,
 * וכאן נבחרים רק הספקים לפי הסביבה — אותה תבנית של `runAi` ב-`worker.ts`.
 * ההפרדה היא מה שמאפשר לבדיקות להריץ את הצינור המלא מול תיבה בזיכרון
 * ומחלץ מזויף, בלי רשת ובלי מפתח.
 *
 * `deps` חלקי ולא מלא: שדה שלא נמסר נבחר לפי הסביבה, ושדה שנמסר כ-`null`
 * פירושו במפורש "אין ספק כזה" — וזו הדרך לבדוק את מסלול "החילוץ אינו
 * זמין" (EM-11) בלי לגעת במשתני הסביבה.
 */
export async function runEmailIntake(
  payload: EmailIntakeJobPayload,
  deps: Partial<EmailIntakeDeps> = {},
): Promise<EmailIntakeOutcome> {
  return handleEmailIntake(payload, {
    // `selectMailSource` (`@/lib/email-intake`) זורקת ולא נופלת בשקט — בדיוק
    // מה שנדרש כאן: הג׳וב הזה נוצר רק כשהיכולת דלוקה ושורת יומן כבר נכתבה
    // (מישהו כבר קרא מהתיבה בסבב), ולכן חוסר תצורה כאן פירושו שהיא נשמטה
    // בין הסבב לג׳וב — כשל שצריך להיראות ב-Sentry, לא מייל שנשאר PENDING לנצח.
    source: deps.source ?? selectMailSource(),
    extractor: deps.extractor !== undefined ? deps.extractor : selectFieldExtractor(),
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.storage ? { storage: deps.storage } : {}),
  });
}
