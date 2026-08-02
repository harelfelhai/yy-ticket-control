import { z } from "zod";
import { he } from "./he";

/**
 * צורת התשובה של כל Server Action במערכת.
 *
 * שגיאות **מוחזרות כערך ולא נזרקות**. ‏Next מצנזר הודעות שגיאה של Server
 * Actions בפרודקשן ומחליף אותן בטקסט גנרי, כך ששגיאה זרוקה הייתה מגיעה
 * למשתמש כ"משהו השתבש" במקום "לנמען אין טלפון ואין מייל". במצב פיתוח
 * ההודעה כן עוברת — ולכן זהו באג שבדיקות מקומיות לא תופסות, ורק הרצת
 * ‏E2E מול בנייה של פרודקשן חושפת (`npm run test:e2e:prod`).
 */
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

/** שגיאה שנועדה להיראות על ידי המשתמש, להבדיל מבאג */
export class UserFacingError extends Error {}

/**
 * מריץ פעולה והופך שגיאה צפויה להודעה למשתמש.
 * שגיאה שאינה צפויה ממשיכה להיזרק — היא באג שצריך להגיע ללוג ולא להיבלע
 * בהודעה מנומסת שמסתירה אותו.
 */
export async function guard<T>(run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    if (error instanceof UserFacingError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) return { ok: false, error: he.common.genericError };
    throw error;
  }
}

/**
 * מוציא את הערך, או זורק את הודעת השגיאה.
 *
 * **הצד ההפוך של `guard`, ובצד הלקוח.** ‏`guard` הופך חריגה לערך כדי שההודעה
 * תשרוד את הצנזור של Next; כאן היא חוזרת להיות חריגה, מפני שהקוראים —
 * `LearnedSelect` ו-`RecipientPicker` — מצפים לחריגה כדי להציג את ההודעה
 * בתוך הבורר עצמו.
 *
 * הפונקציה הזו הייתה משוכפלת בשישה קבצים כ-`unwrap` מקומית. השכפול לא היה
 * מזיק בפני עצמו, אבל הוא בדיוק הצורה שבה ערכים נפרדים בשקט (ראו פער 1).
 */
export function unwrapOrThrow<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
