import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaView } from "@/lib/media-view";
import { he } from "@/lib/he";

/**
 * "הסר קובץ" בטיוטה ממייל (EM-S7-05, §7 שורה 68).
 *
 * מה שנבדק: הקריאה לפעולה עם המזהים הנכונים, שם נגיש שונה לכל אריח — גם
 * לקבצים בלי שם (תמונה משובצת בגוף המייל) — והודעת השרת במקום הפעולה.
 */

type Result = { ok: true; data: undefined } | { ok: false; error: string };

const actions = vi.hoisted(() => ({
  removeDraftMediaAction: vi.fn<(...args: unknown[]) => Promise<Result>>(async () => ({ ok: true, data: undefined })),
}));

vi.mock("@/app/(internal)/tickets/[id]/actions", () => actions);

const { DraftMediaList } = await import("@/app/(internal)/tickets/[id]/draft-media-list");

function media(id: string, name: string, mimeType = "image/png"): MediaView {
  return { id, url: `/api/media/${id}`, mimeType, name, aiText: null, aiNote: null };
}

beforeEach(() => {
  actions.removeDraftMediaAction.mockReset();
  actions.removeDraftMediaAction.mockResolvedValue({ ok: true, data: undefined });
});

describe("DraftMediaList", () => {
  it("בלי קבצים — לא מרונדר כלום", () => {
    const { container } = render(<DraftMediaList ticketId="t1" media={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("'הסר קובץ' קורא לפעולה עם מזהה הפנייה ומזהה הקובץ, בסדר הזה", async () => {
    const user = userEvent.setup();
    render(<DraftMediaList ticketId="t1" media={[media("m1", "logo.png")]} />);
    await user.click(screen.getByRole("button", { name: `${he.media.remove}: logo.png` }));
    expect(actions.removeDraftMediaAction).toHaveBeenCalledWith("t1", "m1");
  });

  it("תמונה מוצגת כתמונה ממוזערת, וקובץ אחר — בשמו", () => {
    render(<DraftMediaList ticketId="t1" media={[media("m1", "logo.png"), media("m2", "plan.pdf", "application/pdf")]} />);
    expect(screen.getByRole("img", { name: "logo.png" })).toHaveAttribute("src", "/api/media/m1");
    expect(screen.getByText("plan.pdf")).toBeInTheDocument();
  });

  it("קבצים בלי שם מקבלים שם חלופי ממוספר — ושם נגיש שונה לכל אחד", () => {
    render(<DraftMediaList ticketId="t1" media={[media("m1", ""), media("m2", "", "application/pdf")]} />);
    expect(screen.getByRole("button", { name: `${he.media.remove}: ${he.emailDraft.unnamedAttachmentN(1)}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${he.media.remove}: ${he.emailDraft.unnamedAttachmentN(2)}` })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: he.media.imageAlt })).toBeInTheDocument();
    expect(screen.getByText(he.emailDraft.unnamedAttachmentN(2))).toBeInTheDocument();
  });

  it("המשפט מתחת לרשימה מדבר על קובץ שהגיע במייל, ושגיאת השרת מוצגת במקום הפעולה", async () => {
    actions.removeDraftMediaAction.mockResolvedValue({ ok: false, error: he.common.notAllowed });
    const user = userEvent.setup();
    render(<DraftMediaList ticketId="t1" media={[media("m1", "logo.png")]} />);
    expect(screen.getByText(he.emailDraft.mediaKept)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `${he.media.remove}: logo.png` }));
    expect(await screen.findByRole("alert")).toHaveTextContent(he.common.notAllowed);
  });
});
