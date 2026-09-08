import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReplyField } from "@/components/reply-field";
import { he } from "@/lib/he";

/**
 * מקלדת בקומפוזר — ההתנהגות היחידה במערכת שמותנית בסוג המכשיר.
 *
 * **למה זה נבדק ביחידה ולא רק ב-E2E.** שניים משלושת התנאים אינם ניתנים
 * לביטוי ב-Playwright: הרכבת תו (`isComposing`) אינה נשלחת על ידי
 * `page.keyboard`, ו-`onSubmit` שהושמט הוא מצב פנימי של אתר הקריאה. ומה
 * שכן נבדק בדפדפן — ההבחנה בין טלפון למחשב — נבדק שם דווקא מפני שהוא
 * **אינו** ניתן לזיוף אמין ביחידה: `matchMedia` כאן הוא stub, ולכן הוא
 * מוכיח שהקוד שואל את השאלה, לא שהדפדפן עונה עליה נכון.
 */

/** jsdom אינו מממש `matchMedia`. `fine` = מחשב, כלומר Enter שולח. */
function stubPointer(fine: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: fine && query === "(any-pointer: fine)",
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function field() {
  return screen.getByLabelText(he.ticket.reply);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Enter בקומפוזר — מחשב", () => {
  beforeEach(() => stubPointer(true));

  it("Enter שולח, ובולע את השורה החדשה", () => {
    const onSubmit = vi.fn();
    render(<ReplyField value="בדקתי בשטח" onChange={() => {}} onSubmit={onSubmit} />);

    // `fireEvent` מחזיר `false` כשהמאזין קרא ל-`preventDefault`. בלעדיו
    // הדפדפן היה מוסיף `\n` **וגם** שולח, והשדה שנוקה היה חוזר עם שורה ריקה.
    const notPrevented = fireEvent.keyDown(field(), { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(false);
  });

  it("Shift+Enter יורד שורה ואינו שולח", () => {
    const onSubmit = vi.fn();
    render(<ReplyField value="שורה ראשונה" onChange={() => {}} onSubmit={onSubmit} />);

    const notPrevented = fireEvent.keyDown(field(), { key: "Enter", shiftKey: true });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });

  /**
   * מקלדת שמרכיבה תו — ניקוד עברי, IME — שולחת Enter כדי **לאשר את התו**.
   * בלי הבדיקה הזו משתמש שמנקד מוצא את עצמו שולח באמצע מילה.
   */
  it("Enter שמאשר הרכבת תו אינו שליחה", () => {
    const onSubmit = vi.fn();
    render(<ReplyField value="שלום" onChange={() => {}} onSubmit={onSubmit} />);

    fireEvent.keyDown(field(), { key: "Enter", isComposing: true });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  /**
   * `onSubmit` מושמט כשאין מה לשלוח או כשהממשק נעול (`busy`), ואז Enter
   * חייב ליפול חזרה להתנהגות הטבעית של השדה — לא להיבלע בשקט.
   */
  it("בלי `onSubmit` — Enter יורד שורה כרגיל", () => {
    render(<ReplyField value="" onChange={() => {}} />);

    expect(fireEvent.keyDown(field(), { key: "Enter" })).toBe(true);
  });

  it("מקש אחר אינו שולח", () => {
    const onSubmit = vi.fn();
    render(<ReplyField value="טקסט" onChange={() => {}} onSubmit={onSubmit} />);

    fireEvent.keyDown(field(), { key: "a" });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("Enter בקומפוזר — טלפון", () => {
  beforeEach(() => stubPointer(false));

  /**
   * ההכרעה (7.9.2026): במקלדת מסך, Enter הוא "שורה חדשה" בכל אפליקציית
   * הודעות שהמשתמש מכיר, ואין Shift נוח שיחזיר אותה.
   */
  it("Enter יורד שורה ואינו שולח, גם כשיש מה לשלוח", () => {
    const onSubmit = vi.fn();
    render(<ReplyField value="בדקתי בשטח" onChange={() => {}} onSubmit={onSubmit} />);

    const notPrevented = fireEvent.keyDown(field(), { key: "Enter" });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });
});
