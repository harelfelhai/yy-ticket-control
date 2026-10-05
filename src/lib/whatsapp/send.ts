import { WaApiError } from "./errors";
import { type GraphConfig, graphJson } from "./graph";

/**
 * שליחת הודעת טקסט — הצורה היחידה שבה המערכת כותבת בוואטסאפ בגרסה 1.4: הודעת
 * האישור לשולח, כתגובה להודעה שלו (§2.7 שלב 4). אין כאן תבניות, כפתורים או
 * רשימות (§6, `scope-boundaries.test.ts` SC-OUT-01).
 *
 * **`context.message_id` הוא מה שמחבר את השיחה.** הודעה שנשלחת כתגובה לאחרונה
 * בדיווח מופיעה אצל השולח מצוטטת, וה-wamid שלה נשמר: תגובה (Reply) עליה
 * חוזרת לטיוטה (§2.7 שלב 5).
 */

/** הגג של וואטסאפ לגוף הודעת טקסט */
export const MAX_TEXT_LENGTH = 4096;

export interface SendTextInput {
  /** המספר העסקי ששולח (`WaNumber.phoneNumberId`) */
  phoneNumberId: string;
  /** הנמען — `wa_id` כפי שנמסר (`972…`) */
  to: string;
  body: string;
  /** ההודעה שעליה עונים — מופיעה מצוטטת אצל הנמען */
  contextWamid?: string | null;
}

interface SendResponse {
  messages?: { id?: unknown }[];
}

export async function sendText(config: GraphConfig, input: SendTextInput): Promise<{ wamid: string }> {
  if (!input.body.trim()) throw new WaApiError("הודעה ריקה אינה נשלחת", "permanent");
  // נוסח ארוך מהגג הוא באג אצל מי שהרכיב אותו; Meta הייתה דוחה אותו ממילא
  if (input.body.length > MAX_TEXT_LENGTH) {
    throw new WaApiError(`ההודעה ארוכה מ-${MAX_TEXT_LENGTH} תווים`, "permanent");
  }

  const response = await graphJson<SendResponse>(config, `${encodeURIComponent(input.phoneNumberId)}/messages`, {
    method: "POST",
    json: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "text",
      text: { body: input.body, preview_url: false },
      ...(input.contextWamid ? { context: { message_id: input.contextWamid } } : {}),
    },
  });

  const wamid = response.messages?.[0]?.id;
  if (typeof wamid !== "string" || !wamid) {
    // ההודעה אולי יצאה, ואין לנו את המזהה שלה — תגובה עליה לא תחזור לטיוטה
    throw new WaApiError("Graph קיבל את ההודעה בלי להחזיר את המזהה שלה", "permanent");
  }
  return { wamid };
}
