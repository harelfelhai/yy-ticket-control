import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftFieldDisplay } from "@/lib/draft/display";
import { he } from "@/lib/he";

/**
 * מסך 7א — חלון הסתירות (EM-S7A-02…05, §7 שורה 84).
 *
 * הפעולה (`resolveDraftConflictsAction`) מזויפת: מה שנבדק כאן הוא חוזה
 * החלון — אין בחירה מראש, "החל את הבחירה" נפתח רק כשנבחר ערך בכל שדה
 * שבסתירה, האישור בשלב אחד עם הגרסה שהוצגה **בפתיחה**, ו"סגור" אינו משנה דבר.
 */

type Result = { ok: true; data: undefined } | { ok: false; error: string };

const actions = vi.hoisted(() => ({
  resolveDraftConflictsAction: vi.fn(async (): Promise<Result> => ({ ok: true as const, data: undefined })),
}));

vi.mock("@/app/(internal)/tickets/[id]/actions", () => actions);

const { ConflictDialog } = await import("@/app/(internal)/tickets/[id]/conflict-dialog");

function field(
  name: DraftFieldDisplay["field"],
  label: string,
  systemText: string,
  extra: Partial<DraftFieldDisplay> = {},
): DraftFieldDisplay {
  return {
    field: name,
    label,
    systemText,
    emailText: null,
    conflict: false,
    fromEmail: false,
    missing: false,
    version: `${name}-v1`,
    ...extra,
  };
}

const FIELDS: DraftFieldDisplay[] = [
  field("SITE", "אתר", "אתר לדוגמה"),
  field("BUILDING", "בניין", "בניין א", { conflict: true, emailText: "בניין ב" }),
  field("APARTMENT", "דירה", "12"),
  field("ROOM", "חדר", "—"),
  field("DOMAIN", "תחום", "חשמל"),
  field("DESCRIPTION", "תיאור", "נזילה", { fromEmail: true }),
  field("RECIPIENTS", "נמענים", "יוסי", { conflict: true, emailText: "להוסיף: דנה" }),
];

beforeEach(() => {
  actions.resolveDraftConflictsAction.mockReset();
  actions.resolveDraftConflictsAction.mockResolvedValue({ ok: true as const, data: undefined });
});

async function open(fields = FIELDS, extra: { emailSiteAllowed?: boolean } = {}) {
  const user = userEvent.setup();
  const view = render(<ConflictDialog ticketId="t1" fields={fields} version="v1" {...extra} />);
  await user.click(screen.getByRole("button", { name: he.emailDraft.compare }));
  return { user, ...view };
}

function group(name: string) {
  return within(screen.getByRole("dialog")).getByRole("group", { name });
}

describe("ConflictDialog", () => {
  it("נפתח עם הכותרת מהאפיון, בלי בחירה מראש, ו'החל את הבחירה' מושבת", async () => {
    await open();
    const dialog = screen.getByRole("dialog", { name: he.emailDraft.conflictsTitle });
    const radios = within(dialog).getAllByRole("radio");
    expect(radios).toHaveLength(4);
    for (const radio of radios) expect(radio).not.toBeChecked();
    expect(within(dialog).getByRole("button", { name: he.emailDraft.applyChoices })).toBeDisabled();
    expect(within(dialog).getByText(he.emailDraft.chooseEverywhere)).toBeInTheDocument();
  });

  it("כל השדות בדסקטופ, רק הסתירות בטלפון — DOM אחד", async () => {
    await open();
    const rows = within(screen.getByRole("dialog")).getAllByRole("listitem");
    expect(rows).toHaveLength(FIELDS.length);
    expect(rows.filter((row) => row.classList.contains("hidden"))).toHaveLength(5);
  });

  it("שורה שאינה בסתירה: הערך מהמייל מוצג כשהוא ידוע (fromEmail), ואחרת התא ריק — לא '—'", async () => {
    await open();
    const rows = within(screen.getByRole("dialog")).getAllByRole("listitem");
    // התיאור הגיע מהמייל: הערך במערכת הוא הערך מהמייל, ותא ריק היה נקרא "המייל לא נתן כלום"
    const description = rows.find((row) => row.firstElementChild?.textContent === "תיאור");
    expect(description?.lastElementChild).toHaveTextContent("נזילה");
    // הדירה נקבעה במערכת: ערך מהמייל נשמר רק בסתירה, ו"—" היה טוען שלמייל לא היה ערך
    const apartment = rows.find((row) => row.firstElementChild?.textContent === "דירה");
    expect(apartment?.lastElementChild).toBeEmptyDOMElement();
    expect(apartment).not.toHaveTextContent(he.emailIntake.empty);
  });

  it("'השווה ובחר' מושבת כשהטופס עסוק — לחיצה בזמן שמירה הייתה פותחת חלון על ערכים שעומדים להתחלף", async () => {
    const user = userEvent.setup();
    render(<ConflictDialog ticketId="t1" fields={FIELDS} version="v1" disabled />);
    const trigger = screen.getByRole("button", { name: he.emailDraft.compare });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("המקור נכלל בשם הנגיש של כל רדיו, ומוסתר בדסקטופ ב-sr-only ולא ב-hidden", async () => {
    await open();
    const building = group("בניין");
    expect(within(building).getByRole("radio", { name: `${he.emailDraft.columnSystem}: בניין א` })).toBeInTheDocument();
    const email = within(building).getByRole("radio", { name: `${he.emailDraft.columnEmail}: בניין ב` });
    const source = email.closest("label")?.querySelector("span span");
    expect(source?.className).toContain("md:sr-only");
    expect(source?.className).not.toContain("md:hidden");
  });

  it("האישור נפתח רק אחרי בחירה בכל שדה, ונשלח בשלב אחד עם הגרסה שהוצגה", async () => {
    const { user } = await open();
    const apply = within(screen.getByRole("dialog")).getByRole("button", { name: he.emailDraft.applyChoices });

    await user.click(within(group("בניין")).getByRole("radio", { name: /בניין א/ }));
    expect(apply).toBeDisabled();
    await user.click(within(group("נמענים")).getByRole("radio", { name: /להוסיף: דנה/ }));
    expect(apply).toBeEnabled();
    expect(screen.queryByText(he.emailDraft.chooseEverywhere)).not.toBeInTheDocument();

    await user.click(apply);
    expect(actions.resolveDraftConflictsAction).toHaveBeenCalledWith(
      "t1",
      { BUILDING: "system", RECIPIENTS: "email" },
      "v1",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("רענון בזמן שהחלון פתוח אינו מחליף את מה שהוצג — נשלחת הגרסה שבפתיחה (§7 שורה 84)", async () => {
    const { user, rerender } = await open();
    await user.click(within(group("בניין")).getByRole("radio", { name: /בניין א/ }));
    await user.click(within(group("נמענים")).getByRole("radio", { name: /יוסי/ }));

    // תשובה חדשה במייל נקלטה והעמוד התרענן: ערך אחר מהמייל, גרסה אחרת
    const refreshed = FIELDS.map((f) => (f.field === "BUILDING" ? { ...f, emailText: "בניין ג" } : f));
    rerender(<ConflictDialog ticketId="t1" fields={refreshed} version="v2" />);

    expect(within(group("בניין")).queryByRole("radio", { name: /בניין ג/ })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: he.emailDraft.applyChoices }));
    expect(actions.resolveDraftConflictsAction).toHaveBeenCalledWith(
      "t1",
      { BUILDING: "system", RECIPIENTS: "system" },
      "v1",
    );
  });

  it("'סגור' (ה-X של הדיאלוג) סוגר בלי שינוי, ופתיחה חוזרת מתחילה בלי בחירה", async () => {
    const { user } = await open();
    await user.click(within(group("בניין")).getByRole("radio", { name: /בניין ב/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: he.common.close }));

    expect(actions.resolveDraftConflictsAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: he.emailDraft.compare }));
    for (const radio of screen.getAllByRole("radio")) expect(radio).not.toBeChecked();
  });

  it("בזמן שההכרעה בדרך החלון אינו נסגר — סגירה הייתה מעלימה את התשובה", async () => {
    let finish: (value: Result) => void = () => {};
    actions.resolveDraftConflictsAction.mockImplementation(() => new Promise<Result>((resolve) => (finish = resolve)));
    const { user } = await open();
    await user.click(within(group("בניין")).getByRole("radio", { name: /בניין א/ }));
    await user.click(within(group("נמענים")).getByRole("radio", { name: /יוסי/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: he.emailDraft.applyChoices }));

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    finish({ ok: false, error: he.emailDraft.conflictsChanged });
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      he.emailDraft.conflictsChanged,
    );
  });

  it("סירוב של השרת (הסתירות השתנו) מוצג בחלון והחלון נשאר פתוח", async () => {
    actions.resolveDraftConflictsAction.mockResolvedValue({ ok: false, error: he.emailDraft.conflictsChanged });
    const { user } = await open();
    await user.click(within(group("בניין")).getByRole("radio", { name: /בניין א/ }));
    await user.click(within(group("נמענים")).getByRole("radio", { name: /יוסי/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: he.emailDraft.applyChoices }));

    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      he.emailDraft.conflictsChanged,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("אתר מהמייל שהצופה אינו רשאי לבחור: האפשרות מושבתת עם הסבר, וצד המערכת עדיין אפשרי", async () => {
    const fields = FIELDS.map((f) =>
      f.field === "SITE" ? { ...f, conflict: true, emailText: "אתר שני" } : f.field === "BUILDING" ? { ...f, conflict: false } : f,
    );
    const { user } = await open(fields, { emailSiteAllowed: false });
    const site = group("אתר");
    expect(within(site).getByRole("radio", { name: /אתר שני/ })).toBeDisabled();
    expect(within(site).getByText(he.emailDraft.emailSiteNotAllowed)).toBeInTheDocument();

    await user.click(within(site).getByRole("radio", { name: /אתר לדוגמה/ }));
    await user.click(within(group("נמענים")).getByRole("radio", { name: /יוסי/ }));
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: he.emailDraft.applyChoices })).toBeEnabled();
  });
});
