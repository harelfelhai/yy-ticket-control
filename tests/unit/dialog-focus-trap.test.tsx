import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Dialog } from "@/components/ui/dialog";
import { he } from "@/lib/he";

/**
 * מלכודת המיקוד של `Dialog` מול קבוצת רדיו (DESIGN.md § Dialog).
 *
 * קבוצת רדיו היא עצירת Tab אחת. כשהכפתור האחרון בפאנל מושבת — כמו "החל את
 * הבחירה" בחלון הסתירות לפני שנבחר ערך בכל שדה — העצירה האחרונה היא הקבוצה,
 * לא הרדיו האחרון בסדר המסמך. אם המלכודת לא יודעת את זה, Tab יוצא מהדיאלוג.
 */

function Panel() {
  return (
    <>
      <button type="button">מחוץ לדיאלוג</button>
      <Dialog title="בדיקה" onClose={() => {}}>
        <div role="group" aria-label="בניין">
          <label>
            <input type="radio" name="g" value="a" /> א
          </label>
          <label>
            <input type="radio" name="g" value="b" /> ב
          </label>
        </div>
        <button type="button" disabled>
          אשר
        </button>
      </Dialog>
    </>
  );
}

describe("Dialog — מלכודת מיקוד עם קבוצת רדיו", () => {
  it("Tab מתוך קבוצת הרדיו האחרונה חוזר לתחילת הדיאלוג ואינו יוצא ממנו", async () => {
    const user = userEvent.setup();
    render(<Panel />);
    const first = screen.getByRole("radio", { name: "א" });
    first.focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: he.common.close }));
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "מחוץ לדיאלוג" }));
  });

  it("Shift+Tab מכפתור הסגירה חוזר לקבוצה — כשאין בחירה, לרדיו האחרון בה, כמו הדפדפן", async () => {
    const user = userEvent.setup();
    render(<Panel />);
    screen.getByRole("button", { name: he.common.close }).focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "ב" }));
  });

  it("Shift+Tab לקבוצה שיש בה בחירה נוחת על הרדיו המסומן — לא על הראשון ולא על האחרון", async () => {
    const user = userEvent.setup();
    render(<Panel />);
    const first = screen.getByRole("radio", { name: "א" });
    await user.click(first);
    screen.getByRole("button", { name: he.common.close }).focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(first);
  });
});
