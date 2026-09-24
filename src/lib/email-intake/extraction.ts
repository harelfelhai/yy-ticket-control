import { z } from "zod";
import {
  AiRequestError,
  askStructured,
  inputKindFor,
  MAX_INLINE_BYTES,
  type StructuredPart,
} from "@/lib/ai/gemini";
import { env } from "@/lib/env";
import { he } from "@/lib/he";
import { logWarn } from "@/lib/observability/log";
import { ROOMS } from "@/lib/rooms";
import type { FieldExtraction, Mention, MentionSource } from "./types";

/**
 * חילוץ שדות הפנייה ממייל אחד (אפיון §2.6.3, EM-05a).
 *
 * **קריאה אחת, מולטימודלית.** הכותרת, הטקסט החדש והקבצים המצורפים נשלחים
 * יחד, כי הדירה יכולה להיות כתובה בגוף המייל, בצילום של פתק או להיאמר
 * בהקלטה. ניסוי S0 (`docs/research/email-intake-spikes.md`) אימת שהשילוב
 * הזה עובד מול `response_format`, ולכן החלופה של שתי קריאות (חילוץ טקסט
 * מכל קובץ, ואז קריאה מובנית על טקסט) אינה נדרשת.
 *
 * **המחלץ אינו מחליט דבר.** הוא מחזיר טקסט כפי שנכתב ולעולם לא מזהה, אינו
 * יודע מה יש בטיוטה, ואינו בוחר מהרשימות. ההתאמה לרשומות היא `matching.ts`,
 * והמיזוג לטיוטה הוא השירות — כי מודל שפה שמתבקש "לבחור מהרשימה" בוחר גם
 * כשהקלט אינו מתאים לאף פריט. הרשימות נשלחות אליו **להקשר זיהוי בלבד**:
 * מי שיודע ש"נווה שאנן" הוא שם של אתר קורא נכון גם "בנווה שאנן".
 *
 * **הכשל כאן הוא הכרעה, לא שתיקה** (EM-11). תשובה שאינה עומדת בסכימה
 * זורקת `AiRequestError`; היא אינה הופכת לחילוץ ריק, שנראה בדיוק כמו מייל
 * שלא היה בו דבר. הצינור (S6) הוא שמחליט אם לנסות שוב או לפתוח טיוטה
 * שתוכן המייל הוא התיאור שלה, ולומר זאת לשולח.
 */

// ─────────────────────────────── הקלט ───────────────────────────────

/** קובץ מצורף כפי שהוא נשלח למודל — הבתים כבר בידינו */
export interface ExtractionAttachment {
  filename: string | null;
  mimeType: string;
  bytes: Buffer;
}

/**
 * הרשומות הקיימות, כטקסט להקשר.
 *
 * **תוויות בלבד, בלי מזהים.** מזהה בפרומפט היה מזמין את המודל להחזיר אותו,
 * וזו בדיוק הבחירה שהוצאה מידיו. מי נכנס לרשימה — למשל שאיש מקצוע מושבת
 * אינו מועמד — נקבע בשכבת השירות שטוענת אותה, כמו ב-`matching.ts`.
 *
 * החדרים אינם כאן: הם רשימה קבועה של המערכת (`ROOMS`, `he.room`) ונגזרים
 * מהמקור הזה בבניית הפרומפט, כדי שלא יהיו שני מקורות לאותו מיפוי.
 */
export interface Gazetteer {
  sites: readonly string[];
  buildings: readonly string[];
  apartments: readonly string[];
  domains: readonly string[];
  professionals: readonly string[];
  users: readonly string[];
}

export interface ExtractionInput {
  subject: string;
  /** גוף המייל. בתשובה — **הטקסט החדש בלבד**, אחרי `extractNewText` (EM-13) */
  text: string;
  attachments: readonly ExtractionAttachment[];
  gazetteer: Gazetteer;
  /**
   * האם זו תשובה בשרשרת.
   *
   * זה מה שקובע את `description.op`, ולכן הוא נאמר למודל במפורש ולא נלמד
   * מנוסח הטקסט: מייל ראשון קובע תיאור (`set`), ותשובה מוסיפה לו (`append`)
   * או מחליפה רק כשנאמר כך. ניחוש כאן היה מוחק תיאור קיים.
   */
  isReply?: boolean;
}

export interface FieldExtractor {
  readonly name: string;
  extract(input: ExtractionInput): Promise<FieldExtraction>;
}

// ─────────────────────────────── הסכימה ───────────────────────────────

const SOURCES = ["none", "text", "attachment"] as const;

/**
 * `NONE` ולא `null`: הסכימה שנשלחת ל-Gemini היא JSON Schema, ו-enum עם
 * ערך "לא הוזכר" מפורש הוא מה שהניסוי אימת. ההמרה ל-`null` נעשית כאן,
 * ב-`toFieldExtraction`, כדי שהליבה תראה טיפוס אחד.
 */
const ROOM_VALUES = ["NONE", ...ROOMS] as const;

const mentionSchema = z.object({
  text: z.string().describe("הערך כפי שנכתב במקור, מילה במילה. מחרוזת ריקה אם לא הוזכר"),
  source: z.enum(SOURCES),
});

/**
 * הסכימה, ומתוכה סכימת ה-JSON שנשלחת בבקשה — **מקור אחד לשניהם**, כפי
 * שנעשה בניסוי. מבנה שיזוז בצד אחד בלבד היה שולח סכימה אחת ומאמת אחרת.
 */
export const extractionSchema = z.object({
  site: mentionSchema,
  building: mentionSchema,
  apartment: mentionSchema,
  room: z.object({ value: z.enum(ROOM_VALUES), source: z.enum(SOURCES) }),
  domain: mentionSchema,
  description: z.object({
    op: z.enum(["none", "set", "append", "replace"]),
    text: z.string(),
  }),
  // הגג אינו קישוט: "תוסיפו את כולם" על רשימת תפוצה היה מייצר עשרות
  // נמענים שאיש לא כתב, והמודל מקבל את המגבלה בסכימה עצמה.
  recipients: z.object({
    add: z.array(mentionSchema).max(10),
    remove: z.array(mentionSchema).max(10),
  }),
});

export type ExtractionPayload = z.infer<typeof extractionSchema>;

const EXTRACTION_JSON_SCHEMA = z.toJSONSchema(extractionSchema);

// ─────────────────────────────── הפרומפט ───────────────────────────────

/**
 * ההוראות הקבועות. **אינן מחרוזות תצוגה** — הן נקראות בידי מודל ולא בידי
 * אדם, ולכן הן כאן ולא ב-`he.ts`, כמו הפרומפטים של התמלול והחילוץ.
 *
 * כל שורה כאן נכתבה בגלל מדידה בניסוי:
 * - "אל תשלים שם" — מודל שמקבל רשימה משלים אליה, וכך "יוסי" הופך ל"יוסי
 *   כהן" גם כשיש שני יוסי ברשימה, והעמימות (EM-08) נעלמת בלי שאיש יידע.
 * - שם בעל מקצוע אינו תחום — "צריך אינסטלטור" החזיר `domain: "אינסטלטור"`
 *   בכל הריצות עד שנוספה ההוראה; בלעדיה המייל החוזר מדווח "לא נמצא
 *   ברשימה" על תחום שהשולח לא כתב (S0 ממצא 1, EM-A09, §7 שורה 78).
 */
const BASE_INSTRUCTIONS = [
  "אתה מחלץ פרטי פנייה על ליקוי בדירה מתוך מייל בעברית ומהקבצים המצורפים אליו.",
  "העתק כל ערך בדיוק כפי שנכתב או נאמר. אל תתקן, אל תשלים שם ואל תבחר מהרשימות — הן להקשר זיהוי בלבד.",
  'source="text" רק אם הערך מופיע מילולית בכותרת או בגוף הטקסט; "attachment" אם הופיע רק בקובץ מצורף; "none" אם לא הוזכר כלל.',
  "recipients.add ו-recipients.remove — רק אנשים שנכתב במפורש לשלוח אליהם או להסיר אותם.",
  'domain רק כשנכתב שם של תחום עבודה ("אינסטלציה", "חשמל"). שם של בעל מקצוע ("אינסטלטור") אינו תחום — אז source="none".',
];

/** מייל ראשון פותח תיאור; תשובה מוסיפה לו. ניחוש כאן מוחק תיאור קיים. */
const FIRST_MAIL_INSTRUCTIONS = [
  "זהו המייל הראשון בפנייה.",
  'description.op="set" עם תיאור התקלה כפי שנכתב. אל תחזיר append או replace.',
];

const REPLY_INSTRUCTIONS = [
  "זוהי תשובה בשרשרת קיימת, והטקסט שלהלן הוא הטקסט החדש בלבד (הציטוט הוסר).",
  'description.op="append" לתוספת לתיאור, "replace" רק כשנאמר במפורש להחליף את התיאור, "none" כשאין תוספת.',
];

function instructionsFor(isReply: boolean): string {
  return [...BASE_INSTRUCTIONS, ...(isReply ? REPLY_INSTRUCTIONS : FIRST_MAIL_INSTRUCTIONS)].join("\n");
}

/** `סלון=SALON, מטבח=KITCHEN, …` — מהרשימה הקבועה ומהתוויות של המערכת */
const ROOM_LINE = ROOMS.map((room) => `${he.room[room]}=${room}`).join(", ");

function listLine(title: string, values: readonly string[]): string[] {
  return values.length > 0 ? [`${title}: ${values.join(", ")}.`] : [];
}

/**
 * הרשימות כטקסט. רשימה ריקה אינה נשלחת כלל — "אתרים קיימים: ." היה מזמין
 * את המודל להסיק שאין אתרים ולוותר על השדה.
 */
function gazetteerText(gazetteer: Gazetteer): string {
  return [
    ...listLine("אתרים קיימים", gazetteer.sites),
    ...listLine("בניינים", gazetteer.buildings),
    ...listLine("דירות", gazetteer.apartments),
    ...listLine("תחומי עבודה", gazetteer.domains),
    ...listLine("אנשי מקצוע", gazetteer.professionals),
    ...listLine("משתמשי המערכת", gazetteer.users),
    `חדרים: ${ROOM_LINE}.`,
  ].join("\n");
}

// ─────────────────────────────── תקציב הקבצים ───────────────────────────────

/**
 * התקציב לכל הקבצים בקריאה אחת — אותו גג של הקלט המוטבע ב-Gemini.
 *
 * מיובא ולא נכתב שוב: ביום שהגג יזוז, שני מספרים היו הופכים את הבקשה
 * ל-400 שאיש אינו מצפה לו.
 */
export const ATTACHMENT_BUDGET_BYTES = MAX_INLINE_BYTES;

export interface DroppedAttachment {
  attachment: ExtractionAttachment;
  reason: "unsupported" | "budget";
}

/**
 * אילו קבצים נכנסים לקריאה.
 *
 * **בסדר השולח, ולא מהגדול לקטן.** סדר הוא מידע: מי שצירף צילום של הפתק
 * ואחריו וידאו ארוך התכוון שהפתק ייקרא. מיון לפי גודל היה מעלה דווקא את
 * הווידאו ומוציא את הפתק. קובץ שאינו נכנס לשארית התקציב **מדולג**, והבא
 * אחריו עדיין נבחן — כך קובץ קטן בסוף אינו נופל בגלל אחד גדול לפניו.
 *
 * מה שהושמט אינו נעלם: הקובץ נשמר בפנייה כמדיה בכל מקרה (EM-06), והמידע
 * שבו עשוי להגיע דרך התמלול או חילוץ הטקסט שרצים עליו בנפרד.
 */
export function planAttachments(
  attachments: readonly ExtractionAttachment[],
  budgetBytes: number = ATTACHMENT_BUDGET_BYTES,
): { sent: ExtractionAttachment[]; dropped: DroppedAttachment[] } {
  const sent: ExtractionAttachment[] = [];
  const dropped: DroppedAttachment[] = [];
  let used = 0;

  for (const attachment of attachments) {
    if (inputKindFor(attachment.mimeType) === null) {
      dropped.push({ attachment, reason: "unsupported" });
      continue;
    }
    if (used + attachment.bytes.byteLength > budgetBytes) {
      dropped.push({ attachment, reason: "budget" });
      continue;
    }
    used += attachment.bytes.byteLength;
    sent.push(attachment);
  }

  return { sent, dropped };
}

function buildParts(input: ExtractionInput, sent: readonly ExtractionAttachment[]): StructuredPart[] {
  const files = sent.flatMap<StructuredPart>((attachment) => {
    const kind = inputKindFor(attachment.mimeType);
    // `planAttachments` כבר סינן; הבדיקה כאן היא מה שמשאיר את הטיפוס צר.
    return kind === null ? [] : [{ type: kind, data: attachment.bytes, mimeType: attachment.mimeType }];
  });

  return [
    { type: "text", text: instructionsFor(input.isReply === true) },
    { type: "text", text: gazetteerText(input.gazetteer) },
    { type: "text", text: `כותרת: ${input.subject}\nגוף:\n${input.text}` },
    ...files,
  ];
}

// ─────────────────────────────── התשובה ───────────────────────────────

/**
 * מנקה סתירה קטנה ושכיחה: ערך שסומן "לא הוזכר" אך הוחזר עם טקסט, וטקסט
 * ריק שסומן כאילו נקרא. שניהם היו מגיעים להתאמה ומחזירים "לא נמצא ברשימה"
 * על ערך שאיש לא כתב.
 */
function toMention(mention: { text: string; source: MentionSource }): Mention {
  const text = mention.text.trim();
  if (text === "" || mention.source === "none") return { text: "", source: "none" };
  return { text, source: mention.source };
}

export function toFieldExtraction(payload: ExtractionPayload): FieldExtraction {
  const description = { op: payload.description.op, text: payload.description.text.trim() };

  return {
    site: toMention(payload.site),
    building: toMention(payload.building),
    apartment: toMention(payload.apartment),
    room:
      payload.room.value === "NONE" || payload.room.source === "none"
        ? { value: null, source: "none" }
        : { value: payload.room.value, source: payload.room.source },
    domain: toMention(payload.domain),
    // פעולה בלי טקסט אינה פעולה: `append` עם מחרוזת ריקה היה מוסיף שורה
    // ריקה לתיאור ומדווח עליה כעדכון.
    description: description.text === "" ? { op: "none", text: "" } : description,
    recipients: {
      add: payload.recipients.add.map(toMention).filter((mention) => mention.text !== ""),
      remove: payload.recipients.remove.map(toMention).filter((mention) => mention.text !== ""),
    },
  };
}

// ─────────────────────────────── הספק ───────────────────────────────

export function geminiFieldExtractor(apiKey: string): FieldExtractor {
  return {
    name: "gemini",
    async extract(input) {
      const plan = planAttachments(input.attachments);
      for (const { attachment, reason } of plan.dropped) {
        // בלי שם הקובץ: שם של צרופה נושא לא פעם שם של אדם או של דירה,
        // והלוג הזה נקרא בידי מי שאין לו גישה לפנייה.
        logWarn("email.extract.attachment-skipped", {
          reason,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.bytes.byteLength,
        });
      }

      const payload = await askStructured(
        apiKey,
        buildParts(input, plan.sent),
        EXTRACTION_JSON_SCHEMA,
      );

      const parsed = extractionSchema.safeParse(payload);
      if (!parsed.success) {
        // `permanent`: אותה בקשה תחזיר את אותה תשובה. הצינור הופך זאת
        // למסלול "החילוץ אינו זמין" (EM-11) — הכרעה שנאמרת לשולח.
        throw new AiRequestError(
          `תשובת החילוץ אינה עומדת בסכימה: ${parsed.error.message.slice(0, 300)}`,
          "permanent",
        );
      }

      return toFieldExtraction(parsed.data);
    },
  };
}

/**
 * בורר המחלץ, באותה תבנית של `selectTranscriber` ו-`selectTextExtractor`.
 *
 * `null` ולא זריקה: היעדר מפתח הוא מצב מוכר שיש לו מסלול מלא — טיוטה
 * שתוכן המייל הוא התיאור שלה ומייל חוזר שמפנה למערכת (EM-11). ההחלטה
 * שייכת לקורא, ולכן כאן היא רק נאמרת.
 */
export function selectFieldExtractor(): FieldExtractor | null {
  const apiKey = env.geminiApiKey();
  return apiKey ? geminiFieldExtractor(apiKey) : null;
}
