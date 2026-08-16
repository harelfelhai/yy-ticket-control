import { describe, expect, it } from "vitest";
import { type BoardCard, isSortKey, nextSort, sortCards } from "@/lib/board-view";

/**
 * מיון לפי עמודה בטבלת הלוח (הכרעת 0.4, §7 שורה 30).
 *
 * הטענה שנבדקת כאן היא לא "המיון ממיין" אלא **שהמצב השלישי קיים ומחזיר
 * לסדר המערכת**. בלעדיו המיון הוא דלת חד-כיוונית: הוא מבטל את דירוג
 * הדחיפות שהלוח בנוי עליו, ואינו מציע דרך חזרה.
 */

function card(overrides: Partial<BoardCard> = {}): BoardCard {
  return {
    id: Math.random().toString(36).slice(2),
    seq: 1,
    buildingName: "בניין א",
    apartmentNumber: "1",
    domainName: "חשמל",
    descriptionLine: "תקלה",
    channel: "SELF",
    recipientNames: [],
    status: "NEW",
    section: "WITH_RECIPIENTS",
    reason: "נשלח, טרם נצפה",
    ageDays: 0,
    reopened: false,
    escalated: false,
    createdAt: new Date("2026-03-01T00:00:00Z"),
    ...overrides,
  };
}

const seqs = (cards: BoardCard[]) => cards.map((c) => c.seq);

describe("nextSort — המחזור התלת-מצבי", () => {
  it("לחיצה ראשונה ממיינת בעולה", () => {
    expect(nextSort(null, "domain")).toEqual({ key: "domain", direction: "asc" });
  });

  it("לחיצה שנייה הופכת ליורד", () => {
    expect(nextSort({ key: "domain", direction: "asc" }, "domain")).toEqual({
      key: "domain",
      direction: "desc",
    });
  });

  it("לחיצה שלישית מחזירה לסדר המערכת", () => {
    expect(nextSort({ key: "domain", direction: "desc" }, "domain")).toBeNull();
  });

  it("לחיצה על עמודה אחרת מתחילה מחדש בעולה ואינה יורשת כיוון", () => {
    // ירידה שנגררת לעמודה חדשה נקראת כתקלה: המשתמש לחץ פעם אחת וקיבל
    // סדר הפוך בלי שביקש.
    expect(nextSort({ key: "domain", direction: "desc" }, "location")).toEqual({
      key: "location",
      direction: "asc",
    });
  });
});

describe("sortCards", () => {
  it("בלי מיון מחזיר את הסדר כפי שהוא — זה המצב השלישי", () => {
    const cards = [card({ seq: 3 }), card({ seq: 1 }), card({ seq: 2 })];
    expect(seqs(sortCards(cards, null))).toEqual([3, 1, 2]);
  });

  it("אינו משנה את המערך המקורי", () => {
    const cards = [card({ seq: 3, domainName: "ריצוף" }), card({ seq: 1, domainName: "חשמל" })];
    sortCards(cards, { key: "domain", direction: "asc" });
    expect(seqs(cards)).toEqual([3, 1]);
  });

  it("מיון מיקום הוא בניין ואז דירה, ודירה 10 באה אחרי דירה 2", () => {
    const cards = [
      card({ seq: 1, buildingName: "בניין א", apartmentNumber: "10" }),
      card({ seq: 2, buildingName: "בניין א", apartmentNumber: "2" }),
      card({ seq: 3, buildingName: "אבן גבירול", apartmentNumber: "5" }),
    ];
    expect(seqs(sortCards(cards, { key: "location", direction: "asc" }))).toEqual([3, 2, 1]);
  });

  it("ערך ריק יורד לסוף בשני הכיוונים", () => {
    const cards = [
      card({ seq: 1, domainName: null }),
      card({ seq: 2, domainName: "חשמל" }),
      card({ seq: 3, domainName: "אינסטלציה" }),
    ];
    expect(seqs(sortCards(cards, { key: "domain", direction: "asc" }))).toEqual([3, 2, 1]);
    // ביורד הריק **אינו** קופץ לראש: "אין תחום" אינו ערך קיצון, הוא היעדר.
    expect(seqs(sortCards(cards, { key: "domain", direction: "desc" }))).toEqual([2, 3, 1]);
  });

  it("המיון יציב — שוויון שומר על סדר המערכת בין השווים", () => {
    const cards = [
      card({ seq: 7, domainName: "חשמל" }),
      card({ seq: 3, domainName: "חשמל" }),
      card({ seq: 5, domainName: "חשמל" }),
    ];
    expect(seqs(sortCards(cards, { key: "domain", direction: "asc" }))).toEqual([7, 3, 5]);
  });

  it("ממיין לפי נמענים ולפי תיאור", () => {
    const byRecipients = [
      card({ seq: 1, recipientNames: ["רון"] }),
      card({ seq: 2, recipientNames: ["אבי", "בני"] }),
    ];
    expect(seqs(sortCards(byRecipients, { key: "recipients", direction: "asc" }))).toEqual([2, 1]);

    const byDescription = [
      card({ seq: 1, descriptionLine: "נזילה במטבח" }),
      card({ seq: 2, descriptionLine: "אין חשמל בסלון" }),
    ];
    expect(seqs(sortCards(byDescription, { key: "description", direction: "asc" }))).toEqual([
      2, 1,
    ]);
  });

  it("פנייה בלי תיאור יורדת לסוף בשני הכיוונים", () => {
    // המקרה השכיח הוא **טיוטה**: היא נשמרת לפני שנכתב תיאור, וסדר יורד
    // שהיה מקפיץ אותה לראש היה ממלא את ראש הטבלה בשורות ריקות.
    const cards = [
      card({ seq: 1, descriptionLine: "" }),
      card({ seq: 2, descriptionLine: "נזילה" }),
      card({ seq: 3, descriptionLine: "אריח שבור" }),
    ];
    expect(seqs(sortCards(cards, { key: "description", direction: "asc" }))).toEqual([3, 2, 1]);
    expect(seqs(sortCards(cards, { key: "description", direction: "desc" }))).toEqual([2, 3, 1]);
  });
});

describe("isSortKey — מה שמגיע מהכתובת אינו נאמן", () => {
  it("מקבל מפתח מוכר ודוחה כל דבר אחר", () => {
    expect(isSortKey("location")).toBe(true);
    expect(isSortKey("צבע")).toBe(false);
    expect(isSortKey(undefined)).toBe(false);
  });

  it("מפתח שירד ב-0.5 נקרא כ'בלי מיון' ולא מפיל את המסך", () => {
    // קישור שנשמר לפני 0.5 עדיין נושא `?sort=seq` או `?sort=status`.
    expect(isSortKey("seq")).toBe(false);
    expect(isSortKey("status")).toBe(false);
    expect(isSortKey("reason")).toBe(false);
  });
});
