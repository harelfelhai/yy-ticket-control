import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { he } from "@/lib/he";

/**
 * טופס החלפת הסיסמה (הכרעת מימוש 1.1).
 *
 * שתי התנהגויות כאן אינן קיימות בשרת כלל, ולכן אין מי שיבדוק אותן חוץ
 * מהקובץ הזה: **אימות שתי ההקלדות**, שהוא הגנה מפני שגיאת הקלדה ולא כלל
 * עסקי, ו**ריקון השדות בהצלחה** — סיסמה שנשארת על המסך אחרי שהוחלפה היא
 * בדיוק מה שהמשתמש בא לסלק.
 */

const actions = vi.hoisted(() => ({
  changePasswordAction: vi.fn(async () => ({ ok: true as const, data: undefined })),
}));

vi.mock("@/app/(internal)/account/actions", () => actions);

const { ChangePasswordForm } = await import(
  "@/app/(internal)/account/change-password-form"
);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function fill(current: string, next: string, confirm: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(he.account.currentPassword), current);
  await user.type(screen.getByLabelText(he.account.newPassword), next);
  await user.type(screen.getByLabelText(he.account.confirmPassword), confirm);
  return user;
}

describe("טופס החלפת סיסמה", () => {
  it("שולח את הנוכחית ואת החדשה — ולא את שדה האימות", async () => {
    render(<ChangePasswordForm />);
    const user = await fill("yashan-123", "chadash-456", "chadash-456");
    await user.click(screen.getByRole("button", { name: he.account.submit }));

    expect(actions.changePasswordAction).toHaveBeenCalledWith({
      currentPassword: "yashan-123",
      newPassword: "chadash-456",
    });
  });

  it("שתי הקלדות שאינן זהות נעצרות בלקוח ואינן מגיעות לשרת", async () => {
    render(<ChangePasswordForm />);
    const user = await fill("yashan-123", "chadash-456", "chadash-457");
    await user.click(screen.getByRole("button", { name: he.account.submit }));

    expect(screen.getByText(he.account.confirmMismatch)).toBeVisible();
    expect(actions.changePasswordAction).not.toHaveBeenCalled();
  });

  it("בהצלחה: אישור מוצג והשדות מתרוקנים", async () => {
    render(<ChangePasswordForm />);
    const user = await fill("yashan-123", "chadash-456", "chadash-456");
    await user.click(screen.getByRole("button", { name: he.account.submit }));

    expect(await screen.findByText(he.account.changed)).toBeVisible();
    expect(screen.getByLabelText(he.account.currentPassword)).toHaveValue("");
    expect(screen.getByLabelText(he.account.newPassword)).toHaveValue("");
    expect(screen.getByLabelText(he.account.confirmPassword)).toHaveValue("");
  });

  it("כשל מהשרת מוצג כלשונו, והשדות נשארים מלאים כדי לתקן", async () => {
    actions.changePasswordAction.mockResolvedValueOnce({
      ok: false,
      error: he.account.currentPasswordWrong,
    } as never);

    render(<ChangePasswordForm />);
    const user = await fill("shagui-123", "chadash-456", "chadash-456");
    await user.click(screen.getByRole("button", { name: he.account.submit }));

    expect(await screen.findByText(he.account.currentPasswordWrong)).toBeVisible();
    expect(screen.getByLabelText(he.account.newPassword)).toHaveValue("chadash-456");
  });

  it("הכפתור נעול עד שכל שלושת השדות מלאים", async () => {
    render(<ChangePasswordForm />);
    const submit = screen.getByRole("button", { name: he.account.submit });
    expect(submit).toBeDisabled();

    await fill("yashan-123", "chadash-456", "chadash-456");
    expect(submit).toBeEnabled();
  });
});
