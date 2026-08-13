import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteButton } from "@/components/delete-button";
import { he } from "@/lib/he";

/**
 * ‏`DeleteButton` הוא הפקד המשותף לשש רשימות הניהול, ושתי ההתנהגויות שלו הן
 * הכרעות מתועדות ולא פרטי מימוש: **אישור לפני מחיקה** (DESIGN.md § מחיקה),
 * ו**כפתור שנשאר לחיץ גם כשהמחיקה חסומה** — כי המסך אינו יודע מראש מה חוסם,
 * וכפתור עמום שאינו מגיב נקרא כתקלה.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(result: Awaited<ReturnType<Parameters<typeof DeleteButton>[0]["action"]>>) {
  const action = vi.fn(async () => result);
  render(<DeleteButton name="בניין א" action={action} />);
  return { action, user: userEvent.setup() };
}

describe("DeleteButton", () => {
  it("שואל לפני מחיקה, ונוקב בשם — לחיצה בטעות אינה עוברת בשקט", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { action, user } = setup({ ok: true, data: undefined });

    await user.click(screen.getByRole("button", { name: `${he.admin.delete} בניין א` }));

    expect(confirm).toHaveBeenCalledWith(he.admin.deleteConfirm("בניין א"));
    expect(action).toHaveBeenCalledOnce();
  });

  it("ביטול האישור אינו מריץ את הפעולה", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { action, user } = setup({ ok: true, data: undefined });

    await user.click(screen.getByRole("button", { name: /מחק/ }));

    expect(action).not.toHaveBeenCalled();
  });

  it("מחיקה חסומה מציגה מה חוסם, והכפתור נשאר לחיץ", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const blocked = he.admin.deleteBlocked(he.admin.blockedBy.tickets(12));
    const { user } = setup({ ok: false, error: blocked });

    const button = screen.getByRole("button", { name: /מחק/ });
    await user.click(button);

    expect(await screen.findByText(blocked)).toBeInTheDocument();
    // זו הנקודה: השגיאה אינה נועלת את הפקד. המשתמש מסיר את מה שחוסם וחוזר.
    expect(button).toBeEnabled();
  });
});
