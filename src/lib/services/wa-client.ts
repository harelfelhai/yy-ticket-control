import { AiRequestError } from "@/lib/ai/gemini";
import { env } from "@/lib/env";
import { type WaApi, graphWaApi } from "@/lib/whatsapp/api";
import { WaApiError } from "@/lib/whatsapp/errors";
import { openWaToken } from "@/lib/whatsapp/token";
import { reportWaIssue } from "./wa-number";

/**
 * וואטסאפ בשם המספר העסקי — לקליטה (`wa-intake.ts`) ולהודעת האישור (`wa-reply.ts`).
 *
 * **הטוקן נפתח ממש לפני הבקשה**, מהמספר שההודעה שייכת לו, ואינו נשמר בזיכרון של
 * התהליך. טוקן שאינו קריא (הסוד הוחלף) הוא תקלה בחיבור: המספר עובר ל"תקלה" עם הקוד
 * שמסך 17 מתרגם להוראה, והבקשה נכשלת ברעש — אין טעם לנסות שוב טוקן שלא ייפתח.
 */

export interface WaNumberRef {
  id: string;
  tokenCipher: string | null;
}

/**
 * ה-API של המספר. `injected` — מימוש מזויף בבדיקה (`tests/helpers/fake-wa-api.ts`),
 * שאינו צריך טוקן.
 */
export async function waApiForNumber(number: WaNumberRef, injected?: WaApi): Promise<WaApi> {
  if (injected) return injected;

  const app = env.whatsapp();
  // ההודעה הגיעה, ולכן הייתה תצורה כשהיא נרשמה (ה-route מחזיר 404 בלעדיה). תצורה
  // שנעלמה מאז היא שינוי במשתני הסביבה, ודורשת אדם.
  if (!app) throw new Error("וואטסאפ: אין תצורה בסביבה (WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN)");

  const token = number.tokenCipher ? openWaToken(number.tokenCipher) : null;
  if (!token) {
    await reportWaIssue(number.id, { code: "token_unreadable" });
    throw new WaApiError("הטוקן של המספר העסקי אינו קריא — דרוש חיבור מחדש (מסך 17)", "auth");
  }
  return graphWaApi({ token, version: app.graphVersion, host: env.whatsappGraphHost() });
}

/**
 * מה עושים עם כשל של שירות חיצוני בעיבוד הודעה — **מה הצינור יעשה**, לא מה קרה.
 *
 * - `defer` — לנסות שוב אחר כך: רשת, הגבלת קצב, תקלה אצל הספק, ומנוע AI שאינו
 *   זמין (כולל מפתח שגוי — הדחייה מגיעה ל-Sentry אחרי כמה ניסיונות).
 * - `skip` — הקובץ אינו (מדיה שפגה אחרי 7 ימים, בקשה שנדחתה לגופה): ממשיכים בלעדיו,
 *   והסיבה נרשמת על הקובץ.
 *
 * **טוקן שבוטל נזרק**, אחרי שהמספר עבר ל"תקלה": אין דחייה שתפתור אותו, והמספר
 * כולו שותק עד חיבור מחדש — זה בדיוק מה שמסך 17 והבאנר בלוח אומרים למנהל.
 */
export async function onExternalFailure(error: unknown, numberId: string): Promise<"defer" | "skip"> {
  if (error instanceof WaApiError) {
    if (error.kind === "transient") return "defer";
    if (error.kind === "auth") {
      await reportWaIssue(numberId, { code: "token_revoked" });
      throw error;
    }
    return "skip";
  }
  if (error instanceof AiRequestError) return error.kind === "permanent" ? "skip" : "defer";
  throw error;
}
