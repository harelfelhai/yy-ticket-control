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
    expect(nextSort({ key: "domain", direction: "desc" }, "status")).toEqual({
      key: "status",
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
    const cards = [card({ seq: 3 }), card({ seq: 1 })];
    sortCards(cards, { key: "seq", direction: "asc" });
    expect(seqs(cards)).toEqual([3, 1]);
  });

  it("ממיין לפי מספר פנייה בשני הכיוונים", () => {
    const cards = [card({ seq: 3 }), card({ seq: 1 }), card({ seq: 2 })];
    expect(seqs(sortCards(cards, { key: "seq", direction: "asc" }))).toEqual([1, 2, 3]);
    expect(seqs(sortCards(cards, { key: "seq", direction: "desc" }))).toEqual([3, 2, 1]);
  });

  it("מיון מיקום הוא בניין ואז דירה, ודירה 10 באה אחרי דירה 2", () => {
    const cards = [
      card({ seq: 1, buildingName: "בניין א", apartmentNumber: "10" }),
      card({ seq: 2, buildingName: "בניין א", apartmentNumber: "2" }),
      card({ seq: 3, buildingName: "אבן גבירול", apartmentNumber: "5" }),
    ];
    expect(seqs(sortCards(cards, { key: "location", direction: "asc" }))).toEqual([3, 2, 1]);
  });

  it("מיון סטטוס הוא לפי דחיפות ולא לפי אלפבית", () => {
    // "שאלה" גוברת על "נצפה" — אותה קדימות שבה `deriveTicketStatus` בודק.
    const cards = [
      card({ seq: 1, status: "CLOSED" }),
      card({ seq: 2, status: "VIEWED" }),
      card({ seq: 3, status: "AWAITING_OPENER_QUESTION" }),
      card({ seq: 4, status: "DRAFT" }),
    ];
    expect(seqs(sortCards(cards, { key: "status", direction: "asc" }))).toEqual([4, 3, 2, 1]);
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

  it("ממיין לפי נמענים ולפי סיבה", () => {
    const byRecipients = [
      card({ seq: 1, recipientNames: ["רון"] }),
      card({ seq: 2, recipientNames: ["אבי", "בני"] }),
    ];
    expect(seqs(sortCards(byRecipients, { key: "recipients", direction: "asc" }))).toEqual([2, 1]);

    const byReason = [card({ seq: 1, reason: "ללא תנועה" }), card({ seq: 2, reason: "דוד מטפל" })];
    expect(seqs(sortCards(byReason, { key: "reason", direction: "asc" }))).toEqual([2, 1]);
  });
});

describe("isSortKey — מה שמגיע מהכתובת אינו נאמן", () => {
  it("מקבל מפתח מוכר ודוחה כל דבר אחר", () => {
    expect(isSortKey("status")).toBe(true);
    expect(isSortKey("צבע")).toBe(false);
    expect(isSortKey(undefined)).toBe(false);
  });
});
