import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioRecorder } from "@/components/audio-recorder";
import { he } from "@/lib/he";

/**
 * הקלטה קולית — נקודת הכשל השקטה של השטח: מיקרופון חסום או דפדפן שאינו
 * תומך. הבדיקות מוודאות שכל אחד מהם מדווח בהודעה נכונה, ושהמסלול התקין
 * מחזיר קובץ. ‏MediaRecorder ו-getUserMedia אינם קיימים ב-jsdom ולכן מדומים.
 */

/** stub ל-MediaRecorder: start/stop משגרים dataavailable ו-onstop כמו האמיתי */
class FakeMediaRecorder {
  static isTypeSupported = () => true;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  state = "inactive";
  mimeType = "audio/webm";
  stream: { getTracks: () => { stop: () => void }[] };

  constructor(stream: { getTracks: () => { stop: () => void }[] }) {
    this.stream = stream;
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["בתים"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

function fakeStream() {
  return { getTracks: () => [{ stop: vi.fn() }] };
}

afterEach(() => {
  vi.restoreAllMocks();
  // ניקוי הגלובלים שהוזרקו כדי שבדיקה אחת לא תדלוף לשנייה.
  Reflect.deleteProperty(navigator, "mediaDevices");
  Reflect.deleteProperty(globalThis, "MediaRecorder");
});

describe("AudioRecorder", () => {
  it("דפדפן ללא תמיכה בהקלטה — מדווח micUnavailable", async () => {
    // navigator.mediaDevices לא מוגדר ב-jsdom — בדיוק המצב שנבדק.
    const onError = vi.fn();
    render(<AudioRecorder onRecorded={vi.fn()} onError={onError} />);

    await userEvent.click(screen.getByRole("button"));
    expect(onError).toHaveBeenCalledWith(he.media.micUnavailable);
  });

  it("הרשאת מיקרופון נדחתה — מדווח micDenied", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const onError = vi.fn();
    render(<AudioRecorder onRecorded={vi.fn()} onError={onError} />);

    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(he.media.micDenied));
  });

  it("מסלול תקין — מחזיר קובץ הקלטה אחרי עצירה", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream()) },
    });
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: FakeMediaRecorder,
    });

    const onRecorded = vi.fn();
    render(<AudioRecorder onRecorded={onRecorded} onError={vi.fn()} />);

    // לחיצה ראשונה מתחילה הקלטה — הכפתור עובר ל"עצור".
    await userEvent.click(screen.getByRole("button"));
    await screen.findByRole("button", { name: he.media.stopRecording });

    // לחיצה שנייה עוצרת — onstop משגר את הקובץ.
    await userEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
    const file = onRecorded.mock.calls[0]?.[0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe("audio/webm");
  });
});
