import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TicketDetailsDialog } from "@/app/(internal)/tickets/[id]/ticket-details-dialog";
import { he } from "@/lib/he";

/**
 * דיאלוג "פרטים" של מסך הפנייה.
 *
 * ‏DESIGN.md § Dialog מונה ארבע התנהגויות ומכנה אותן **תנאי קיום** ולא
 * שיפורים, מפני שזהו הרכיב היחיד במערכת שלוכד את המשתמש: כל עוד הוא פתוח,
 * מה שמאחוריו אינו זמין. פאנל שאפשר להיכנס אליו ולא לצאת ממנו הוא מלכודת.
 *
 * ארבעתן נבדקות כאן ולא ב-`Dialog` עצמו, כי כאן הן **בשימוש** — וזהו גם
 * אתר הקריאה שבו התוכן מגיע מהשרת כ-`children`, כלומר הצורה שהמסך מרנדר
 * בפועל. עד 0.4 לא הייתה לרכיב בדיקה כלל.
 */

function renderDialog() {
  return render(
    <TicketDetailsDialog>
      <button type="button">הסר יוסי</button>
      <button type="button">קישור גישה יוסי</button>
    </TicketDetailsDialog>,
  );
}

describe("TicketDetailsDialog", () => {
  it("סגור כברירת מחדל — השרשור הוא גוף המסך, לא הפרטים", () => {
    renderDialog();

    expect(screen.getByRole("button", { name: he.ticket.detailsPanel })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /**
   * ההבדל המהותי מ-`<details>`, ולא רק ויזואלי.
   *
   * תוכן של `<details>` סגור **קיים ב-DOM** אך מוסר מעץ הנגישות, ולכן
   * `getByRole` תחתיו נפתר לאפס — כלומר טענת `toHaveCount(0)` הפכה
   * ירוקה-שקר על תוכן שקיים בפועל. דיאלוג סגור אינו מרונדר, וההבחנה בין
   * "לא קיים" ל"קיים ומוסתר" חוזרת להיות אמיתית.
   */
  it("תוכן הפרטים אינו מרונדר כשהדיאלוג סגור", () => {
    renderDialog();
    expect(screen.queryByRole("button", { name: "הסר יוסי" })).toBeNull();
  });

  it("לחיצה פותחת, והתוכן מהשרת נמצא בפנים", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: he.ticket.detailsPanel }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal");
    expect(screen.getByRole("button", { name: "הסר יוסי" })).toBeInTheDocument();
  });

  it("לדיאלוג יש שם נגיש — אחרת הוא אזור אנונימי באמצע העמוד", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: he.ticket.detailsPanel }));

    expect(screen.getByRole("dialog", { name: he.ticket.detailsPanel })).toBeInTheDocument();
  });

  it("Escape סוגר", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: he.ticket.detailsPanel }));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("כפתור סגירה גלוי — 'לחץ מחוץ' אינו אפשרות שמישהו לומד מעצמו", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: he.ticket.detailsPanel }));

    await user.click(screen.getByRole("button", { name: he.common.close }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("המיקוד נכנס פנימה בפתיחה, וחוזר לכפתור בסגירה", async () => {
    const user = userEvent.setup();
    renderDialog();
    const trigger = screen.getByRole("button", { name: he.ticket.detailsPanel });

    await user.click(trigger);
    // בלי זה ניווט מקלדת ממשיך לגלול את הדף שמאחור.
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    // ובלי החזרה — קורא מסך מתחיל מחדש מראש העמוד אחרי כל סגירה.
    expect(document.activeElement).toBe(trigger);
  });
});
