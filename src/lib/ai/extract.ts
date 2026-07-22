import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import type { TextExtractor } from "./types";

/**
 * חילוץ טקסט מתמונה או מ-PDF, באמצעות Claude.
 *
 * המקרה שבגללו זה קיים: דוח בדק בית מגיע כ-PDF או כצילום מסך, ולפעמים
 * כתוב בכתב יד. חילוץ הטקסט הופך אותו למשהו שאפשר לחפש בו — "כל הפניות
 * שמזכירות רטיבות" — במקום לתמונה שמישהו צריך לפתוח ולקרוא.
 *
 * ‏Claude ולא מנוע OCR ייעודי: העברית בכתב יד ובטבלאות שבורות היא בדיוק
 * מה שמנועי OCR קלאסיים נכשלים בו, וכאן נדרשת גם הבנה של המבנה ולא רק
 * זיהוי תווים.
 */

const MODEL = "claude-opus-4-8";

/** תשובת חילוץ ארוכה מזה היא סימן שהמודל התחיל להמציא */
const MAX_TOKENS = 4096;

/**
 * ‏PDF וכתב יד עברי הם המקרה הקשה, ולכן ההנחיה מפורשת בשלוש נקודות:
 * להחזיר טקסט בלבד, לשמור על סדר הקריאה, ולומר במפורש כשאין טקסט. בלי
 * האחרונה המודל ממציא תיאור של התמונה, והתיאור הזה היה נכנס לחיפוש
 * כאילו היה טקסט שנמצא במסמך.
 */
const PROMPT = [
  "חלץ את כל הטקסט שמופיע בקובץ, בעברית או בכל שפה אחרת.",
  "החזר את הטקסט בלבד, בסדר שבו הוא מופיע, בלי הקדמה ובלי הסבר.",
  "שמור על מבנה של טבלאות ורשימות ככל האפשר.",
  'אם אין בקובץ טקסט כלל, החזר בדיוק: "אין טקסט".',
].join(" ");

/** הנוסח שהמודל מתבקש להחזיר כשאין טקסט — מזוהה ומתורגם ל"אין תוצאה" */
const NO_TEXT = "אין טקסט";

export function claudeExtractor(apiKey: string): TextExtractor {
  const client = new Anthropic({ apiKey });

  return {
    name: "claude",

    async extract(file, mimeType) {
      const base64 = file.toString("base64");
      const mediaType = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";

      const message = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          {
            role: "user",
            content: [
              // ‏PDF נשלח כ-document ותמונה כ-image. אלה שני סוגי בלוקים
              // שונים ב-API, והחלפה ביניהם נדחית.
              mediaType === "application/pdf"
                ? {
                    type: "document" as const,
                    source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 },
                  }
                : {
                    type: "image" as const,
                    source: {
                      type: "base64" as const,
                      media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
                      data: base64,
                    },
                  },
              { type: "text" as const, text: PROMPT },
            ],
          },
        ],
      });

      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();

      return text === NO_TEXT ? "" : text;
    },
  };
}

/**
 * מחזיר מחלץ טקסט, או null כשאין מפתח.
 * ‏null ולא שגיאה — מאותה סיבה שבתמלול: תמונה בלי טקסט מחולץ היא עדיין
 * תמונה שאפשר להסתכל בה.
 */
export function selectTextExtractor(): TextExtractor | null {
  const apiKey = env.anthropicApiKey();
  return apiKey ? claudeExtractor(apiKey) : null;
}

/** ‏Claude רואה את הסוגים האלה. וידאו והקלטות אינם נשלחים אליו כלל. */
const SUPPORTED = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

export function canExtractText(mimeType: string): boolean {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return SUPPORTED.includes(base);
}
