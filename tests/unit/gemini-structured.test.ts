import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiRequestError, askStructured } from "@/lib/ai/gemini";
import {
  ATTACHMENT_BUDGET_BYTES,
  extractionSchema,
  geminiFieldExtractor,
  planAttachments,
  selectFieldExtractor,
  toFieldExtraction,
  type ExtractionInput,
} from "@/lib/email-intake/extraction";
import * as log from "@/lib/observability/log";

/**
 * החילוץ המובנה (EM-05a) — הקריאה היחידה שמדברת עם מודל שפה בקליטת המייל.
 *
 * S0 (`docs/research/email-intake-spikes.md`) כבר הכריע את הצורה: קריאה
 * אחת מולטימודלית, `response_format` עם סכימה מ-zod, `temperature: 0`
 * ו-`thinking_level: "low"`. מה שנבדק כאן הוא מה שיכול להישבר בלי שאיש
 * יידע:
 *
 * 1. **צורת הבקשה.** סכימה, טמפרטורה ורמת חשיבה שנשמטו אינם מפילים דבר —
 *    המודל פשוט מחזיר פרוזה, והחילוץ מתחיל לזייף ערכים.
 * 2. **סיווג הכשל.** הצינור (S6) מחליט לפי `kind` אם לנסות שוב לנצח או
 *    לעצור ברעש. סיווג שגוי פירושו ניסיונות אינסופיים על מפתח פסול, או
 *    ויתור על תקלה חולפת.
 * 3. **"החילוץ אינו זמין" הוא הכרעה ולא שתיקה** (EM-11). תשובה שאינה
 *    עומדת בסכימה **זורקת**; היא אינה הופכת לחילוץ ריק שנראה כמו מייל בלי
 *    פרטים.
 * 4. **תקציב ה-14MB.** קובץ שלא נכנס מושמט מהבקשה במקום להחזיר 400 סתום.
 *
 * `fetch` מוחלף בכפיל בכל הבדיקות — אין כאן קריאה אמיתית ל-Gemini.
 */

// ─────────────────────────────── כלי עזר ───────────────────────────────

/** תשובה בצורה ש-S0 מדד: הטקסט בצעד `model_output`, ב-`content[].text` */
function reply(text: string) {
  return {
    steps: [
      { type: "thought", content: [{ text: "שלב ביניים" }] },
      { type: "model_output", content: [{ text }] },
    ],
  };
}

function mockFetch(payload: unknown, ok = true, status = 200) {
  const spy = vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function requestBody(spy: ReturnType<typeof mockFetch>, call = 0) {
  const [, init] = spy.mock.calls[call] as [string, RequestInit];
  return JSON.parse(init.body as string) as {
    model: string;
    input: { type: string; text?: string; data?: string; mime_type?: string }[];
    store?: boolean;
    generation_config: { temperature: number; thinking_level?: string };
    response_format: { type: string; mime_type: string; schema: unknown };
  };
}

/** תשובת חילוץ מלאה ותקינה, כמו זו שהתקבלה בניסוי */
const EXTRACTED = {
  site: { text: "", source: "none" },
  building: { text: "א", source: "text" },
  apartment: { text: "14", source: "text" },
  room: { value: "BATHROOM", source: "text" },
  domain: { text: "אינסטלציה", source: "text" },
  description: { op: "set", text: "נזילה מתחת לכיור" },
  recipients: { add: [{ text: "יוסי כהן", source: "text" }], remove: [] },
};

const INPUT: ExtractionInput = {
  subject: "תקלה בדירה 14",
  text: "דייר מבניין א דירה 14 מדווח על נזילה מתחת לכיור בחדר הרחצה. תשלחו את יוסי כהן.",
  attachments: [],
  gazetteer: {
    sites: ["נווה שאנן"],
    buildings: ["בניין א"],
    apartments: ["14", "12"],
    domains: ["אינסטלציה", "חשמל"],
    professionals: ["יוסי כהן"],
    users: ["משה לוי"],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ─────────────────────────────── צורת הבקשה ───────────────────────────────

describe("EM-05a — צורת הבקשה המובנית", () => {
  it("נושאת את הסכימה, טמפרטורה 0 ורמת חשיבה low", async () => {
    const spy = mockFetch(reply(JSON.stringify(EXTRACTED)));

    await geminiFieldExtractor("k").extract(INPUT);

    const body = requestBody(spy);
    expect(body.response_format.mime_type).toBe("application/json");
    expect(body.response_format.schema).toEqual(z.toJSONSchema(extractionSchema));
    expect(body.generation_config.temperature).toBe(0);
    expect(body.generation_config.thinking_level).toBe("low");
    // `store: false` — תוכן המייל אינו נשמר אצל הספק.
    expect(body.store).toBe(false);
  });

  it("הסכימה שיוצאת בפועל נושאת את הגג של הנמענים ואת רשימת החדרים", () => {
    // מה ש-zod מפיק הוא מה שמגביל את המודל. `maxItems` שנעלם בשדרוג היה
    // מתיר "תוסיפו את כולם" להחזיר עשרות נמענים, ורשימת חדרים שאינה תואמת
    // ל-`ROOMS` הייתה מחזירה ערך שה-enum במסד אינו מכיר.
    // דרך `unknown`: הטיפוס ש-zod מחזיר הוא סכימה גנרית, וההצהרה כאן היא על
    // מה שאנחנו קוראים ממנה בפועל — שתי צורות שאינן חופפות מספיק ל-TS.
    const schema = z.toJSONSchema(extractionSchema) as unknown as {
      properties: {
        recipients: { properties: { add: { maxItems: number } } };
        room: { properties: { value: { enum: string[] } } };
      };
    };

    expect(schema.properties.recipients.properties.add.maxItems).toBe(10);
    expect(schema.properties.room.properties.value.enum).toEqual([
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
    ]);
  });

  it("שולחת את הכותרת, את הטקסט ואת הגזטיר, ומורה להעתיק כפי שנכתב", async () => {
    const spy = mockFetch(reply(JSON.stringify(EXTRACTED)));

    await geminiFieldExtractor("k").extract(INPUT);

    const prompt = requestBody(spy)
      .input.map((part) => part.text ?? "")
      .join("\n");
    expect(prompt).toContain("תקלה בדירה 14");
    expect(prompt).toContain("נזילה מתחת לכיור");
    expect(prompt).toContain("נווה שאנן");
    expect(prompt).toContain("יוסי כהן");
    expect(prompt).toContain("אל תשלים");
    // החדרים נגזרים מ-`ROOMS` ומ-`he.room`, ולא מועברים בקלט.
    expect(prompt).toContain("חדר רחצה=BATHROOM");
  });

  it("EM-A09 — הפרומפט אומר ששם בעל מקצוע אינו תחום", async () => {
    // S0 מדד: "צריך אינסטלטור" החזיר `domain: "אינסטלטור"` בכל הריצות, עד
    // שההוראה הזו נוספה. בלעדיה המייל החוזר מדווח "לא נמצא ברשימה" על תחום
    // שאיש לא כתב.
    const spy = mockFetch(reply(JSON.stringify(EXTRACTED)));

    await geminiFieldExtractor("k").extract(INPUT);

    const prompt = requestBody(spy)
      .input.map((part) => part.text ?? "")
      .join("\n");
    expect(prompt).toContain("אינסטלטור");
  });

  it("אומרת למודל אם זה מייל ראשון או תשובה, כדי שההכרעה על התיאור לא תהיה ניחוש", async () => {
    const spy = mockFetch(
      reply(JSON.stringify({ ...EXTRACTED, description: { op: "append", text: "רטיבות בתקרה" } })),
    );

    await geminiFieldExtractor("k").extract({ ...INPUT, isReply: true });
    await geminiFieldExtractor("k").extract(INPUT);

    const promptOf = (call: number) =>
      requestBody(spy, call)
        .input.map((part) => part.text ?? "")
        .join("\n");
    expect(promptOf(0)).toContain("תשובה בשרשרת");
    expect(promptOf(1)).not.toContain("תשובה בשרשרת");
    expect(promptOf(1)).toContain("המייל הראשון");
  });
});

// ─────────────────────────────── קריאת התשובה ───────────────────────────────

describe("EM-05a — קריאת התשובה", () => {
  it("תשובה תקינה הופכת ל-FieldExtraction", async () => {
    mockFetch(reply(JSON.stringify(EXTRACTED)));

    const result = await geminiFieldExtractor("k").extract(INPUT);

    expect(result.building).toEqual({ text: "א", source: "text" });
    expect(result.apartment).toEqual({ text: "14", source: "text" });
    expect(result.room).toEqual({ value: "BATHROOM", source: "text" });
    expect(result.description).toEqual({ op: "set", text: "נזילה מתחת לכיור" });
    expect(result.recipients.add).toEqual([{ text: "יוסי כהן", source: "text" }]);
    expect(result.recipients.remove).toEqual([]);
  });

  it('חדר "NONE" נקרא כהיעדר חדר, לא כערך', async () => {
    mockFetch(reply(JSON.stringify({ ...EXTRACTED, room: { value: "NONE", source: "none" } })));

    const result = await geminiFieldExtractor("k").extract(INPUT);

    expect(result.room).toEqual({ value: null, source: "none" });
  });

  it('ערך עם source "none" מנוקה לטקסט ריק, וטקסט ריק מסומן "none"', () => {
    const parsed = extractionSchema.parse({
      ...EXTRACTED,
      // המודל החזיר טקסט למרות שסימן שלא הוזכר, ולהפך
      site: { text: "נווה שאנן", source: "none" },
      building: { text: "   ", source: "text" },
    });

    const result = toFieldExtraction(parsed);

    expect(result.site).toEqual({ text: "", source: "none" });
    expect(result.building).toEqual({ text: "", source: "none" });
  });

  it("פעולה על התיאור בלי טקסט אינה פעולה", () => {
    // `append` עם מחרוזת ריקה היה מוסיף שורה ריקה לתיאור, ומדווח עליה
    // לשולח כעדכון שנעשה.
    const parsed = extractionSchema.parse({ ...EXTRACTED, description: { op: "append", text: "  " } });

    expect(toFieldExtraction(parsed).description).toEqual({ op: "none", text: "" });
  });

  it("EM-11 — תשובה שאינה JSON נזרקת כ-permanent ולא הופכת לחילוץ ריק", async () => {
    mockFetch(reply("בוודאי! הנה הפרטים שמצאתי:"));

    await expect(geminiFieldExtractor("k").extract(INPUT)).rejects.toMatchObject({
      kind: "permanent",
    });
  });

  it("EM-11 — JSON שאינו עומד בסכימה נזרק כ-permanent", async () => {
    mockFetch(reply(JSON.stringify({ ...EXTRACTED, room: { value: "GARDEN", source: "text" } })));

    await expect(geminiFieldExtractor("k").extract(INPUT)).rejects.toMatchObject({
      kind: "permanent",
    });
  });

  it("תשובה במבנה לא מוכר נזרקת ואינה מוחזרת כריקה", async () => {
    mockFetch({ unexpected: true });

    await expect(geminiFieldExtractor("k").extract(INPUT)).rejects.toBeInstanceOf(AiRequestError);
  });
});

// ─────────────────────────────── סיווג הכשל ───────────────────────────────

describe("EM-05a — סיווג הכשל קובע מה הצינור יעשה", () => {
  const schema = z.toJSONSchema(z.object({ a: z.string() }));

  async function callWith(status: number) {
    mockFetch({ error: { message: "נפילה" } }, false, status);
    return askStructured("k", [{ type: "text", text: "שאלה" }], schema).catch(
      (error: unknown) => error,
    );
  }

  it("429 הוא מכסה, 5xx ו-408 חולפים, 401/403 הרשאה, והשאר קבוע", async () => {
    expect(await callWith(429)).toMatchObject({ kind: "quota", status: 429 });
    expect(await callWith(500)).toMatchObject({ kind: "transient" });
    expect(await callWith(503)).toMatchObject({ kind: "transient" });
    expect(await callWith(408)).toMatchObject({ kind: "transient" });
    expect(await callWith(401)).toMatchObject({ kind: "auth" });
    expect(await callWith(403)).toMatchObject({ kind: "auth" });
    expect(await callWith(400)).toMatchObject({ kind: "permanent" });
  });

  it("השגיאה נושאת את הסטטוס ואת גוף התשובה, לאבחון מ-Job.lastError", async () => {
    const error = (await callWith(400)) as AiRequestError;

    expect(error.message).toContain("400");
    expect(error.message).toContain("נפילה");
  });

  it("גוף תשובה שנקטע באמצע הקריאה הוא כשל חולף, ולא 'מבנה לא מוכר'", async () => {
    // הכותרות חזרו עם 200 והחיבור נפל באמצע הגוף — תקלת רשת לכל דבר, שתצליח
    // בניסיון הבא. סיווג `permanent` כאן היה מוותר על המייל לתמיד ומדווח לשולח
    // "החילוץ אינו זמין" על סמך תקלה שנמשכה שנייה.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => {
          throw new TypeError("terminated");
        },
      }),
    );

    await expect(
      askStructured("k", [{ type: "text", text: "שאלה" }], schema),
    ).rejects.toMatchObject({ kind: "transient" });
  });

  it("גוף שלא נקרא אינו מבטל את סיווג הסטטוס", async () => {
    // הכיוון ההפוך: כשיש קוד תשובה, הוא זה שמכריע — גם כשהגוף לא נקרא.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => {
          throw new TypeError("terminated");
        },
      }),
    );

    await expect(
      askStructured("k", [{ type: "text", text: "שאלה" }], schema),
    ).rejects.toMatchObject({ kind: "auth", status: 401 });
  });

  it("כשל רשת או פסק זמן הוא חולף", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" })),
    );

    await expect(
      askStructured("k", [{ type: "text", text: "שאלה" }], schema),
    ).rejects.toMatchObject({ kind: "transient" });
  });
});

// ─────────────────────────────── תקציב הקבצים ───────────────────────────────

describe("EM-05a — תקציב ה-14MB", () => {
  function file(name: string, mimeType: string, size: number) {
    return { filename: name, mimeType, bytes: Buffer.alloc(size) };
  }

  it("שומר על סדר השולח ומדלג על מה שאינו נכנס, ולא על הגדול ביותר", () => {
    const big = file("a.pdf", "application/pdf", 8 * 1024 * 1024);
    const second = file("b.pdf", "application/pdf", 8 * 1024 * 1024);
    const small = file("c.png", "image/png", 1024);

    const plan = planAttachments([big, second, small]);

    expect(plan.sent).toEqual([big, small]);
    expect(plan.dropped).toEqual([{ attachment: second, reason: "budget" }]);
  });

  it("סוג שהמודל אינו קורא מושמט מהבקשה", () => {
    const video = file("clip.mp4", "video/mp4", 1024);
    const doc = file("x.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 10);

    const plan = planAttachments([video, doc, file("a.png", "image/png", 10)]);

    expect(plan.sent.map((a) => a.filename)).toEqual(["a.png"]);
    expect(plan.dropped.map((d) => d.reason)).toEqual(["unsupported", "unsupported"]);
  });

  it("קובץ בודד מעל התקציב מושמט ואינו מפיל את החילוץ", async () => {
    const spy = mockFetch(reply(JSON.stringify(EXTRACTED)));
    const tooBig = file("huge.pdf", "application/pdf", ATTACHMENT_BUDGET_BYTES + 1);

    await geminiFieldExtractor("k").extract({ ...INPUT, attachments: [tooBig] });

    // הבקשה יצאה — בלי החלק שלא נכנס.
    expect(requestBody(spy).input.filter((part) => part.type === "document")).toEqual([]);
  });

  it("קובץ שהושמט נאמר ביומן — עם הסיבה, הסוג והגודל, ובלי שם הקובץ", async () => {
    // "מדלג ואומר זאת" הוא חצי מהדרישה: השמטה שקטה מסבירה בדיעבד חילוץ שהחמיץ
    // את מה שהיה בצרופה, ובלי שורה ביומן אין דרך לדעת שזו הסיבה. **שם הקובץ
    // אינו נכנס** — "דוח ליקויים - דירה 12 - משפחת כהן.pdf" הוא שם של אדם
    // ושל דירה, והיומן נקרא בידי מי שאין לו גישה לפנייה.
    mockFetch(reply(JSON.stringify(EXTRACTED)));
    const warn = vi.spyOn(log, "logWarn").mockImplementation(() => undefined);

    await geminiFieldExtractor("k").extract({
      ...INPUT,
      attachments: [file("הקלטה של משפחת כהן.mp4", "video/mp4", 512)],
    });

    expect(warn).toHaveBeenCalledWith("email.extract.attachment-skipped", {
      reason: "unsupported",
      mimeType: "video/mp4",
      sizeBytes: 512,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("משפחת כהן");
    warn.mockRestore();
  });

  it("קובץ שנכנס נשלח מקודד, עם הסוג הנקי שלו", async () => {
    const spy = mockFetch(reply(JSON.stringify(EXTRACTED)));
    const png = { filename: "note.png", mimeType: "image/png; name=note.png", bytes: Buffer.from("PNG") };

    await geminiFieldExtractor("k").extract({ ...INPUT, attachments: [png] });

    const image = requestBody(spy).input.find((part) => part.type === "image");
    expect(image?.mime_type).toBe("image/png");
    expect(image?.data).toBe(Buffer.from("PNG").toString("base64"));
  });

  it("askStructured חוסם קלט מוטבע שחורג מהגג, לפני שהוא יוצא", async () => {
    const spy = mockFetch(reply("{}"));

    await expect(
      askStructured("k", [{ type: "document", data: Buffer.alloc(ATTACHMENT_BUDGET_BYTES + 1), mimeType: "application/pdf" }], {}),
    ).rejects.toMatchObject({ kind: "permanent" });
    expect(spy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────── בחירת הספק ───────────────────────────────

describe("EM-11 — בחירת המחלץ", () => {
  it("בלי מפתח אין מחלץ, והקורא הופך זאת למסלול 'החילוץ אינו זמין'", () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    expect(selectFieldExtractor()).toBeNull();
  });

  it("עם מפתח מוחזר המחלץ של Gemini", () => {
    vi.stubEnv("GEMINI_API_KEY", "key");

    expect(selectFieldExtractor()?.name).toBe("gemini");
  });
});
