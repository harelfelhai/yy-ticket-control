import { describe, expect, it } from "vitest";
import { he } from "@/lib/he";
import { type MediaRecord, toMediaView } from "@/lib/media-view";

/**
 * מה נאמר למשתמש על עיבוד ה-AI של קובץ שהעלה.
 *
 * הפונקציה הזו היא כל מה שעומד בין "המערכת עיבדה את ההקלטה" לבין "המערכת
 * לא עיבדה אותה ואיש לא יודע". היא הייתה עד כה **ללא כיסוי בדיקות כלל** —
 * וזו הסיבה ש-`SKIPPED` חזר `null` בשקט: אין מי שיגלה שתיקה, כי היא עוברת.
 *
 * הדיווח מהשטח: "חיפשתי משהו שהקלטתי וזה לא מצא". התמלול אכן לא רץ (אין
 * ‏`GEMINI_API_KEY`), אבל שום דבר במסך לא אמר זאת.
 */

const audio: MediaRecord = {
  id: "m1",
  mimeType: "audio/webm",
  originalName: "recording.webm",
  transcription: null,
  extractedText: null,
  aiStatus: "PENDING",
  aiError: null,
};

const image: MediaRecord = { ...audio, id: "m2", mimeType: "image/jpeg", originalName: "x.jpg" };
const video: MediaRecord = { ...audio, id: "m3", mimeType: "video/mp4", originalName: "x.mp4" };

const noteFor = (file: MediaRecord) => toMediaView(file).aiNote;

describe("aiNote — אין ספק עיבוד", () => {
  it("הקלטה שדולגה מחוסר מנוע אומרת זאת, ומזהירה שהיא לא תימצא בחיפוש", () => {
    // האזהרה על החיפוש היא העיקר: בלעדיה המנהל מחפש ולא מבין למה אין תוצאה.
    const note = noteFor({ ...audio, aiStatus: "SKIPPED", aiError: "no-engine" });

    expect(note).toBe(he.ai.transcriptionNoEngine);
    expect(note).toContain("חיפוש");
  });

  it("קובץ לקריאה שדולג מחוסר מנוע אומר זאת בנוסח שלו", () => {
    const note = noteFor({ ...image, aiStatus: "SKIPPED", aiError: "no-engine" });
    expect(note).toBe(he.ai.extractionNoEngine);
  });

  it("אינו מתחזה לכשל — 'אינו מוגדר' ולא 'נכשל'", () => {
    // ההבחנה אומרת למנהל שאין טעם לנסות שוב: אין כאן תקלה אלא הגדרה חסרה.
    const note = noteFor({ ...audio, aiStatus: "SKIPPED", aiError: "no-engine" });
    expect(note).not.toBe(he.ai.transcriptionFailed);
  });
});

describe("aiNote — דילוג שנכון לשתוק עליו", () => {
  it("וידאו מדולג בשקט", () => {
    // אין מה לתמלל בווידאו, ואין למשתמש מה לעשות עם ההודעה.
    expect(noteFor({ ...video, aiStatus: "SKIPPED", aiError: "unsupported" })).toBeNull();
  });

  it("דילוג בלי סיבה שמורה נשאר שקט", () => {
    // רשומות שנוצרו לפני שהסיבה נשמרה. עדיף שקט על ניחוש.
    expect(noteFor({ ...audio, aiStatus: "SKIPPED", aiError: null })).toBeNull();
  });
});

describe("aiNote — שאר המצבים לא נפגעו", () => {
  it("ממתין ובעיבוד מציגים 'מתמלל…'", () => {
    expect(noteFor({ ...audio, aiStatus: "PENDING" })).toBe(he.ai.transcriptionPending);
    expect(noteFor({ ...audio, aiStatus: "PROCESSING" })).toBe(he.ai.transcriptionPending);
  });

  it("כשל אמיתי מוצג ככשל", () => {
    expect(noteFor({ ...audio, aiStatus: "FAILED", aiError: "timeout" })).toBe(
      he.ai.transcriptionFailed,
    );
  });

  it("תמלול שקיים מבטל כל הערה", () => {
    // כשיש טקסט אין מה לומר עליו — הטקסט עצמו הוא התשובה.
    const note = noteFor({
      ...audio,
      aiStatus: "SKIPPED",
      aiError: "no-engine",
      transcription: "נזילה במטבח",
    });
    expect(note).toBeNull();
  });

  it("תמונה שנקראה בלי טקסט אינה מתלוננת", () => {
    expect(noteFor({ ...image, aiStatus: "DONE" })).toBeNull();
  });
});
