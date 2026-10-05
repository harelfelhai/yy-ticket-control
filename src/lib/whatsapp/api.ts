import type { GraphConfig } from "./graph";
import { type MediaDownload, downloadMedia } from "./media";
import { type SendTextInput, sendText } from "./send";

/**
 * מה שהצינור צריך מוואטסאפ — ממשק מוזרק, כמו `MailSource` במייל.
 *
 * הצינור מקבל `WaApi` ולא קורא ל-Graph בעצמו, ולכן בדיקה לעולם אינה נוגעת
 * ברשת: היא מזריקה את המימוש המזויף (`tests/helpers/fake-wa-api.ts`). המימוש
 * האמיתי כאן רק מחבר את המודולים, שכל אחד מהם נבדק בנפרד מול `fetch` מזויף.
 */
export interface WaApi {
  sendText(input: SendTextInput): Promise<{ wamid: string }>;
  downloadMedia(mediaId: string, options: { maxBytes: number }): Promise<MediaDownload>;
}

export function graphWaApi(config: GraphConfig): WaApi {
  return {
    sendText: (input) => sendText(config, input),
    downloadMedia: (mediaId, options) => downloadMedia(config, mediaId, options),
  };
}
