/**
 * Spike (S0, פתיחת פנייה במייל): האם Gemini מחזיר **פלט מובנה** כשהקלט
 * כולל קבצים — תמונה, PDF ואודיו — באותה קריאה.
 *
 * **למה זה נבדק לפני שנכתב קוד.** התיעוד של `response_format` ב-Interactions
 * API מדגים פלט JSON על קלט טקסט בלבד, ואינו אומר דבר על שילוב עם קלט
 * מולטימודלי. חילוץ שדות הפנייה ממייל נשען בדיוק על השילוב הזה: הדירה
 * יכולה להיות כתובה בגוף המייל, בצילום של פתק, או להיאמר בהקלטה. אם השילוב
 * אינו נתמך, החלופה היא שתי קריאות (חילוץ טקסט מהקבצים, ואז קריאה מובנית על
 * טקסט בלבד) — והארכיטקטורה של המחלץ שונה.
 *
 * מה נמדד, לכל תרחיש: קוד התשובה, האם ה-JSON תקין ועומד בסכימה (zod —
 * אותו מקור ממנו נגזרת סכימת ה-JSON שנשלחת), זמן תגובה, צריכת טוקנים,
 * ויציבות הפלט בין חזרות ב-temperature 0.
 *
 * הרצה (הקבצים נוצרים מקומית ואינם בריפו):
 *   npx tsx scripts/spike-gemini-structured.mts <תיקייה עם note.png, report.pdf, voice.wav>
 *
 * המפתח נקרא מ-`GEMINI_API_KEY` ואינו מודפס לעולם. הפלט המלא נכתב
 * ל-`<תיקייה>/gemini-report.json`.
 */

import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MODELS = ["gemini-3.7-flash", "gemini-3.8-flash"];
const TIMEOUT_MS = 120_000;

const dir = process.argv[2];
if (!dir) {
  console.error("שימוש: npx tsx scripts/spike-gemini-structured.mts <תיקיית קבצים>");
  process.exit(1);
}
const apiKey = process.env["GEMINI_API_KEY"];
if (!apiKey) {
  console.error("✖ GEMINI_API_KEY אינו מוגדר");
  process.exit(1);
}

// ──────────────────────── הסכימה (טיוטה ל-S5) ────────────────────────

const ROOMS = [
  "NONE",
  "SALON",
  "KITCHEN",
  "BEDROOM",
  "BATHROOM",
  "WC",
  "BALCONY",
  "MAMAD",
  "STAIRWELL",
  "PARKING",
  "LOBBY",
  "COMMON",
] as const;

/** ערך שנכתב במייל, כפי שנכתב, ומאיפה הוא נלקח */
const mention = z.object({
  text: z.string().describe('הערך כפי שנכתב במקור, מילה במילה. מחרוזת ריקה אם לא הוזכר'),
  source: z.enum(["none", "text", "attachment"]),
});

const extraction = z.object({
  site: mention,
  building: mention,
  apartment: mention,
  room: z.object({ value: z.enum(ROOMS), source: z.enum(["none", "text", "attachment"]) }),
  domain: mention,
  description: z.object({
    op: z.enum(["none", "set", "append", "replace"]),
    text: z.string(),
  }),
  recipients: z.object({
    add: z.array(mention).max(10),
    remove: z.array(mention).max(10),
  }),
});

type Extraction = z.infer<typeof extraction>;

const jsonSchema = z.toJSONSchema(extraction);
// `$schema` אינו חלק מתת-הקבוצה ש-Gemini מתעד; נבדק גם עם וגם בלי.
const jsonSchemaBare = Object.fromEntries(
  Object.entries(jsonSchema as Record<string, unknown>).filter(([key]) => key !== "$schema"),
);

// ──────────────────────── ההקשר (גזטיר) ────────────────────────

const GAZETTEER = [
  "אתרים קיימים: נווה שאנן, רמת אביב.",
  "בניינים באתר: א, ב, ג.",
  "תחומים: אינסטלציה, חשמל, אלומיניום, ריצוף.",
  "אנשי מקצוע: יוסי כהן, יוסי לוי, דני שטרן.",
  "חדרים: סלון=SALON, מטבח=KITCHEN, חדר שינה=BEDROOM, חדר רחצה=BATHROOM, שירותים=WC, מרפסת=BALCONY, ממ״ד=MAMAD, חדר מדרגות=STAIRWELL, חניה=PARKING, לובי=LOBBY, שטח משותף=COMMON.",
].join("\n");

const INSTRUCTIONS = [
  "אתה מחלץ פרטי פנייה על ליקוי בדירה מתוך מייל בעברית ומהקבצים המצורפים אליו.",
  "העתק כל ערך בדיוק כפי שנכתב או נאמר. אל תתקן, אל תשלים שם ואל תבחר מהרשימות — הן להקשר זיהוי בלבד.",
  'source="text" רק אם הערך מופיע מילולית בכותרת או בגוף הטקסט; "attachment" אם הופיע רק בקובץ; "none" אם לא הוזכר.',
  "description.op: set במייל ראשון; בתשובה — append להוספה, replace רק כשנאמר במפורש להחליף, none אם אין.",
  "recipients.remove רק כשנאמר במפורש להסיר נמען.",
  'domain רק כשנכתב שם של תחום עבודה ("אינסטלציה", "חשמל"). שם של בעל מקצוע ("אינסטלטור") אינו תחום — אז source="none".',
].join("\n");

// ──────────────────────── תרחישים ────────────────────────

interface Part {
  type: "text" | "image" | "document" | "audio";
  text?: string;
  file?: string;
  mime?: string;
}

interface Scenario {
  name: string;
  reps: number;
  parts: Part[];
  expect: (x: Extraction) => string[];
}

const SCENARIOS: Scenario[] = [
  {
    name: "text-primary+pdf",
    reps: 3,
    parts: [
      {
        type: "text",
        text: "כותרת: Fwd: תקלה בדירה 14\nגוף:\nהיי, דייר מבניין א דירה 14 מדווח על נזילה מתחת לכיור בחדר הרחצה. צריך אינסטלטור, תשלחו את יוסי כהן. מצרף את הדוח.\n\nבתודה,\nמשה",
      },
      { type: "document", file: "report.pdf", mime: "application/pdf" },
    ],
    expect: (x) =>
      [
        x.building.text.includes("א") ? "" : "building≠א",
        x.apartment.text.includes("14") ? "" : "apartment≠14",
        x.room.value === "BATHROOM" ? "" : `room=${x.room.value}`,
        x.recipients.add.some((r) => r.text.includes("יוסי כהן")) ? "" : "recipient יוסי כהן חסר",
        x.description.op === "set" ? "" : `op=${x.description.op}`,
      ].filter(Boolean),
  },
  {
    name: "attachments-only(image+audio)",
    reps: 5,
    parts: [
      { type: "text", text: "כותרת: תקלה\nגוף:\nהפרטים בתמונה ובהקלטה. תודה" },
      { type: "image", file: "note.png", mime: "image/png" },
      { type: "audio", file: "voice.wav", mime: "audio/wav" },
    ],
    expect: (x) =>
      [
        x.building.text.includes("ב") ? "" : `building=${x.building.text}`,
        /12|שתים עשרה/.test(x.apartment.text) ? "" : `apartment=${x.apartment.text}`,
        x.apartment.source === "attachment" ? "" : `apartment.source=${x.apartment.source}`,
        x.room.value === "BEDROOM" ? "" : `room=${x.room.value}`,
        x.recipients.add.some((r) => r.text.includes("יוסי")) ? "" : "recipient חסר",
      ].filter(Boolean),
  },
  {
    name: "reply-new-text-only",
    reps: 3,
    parts: [
      {
        type: "text",
        text: "תשובה במייל (הטקסט החדש בלבד):\nדירה 14 ולא 12. וגם יש רטיבות בתקרה. תורידו את יוסי כהן ותוסיפו את דני.",
      },
    ],
    expect: (x) =>
      [
        x.apartment.text.includes("14") ? "" : `apartment=${x.apartment.text}`,
        x.description.op === "append" ? "" : `op=${x.description.op}`,
        x.recipients.remove.some((r) => r.text.includes("יוסי כהן")) ? "" : "remove חסר",
        x.recipients.add.some((r) => r.text.includes("דני")) ? "" : "add דני חסר",
        x.building.source === "none" ? "" : `building.source=${x.building.source}`,
      ].filter(Boolean),
  },
];

// ──────────────────────── ריצה ────────────────────────

async function toInput(parts: Part[]) {
  const input: Record<string, unknown>[] = [{ type: "text", text: `${INSTRUCTIONS}\n\n${GAZETTEER}` }];
  for (const part of parts) {
    if (part.type === "text") input.push({ type: "text", text: part.text });
    else {
      const bytes = await readFile(join(dir!, part.file!));
      input.push({ type: part.type, data: bytes.toString("base64"), mime_type: part.mime });
    }
  }
  return input;
}

function readOutput(payload: unknown): { text: string; via: string } {
  const p = payload as {
    output_text?: string;
    steps?: { type?: string; content?: { text?: string }[] }[];
  };
  if (typeof p.output_text === "string") return { text: p.output_text, via: "output_text" };
  const last = p.steps?.filter((s) => s.type === "model_output").at(-1) ?? p.steps?.at(-1);
  return {
    text: (last?.content ?? []).map((c) => c.text ?? "").join(""),
    via: "steps",
  };
}

interface RunRecord {
  scenario: string;
  model: string;
  variant: string;
  rep: number;
  status: number;
  ms: number;
  via?: string;
  jsonOk: boolean;
  schemaOk: boolean;
  misses: string[];
  usage?: unknown;
  error?: string;
  output?: unknown;
}

async function runOnce(
  scenario: Scenario,
  model: string,
  variant: { name: string; schema: unknown; thinking?: string },
  rep: number,
): Promise<RunRecord> {
  const started = Date.now();
  const body = {
    model,
    input: await toInput(scenario.parts),
    store: false,
    generation_config: { temperature: 0, ...(variant.thinking ? { thinking_level: variant.thinking } : {}) },
    response_format: { type: "text", mime_type: "application/json", schema: variant.schema },
  };
  const record: RunRecord = {
    scenario: scenario.name,
    model,
    variant: variant.name,
    rep,
    status: 0,
    ms: 0,
    jsonOk: false,
    schemaOk: false,
    misses: [],
  };
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "x-goog-api-key": apiKey!, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    record.status = response.status;
    const raw = await response.text();
    record.ms = Date.now() - started;
    if (!response.ok) {
      record.error = raw.slice(0, 600);
      return record;
    }
    const payload = JSON.parse(raw) as { usage?: unknown };
    record.usage = payload.usage;
    const { text, via } = readOutput(payload);
    record.via = via;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
      record.jsonOk = true;
    } catch {
      record.error = `לא JSON: ${text.slice(0, 300)}`;
      return record;
    }
    record.output = parsed;
    const result = extraction.safeParse(parsed);
    record.schemaOk = result.success;
    if (result.success) record.misses = scenario.expect(result.data);
    else record.error = result.error.message.slice(0, 600);
  } catch (error) {
    record.ms = Date.now() - started;
    record.error = error instanceof Error ? error.message : String(error);
  }
  return record;
}

const records: RunRecord[] = [];

// מטריצה מצומצמת: כל התרחישים על המודל הנוכחי עם הסכימה כפי ש-zod מפיק,
// ומעליה שלוש שאלות צד — בלי `$schema`, thinking מינימלי, והמודל החדש.
const variants = [
  { name: "zod-schema", schema: jsonSchema },
  { name: "bare-schema", schema: jsonSchemaBare },
  // ‏"minimal" נדחה בריצה הראשונה (400: מותרים low/medium/high למודל הזה).
  { name: "thinking-low", schema: jsonSchemaBare, thinking: "low" },
];

for (const scenario of SCENARIOS) {
  for (let rep = 1; rep <= scenario.reps; rep++) {
    const r = await runOnce(scenario, MODELS[0]!, variants[0]!, rep);
    records.push(r);
    console.log(
      `${r.scenario} ${r.model} ${r.variant} #${rep}: ${r.status} ${r.ms}ms json=${r.jsonOk} schema=${r.schemaOk} misses=${JSON.stringify(r.misses)}${r.error ? ` err=${r.error.slice(0, 160)}` : ""}`,
    );
  }
}

const multimodal = SCENARIOS[1]!;
for (const [variant, reps] of [[variants[1]!, 1], [variants[2]!, 3]] as const) for (let rep = 1; rep <= reps; rep++) {
  const r = await runOnce(multimodal, MODELS[0]!, variant, rep);
  records.push(r);
  console.log(`${r.scenario} ${r.model} ${r.variant}: ${r.status} ${r.ms}ms json=${r.jsonOk} schema=${r.schemaOk} misses=${JSON.stringify(r.misses)}${r.error ? ` err=${r.error.slice(0, 160)}` : ""}`);
}
{
  const r = await runOnce(multimodal, MODELS[1]!, variants[0]!, 1);
  records.push(r);
  console.log(`${r.scenario} ${r.model} ${r.variant}: ${r.status} ${r.ms}ms json=${r.jsonOk} schema=${r.schemaOk} misses=${JSON.stringify(r.misses)}${r.error ? ` err=${r.error.slice(0, 160)}` : ""}`);
}

// יציבות: כמה פלטים שונים לכל תרחיש, על המודל והסכימה הראשיים.
for (const scenario of SCENARIOS) {
  const outputs = records
    .filter((r) => r.scenario === scenario.name && r.variant === "zod-schema" && r.model === MODELS[0] && r.schemaOk)
    .map((r) => JSON.stringify(r.output));
  console.log(`יציבות ${scenario.name}: ${new Set(outputs).size} פלטים שונים מתוך ${outputs.length}`);
}

await writeFile(join(dir, "gemini-report.json"), JSON.stringify({ jsonSchema, records }, null, 2));
console.log(`\nהדוח המלא: ${join(dir, "gemini-report.json")}`);
