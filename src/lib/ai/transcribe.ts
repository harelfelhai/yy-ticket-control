import { env } from "@/lib/env";
import type { Transcriber } from "./types";

/**
 * תמלול הקלטה קולית בעברית.
 *
 * זו התכונה שהופכת פתיחת פנייה בשטח למהירה באמת: מנהל עבודה עם כפפות,
 * מול דירה, מדבר במקום להקליד. התמלול ממלא את התיאור אם הוא ריק.
 *
 * ‏`fetch` ישיר ולא SDK: מדובר בקריאת multipart אחת לנקודת קצה מתועדת,
 * ו-SDK של OpenAI היה מוסיף תלות כבדה עבור בקשה יחידה.
 */

const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";

/**
 * המודל המהיר והזול מבין מודלי התמלול. `whisper-1` נשאר כגיבוי: הוא
 * הוותיק, והוא זמין גם כשהחדש אינו נתמך בחשבון.
 */
const MODEL = "gpt-4o-mini-transcribe";
const FALLBACK_MODEL = "whisper-1";

/**
 * ‏`language: "he"` אינו קישוט. בלעדיו המודל מזהה את השפה בעצמו, ובהקלטה
 * קצרה ורועשת מאתר בנייה הוא טועה ומחזיר תעתיק לטינית של מילים עבריות.
 */
const LANGUAGE = "he";

export function openaiTranscriber(apiKey: string): Transcriber {
  return {
    name: "openai",

    async transcribe(audio, mimeType) {
      try {
        return await request(apiKey, audio, mimeType, MODEL);
      } catch (error) {
        // ניסיון שני במודל הוותיק, ורק אז כישלון. חשבון שאין לו גישה
        // למודל החדש הוא תקלה שקטה שאפשר לעקוף.
        if (!isModelError(error)) throw error;
        return request(apiKey, audio, mimeType, FALLBACK_MODEL);
      }
    },
  };
}

async function request(
  apiKey: string,
  audio: Buffer,
  mimeType: string,
  model: string,
): Promise<string> {
  const form = new FormData();
  // שם הקובץ נדרש: ה-API מסיק ממנו את הפורמט, ובלעדיו הוא דוחה את הבקשה.
  form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), fileName(mimeType));
  form.append("model", model);
  form.append("language", LANGUAGE);

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new TranscriptionError(response.status, `OpenAI החזיר ${response.status}: ${details}`);
  }

  const data = (await response.json()) as { text?: string };
  return (data.text ?? "").trim();
}

class TranscriptionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** ‏400/404 על מודל פירושם "המודל אינו זמין לך", ולא תקלה בקובץ */
function isModelError(error: unknown): boolean {
  return error instanceof TranscriptionError && (error.status === 400 || error.status === 404);
}

const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
};

function fileName(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return `recording.${EXTENSIONS[base] ?? "webm"}`;
}

/**
 * מחזיר מתמלל, או null כשאין מפתח.
 *
 * ‏null ולא שגיאה: הקלטה בלי תמלול היא עדיין הקלטה שאפשר להאזין לה, ולכן
 * היעדר המפתח מסמן את הקובץ כ-SKIPPED במקום להכשיל ג'וב שוב ושוב. זה
 * שונה מהמייל, שם היעדר הגדרה פירושו שאיש לא מקבל דבר.
 */
export function selectTranscriber(): Transcriber | null {
  const apiKey = env.openaiApiKey();
  return apiKey ? openaiTranscriber(apiKey) : null;
}
