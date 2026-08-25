import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Field, Input, Select, Textarea, controlClasses } from "@/components/ui/field";

/**
 * מה שנשמר כאן הוא בדיוק מה שנשחק כשלא היה פרימיטיב: גודל הגופן בפקד
 * (שמונע הגדלת עמוד ב-iOS), גובה אזור המגע, והשם הנגיש של הפקד — שעליו
 * נשענות 132 בדיקות ה-E2E.
 */

describe("פקדי קלט", () => {
  it("גודל הגופן הוא 16px — מתחת לזה ספארי ב-iOS מגדיל את כל העמוד", () => {
    render(<Input aria-label="שם" />);
    expect(screen.getByLabelText("שם").className).toContain("text-base");
  });

  it("גם `compact` נשאר 16px — הצמצום הוא בגובה, לא בקריאוּת", () => {
    render(<Input size="compact" aria-label="חיפוש" />);
    const className = screen.getByLabelText("חיפוש").className;

    expect(className).toContain("text-base");
    expect(className).toContain("touch:min-h-11");
  });

  it("ברירת המחדל צפופה בעכבר וחוזרת לרצפת המגע באצבע", () => {
    render(<Input aria-label="שם" />);
    // ‏32px בעכבר / 44px במגע. הגובה הוא הדבר היחיד שתלוי במכשיר — הגופן
    // נשאר 16px בשני המקרים (ראו הבדיקה שמעל: ספארי ב-iOS מגדיל מתחת לזה).
    const className = screen.getByLabelText("שם").className;
    expect(className).toContain("min-h-8");
    expect(className).toContain("touch:min-h-11");
  });

  it("`invalid` מוסיף מסגרת אדומה", () => {
    render(<Input invalid aria-label="טלפון" />);
    expect(screen.getByLabelText("טלפון").className).toContain("border-danger");
  });

  it("Select ו-Textarea חולקים את אותו בסיס", () => {
    render(
      <>
        <Select aria-label="תחום">
          <option>חשמל</option>
        </Select>
        <Textarea aria-label="תיאור" />
      </>,
    );

    expect(screen.getByLabelText("תחום").className).toContain("text-base");
    expect(screen.getByLabelText("תיאור").className).toContain("text-base");
  });

  it("Textarea מקבל ריפוד אנכי — בלעדיו הטקסט נדבק לגבול העליון", () => {
    render(<Textarea aria-label="תיאור" />);
    expect(screen.getByLabelText("תיאור").className).toContain("p-2");
  });

  it("מעביר props הלאה ומגיב להקלדה", async () => {
    const onChange = vi.fn();
    render(<Input aria-label="שם" onChange={onChange} dir="ltr" inputMode="tel" />);

    const input = screen.getByLabelText("שם");
    expect(input).toHaveAttribute("dir", "ltr");
    expect(input).toHaveAttribute("inputmode", "tel");

    await userEvent.type(input, "05");
    expect(onChange).toHaveBeenCalled();
  });

  it("‏Select נושא את חץ המערכת ולא את חץ הדפדפן", () => {
    // `control-chevron` (ב-globals.css) עושה `appearance-none` ומצייר חץ
    // אחד. בלעדיו החץ מגיע מהדפדפן ונראה אחרת בכל מנוע.
    render(
      <Select aria-label="תחום">
        <option>חשמל</option>
      </Select>,
    );
    expect(screen.getByLabelText("תחום").className).toContain("control-chevron");
  });

  it("controlClasses נותן את אותן מחלקות לאלמנט חיצוני", () => {
    /*
     * **הטענה הודקה ב-0.6.** קודם היא בדקה `toContain("min-h-11")` על
     * הגודל הקומפקטי — והיא עברה רק מפני ש-`"touch:min-h-11"` **מכיל**
     * את המחרוזת. כלומר היא לא בדקה דבר על גובה העכבר, ורצפת המגע נבדקה
     * בה במקרה. שני חצאי הזוג נבדקים עכשיו בנפרד ובמפורש.
     */
    expect(controlClasses("compact")).toContain("min-h-7");
    expect(controlClasses("compact")).toContain("touch:min-h-11");
    expect(controlClasses("default", true)).toContain("border-danger");
  });
});

describe("Field", () => {
  it("התווית מקושרת לפקד בלי id", () => {
    render(
      <Field label="שם משתמש">
        <Input />
      </Field>,
    );
    expect(screen.getByLabelText("שם משתמש")).toBeInTheDocument();
  });

  it("רמז אינו נכנס לשם הנגיש — עליו נשענות בדיקות ה-E2E", () => {
    render(
      <Field label="טלפון" hint="טלפון או מייל — חובה">
        <Input />
      </Field>,
    );

    // אילו הרמז היה בתוך ה-<label>, השם הנגיש היה "טלפון טלפון או מייל — חובה"
    // וכל `getByLabel("טלפון")` בפרויקט היה נכשל.
    expect(screen.getByLabelText("טלפון")).toBeInTheDocument();
    expect(screen.getByText("טלפון או מייל — חובה")).toBeInTheDocument();
  });

  it("שגיאה אינה נכנסת לשם הנגיש, ומוכרזת כהתראה", () => {
    render(
      <Field label="מייל" error="כתובת לא תקינה">
        <Input invalid />
      </Field>,
    );

    expect(screen.getByLabelText("מייל")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("כתובת לא תקינה");
  });

  it("שגיאה היא טקסט ולא רק צבע — צבע לבדו אינו נראה בשמש", () => {
    render(
      <Field label="מייל" error="כתובת לא תקינה">
        <Input invalid />
      </Field>,
    );

    expect(screen.getByText("כתובת לא תקינה")).toBeVisible();
    expect(screen.getByLabelText("מייל").className).toContain("border-danger");
  });

  it("בלי רמז ובלי שגיאה לא מרונדר כלום מיותר", () => {
    render(
      <Field label="שם">
        <Input />
      </Field>,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
