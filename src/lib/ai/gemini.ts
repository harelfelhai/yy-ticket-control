import { env } from "@/lib/env";
import type { TextExtractor, Transcriber } from "./types";

/**
 * שני מנועי ה-AI של המערכת — תמלול עברית וחילוץ טקסט — מול ספק אחד.
 *
 * **עד 1.9.2026 היו כאן שני ספקים**: ‏OpenAI לתמלול ו-Claude לחילוץ. כל
 * אחד נבחר בנפרד כ"הטוב ביותר לתפקידו", ואיש לא תמחר את הפיצול עצמו: שני
 * חשבונות, שני מפתחות, שתי נקודות כשל, ושתי חשבוניות — במערכת שכל
 * ה-AI שלה הוא הקלטה מדי פעם ודוח בדק בית מדי פעם.
 *
 * ‏Gemini עושה את שניהם באותה נקודת קצה ובאותו מודל, ולכן החוזה נשאר כפול
 * (`Transcriber` ו-`TextExtractor` הם שתי שאלות שונות) בעוד המימוש נעשה
 * אחד. זה גם זול בהרבה: `gemini-3.7-flash` הוא $0.75/$3.75 למיליון טוקנים
 * מול $5/$25 של Opus 4.8 שחילץ כאן קודם.
 *
 * **החוזה לא זז.** מי שקורא לכאן — `jobs/handlers/ai.ts` — אינו יודע מי
 * הספק, וזו בדיוק הסיבה שההחלפה נגעה בקובץ הזה ובבחירת המפתח בלבד.
 */

/** נקודת הקצה האחידה של Gemini — אודיו, תמונות ו-PDF עוברים דרכה זהה */
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

/**
 * מודל אחד לשתי המשימות, כפי שהתיעוד של Gemini מדגים את שתיהן.
 *
 * ‏`gemini-3.5-transcribe` קיים ברשימת המודלים כמנוע דיבור ייעודי, ואינו
 * נבחר כאן: תיעוד האודיו של ה-API הזה מפנה לדגם ה-flash, ולתמלול ייעודי
 * בזמן אמת הוא מפנה ל-Cloud Speech-to-Text — שירות אחר עם אימות אחר.
 * מודל אחד לשתי המשימות שווה יותר מאופטימיזציה שמכניסה ספק שלישי.
 */
const MODEL = "gemini-3.7-flash";

/**
 * גג לקריאה בודדת. דוח בדק בית ארוך לוקח זמן, אבל לא בלי גבול: התור
 * מנוקז סדרתית, וקריאה שאינה חוזרת עוצרת גם את ההתראות שממתינות אחריה.
 */
const TIMEOUT_MS = 120_000;

/**
 * ‏Gemini מגביל בקשה **מוטבעת** ל-20MB כולל הפרומפט, ו-base64 מנפח את
 * הקובץ ביחס 4:3. מכאן הגג האמיתי על הקובץ הגולמי: ~14MB.
 *
 * המערכת מתירה העלאה עד 50MB (`MAX_FILE_BYTES`), ולכן הפער אפשרי. הוא
 * נבדק **לפני** הקידוד ונכשל בהודעה שאומרת את המספרים — ולא נשלח כדי
 * לקבל 400 סתום. הפתרון המלא הוא Files API של Gemini, והוא ייכתב כשקובץ
 * כזה יופיע בפועל; היום אין אף אחד כזה, וכל 15 קובצי המדיה בפרודקשן
 * קטנים בסדרי גודל.
 */
const MAX_INLINE_BYTES = 14 * 1024 * 1024;

/** סוגי הקבצים ש-Gemini קורא מהם טקסט. וידאו והקלטות אינם נשלחים לכאן. */
const SUPPORTED = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

export function canExtractText(mimeType: string): boolean {
  return SUPPORTED.includes(baseMime(mimeType));
}

/**
 * ‏PDF נשלח כ-`document` ותמונה כ-`image` — שני סוגי קלט שונים ב-API,
 * ואודיו כ-`audio`. הצמד הזה הוא כל ההבדל בין שתי המשימות.
 */
type InputKind = "audio" | "image" | "document";

/** ‏`image/jpeg; charset=x` → `image/jpeg`. ה-API מקבל את הטיפוס הנקי בלבד. */
function baseMime(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

/**
 * קריאה אחת ל-Gemini: קובץ אחד ופרומפט אחד, וטקסט בחזרה.
 *
 * ‏`fetch` ישיר ולא SDK, כמו בכל שאר האינטגרציות היוצאות כאן: זו בקשת
 * POST אחת לנקודת קצה מתועדת, ו-SDK היה מוסיף תלות שלמה עבורה.
 */
async function ask(
  apiKey: string,
  kind: InputKind,
  file: Buffer,
  mimeType: string,
  prompt: string,
): Promise<string> {
  if (file.byteLength > MAX_INLINE_BYTES) {
    throw new Error(
      `הקובץ גדול מדי לעיבוד מוטבע: ${Math.round(file.byteLength / 1024 / 1024)}MB, ` +
        `הגג הוא ${MAX_INLINE_BYTES / 1024 / 1024}MB`,
    );
  }

  const response = await fetch(ENDPOINT, {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      // ‏Gemini מאמת בכותרת ייעודית, לא ב-`Authorization: Bearer`.
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      input: [
        { type: kind, data: file.toString("base64"), mime_type: baseMime(mimeType) },
        { type: "text", text: prompt },
      ],
    }),
  });

  if (!response.ok) {
    // הטקסט המלא נכנס לשגיאה כדי שיישמר ב-`Job.lastError` ויהיה אפשר
    // לאבחן בלי לשחזר — אותה מדיניות כמו בשליחת המייל.
    const details = await response.text().catch(() => "");
    throw new Error(`Gemini החזיר ${response.status}: ${details}`);
  }

  return readText(await response.json());
}

/**
 * מוציא את הטקסט מהתשובה.
 *
 * המבנה הוא `steps[].content[].text`, והקריאה היא מה**צעד האחרון** — הוא
 * התשובה, וקודמיו הם שלבי ביניים. כתוב הגנתי בכוונה: תשובה בצורה שאינה
 * מוכרת מחזירה מחרוזת ריקה, כלומר "לא נמצא טקסט", ולא מפילה את הג'וב
 * ב-`TypeError` שאי אפשר לאבחן ממנו דבר.
 */
function readText(payload: unknown): string {
  const steps = (payload as { steps?: { content?: { text?: string }[] }[] }).steps;
  const last = Array.isArray(steps) ? steps.at(-1) : undefined;
  if (!last || !Array.isArray(last.content)) return "";

  return last.content
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
}

// ──────────────────────────── תמלול ────────────────────────────

/**
 * ‏"בעברית" בפרומפט אינו קישוט: בהקלטה קצרה ורועשת מאתר בנייה מודל
 * שמזהה שפה בעצמו נוטה להחזיר תעתיק לטינית של מילים עבריות. אותה סיבה
 * בדיוק שבגללה המימוש הקודם קיבע `language: "he"`.
 *
 * וההנחיה להחזיר טקסט בלבד נחוצה כאן לא פחות מבחילוץ: מודל מולטימודלי
 * שמתבקש "לתמלל" עלול להוסיף פתיח מנומס, והפתיח הזה היה נכנס לשדה
 * התיאור של הפנייה ולמנוע החיפוש כאילו מישהו אמר אותו.
 */
const TRANSCRIBE_PROMPT = [
  "תמלל את ההקלטה הזו במלואה. ההקלטה בעברית.",
  "החזר את התמלול בלבד, בלי הקדמה, בלי הסבר ובלי סימני ציטוט.",
  'אם לא נאמר בהקלטה דבר, החזר בדיוק: "אין דיבור".',
].join(" ");

/** הנוסח שהמודל מתבקש להחזיר כשאין דיבור — מתורגם ל"אין תוצאה" */
const NO_SPEECH = "אין דיבור";

export function geminiTranscriber(apiKey: string): Transcriber {
  return {
    name: "gemini",
    async transcribe(audio, mimeType) {
      const text = await ask(apiKey, "audio", audio, mimeType, TRANSCRIBE_PROMPT);
      return text === NO_SPEECH ? "" : text;
    },
  };
}

// ──────────────────────── חילוץ טקסט ────────────────────────

/**
 * ‏PDF וכתב יד עברי הם המקרה הקשה, ולכן ההנחיה מפורשת בשלוש נקודות:
 * להחזיר טקסט בלבד, לשמור על סדר הקריאה, ולומר במפורש כשאין טקסט. בלי
 * האחרונה המודל ממציא תיאור של התמונה, והתיאור הזה היה נכנס לחיפוש
 * כאילו היה טקסט שנמצא במסמך.
 */
const EXTRACT_PROMPT = [
  "חלץ את כל הטקסט שמופיע בקובץ, בעברית או בכל שפה אחרת.",
  "החזר את הטקסט בלבד, בסדר שבו הוא מופיע, בלי הקדמה ובלי הסבר.",
  "שמור על מבנה של טבלאות ורשימות ככל האפשר.",
  'אם אין בקובץ טקסט כלל, החזר בדיוק: "אין טקסט".',
].join(" ");

/** הנוסח שהמודל מתבקש להחזיר כשאין טקסט — מתורגם ל"אין תוצאה" */
const NO_TEXT = "אין טקסט";

export function geminiExtractor(apiKey: string): TextExtractor {
  return {
    name: "gemini",
    async extract(file, mimeType) {
      const kind: InputKind = baseMime(mimeType) === "application/pdf" ? "document" : "image";
      const text = await ask(apiKey, kind, file, mimeType, EXTRACT_PROMPT);
      return text === NO_TEXT ? "" : text;
    },
  };
}

// ──────────────────────────── בחירה ────────────────────────────

/**
 * שני הבוררים, ומפתח אחד מאחוריהם.
 *
 * ‏null ולא שגיאה: הקלטה בלי תמלול היא עדיין הקלטה שאפשר להאזין לה,
 * ותמונה בלי טקסט מחולץ היא תמונה שאפשר להסתכל בה. היעדר המפתח מסמן את
 * הקובץ כ-SKIPPED עם שורה שאומרת זאת למשתמש, במקום להכשיל ג'וב שוב ושוב.
 * זה שונה מהמייל, שם היעדר הגדרה פירושו שאיש אינו מקבל דבר — ולכן שם זו
 * זריקה.
 */
export function selectTranscriber(): Transcriber | null {
  const apiKey = env.geminiApiKey();
  return apiKey ? geminiTranscriber(apiKey) : null;
}

export function selectTextExtractor(): TextExtractor | null {
  const apiKey = env.geminiApiKey();
  return apiKey ? geminiExtractor(apiKey) : null;
}
