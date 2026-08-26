import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaPicker } from "@/components/media-picker";
import { he } from "@/lib/he";

/**
 * שורת פקדי המדיה בטופס — צירוף · צילום · הקלטה.
 *
 * **מה שנבדק כאן הוא האינווריאנט שהמעבר לאייקונים תלוי בו.** שלושת
 * הכפתורים איבדו את הטקסט הגלוי שלהם, והשם הנגיש הוא כל מה שנשאר: קורא
 * מסך מכריז ממנו, ו-`conformance` ו-`e2e` מאתרים אותם דרכו
 * (`s2-s3-s4-s7`, `v03-deltas`). סטייה של תו אחד שוברת את שתי החבילות
 * בהודעה "לא נמצא אלמנט", שאינה מרמזת על הסיבה.
 *
 * ‏`primitives.test.ts` אוכף שקיים `aria-label` כלשהו; כאן נבדק שהוא
 * **המחרוזת הנכונה**, ושהיא מגיעה מ-`he.ts` ולא נכתבה ביד.
 */

// שלוש התלויות של `useMediaUpload` שאין להן מקום ב-jsdom. הרכיב עצמו אינו
// מפעיל אותן ברינדור — הן נדרשות רק כדי שהמודול ייטען.
vi.mock("@/app/media-actions", () => ({
  registerMediaAction: vi.fn(),
  confirmUploadAction: vi.fn(),
}));

describe("שורת פקדי המדיה", () => {
  // ‏jsdom אינו מממש `matchMedia`, ו-`useMediaUpload` שואל אותו כדי לדעת אם
  // יש מצלמת מכשיר. `false` הוא הענף של הדסקטופ — הרלוונטי לבדיקת רינדור.
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderPicker() {
    return render(<MediaPicker files={[]} onChange={() => {}} />);
  }

  it("שלושת הפקדים נושאים שם נגיש בעברית", () => {
    renderPicker();

    for (const name of [he.media.attach, he.media.camera, he.media.record]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("ואף אחד מהם אינו נושא טקסט גלוי — האייקון הוא כל התוכן", () => {
    renderPicker();

    for (const name of [he.media.attach, he.media.camera, he.media.record]) {
      // ‏`textContent` ריק פירושו שהשם הגיע מ-`aria-label` בלבד. אילו
      // התווית הייתה חוזרת כטקסט, הבדיקה הראשונה הייתה עוברת גם בלעדיו —
      // כלומר לא הייתה שומרת על דבר.
      expect(screen.getByRole("button", { name })).toHaveTextContent("");
    }
  });

  it("‏SVG של אייקון אינו נחשף לקורא מסך", () => {
    const { container } = renderPicker();

    const icons = container.querySelectorAll("svg");
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
