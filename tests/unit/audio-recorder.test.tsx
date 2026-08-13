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

    // לחיצה ראשונה מתחילה הקלטה — הכפתור עובר ל"עצור ושמור".
    await userEvent.click(screen.getByRole("button", { name: he.media.record }));
    // ‏name מפורש ולא `getByRole("button")` לבדו: בזמן הקלטה יש שני
    // כפתורים, ובורר בלי שם היה נופל על ריבוי התאמות במקום לבדוק משהו.
    const stop = await screen.findByRole("button", { name: new RegExp(he.media.stopRecording) });

    await userEvent.click(stop);

    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
    const file = onRecorded.mock.calls[0]?.[0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe("audio/webm");
  });

  /**
   * הליבה של סעיף 3 בדיווח: עד כה הדרך היחידה "לבטל" הייתה לעצור — ואז
   * הקובץ כבר נרשם והועלה — ורק אז להסיר אותו מרשימת הצרופות.
   */
  it("ביטול בזמן הקלטה אינו מחזיר קובץ, ומכבה את המיקרופון", async () => {
    const trackStop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] }),
      },
    });
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: FakeMediaRecorder,
    });

    const onRecorded = vi.fn();
    render(<AudioRecorder onRecorded={onRecorded} onError={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: he.media.record }));
    await userEvent.click(
      await screen.findByRole("button", { name: he.media.cancelRecording }),
    );

    // חוזר למצב ההתחלתי, ובלי לשלוח דבר הלאה.
    await screen.findByRole("button", { name: he.media.record });
    expect(onRecorded).not.toHaveBeenCalled();
    // נורית המיקרופון כבה — אחרת הביטול נראה למשתמש כהאזנה שנמשכת.
    expect(trackStop).toHaveBeenCalled();
  });

  it("לחיצה כפולה בזמן המתנה להרשאה אינה פותחת זרם שני", async () => {
    /*
     * התגלה בהרצה בפועל: `getUserMedia` ממתין לאישור, הכפתור נראה כאילו
     * הלחיצה נבלעה, ולחיצה שנייה פתחה **זרם שני** ודרסה את `recorderRef` —
     * כלומר הראשון נשאר פתוח לנצח והמיקרופון המשיך לדלוק בלי דרך לכבותו.
     */
    let calls = 0;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => {
          calls += 1;
          return new Promise(() => {});
        },
      },
    });

    render(<AudioRecorder onRecorded={vi.fn()} onError={vi.fn()} />);
    const button = screen.getByRole("button", { name: he.media.record });
    await userEvent.click(button);

    // הכפתור אומר במילים שהוא ממתין, ואינו ניתן ללחיצה חוזרת.
    await screen.findByRole("button", { name: he.media.micStarting });
    expect(screen.getByRole("button", { name: he.media.micStarting })).toBeDisabled();
    expect(calls).toBe(1);
  });

  it("בזמן הקלטה מוצג זמן חולף", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream()) },
    });
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: FakeMediaRecorder,
    });

    render(<AudioRecorder onRecorded={vi.fn()} onError={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: he.media.record }));

    // ‏0:00 ולא סתם "מקליט": מיקרופון חסום נראה בדיוק כמו הקלטה תקינה,
    // והמונה הוא החיווי היחיד שמשהו באמת קורה.
    expect(await screen.findByText("0:00")).toBeInTheDocument();
    // ולקורא מסך נמסר המצב פעם אחת, במקום מספר שמשתנה כל שנייה בתוך
    // השם הנגיש של הכפתור.
    expect(screen.getByRole("group", { name: he.media.recording })).toBeInTheDocument();
  });
});
