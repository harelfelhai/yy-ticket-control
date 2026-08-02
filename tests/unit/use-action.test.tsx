import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/action-result";
import { useAction } from "@/lib/use-action";

/**
 * ‏`useAction` מחזיק את שלוש ההחלטות שנלוות לכל קריאת Server Action: מתי
 * הממשק נעול, איפה יושבת השגיאה, ומה קורה בהצלחה. הבדיקות כאן הן על
 * ההתנהגות — האוכף שמונע כתיבה מחדש של אותה תבנית יושב ב-`primitives.test.ts`.
 *
 * **מה שלא נבדק כאן:** תנאי ה-hydration. ‏`useHydrated` נשען על
 * `useSyncExternalStore`, ו-jsdom מריץ את תמונת המצב של הלקוח — כלומר
 * `hydrated` הוא `true` מהרינדור הראשון, ו-`busy` שווה ל-`pending`. הנעילה
 * שלפני ה-hydration נבדקת בפועל ב-E2E, שם יש שרת שמגיש HTML.
 */

interface ProbeProps<T> {
  action: () => Promise<ActionResult<T> | void>;
  onSuccess?: (data: T) => void;
}

function Probe<T>({ action, onSuccess }: ProbeProps<T>) {
  const { busy, error, run, setError } = useAction();

  return (
    <div>
      <button type="button" onClick={() => run(action, onSuccess)}>
        הפעל
      </button>
      <button type="button" onClick={() => setError("שגיאה ידנית")}>
        זרוק
      </button>
      <span data-testid="busy">{busy ? "נעול" : "פנוי"}</span>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

/** הבטחה שנשלטת מבחוץ — מאפשרת לבדוק את המצב **בזמן** שהפעולה רצה */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useAction", () => {
  it("בהצלחה מעביר את הערך ל-`onSuccess`", async () => {
    const onSuccess = vi.fn();
    render(
      <Probe action={async () => ({ ok: true, data: "מזהה-1" }) as const} onSuccess={onSuccess} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "הפעל" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("מזהה-1"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("בכשל מציג את ההודעה ואינו קורא ל-`onSuccess`", async () => {
    const onSuccess = vi.fn();
    render(
      <Probe
        action={async () => ({ ok: false, error: "לנמען אין טלפון" }) as const}
        onSuccess={onSuccess}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "הפעל" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("לנמען אין טלפון");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  /**
   * זהו המסלול של `deleteTicketAction`, `deleteDraftAction` ו-`createTicketAction`:
   * ‏`redirect()` קוטע את ה-action, ומה שמגיע ללקוח הוא `undefined`. בלי
   * ההבחנה הזו כל פעולה שמנווטת הייתה מציגה שגיאה על הצלחה.
   */
  it("תוצאה חסרה — פעולה שניווטה — היא הצלחה ולא שגיאה", async () => {
    const onSuccess = vi.fn();
    render(<Probe action={async () => undefined} onSuccess={onSuccess} />);

    await userEvent.click(screen.getByRole("button", { name: "הפעל" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("הרצה חדשה מנקה את השגיאה הקודמת", async () => {
    let fail = true;
    render(
      <Probe
        action={async () => (fail ? ({ ok: false, error: "נכשל" } as const) : undefined)}
        onSuccess={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "הפעל" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("נכשל");

    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "הפעל" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("`busy` דולק כל עוד הפעולה לא חזרה", async () => {
    const gate = deferred<ActionResult<void>>();
    render(<Probe action={() => gate.promise} />);

    expect(screen.getByTestId("busy")).toHaveTextContent("פנוי");

    await userEvent.click(screen.getByRole("button", { name: "הפעל" }));
    await waitFor(() => expect(screen.getByTestId("busy")).toHaveTextContent("נעול"));

    gate.resolve({ ok: true, data: undefined });
    await waitFor(() => expect(screen.getByTestId("busy")).toHaveTextContent("פנוי"));
  });

  /**
   * ‏`setError` נחשף מפני שהזרימות הרב-שלביות (`draft-completion`,
   * `create-ticket-form`) מציבות שגיאה מאמצע הרצף ולא מתוך `run`.
   */
  it("`setError` מציב שגיאה גם בלי הרצה", async () => {
    render(<Probe action={async () => undefined} />);

    await userEvent.click(screen.getByRole("button", { name: "זרוק" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("שגיאה ידנית");
  });
});
