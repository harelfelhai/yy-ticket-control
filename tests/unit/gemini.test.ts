import { afterEach, describe, expect, it, vi } from "vitest";
import { canExtractText, geminiExtractor, geminiTranscriber } from "@/lib/ai/gemini";

/**
 * המודול היחיד שמדבר עם ספק ה-AI. שלוש הנקודות שנבדקות כאן הן אלה
 * שיכולות להישבר **בשקט** — כלומר בלי שג'וב ייכשל ובלי שמישהו ידע:
 *
 * 1. **פענוח התשובה.** מבנה שאינו מוכר מחזיר מחרוזת ריקה, שנקראת במעלה
 *    הזרם כ"אין טקסט". אילו היה זורק `TypeError`, הג'וב היה נכשל עם הודעה
 *    שאי אפשר לאבחן ממנה דבר.
 * 2. **מחרוזות ה"אין תוצאה".** המודל מתבקש להחזיר נוסח מדויק, והתרגום שלו
 *    ל-`""` הוא מה שמונע מ"אין טקסט" להיכנס למנוע החיפוש כאילו הוא טקסט
 *    שנמצא במסמך.
 * 3. **גבול ה-20MB.** הוא נבדק לפני הקידוד, כי base64 מנפח ב-33% ו-400
 *    מהשרת אינו אומר מה קרה.
 *
 * ‏`fetch` מוחלף בכפיל: הבדיקה מאמתת את החוזה שלנו מול Gemini, ולא את
 * Gemini עצמו — ואין לשלם על קריאה חיצונית בכל ריצת בדיקות.
 */

function mockFetch(payload: unknown, ok = true, status = 200) {
  const spy = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** תשובה בצורה שהתיעוד מגדיר: הטקסט יושב בצעד האחרון */
function reply(text: string) {
  return { steps: [{ content: [{ text: "שלב ביניים" }] }, { content: [{ text }] }] };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("canExtractText", () => {
  it("מקבל תמונות ו-PDF", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]) {
      expect(canExtractText(type), type).toBe(true);
    }
  });

  it("דוחה וידאו ואודיו — הם אינם נשלחים לחילוץ כלל", () => {
    for (const type of ["video/mp4", "audio/webm", "audio/mpeg"]) {
      expect(canExtractText(type), type).toBe(false);
    }
  });

  it("מתעלם מפרמטרים אחרי הטיפוס", () => {
    // הדפדפן שולח לעיתים `image/jpeg; charset=utf-8`, וההשוואה חייבת לעמוד בזה.
    expect(canExtractText("image/jpeg; charset=utf-8")).toBe(true);
  });
});

describe("geminiTranscriber", () => {
  it("מחזיר את הטקסט מהצעד האחרון בתשובה", async () => {
    mockFetch(reply("יש נזילה מתחת לכיור"));

    const text = await geminiTranscriber("k").transcribe(Buffer.from("audio"), "audio/webm");

    expect(text).toBe("יש נזילה מתחת לכיור");
  });

  it('"אין דיבור" נקרא כהיעדר תמלול ולא כתוכן', async () => {
    mockFetch(reply("אין דיבור"));

    expect(await geminiTranscriber("k").transcribe(Buffer.from("a"), "audio/webm")).toBe("");
  });

  it("שולח את המפתח בכותרת של Gemini ואת האודיו כ-audio", async () => {
    const spy = mockFetch(reply("טקסט"));

    await geminiTranscriber("my-key").transcribe(Buffer.from("audio"), "audio/webm; codecs=opus");

    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("my-key");

    const body = JSON.parse(init.body as string);
    expect(body.input[0].type).toBe("audio");
    // הפרמטר אחרי `;` נחתך — ה-API מקבל את הטיפוס הנקי בלבד.
    expect(body.input[0].mime_type).toBe("audio/webm");
  });
});

describe("geminiExtractor", () => {
  it("שולח PDF כ-document ותמונה כ-image", async () => {
    const spy = mockFetch(reply("טקסט"));

    await geminiExtractor("k").extract(Buffer.from("pdf"), "application/pdf");
    expect(JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string).input[0].type).toBe(
      "document",
    );

    await geminiExtractor("k").extract(Buffer.from("img"), "image/png");
    expect(JSON.parse((spy.mock.calls[1]![1] as RequestInit).body as string).input[0].type).toBe(
      "image",
    );
  });

  it('"אין טקסט" נקרא כהיעדר טקסט ואינו נכנס לחיפוש', async () => {
    mockFetch(reply("אין טקסט"));

    expect(await geminiExtractor("k").extract(Buffer.from("f"), "image/png")).toBe("");
  });

  it("תשובה במבנה לא מוכר מחזירה ריק ואינה זורקת", async () => {
    mockFetch({ unexpected: true });

    expect(await geminiExtractor("k").extract(Buffer.from("f"), "image/png")).toBe("");
  });

  it("שגיאת HTTP נושאת את הסטטוס ואת גוף התשובה, לאבחון מ-Job.lastError", async () => {
    mockFetch({ error: "quota" }, false, 429);

    await expect(geminiExtractor("k").extract(Buffer.from("f"), "image/png")).rejects.toThrow(/429/);
  });
});

describe("גבול הבקשה המוטבעת", () => {
  it("קובץ מעל הגג נחסם לפני הקידוד, עם המספרים בהודעה", async () => {
    const spy = mockFetch(reply("לא אמור להישלח"));
    const tooBig = Buffer.alloc(15 * 1024 * 1024);

    await expect(geminiExtractor("k").extract(tooBig, "application/pdf")).rejects.toThrow(/15MB/);
    // והעיקר: לא יצאה בקשה. שליחה שהייתה חוזרת ב-400 סתום היא בדיוק מה
    // שהבדיקה המוקדמת נועדה למנוע.
    expect(spy).not.toHaveBeenCalled();
  });

  it("קובץ מתחת לגג נשלח כרגיל", async () => {
    const spy = mockFetch(reply("בסדר"));

    await geminiExtractor("k").extract(Buffer.alloc(1024), "application/pdf");

    expect(spy).toHaveBeenCalledOnce();
  });
});
