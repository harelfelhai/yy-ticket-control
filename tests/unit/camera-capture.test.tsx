import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraCapture } from "@/components/camera-capture";
import { he } from "@/lib/he";

/**
 * חלון הצילום בדסקטופ.
 *
 * ‏jsdom ולא Playwright, באותו נימוק שבו נבדק `AudioRecorder`: `getUserMedia`
 * ו-`canvas.toBlob` אינם קיימים בדפדפן הבדיקות בלי דגלי מכשיר מזויף, ומה
 * שחשוב לאמת כאן הוא ההתנהגות סביבם — סירוב הרשאה, כיבוי המצלמה בסגירה,
 * והקובץ שיוצא מהצילום.
 */

function fakeStream(stop = vi.fn()) {
  return { getTracks: () => [{ stop }] } as unknown as MediaStream;
}

function mockCamera(getUserMedia: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("CameraCapture", () => {
  it("דפדפן ללא תמיכה — מדווח ואינו מציג כפתור צילום", async () => {
    // navigator.mediaDevices אינו מוגדר ב-jsdom — בדיוק המצב שנבדק.
    render(<CameraCapture onCaptured={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(he.media.cameraUnavailable);
    expect(screen.queryByRole("button", { name: he.media.takePhoto })).toBeNull();
  });

  it("הרשאת מצלמה נדחתה — מדווח ואינו נשאר בתצוגה ריקה", async () => {
    mockCamera(() => Promise.reject(new Error("denied")));
    render(<CameraCapture onCaptured={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(he.media.cameraDenied);
  });

  it("אומר במילים שהוא ממתין להרשאה, ולא רק משבית את הכפתור", async () => {
    // התגלה בהרצה בפועל: עד שההרשאה מאושרת התמונה שחורה והכפתור עמום,
    // כלומר המסך נראה כתקלה. זו אותה מחלה שדווחה על "יש לי שאלה".
    mockCamera(() => new Promise(() => {}));
    render(<CameraCapture onCaptured={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByText(he.media.cameraStarting)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: he.media.takePhoto })).toBeDisabled();
  });

  it("סגירה מכבה את המצלמה", async () => {
    // בלי זה נורית המצלמה נשארת דולקת אחרי סגירת החלון — התנהגות
    // שנראית למשתמש כמו צילום שנמשך.
    const trackStop = vi.fn();
    mockCamera(() => Promise.resolve(fakeStream(trackStop)));

    const { unmount } = render(<CameraCapture onCaptured={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: he.media.takePhoto })).toBeEnabled(),
    );

    unmount();
    expect(trackStop).toHaveBeenCalled();
  });

  it("‏Escape סוגר את החלון", async () => {
    // דיאלוג שאי אפשר לצאת ממנו הוא מלכודת, ובפרט כשהוא מבקש הרשאת מצלמה.
    mockCamera(() => Promise.resolve(fakeStream()));
    const onClose = vi.fn();
    render(<CameraCapture onCaptured={vi.fn()} onClose={onClose} />);

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("החלון נושא שם נגיש", async () => {
    // בלי `aria-labelledby` קורא מסך מכריז על אזור אנונימי באמצע העמוד.
    mockCamera(() => Promise.resolve(fakeStream()));
    render(<CameraCapture onCaptured={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: he.media.camera })).toBeInTheDocument();
  });

  it("צילום מחזיר קובץ JPEG וסוגר", async () => {
    mockCamera(() => Promise.resolve(fakeStream()));
    // ‏jsdom אינו מממש canvas; מה שנבדק כאן הוא המסלול סביבו.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["בתים"], { type: "image/jpeg" }));
    });

    const onCaptured = vi.fn();
    const onClose = vi.fn();
    render(<CameraCapture onCaptured={onCaptured} onClose={onClose} />);

    const shoot = await screen.findByRole("button", { name: he.media.takePhoto });
    await waitFor(() => expect(shoot).toBeEnabled());
    await userEvent.click(shoot);

    await waitFor(() => expect(onCaptured).toHaveBeenCalledTimes(1));
    const file = onCaptured.mock.calls[0]?.[0] as File;
    expect(file).toBeInstanceOf(File);
    // ‏JPEG ולא PNG: צילום ליקוי הוא תצלום, ו-PNG היה מנפח את הקובץ
    // פי כמה בלי רווח — מורגש על רשת סלולרית באתר בנייה.
    expect(file.type).toBe("image/jpeg");
    expect(onClose).toHaveBeenCalled();
  });
});
