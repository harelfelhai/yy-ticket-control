import { createHash } from "node:crypto";
import type { WaApi } from "@/lib/whatsapp/api";
import type { WaApiError } from "@/lib/whatsapp/errors";
import type { MediaDownload } from "@/lib/whatsapp/media";
import type { SendTextInput } from "@/lib/whatsapp/send";

/**
 * וואטסאפ בזיכרון שמממש את `WaApi` — לכל בדיקה של הצינור (W4 ואילך).
 *
 * **אין כאן רשת, ואי אפשר להוסיף אותה בלי לשנות את הקובץ** — אותו עיקרון כמו
 * `fake-mail-source.ts`. המספר העסקי אמיתי ומשמש את הצוות, ובדיקה ש"נגעה בטעות"
 * בשליחה הייתה שולחת הודעה לאדם.
 *
 * **הכשל הוא חצי מהתפקיד.** `failSend` ו-`failMedia` מחזירים `WaApiError` מסווג,
 * כדי שהבדיקות יעברו גם במסלול הדחייה (`transient`), העצירה (`auth`) וההכרעה
 * (`permanent`, למשל 131047) — מימוש שיודע רק להצליח משאיר אותם בלי כיסוי.
 */

export interface FakeMedia {
  bytes: Buffer;
  mimeType: string;
}

export interface FakeWaApi extends WaApi {
  /** כל הודעה שנשלחה, לפי הסדר */
  sent: (SendTextInput & { wamid: string })[];
  /** כל מזהה מדיה שהתבקש, לפי הסדר */
  mediaRequests: string[];
}

export function fakeWaApi(
  options: {
    media?: Record<string, FakeMedia>;
    failSend?: (input: SendTextInput) => WaApiError | null;
    failMedia?: (mediaId: string) => WaApiError | null;
  } = {},
): FakeWaApi {
  const sent: FakeWaApi["sent"] = [];
  const mediaRequests: string[] = [];

  return {
    sent,
    mediaRequests,
    async sendText(input) {
      const failure = options.failSend?.(input);
      if (failure) throw failure;
      const wamid = `wamid.sent-${sent.length + 1}`;
      sent.push({ ...input, wamid });
      return { wamid };
    },
    async downloadMedia(mediaId, { maxBytes }): Promise<MediaDownload> {
      mediaRequests.push(mediaId);
      const failure = options.failMedia?.(mediaId);
      if (failure) throw failure;
      const media = options.media?.[mediaId];
      if (!media) throw new Error(`fakeWaApi: אין מדיה ${mediaId} — הבדיקה לא הגדירה אותה`);
      if (media.bytes.byteLength > maxBytes) return { ok: false, reason: "too-large", sizeBytes: media.bytes.byteLength };
      return {
        ok: true,
        media: {
          bytes: media.bytes,
          mimeType: media.mimeType,
          sha256: createHash("sha256").update(media.bytes).digest("hex"),
          sizeBytes: media.bytes.byteLength,
        },
      };
    },
  };
}
