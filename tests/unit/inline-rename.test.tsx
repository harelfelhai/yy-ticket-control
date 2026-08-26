import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InlineRename } from "@/components/inline-rename";
import { he } from "@/lib/he";

function setup(props: Partial<Parameters<typeof InlineRename>[0]> = {}) {
  const action = vi.fn(async () => ({ ok: true as const, data: undefined }));
  render(<InlineRename value="בניין א" action={action} {...props} />);
  return { action, user: userEvent.setup() };
}

describe("InlineRename", () => {
  it("הטריגר הוא עיפרון, והשם הנגיש שורד את היעלמות התווית", () => {
    /**
     * **הבדיקה הזו שומרת על החוזה שמחזיק חמש חבילות e2e.**
     *
     * ב-0.7 התווית הגלויה "שנה שם" הוחלפה ב-`Pencil` (§ אייקונים). כל
     * חבילה שמאתרת את הכפתור עושה זאת **בשמו** — `getByRole("button",
     * { name: "שנה שם X" })` — והשם הזה מגיע מעכשיו מ-`aria-label` ולא
     * מהטקסט. סטייה של תו אחד בו שוברת אותן בשקט, ולכן הוא נבדק כאן
     * במפורש ולא דרך רגקס סלחני.
     *
     * ‏`aria-hidden` על ה-SVG הוא החצי השני: בלעדיו קורא מסך היה מקריא
     * גם את שם האייקון וגם את התווית.
     */
    setup();
    const trigger = screen.getByRole("button", { name: `${he.common.rename} בניין א` });

    expect(trigger).toHaveTextContent("");
    expect(trigger.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(trigger.querySelector("svg")).toHaveClass("size-3");
  });

  it("השדה נפתח רק בלחיצה — רשימה נשארת רשימה ולא טופס", async () => {
    const { user } = setup();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: `${he.common.rename} בניין א` }));
    expect(screen.getByRole("textbox", { name: "בניין א" })).toBeInTheDocument();
  });

  it("שמירה שולחת את הערך החדש", async () => {
    const { action, user } = setup();
    await user.click(screen.getByRole("button", { name: /שנה שם/ }));

    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "בניין ב");
    await user.click(screen.getByRole("button", { name: he.common.save }));

    expect(action).toHaveBeenCalledWith("בניין ב");
  });

  it("שמירה מושבתת כשהערך לא השתנה — אין קריאת שרת ריקה", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /שנה שם/ }));

    expect(screen.getByRole("button", { name: he.common.save })).toBeDisabled();
  });

  it("ביטול מחזיר את השם המקורי ולא משאיר שדה ריק", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /שנה שם/ }));

    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "משהו אחר");
    await user.click(screen.getByRole("button", { name: he.common.cancel }));

    await user.click(screen.getByRole("button", { name: /שנה שם/ }));
    expect(screen.getByRole("textbox")).toHaveValue("בניין א");
  });

  it("שגיאת שרת מוצגת והשדה נשאר פתוח לתיקון", async () => {
    const action = vi.fn(async () => ({ ok: false as const, error: he.admin.buildingExists }));
    render(<InlineRename value="בניין א" action={action} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /שנה שם/ }));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "בניין ב");
    await user.click(screen.getByRole("button", { name: he.common.save }));

    expect(await screen.findByText(he.admin.buildingExists)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("‏`name` נפרד מ-`value` כשהערך לבדו אינו מזהה — מספר דירה", async () => {
    setup({ value: "5", name: "דירה 5" });
    expect(
      screen.getByRole("button", { name: `${he.common.rename} דירה 5` }),
    ).toBeInTheDocument();
  });

  describe("‏`className` — מיקום הטריגר", () => {
    /**
     * ‏`ms-auto` הוא מה שמצמיד את זוג הפעולות לקצה הכרטיס (0.8, § Layout
     * החריג השני), והפח נגרר אחרי העיפרון. ארבע רשימות ניהול מעבירות אותו.
     */
    it("נוחת על הטריגר המקופל", () => {
      setup({ className: "ms-auto" });
      expect(
        screen.getByRole("button", { name: `${he.common.rename} בניין א` }),
      ).toHaveClass("ms-auto");
    });

    it("אינו נוגע בשם הנגיש — זה מה שמחזיק חמש חבילות e2e", () => {
      // מחלקת מיקום אינה אמורה להשפיע על השם, אבל `Button` מרכיב את שתיהן
      // באותה קריאה — ולכן זו טענה שנבדקת ולא מונחת.
      setup({ className: "ms-auto" });
      expect(
        screen.getByRole("button", { name: `${he.common.rename} בניין א` }),
      ).toBeInTheDocument();
    });

    it("אינו מוחל על המצב הפתוח — שם הרכיב תופס שורה שלמה", async () => {
      /**
       * **זה הבאג שהעטיפה הייתה מייצרת, בגרסה קטנה יותר.**
       *
       * הרכיב הפתוח מרנדר `w-full` שנועד להיות רוחב **השורה**, כדי שהשדה
       * ירד לשורה משלו במקום להידחס לצד המונים. ‏`ms-auto` על אלמנט
       * ‏`w-full` חסר משמעות במקרה הטוב, ובמקרה הרע הוא מה שמישהו יוסיף
       * לו התנהגות בעתיד. הוא פשוט אינו מוחל שם.
       */
      const { user } = setup({ className: "ms-auto" });
      await user.click(screen.getByRole("button", { name: /שנה שם/ }));

      const input = screen.getByRole("textbox", { name: "בניין א" });
      const panel = input.closest("div")?.parentElement;
      expect(panel).toHaveClass("w-full");
      expect(panel).not.toHaveClass("ms-auto");
    });
  });
});
