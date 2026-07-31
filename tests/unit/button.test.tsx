import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, ButtonLink } from "@/components/ui/button";

/**
 * הכפתור הוא המקום שבו הספציפיקציה ב-`docs/DESIGN.md` § Components נאכפת.
 * הבדיקות כאן שומרות בדיוק על מה שנשחק כשלא היה פרימיטיב: גובה אזור המגע,
 * מצב `disabled`, והמניעה של דריסת עיצוב בטעות מאתר הקריאה.
 */

describe("Button", () => {
  it("ברירת המחדל היא פעולה ראשית בגובה מגע מלא", () => {
    render(<Button>שלח</Button>);
    const button = screen.getByRole("button", { name: "שלח" });

    expect(button.className).toContain("bg-brand");
    expect(button.className).toContain("font-semibold");
    // 48px — הסף לפעולה ראשית בעבודת שדה עם כפפות.
    expect(button.className).toContain("min-h-12");
  });

  it("`type` הוא button כברירת מחדל, כדי שכפתור בתוך טופס לא ישלח אותו בטעות", () => {
    render(<Button>בטל</Button>);
    expect(screen.getByRole("button", { name: "בטל" })).toHaveAttribute("type", "button");
  });

  it("`type` ניתן לדריסה מפורשת", () => {
    render(<Button type="submit">שמור</Button>);
    expect(screen.getByRole("button", { name: "שמור" })).toHaveAttribute("type", "submit");
  });

  it.each([
    ["primary", "bg-brand"],
    ["secondary", "border-border"],
    ["danger", "bg-danger"],
    ["dangerOutline", "border-danger"],
    ["dangerQuiet", "text-danger"],
    ["quiet", "text-brand"],
  ] as const)("הווריאנט %s מקבל את הצבע שלו", (variant, expected) => {
    render(<Button variant={variant}>פעולה</Button>);
    expect(screen.getByRole("button").className).toContain(expected);
  });

  it("`quiet` הוא טקסט בלבד — בלי מסגרת ובלי רקע", () => {
    // אילו היה מקבל מסגרת, הוא היה מתחרה בכפתור המשני שלצדו במקום להיות
    // הפעולה המשנית ממנו. זהו כל ההבדל בין `quiet` ל-`secondary`.
    render(<Button variant="quiet">נקה מסננים</Button>);
    const className = screen.getByRole("button").className;

    expect(className).not.toContain("border");
    expect(className).not.toContain("bg-");
  });

  it("`compact` נשאר מעל סף המגע המינימלי (44px)", () => {
    render(<Button size="compact">הסר</Button>);
    // min-h-11 = 44px. אילו היה יורד מזה, לחיצות בשטח היו מתפספסות.
    expect(screen.getByRole("button").className).toContain("min-h-11");
  });

  it("כל וריאנט מקבל מצב disabled — זה מה שנשכח כשכל עמוד בנה כפתור לעצמו", () => {
    render(
      <Button disabled variant="secondary">
        המתן
      </Button>,
    );
    const button = screen.getByRole("button", { name: "המתן" });

    expect(button).toBeDisabled();
    expect(button.className).toContain("disabled:opacity-60");
  });

  it("כפתור מושבת אינו מפעיל onClick", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        שגר
      </Button>,
    );

    await userEvent.click(screen.getByRole("button", { name: "שגר" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("מפעיל onClick כשהוא פעיל", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>שגר</Button>);

    await userEvent.click(screen.getByRole("button", { name: "שגר" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("className מוסיף פריסה בלי לאבד את מחלקות הווריאנט", () => {
    render(<Button className="w-full self-start">שלח</Button>);
    const button = screen.getByRole("button", { name: "שלח" });

    expect(button.className).toContain("w-full");
    expect(button.className).toContain("self-start");
    expect(button.className).toContain("bg-brand");
  });

  it("דריסה מתנגשת מנצחת לפי סדר הכתיבה ולא לפי סדר ה-CSS", () => {
    // בלי twMerge שתי מחלקות הריפוד היו נשארות ב-class, והתוצאה בפועל הייתה
    // נקבעת לפי סדר ההגדרה ב-CSS — כלומר כשל שקט שאי אפשר לראות בקוד.
    render(<Button className="px-3">צר</Button>);
    const className = screen.getByRole("button", { name: "צר" }).className;

    expect(className).toContain("px-3");
    expect(className).not.toContain("px-6");
  });

  it("מעביר תכונות נגישות הלאה", () => {
    render(<Button aria-label="הסר את יוסי">×</Button>);
    expect(screen.getByRole("button", { name: "הסר את יוסי" })).toBeInTheDocument();
  });
});

describe("ButtonLink", () => {
  it("מרונדר כקישור ולא ככפתור — סמנטיקה שונה, הכרזה שונה בקורא מסך", () => {
    render(<ButtonLink href="/tickets/new">פנייה חדשה</ButtonLink>);

    const link = screen.getByRole("link", { name: "פנייה חדשה" });
    expect(link).toHaveAttribute("href", "/tickets/new");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("נראה זהה לכפתור באותו וריאנט", () => {
    render(
      <ButtonLink href="/board" variant="secondary" size="compact">
        חזרה
      </ButtonLink>,
    );
    const className = screen.getByRole("link", { name: "חזרה" }).className;

    expect(className).toContain("border-border");
    expect(className).toContain("min-h-11");
  });
});
