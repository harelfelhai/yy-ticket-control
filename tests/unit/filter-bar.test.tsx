import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FilterBar, FilterSelect } from "@/components/ui/filter-bar";

/**
 * מה שנשמר כאן הוא החיווט: מי מקופל, מי נשאר גלוי, ומה נמסר לקורא המסך.
 *
 * **הנראות עצמה אינה נבדקת כאן.** הקיפול נעשה במחלקות `hidden`/`md:flex`,
 * ו-jsdom אינו מריץ את גיליון הסגנון של Tailwind — `toBeVisible` היה מחזיר
 * "גלוי" גם לפקד מקופל. הנראות בפועל, בשני רוחבי המסך, נבדקת ב-E2E
 * (`e2e/board.spec.ts`), ומה שנבדק כאן הוא ההצהרה הנגישה `aria-expanded`
 * שהיא ממילא מקור האמת עבור קורא מסך.
 */

function renderBar(activeCount = 0) {
  return render(
    <FilterBar activeCount={activeCount} trailing={<button type="button">מצב סיור</button>}>
      <FilterSelect aria-label="בניין">
        <option value="">כל הבניינים</option>
      </FilterSelect>
    </FilterBar>,
  );
}

describe("FilterBar", () => {
  it("מקופלת כברירת מחדל כשאין מסנן פעיל", () => {
    renderBar(0);
    expect(screen.getByRole("button", { name: "מסננים" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("נפתחת מאליה בכתובת מסוננת — לוח מסונן ללא הסבר נקרא כאובדן נתונים", () => {
    renderBar(2);
    expect(screen.getByRole("button", { name: /מסננים/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("המתג פותח וסוגר", async () => {
    renderBar(0);
    const toggle = screen.getByRole("button", { name: "מסננים" });

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("המתג מצביע על הפאנל שהוא שולט בו", () => {
    renderBar(0);
    const controls = screen.getByRole("button", { name: "מסננים" }).getAttribute("aria-controls");

    expect(controls).toBeTruthy();
    expect(document.getElementById(controls as string)).toContainElement(
      screen.getByLabelText("בניין"),
    );
  });

  it("המספר על המתג נמסר לקורא המסך כמשפט, לא כספרה בודדת", () => {
    renderBar(3);
    // השם הנגיש המלא: "מסננים 3 פעילים" — התג עצמו `aria-hidden`.
    expect(screen.getByRole("button", { name: "מסננים 3 פעילים" })).toBeInTheDocument();
  });

  it("המתג ו״נקה מסננים״ אינם מתנגשים בחיפוש לפי שם", () => {
    render(
      <FilterBar activeCount={1} trailing={<button type="button">נקה מסננים</button>}>
        <FilterSelect aria-label="בניין" />
      </FilterBar>,
    );

    // התאמת מחרוזת ב-Playwright היא הכלה, ולכן `"מסננים"` תופס את שניהם.
    // העוגן `^` הוא מה שמפריד ביניהם — ראו `openFilters` ב-`e2e/helpers.ts`.
    expect(screen.getAllByRole("button", { name: /מסננים/ })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^מסננים/ })).toHaveLength(1);
  });

  it("בלי מסננים פעילים אין תג מספר", () => {
    renderBar(0);
    expect(screen.getByRole("button", { name: "מסננים" })).toHaveTextContent(/^מסננים$/);
  });

  it("‏trailing מרונדר פעם אחת בלבד — כפילות הייתה שוברת חיפוש לפי תפקיד", () => {
    renderBar(0);
    expect(screen.getAllByRole("button", { name: "מצב סיור" })).toHaveLength(1);
  });
});

describe("FilterSelect", () => {
  it("מבטל את `w-full` של הפקד — אחרת כל בורר תופס שורה שלמה", () => {
    render(
      <FilterSelect aria-label="תחום">
        <option value="">כל התחומים</option>
      </FilterSelect>,
    );
    const className = screen.getByLabelText("תחום").className;

    expect(className).toContain("w-auto");
    expect(className).not.toContain("w-full");
  });

  it("נשאר `compact` וב-16px — הרצועה צפופה, אך פקד קטן מ-16px מגדיל את העמוד ב-iOS", () => {
    render(
      <FilterSelect aria-label="תחום">
        <option value="">כל התחומים</option>
      </FilterSelect>,
    );
    const className = screen.getByLabelText("תחום").className;

    expect(className).toContain("min-h-11");
    expect(className).toContain("text-base");
  });

  it("‏className של הקורא גובר", () => {
    render(
      <FilterSelect aria-label="תחום" className="w-full">
        <option value="">כל התחומים</option>
      </FilterSelect>,
    );
    expect(screen.getByLabelText("תחום").className).toContain("w-full");
  });
});
