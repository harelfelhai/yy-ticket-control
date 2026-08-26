import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FilterBar, FilterDate, FilterSelect } from "@/components/ui/filter-bar";

/**
 * מה שנשמר כאן הוא החיווט של הרצועה: מה גלוי, ומה נשאר בסוף השורה.
 *
 * **שמונה בדיקות ירדו כאן יחד עם מתג הגילוי** (`aria-expanded`, פתיחה
 * מאליה בכתובת מסוננת, תג המונה, והמשפט לקורא המסך). הן לא נמחקו מפני
 * שהתקלקלו אלא מפני שהתנהגות שהן שמרו עליה כבר אינה קיימת: הרצועה גלויה
 * תמיד, ולכן אין מה לפתוח ואין מה לספור על מתג. הכלל שהמתג שירת — "לוח
 * שהתרוקן בגלל מסנן חייב להסביר את עצמו" — מתקיים עכשיו מעצם זה שהמסנן
 * הפעיל נראה על המסך.
 */

function renderBar() {
  return render(
    <FilterBar trailing={<button type="button">טבלה</button>}>
      <FilterSelect aria-label="בניין">
        <option value="">כל הבניינים</option>
      </FilterSelect>
    </FilterBar>,
  );
}

describe("FilterBar", () => {
  it("אין מתג גילוי — הרצועה אינה נפתחת ואינה נסגרת", () => {
    renderBar();
    expect(screen.queryByRole("button", { name: /מסננים/ })).toBeNull();
  });

  it("המסננים מרונדרים ישירות, בלי פאנל שמסתיר אותם", () => {
    renderBar();
    expect(screen.getByLabelText("בניין")).toBeInTheDocument();
  });

  it("הרצועה פותחת במסנן — החיפוש אינו פריט בתוכה", () => {
    /**
     * הבדיקה הזו החליפה בדיקה הפוכה, שדרשה ש-`leading` (שדה החיפוש) יהיה
     * הפריט הראשון. הסיבה להיפוך נמדדה ולא הוערכה: החיפוש תפס 334px מתוך
     * 1561, ודחף את מסנן "עד תאריך" אל מחוץ למסך ברוחב 1600px — כלומר
     * הרצועה שאמורה להיות גלויה תמיד דרשה גלילה כדי להגיע למסנן שלה.
     *
     * מה שנשמר כאן הוא לא סדר אלא **גבול**: הרצועה מחזיקה מסננים בלבד.
     * מי שיחזיר לכאן פקד חיפוש יישבר על השורה הזו.
     */
    const { container } = renderBar();
    const row = container.firstElementChild as HTMLElement;
    const first = row.firstElementChild as HTMLElement;

    expect(first.getAttribute("aria-label")).toBe("בניין");
    expect(row.querySelector('input[type="search"]')).toBeNull();
  });

  it("‏trailing מרונדר פעם אחת בלבד — כפילות הייתה שוברת חיפוש לפי תפקיד", () => {
    renderBar();
    expect(screen.getAllByRole("button", { name: "טבלה" })).toHaveLength(1);
  });

  it("השורה גוללת ואינה נשברת — גובה הרצועה קבוע בכל רוחב", () => {
    /**
     * ‏`flex-wrap` היה משנה את גובה הרצועה לפי הרוחב, כלומר מזיז את הלוח
     * שמתחתיה. ‏`overflow-x-auto` שומר שורה אחת ומגליל את העודף.
     */
    const { container } = renderBar();
    const row = container.firstElementChild as HTMLElement;

    expect(row.className).toContain("overflow-x-auto");
    expect(row.className).not.toContain("flex-wrap");
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

    /*
     * **הטענה כאן הייתה שקרית עד 0.7, ובאותה צורה בדיוק שתועדה
     * ב-`field.test.tsx`.** היא ביקשה `min-h-11` — 44px — וקיבלה אותו
     * כתת-מחרוזת של `touch:min-h-11`, שהיה הרצפה במגע בלבד. כלומר היא
     * לא בדקה מעולם את הגובה שהפקד מקבל בפועל, ועברה בירוק גם כשהוא
     * היה 28px. ‏`touch:` בוטל ב-0.7, והמלכודת ירדה איתו.
     */
    expect(className).toContain("min-h-7");
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

describe("FilterDate", () => {
  it("הפקד נשאר נייטיב — בורר מותאם היה downgrade על טלפון בשטח", () => {
    // ‏`type="date"` פותח את בורר מערכת ההפעלה. אם מישהו יחליף אותו בפקד
    // מותאם, הבדיקה הזו היא מה שיעצור אותו.
    render(<FilterDate label="מתאריך" />);
    expect(screen.getByLabelText("מתאריך")).toHaveAttribute("type", "date");
  });

  it("התווית גלויה ומקשרת בלי `id`", () => {
    // בשונה מהבוררים, שנושאים משמעות באפשרות ברירת המחדל: שדה תאריך ריק
    // מציג מסכת פורמט בלבד, ואי אפשר לדעת ממנה מי "מתאריך" ומי "עד תאריך".
    render(<FilterDate label="עד תאריך" />);

    expect(screen.getByText("עד תאריך")).toBeVisible();
    expect(screen.getByLabelText("עד תאריך")).toBeInTheDocument();
  });

  it("מבטל את `w-full` וחסום ברוחב, כמו הבוררים שלצדו", () => {
    render(<FilterDate label="מתאריך" />);
    const className = screen.getByLabelText("מתאריך").className;

    expect(className).toContain("w-auto");
    expect(className).toContain("max-w-44");
    expect(className).not.toContain("w-full");
  });

  it("נשאר `compact` וב-16px — פקד קטן מ-16px מגדיל את העמוד ב-iOS", () => {
    render(<FilterDate label="מתאריך" />);
    const className = screen.getByLabelText("מתאריך").className;

    // אותה מלכודת תת-מחרוזת שתוקנה בבורר שמעל — ראו ההסבר שם.
    expect(className).toContain("min-h-7");
    expect(className).toContain("text-base");
  });

  it("‏className של הקורא גובר", () => {
    render(<FilterDate label="מתאריך" className="w-full" />);
    expect(screen.getByLabelText("מתאריך").className).toContain("w-full");
  });

  it("מעביר props הלאה", () => {
    render(<FilterDate label="מתאריך" defaultValue="2026-08-02" />);
    expect(screen.getByLabelText("מתאריך")).toHaveValue("2026-08-02");
  });
});
