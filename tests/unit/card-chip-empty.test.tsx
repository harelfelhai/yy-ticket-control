import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssignmentStatusChip, TicketStatusChip } from "@/components/status-chip";
import { cardClasses } from "@/components/ui/card";
import { Chip, chipClasses } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * מה שנשמר כאן הוא ההבחנות שהאיחוד היה יכול למחוק בשקט — ולא המחלקות עצמן.
 * צירוף מחלקות אפשר לקרוא מהקוד; מה שאי אפשר לקרוא ממנו הוא שהבחנה
 * סמנטית שהייתה קיימת עדיין קיימת.
 */

describe("Card", () => {
  it("מפריד במסגרת ולא בצל — צל אינו נראה בשמש", () => {
    const className = cardClasses();

    expect(className).toContain("border-border");
    expect(className).not.toContain("shadow");
  });

  it("‏`danger` בולט יותר מ-`dangerQuiet` — התראה מול אזור שכבר נכנסו אליו", () => {
    // ההבחנה הזו הייתה קיימת בקוד כמקריות (`border-danger` מול `border-danger/40`
    // בשני קבצים) ולא כהחלטה. כאן היא הופכת למכוונת.
    expect(cardClasses(undefined, { tone: "danger" })).toContain("border-danger");
    expect(cardClasses(undefined, { tone: "danger" })).not.toContain("border-danger/40");
    expect(cardClasses(undefined, { tone: "dangerQuiet" })).toContain("border-danger/40");
  });

  it("‏`dangerOutline` שומר על משטח רגיל — פריט ברשימה, לא הודעה", () => {
    // הרגרסיה שהבדיקה הזו נועדה למנוע קרתה בפועל: איחוד הגוונים נתן לכרטיס
    // הטיוטה בלוח רקע ורדרד שלא היה לו, והוא נקרא כסוג אחר של אובייקט בתוך
    // רשימה של כרטיסים לבנים. רק הצילום חשף את זה.
    expect(cardClasses(undefined, { tone: "dangerOutline" })).toContain("border-danger");
    expect(cardClasses(undefined, { tone: "dangerOutline" })).toContain("bg-surface");
    expect(cardClasses(undefined, { tone: "dangerOutline" })).not.toContain("bg-danger");
  });

  it("מחלקות פריסה של הקורא נשמרות, ודריסה גוברת", () => {
    expect(cardClasses("flex flex-col gap-2")).toContain("flex flex-col gap-2");
    // twMerge פותר לפי סדר הכתיבה ולא לפי סדר ה-CSS — דריסה לא נכשלת בשקט.
    expect(cardClasses("p-6")).toContain("p-6");
    expect(cardClasses("p-6")).not.toContain("p-4");
  });

  it("שלוש רמות הריפוד נבדלות זו מזו", () => {
    const sizes = (["compact", "default", "roomy"] as const).map(
      (padding) => cardClasses(undefined, { padding }).match(/\bp-\d\b/)?.[0],
    );
    expect(new Set(sizes).size).toBe(3);
  });
});

describe("Chip", () => {
  it("‏`soft` נושא מסגרת, `solid` מילוי — תגית שנבחרה מול מידע", () => {
    expect(chipClasses("brand", "soft")).toContain("border");
    expect(chipClasses("brand", "solid")).toContain("bg-brand");
    expect(chipClasses("brand", "solid")).not.toContain("bg-brand/10");
  });

  it("‏`neutralStrong` נבדל מ-`neutral` — ״נצפה״ אינו ״נשלח״", () => {
    // האיחוד היה מוחק את ההבדל בין ״שלחתי לו״ ל״הוא ראה״, שהוא בדיוק המידע
    // שמנהל העבודה מחפש.
    expect(chipClasses("neutral")).toContain("text-muted");
    expect(chipClasses("neutralStrong")).toContain("text-fg");
  });

  it("שני הגדלים קיימים, ושניהם על החריג המאושר של הריפוד", () => {
    expect(chipClasses("brand", "soft", "default")).toContain("text-xs");
    expect(chipClasses("brand", "soft", "large")).toContain("text-sm");
  });

  it("מרונדר כטקסט", () => {
    render(<Chip tone="success">הסתיים</Chip>);
    expect(screen.getByText("הסתיים")).toBeInTheDocument();
  });
});

describe("תגי סטטוס", () => {
  it("שיוך שהוסר נשאר קריא, עם קו חוצה", () => {
    render(<AssignmentStatusChip status="REMOVED" />);
    // הוא נשאר מוצג בכוונה: "שלחתי לו והוא לא הגיב" הוא מידע היסטורי.
    expect(screen.getByText("הוסר").className).toContain("line-through");
  });

  it("שיוך פעיל אינו מקבל קו חוצה", () => {
    render(<AssignmentStatusChip status="SENT" />);
    expect(screen.getByText("נשלח").className).not.toContain("line-through");
  });

  it("״נצפה״ נבדל מ״נשלח״ גם אחרי האיחוד", () => {
    const { rerender } = render(<AssignmentStatusChip status="SENT" />);
    const sent = screen.getByText("נשלח").className;

    rerender(<AssignmentStatusChip status="VIEWED" />);
    expect(screen.getByText("נצפה").className).not.toBe(sent);
  });

  it("סטטוס חוסם נקרא כאדום, וסיום כירוק", () => {
    // טיוטה היא "עבודה בשטח עצורה" (§ Colors). היא תפסה את מקומו של
    // ‏"ממתין לפותח (שאלה)" כשהסטטוס הזה בוטל ב-0.4.
    const { rerender } = render(<TicketStatusChip status="DRAFT" />);
    expect(screen.getByText("טיוטה").className).toContain("danger");

    rerender(<TicketStatusChip status="AWAITING_OPENER_APPROVAL" />);
    expect(screen.getByText(/אישור|ממתין/).className).toContain("success");
  });
});

describe("EmptyState", () => {
  it("מציג הסבר, בלי פעולה כשלא נמסרה", () => {
    render(<EmptyState>אין פניות להצגה</EmptyState>);

    expect(screen.getByText("אין פניות להצגה")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("מציג פעולה כשנמסרה — מצב ריק מזמין לפעולה", () => {
    render(
      <EmptyState action={<button type="button">פנייה חדשה</button>}>אין פניות</EmptyState>,
    );
    expect(screen.getByRole("button", { name: "פנייה חדשה" })).toBeInTheDocument();
  });
});
