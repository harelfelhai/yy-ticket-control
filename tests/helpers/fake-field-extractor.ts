import type { Room } from "@/generated/prisma/enums";
import { AiRequestError, type AiErrorKind } from "@/lib/ai/gemini";
import type { ExtractionInput, FieldExtractor } from "@/lib/email-intake/extraction";
import type { FieldExtraction, Mention, MentionSource } from "@/lib/email-intake/types";

/**
 * מחלץ שדות מזויף — לכל בדיקה של מסלול המייל הראשון והתשובה (S6).
 *
 * **בלי רשת ובלי מפתח.** הקריאה האמיתית היא לספק חיצוני בתשלום, ובדיקה
 * שתלויה בה אינה בדיקה: היא איטית, היא עולה כסף, והיא נכשלת מסיבות שאינן
 * בקוד. מה שנבדק בצינור אינו איכות החילוץ אלא מה שנעשה בתוצאה — ההתאמה
 * לרשומות, הדיווח לשולח, וההכרעה כשהחילוץ אינו זמין (EM-11).
 *
 * **הכשל הוא חצי מהתפקיד.** `AiRequestError` נושא `kind`, והצינור מחליט
 * לפיו אם לנסות שוב (`transient` בתוך תקציב ארבע הדקות) או לרשום מיד הכרעה
 * סופית (`permanent`, היעדר מפתח). מחלץ שיודע רק להצליח משאיר את כל הענף
 * הזה בלי כיסוי — והוא בדיוק הענף ששקט בו הוא הנזק.
 *
 * **הקלט נרשם** (`calls`), כי לחלק מהדרישות אין תוצאה גלויה: EM-13 אומר
 * שבתשובה נקרא רק הטקסט החדש, והדרך היחידה לאמת זאת היא לקרוא מה נשלח
 * למחלץ — טיוטה שנראית נכונה יכולה להתקבל גם מציטוט שנקרא כהוראה.
 */

// ─────────────────────────────── בניית חילוץ ───────────────────────────────

const NONE: Mention = { text: "", source: "none" };

/** חילוץ שלא מצא דבר — הבסיס שכל `extractionOf` בונה עליו */
export function emptyExtraction(): FieldExtraction {
  return {
    site: { ...NONE },
    building: { ...NONE },
    apartment: { ...NONE },
    room: { value: null, source: "none" },
    domain: { ...NONE },
    description: { op: "none", text: "" },
    recipients: { add: [], remove: [] },
  };
}

/**
 * מפרט מקוצר לחילוץ. **ערכים כטקסט כפי שנכתב, לא מזהים** — זה החוזה של
 * `FieldExtraction`, וההתאמה לרשומות היא `matching.ts`. מפרט שהיה מקבל
 * מזהה היה מאפשר לבדיקה לעקוף בדיוק את השלב שהוצא מידי המודל.
 */
export interface ExtractionSpec {
  site?: string;
  building?: string;
  apartment?: string;
  room?: Room;
  domain?: string;
  /** מחרוזת = `set` (מייל ראשון). לתשובה: `{ op: "append", text }`. */
  description?: string | FieldExtraction["description"];
  recipientsAdd?: readonly string[];
  recipientsRemove?: readonly string[];
  /** מאיפה נקראו הערכים. ברירת המחדל `text`; `attachment` למי שנקרא מקובץ. */
  source?: MentionSource;
}

export function extractionOf(spec: ExtractionSpec = {}): FieldExtraction {
  const source = spec.source ?? "text";
  const mention = (text: string | undefined): Mention => (text ? { text, source } : { ...NONE });
  const list = (values: readonly string[] | undefined): Mention[] => (values ?? []).map((text) => ({ text, source }));

  return {
    ...emptyExtraction(),
    site: mention(spec.site),
    building: mention(spec.building),
    apartment: mention(spec.apartment),
    room: spec.room ? { value: spec.room, source } : { value: null, source: "none" },
    domain: mention(spec.domain),
    description:
      typeof spec.description === "string"
        ? { op: "set", text: spec.description }
        : (spec.description ?? { op: "none", text: "" }),
    recipients: { add: list(spec.recipientsAdd), remove: list(spec.recipientsRemove) },
  };
}

/** שגיאת חילוץ עם הסיווג שקובע מה הצינור יעשה בה */
export function aiError(kind: AiErrorKind, message = `כשל מתוכנן בחילוץ (${kind})`): AiRequestError {
  return new AiRequestError(message, kind);
}

// ─────────────────────────────── המחלץ ───────────────────────────────

export interface FakeFieldExtractor extends FieldExtractor {
  /** הקלטים שהגיעו, לפי סדרם */
  readonly calls: readonly ExtractionInput[];
  /** הקלט האחרון, לבדיקה שיש לה קריאה אחת בלבד */
  readonly lastCall: ExtractionInput | undefined;
  /** התשובה מכאן והלאה */
  setResult(result: FieldExtraction | ExtractionSpec): void;
  /** יפיל את `times` הקריאות הבאות (ברירת המחדל 1; `Infinity` = כולן) */
  failNext(error: AiRequestError, times?: number): void;
  clearCalls(): void;
}

export interface FakeFieldExtractorOptions {
  /** מה שיחזור בהצלחה. ברירת המחדל: חילוץ ריק. */
  result?: FieldExtraction | ExtractionSpec;
  /** כשל קבוע: כל קריאה תזרוק אותו, אלא אם נקבע `failTimes`. */
  error?: AiRequestError;
  /** כמה קריאות יפלו ב-`error`. ברירת המחדל כשיש `error`: כולן. */
  failTimes?: number;
  /** השם ליומן. ברירת המחדל `"fake"`. */
  name?: string;
}

/** האם זה `FieldExtraction` מלא או מפרט מקוצר */
function isExtraction(value: FieldExtraction | ExtractionSpec): value is FieldExtraction {
  return "recipients" in value;
}

function toExtraction(value: FieldExtraction | ExtractionSpec): FieldExtraction {
  return isExtraction(value) ? value : extractionOf(value);
}

export function fakeFieldExtractor(options: FakeFieldExtractorOptions = {}): FakeFieldExtractor {
  const calls: ExtractionInput[] = [];
  let result = options.result ? toExtraction(options.result) : emptyExtraction();
  let error: AiRequestError | null = options.error ?? null;
  let remaining = options.error ? (options.failTimes ?? Number.POSITIVE_INFINITY) : 0;

  return {
    name: options.name ?? "fake",

    async extract(input) {
      // הרישום לפני הזריקה: ניסיון שנכשל הוא ניסיון שקרה, ובדיקה שסופרת את
      // תקציב הניסיונות החוזרים (EM-11) צריכה לראות את כולם.
      calls.push(input);

      if (error && remaining > 0) {
        remaining -= 1;
        const thrown = error;
        if (remaining <= 0) error = null;
        throw thrown;
      }
      return result;
    },

    get calls() {
      return calls;
    },

    get lastCall() {
      return calls[calls.length - 1];
    },

    setResult(next) {
      result = toExtraction(next);
    },

    failNext(next, times = 1) {
      error = next;
      remaining = times;
    },

    clearCalls() {
      calls.length = 0;
    },
  };
}
