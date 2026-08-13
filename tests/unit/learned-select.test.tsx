import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LearnedSelect, type LearnedOption } from "@/components/learned-select";
import { controlClasses } from "@/components/ui/field";
import { he } from "@/lib/he";

const OPTIONS: LearnedOption[] = [
  { id: "1", label: "בניין א" },
  { id: "2", label: "בניין ב" },
  { id: "3", label: "בניין ג" },
];

function setup(overrides: Partial<Parameters<typeof LearnedSelect>[0]> = {}) {
  const onChange = vi.fn();
  const onCreate = vi.fn(async (name: string) => ({ id: "new", label: name }));
  render(
    <LearnedSelect
      label="בניין"
      options={OPTIONS}
      value={null}
      onChange={onChange}
      onCreate={onCreate}
      {...overrides}
    />,
  );
  return { onChange, onCreate, user: userEvent.setup() };
}

describe("LearnedSelect — נגישות", () => {
  it("השם הנגיש של הכפתור כולל את תווית השדה", async () => {
    // בלי זה הכפתור נקרא "בחר" בלבד, וקורא מסך אינו יודע איזה שדה זה —
    // וגם בדיקה אוטומטית אינה מצליחה לכוון אליו.
    setup();
    expect(screen.getByRole("button", { name: "בניין בחר" })).toBeInTheDocument();
  });
});

describe("LearnedSelect — בחירה", () => {
  it("מציג את הערכים הקיימים בפתיחה", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /בחר/ }));

    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("בחירה מחזירה את המזהה וסוגרת את הרשימה", async () => {
    const { user, onChange } = setup();
    await user.click(screen.getByRole("button", { name: /בחר/ }));
    await user.click(screen.getByRole("option", { name: "בניין ב" }));

    expect(onChange).toHaveBeenCalledWith("2");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("מסמן את הערך הנבחר", async () => {
    const { user } = setup({ value: "2" });
    // השם הנגיש של הכפתור הוא "<תווית> <ערך נבחר>" — כאן "בניין בניין ב".
    await user.click(screen.getByRole("button", { name: /בניין ב$/ }));

    expect(screen.getByRole("option", { name: "בניין ב" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("מסנן לפי חיפוש", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /בחר/ }));
    await user.type(screen.getByRole("textbox"), "ג");

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "בניין ג" })).toBeInTheDocument();
  });
});

describe("LearnedSelect — יצירה כפעולה מכוונת", () => {
  it("אינו מציע יצירה כשאין טקסט", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /בחר/ }));

    expect(screen.queryByRole("button", { name: /צור חדש/ })).not.toBeInTheDocument();
  });

  it("אינו מציע יצירה כשקיימת התאמה מדויקת", async () => {
    // זה הרגע שבו נוצרת כפילות: הצעת "צור חדש" לצד ערך זהה שכבר קיים.
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /בחר/ }));
    await user.type(screen.getByRole("textbox"), "בניין א");

    expect(screen.queryByRole("button", { name: /צור חדש/ })).not.toBeInTheDocument();
  });

  it("מתעלם מרווחים מיותרים בבדיקת ההתאמה המדויקת", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /בחר/ }));
    await user.type(screen.getByRole("textbox"), "  בניין   א  ");

    expect(screen.queryByRole("button", { name: /צור חדש/ })).not.toBeInTheDocument();
  });

  it("מציע יצירה כשהערך באמת חדש, ומציג אותו בנוסח מהאפיון", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /בחר/ }));
    await user.type(screen.getByRole("textbox"), "בניין ד");

    expect(screen.getByRole("button", { name: he.directory.createNew("בניין ד") })).toBeVisible();
  });

  it("יצירה קוראת ל-onCreate ובוחרת את התוצאה", async () => {
    const { user, onCreate, onChange } = setup();
    await user.click(screen.getByRole("button", { name: /בחר/ }));
    await user.type(screen.getByRole("textbox"), "בניין ד");
    await user.click(screen.getByRole("button", { name: /צור חדש/ }));

    expect(onCreate).toHaveBeenCalledWith("בניין ד");
    expect(onChange).toHaveBeenCalledWith("new");
  });

  it("כשל ביצירה מוצג למשתמש ואינו סוגר את הרשימה", async () => {
    const failing = vi.fn(async () => {
      throw new Error("יש להזין שם בניין");
    });
    const { user } = setup({ onCreate: failing });
    await user.click(screen.getByRole("button", { name: /בחר/ }));
    await user.type(screen.getByRole("textbox"), "בניין ד");
    await user.click(screen.getByRole("button", { name: /צור חדש/ }));

    expect(screen.getByRole("alert")).toHaveTextContent("יש להזין שם בניין");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("רשימה סגורה לא מציעה יצירה כלל", async () => {
    // חדרים, למשל, הם רשימה קבועה שאינה נלמדת (אפיון §3.3).
    const { user } = setup({ onCreate: undefined });
    await user.click(screen.getByRole("button", { name: /בחר/ }));
    await user.type(screen.getByRole("textbox"), "ערך חדש לגמרי");

    expect(screen.queryByRole("button", { name: /צור חדש/ })).not.toBeInTheDocument();
    expect(screen.getByText(he.common.noResults)).toBeVisible();
  });

  /**
   * הרגע שדווח מהשטח כ"לא מצאתי איפה מגדירים בניינים": אתר חדש, רשימה
   * ריקה, ובלי טקסט בשדה החיפוש שורת "צור חדש" עדיין אינה קיימת. המסלול
   * פתוח לגמרי — הוא פשוט אינו נראה.
   */
  it("רשימה נלמדת ריקה מסבירה שהקלדה יוצרת ערך, במקום 'אין תוצאות'", async () => {
    const { user } = setup({ options: [] });
    await user.click(screen.getByRole("button", { name: /בחר/ }));

    expect(screen.getByText(he.directory.emptyListHint)).toBeVisible();
    expect(screen.queryByText(he.common.noResults)).not.toBeInTheDocument();
  });

  it("רשימה סגורה וריקה נשארת עם 'אין תוצאות' — אין שם מה ליצור", async () => {
    const { user } = setup({ options: [], onCreate: undefined });
    await user.click(screen.getByRole("button", { name: /בחר/ }));

    expect(screen.getByText(he.common.noResults)).toBeVisible();
  });

  /**
   * הבורר הזה יושב בשורת ההזנה המרוכזת **צמוד** ל-`<select>` נייטיב. שני
   * פקדים שנראים כמעט זהים ונבדלים בפרט מקרי נקראים כרשלנות ולא כהבחנה —
   * המשתמש אינו לומד ש"חץ דק = אפשר לחפש".
   */
  it("הכפתור נבנה מאותו פרימיטיב כמו `<select>`, ולא ממחלקות משלו", () => {
    setup();
    const trigger = screen.getByRole("button", { name: /בחר/ });
    const expected = controlClasses("default", false, "control-chevron");

    // אותו חץ, אותו גובה, ואותה שקיפות במצב מושבת — לפני האיחוד הוא היה
    // `disabled:opacity-50` מול 60 בכל שאר הפקדים.
    for (const cls of expected.split(" ")) {
      expect(trigger.className.split(" ")).toContain(cls);
    }
  });
});
