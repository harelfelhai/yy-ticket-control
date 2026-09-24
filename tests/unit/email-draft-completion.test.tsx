import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailDraftValues } from "@/app/(internal)/tickets/[id]/email-draft-completion";
import type { DraftDisplay, DraftFieldDisplay } from "@/lib/draft/display";
import { he } from "@/lib/he";

/**
 * מסך 7 של טיוטה ממייל (EM-S7-03, EM-S7-04, EM-M03, §7 שורות 85–86).
 *
 * הפעולות מזויפות; מה שנבדק הוא חוזה המסך: כל השדות מוצגים, התגים ליד השדה
 * הנכון, כל שמירה נושאת את טביעת השדה, שינוי בניין אינו שולח דירה, "שגר"
 * חסום בסתירה, וערך שנדחה חוזר לערך השרת.
 */

type Result = { ok: true; data: undefined } | { ok: false; error: string };

const actions = vi.hoisted(() => ({
  updateTicketFieldsAction: vi.fn<(...args: unknown[]) => Promise<Result>>(async () => ({ ok: true, data: undefined })),
  submitDraftAction: vi.fn<(...args: unknown[]) => Promise<Result>>(async () => ({ ok: true, data: undefined })),
  deleteDraftAction: vi.fn<(...args: unknown[]) => Promise<Result>>(async () => ({ ok: true, data: undefined })),
  removeDraftMediaAction: vi.fn(async () => ({ ok: true as const, data: undefined })),
  resolveDraftConflictsAction: vi.fn(async () => ({ ok: true as const, data: undefined })),
}));
const newActions = vi.hoisted(() => ({
  createBuildingAction: vi.fn(),
  createApartmentAction: vi.fn(),
  createDomainAction: vi.fn(),
  createProfessionalAction: vi.fn(),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("@/app/(internal)/tickets/[id]/actions", () => actions);
vi.mock("@/app/(internal)/tickets/new/actions", () => newActions);
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { EmailDraftCompletion } = await import("@/app/(internal)/tickets/[id]/email-draft-completion");

function field(name: DraftFieldDisplay["field"], label: string, extra: Partial<DraftFieldDisplay> = {}): DraftFieldDisplay {
  return {
    field: name,
    label,
    systemText: "—",
    emailText: null,
    conflict: false,
    fromEmail: false,
    missing: false,
    version: `${name}-v1`,
    ...extra,
  };
}

function display(conflicts: boolean): DraftDisplay {
  return {
    fields: [
      field("SITE", "אתר", { systemText: "אתר לדוגמה" }),
      field("BUILDING", "בניין", conflicts ? { conflict: true, systemText: "בניין א", emailText: "בניין ב" } : {}),
      field("APARTMENT", "דירה", { missing: true }),
      field("ROOM", "חדר"),
      field("DOMAIN", "תחום", { missing: true }),
      field("DESCRIPTION", "תיאור", { fromEmail: true, systemText: "נזילה" }),
      field("RECIPIENTS", "נמענים", { missing: true }),
    ],
    conflictCount: conflicts ? 1 : 0,
    version: "v1",
  };
}

const SITE = { id: "s1", label: "אתר לדוגמה" };
const BUILDINGS = [
  { id: "b1", label: "בניין א", apartments: [{ id: "a1", label: "12" }] },
  { id: "b2", label: "בניין ב", apartments: [] },
];
const VALUES: EmailDraftValues = {
  buildingId: "b1",
  apartmentId: "a1",
  room: null,
  domainId: null,
  description: "נזילה",
  recipients: [],
};

type Overrides = {
  conflicts?: boolean;
  sites?: (typeof SITE)[] | null;
  site?: typeof SITE | null;
  values?: Partial<EmailDraftValues>;
};

function screenProps(overrides: Overrides = {}) {
  return {
    ticketId: "t1",
    banner: he.notices.draftBanner,
    display: display(overrides.conflicts ?? false),
    site: overrides.site === undefined ? SITE : overrides.site,
    sites: overrides.sites === undefined ? [SITE, { id: "s2", label: "אתר שני" }] : overrides.sites,
    buildings: overrides.site === null ? [] : BUILDINGS,
    domains: [{ id: "d1", label: "חשמל" }],
    recipientOptions: [],
    values: { ...VALUES, ...overrides.values },
    emailSiteAllowed: true,
  };
}

function renderScreen(overrides: Overrides = {}) {
  return render(<EmailDraftCompletion {...screenProps(overrides)} />);
}

/** עוטף השדה — `data-field` — כדי שהבדיקה תדע ליד איזה שדה התג יושב */
function block(name: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-field="${name}"]`);
  if (!element) throw new Error(`אין שדה ${name}`);
  return element;
}

beforeEach(() => {
  for (const mock of Object.values(actions)) mock.mockClear();
  actions.updateTicketFieldsAction.mockImplementation(async () => ({ ok: true, data: undefined }));
  router.refresh.mockClear();
});

describe("EmailDraftCompletion — מה מוצג", () => {
  it("כל השדות מוצגים, והתגים יושבים ליד השדה שהם מתארים", () => {
    renderScreen();
    for (const name of ["SITE", "BUILDING", "APARTMENT", "ROOM", "DOMAIN", "DESCRIPTION", "RECIPIENTS"]) {
      expect(block(name)).toBeInTheDocument();
    }
    expect(within(block("DESCRIPTION")).getByText(he.emailDraft.fromEmailTag)).toBeInTheDocument();
    expect(within(block("ROOM")).queryByText(he.emailDraft.fromEmailTag)).not.toBeInTheDocument();
    // "חסר" — רק ליד שדות חובה ריקים; חדר אינו חובה
    for (const name of ["APARTMENT", "DOMAIN", "RECIPIENTS"]) {
      expect(within(block(name)).getByText(he.emailDraft.missingTag)).toBeInTheDocument();
    }
    expect(within(block("ROOM")).queryByText(he.emailDraft.missingTag)).not.toBeInTheDocument();
    expect(screen.queryByText(he.emailDraft.conflictTag)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: he.ticket.submitDraftButton })).toBeEnabled();
  });

  it("סתירה: הודעה עם 'השווה ובחר', תג וקו ליד השדה שבסתירה, ו'שגר' חסום (EM-S7-04)", () => {
    renderScreen({ conflicts: true });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(he.emailDraft.conflictBanner(1));
    expect(status.className).toContain("text-danger");
    expect(screen.getByRole("button", { name: he.emailDraft.compare })).toBeInTheDocument();
    expect(within(block("BUILDING")).getByText(he.emailDraft.conflictTag)).toBeInTheDocument();
    expect(block("BUILDING").className).toContain("border-s-danger");
    expect(screen.getByRole("button", { name: he.ticket.submitDraftButton })).toBeDisabled();
  });

  it("מנהל עבודה רואה את האתר כטקסט, לא כבורר מושבת", () => {
    renderScreen({ sites: null });
    expect(within(block("SITE")).queryByRole("button")).not.toBeInTheDocument();
    expect(within(block("SITE")).getByText("אתר לדוגמה")).toBeInTheDocument();
  });

  it("טיוטה בלי אתר: הבניין מושבת עד שנבחר אתר", () => {
    renderScreen({ site: null, values: { buildingId: null, apartmentId: null } });
    const building = within(block("BUILDING")).getByRole("button", { name: /^בניין/ });
    expect(building).toBeDisabled();
    expect(building).toHaveTextContent(he.ticket.chooseSiteFirst);
  });

  it("'איש מקצוע חדש' רק כשיש אתר — בלעדיו הטופס היה נכשל רק אחרי שמולא", () => {
    const view = renderScreen({ site: null, values: { buildingId: null, apartmentId: null } });
    expect(screen.queryByRole("button", { name: he.directory.newProfessional })).not.toBeInTheDocument();
    view.unmount();
    renderScreen();
    expect(screen.getByRole("button", { name: he.directory.newProfessional })).toBeInTheDocument();
  });

  it("החלפת אתר מאפסת את רשימת הבניינים לזו של האתר החדש — בלי לטעון את הטופס מחדש", async () => {
    const user = userEvent.setup();
    const view = render(<EmailDraftCompletion {...screenProps()} />);
    // השרת התרענן אחרי החלפת האתר: אתר אחר, הבניינים שלו, בניין ודירה שאופסו
    view.rerender(
      <EmailDraftCompletion
        {...screenProps({ site: { id: "s2", label: "אתר שני" }, values: { buildingId: null, apartmentId: null } })}
        buildings={[{ id: "b9", label: "בניין ט", apartments: [] }]}
      />,
    );
    await user.click(within(block("BUILDING")).getByRole("button", { name: /^בניין/ }));
    expect(screen.getByRole("option", { name: "בניין ט" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "בניין א" })).not.toBeInTheDocument();
  });
});

describe("EmailDraftCompletion — שמירה", () => {
  it("שינוי בניין שולח את הבניין בלבד, עם טביעת השדה — השרת מאפס את הדירה בעצמו (§7 שורה 85)", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(within(block("BUILDING")).getByRole("button", { name: /^בניין/ }));
    await user.click(screen.getByRole("option", { name: "בניין ב" }));
    expect(actions.updateTicketFieldsAction).toHaveBeenCalledWith("t1", { buildingId: "b2" }, { BUILDING: "BUILDING-v1" });
  });

  it("בחירה חוזרת באותו בניין אינה שומרת דבר ואינה מוחקת את הדירה", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(within(block("BUILDING")).getByRole("button", { name: /^בניין/ }));
    await user.click(screen.getByRole("option", { name: "בניין א" }));
    expect(actions.updateTicketFieldsAction).not.toHaveBeenCalled();
    expect(within(block("APARTMENT")).getByRole("button", { name: /^דירה/ })).toHaveTextContent("12");
  });

  it("בחירת אתר נשמרת בבחירה מפורשת בלבד, עם טביעת האתר", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(within(block("SITE")).getByRole("button", { name: /^אתר/ }));
    await user.click(screen.getByRole("option", { name: "אתר שני" }));
    expect(actions.updateTicketFieldsAction).toHaveBeenCalledWith("t1", { siteId: "s2" }, { SITE: "SITE-v1" });
  });

  it("חדר נשמר ביציאה מהפקד ולא בכל שינוי — בורר נייטיב מחליף ערך בכל חץ", async () => {
    const user = userEvent.setup();
    renderScreen();
    const room = screen.getByLabelText(`${he.ticket.room} (${he.common.optional})`);
    await user.selectOptions(room, "KITCHEN");
    expect(actions.updateTicketFieldsAction).not.toHaveBeenCalled();
    await user.tab();
    expect(actions.updateTicketFieldsAction).toHaveBeenCalledWith("t1", { room: "KITCHEN" }, { ROOM: "ROOM-v1" });
  });

  it("תיאור נשמר ביציאה מהשדה; שינוי ברווחים בלבד אינו עריכה", async () => {
    const user = userEvent.setup();
    renderScreen();
    const description = screen.getByLabelText(he.ticket.description);

    await user.type(description, "   ");
    await user.tab();
    expect(actions.updateTicketFieldsAction).not.toHaveBeenCalled();

    await user.clear(description);
    await user.type(description, "נזילה חזקה");
    await user.tab();
    expect(actions.updateTicketFieldsAction).toHaveBeenCalledWith(
      "t1",
      { description: "נזילה חזקה" },
      { DESCRIPTION: "DESCRIPTION-v1" },
    );
  });

  it("שמירה שנדחתה מחזירה את הפקד לערך השרת ומציגה את ההודעה", async () => {
    actions.updateTicketFieldsAction.mockImplementation(async () => ({ ok: false, error: he.emailDraft.fieldChanged }));
    const user = userEvent.setup();
    renderScreen();
    const room = screen.getByLabelText(`${he.ticket.room} (${he.common.optional})`);
    await user.selectOptions(room, "KITCHEN");
    await user.tab();
    expect(await screen.findByRole("alert")).toHaveTextContent(he.emailDraft.fieldChanged);
    expect(room).toHaveValue("");
  });

  it("הלחיצה על 'שגר' אינה נבלעת כששמירת התיאור רצה — והשיגור יוצא רק אחרי שהשמירה חזרה", async () => {
    // שמירת התיאור חוזרת רק כשהבדיקה מחליטה — כמו רשת איטית
    let finish: (result: Result) => void = () => {};
    actions.updateTicketFieldsAction.mockImplementation(() => new Promise<Result>((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByLabelText(he.ticket.description), " ונוסף");
    await user.click(screen.getByRole("button", { name: he.ticket.submitDraftButton }));
    expect(actions.updateTicketFieldsAction).toHaveBeenCalledTimes(1);
    expect(actions.submitDraftAction).not.toHaveBeenCalled();

    await act(async () => finish({ ok: true, data: undefined }));
    await waitFor(() => expect(actions.submitDraftAction).toHaveBeenCalledWith("t1"));
  });

  it("שמירת תיאור שנדחתה עוצרת את השיגור שנלחץ אחריה; לחיצה נוספת, אחרי ההודעה, משגרת", async () => {
    // תשובה במייל החליפה את התיאור בינתיים (§7 שורה 86): בלי העצירה, הטיוטה
    // הייתה משוגרת עם תיאור שאיש לא ראה, והטקסט שהוקלד היה אובד
    let finish: (result: Result) => void = () => {};
    actions.updateTicketFieldsAction.mockImplementation(() => new Promise<Result>((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByLabelText(he.ticket.description), " ונוסף");
    const submit = screen.getByRole("button", { name: he.ticket.submitDraftButton });
    await user.click(submit);

    await act(async () => finish({ ok: false, error: he.emailDraft.fieldChanged }));
    expect(await screen.findByRole("alert")).toHaveTextContent(he.emailDraft.fieldChanged);
    expect(actions.submitDraftAction).not.toHaveBeenCalled();

    await user.click(submit);
    await waitFor(() => expect(actions.submitDraftAction).toHaveBeenCalledWith("t1"));
  });

  it("בזמן ששמירה בדרך בורר הנמענים נעול — שינוי שני היה נושא טביעה ישנה ונדחה", async () => {
    actions.updateTicketFieldsAction.mockImplementation(() => new Promise<Result>(() => {}));
    const user = userEvent.setup();
    renderScreen();
    await user.click(within(block("BUILDING")).getByRole("button", { name: /^בניין/ }));
    await user.click(screen.getByRole("option", { name: "בניין ב" }));
    expect(within(block("RECIPIENTS")).getByRole("button", { name: /^נמענים/ })).toBeDisabled();
  });

  it("'מחק טיוטה' שואל לפני, ומוחק רק באישור", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderScreen();
    await user.click(screen.getByRole("button", { name: he.ticket.deleteDraft }));
    expect(actions.deleteDraftAction).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: he.ticket.deleteDraft }));
    expect(actions.deleteDraftAction).toHaveBeenCalledWith("t1");
    confirm.mockRestore();
  });
});

describe("EmailDraftCompletion — רענון ומיקוד", () => {
  it("חזרה ללשונית מרעננת את המסך — תשובה במייל יכלה להגיע בינתיים", () => {
    renderScreen();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("כשהסתירה מוכרעת והכפתור שפתח את החלון נעלם, המיקוד עובר לטופס ולא נופל ל-body", () => {
    const view = render(<EmailDraftCompletion {...screenProps({ conflicts: true })} />);
    expect(document.activeElement).toBe(document.body);
    view.rerender(<EmailDraftCompletion {...screenProps({ conflicts: false })} />);
    expect(document.activeElement?.tagName).toBe("SECTION");
  });
});
