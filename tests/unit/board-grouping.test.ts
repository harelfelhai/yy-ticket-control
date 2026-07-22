import { describe, expect, it } from "vitest";
import { type BoardCard, groupForTour } from "@/lib/board-view";

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
    createdAt: new Date("2026-03-01T00:00:00Z"),
    ...overrides,
  };
}

describe("groupForTour — מצב סיור", () => {
  it("מקבץ פניות של אותה דירה יחד", () => {
    const { groups } = groupForTour([
      card({ buildingName: "בניין א", apartmentNumber: "1" }),
      card({ buildingName: "בניין א", apartmentNumber: "1" }),
      card({ buildingName: "בניין א", apartmentNumber: "2" }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.cards).toHaveLength(2);
    expect(groups[0]?.label).toBe("בניין א · דירה 1");
  });

  it("אותו מספר דירה בשני בניינים הוא שתי קבוצות", () => {
    const { groups } = groupForTour([
      card({ buildingName: "בניין א", apartmentNumber: "1" }),
      card({ buildingName: "בניין ב", apartmentNumber: "1" }),
    ]);

    expect(groups).toHaveLength(2);
  });

  it("מפריד טיוטות ואינו מכניס אותן לקיבוץ", () => {
    // לטיוטה אין בניין ודירה. הצגתה תחת "ללא מיקום" הייתה קוברת בדיוק את
    // מה שדורש השלמה.
    const { drafts, groups } = groupForTour([
      card({ buildingName: null, apartmentNumber: null, status: "DRAFT" }),
      card({ buildingName: "בניין א", apartmentNumber: "1" }),
    ]);

    expect(drafts).toHaveLength(1);
    expect(groups).toHaveLength(1);
  });

  it("פנייה עם בניין בלי דירה נחשבת חסרת מיקום", () => {
    const { drafts, groups } = groupForTour([
      card({ buildingName: "בניין א", apartmentNumber: null }),
    ]);

    expect(drafts).toHaveLength(1);
    expect(groups).toHaveLength(0);
  });

  it("ממיין את הקבוצות לפי מסלול פיזי ולא לפי סדר הפתיחה", () => {
    const { groups } = groupForTour([
      card({ buildingName: "בניין ב", apartmentNumber: "1" }),
      card({ buildingName: "בניין א", apartmentNumber: "10" }),
      card({ buildingName: "בניין א", apartmentNumber: "2" }),
    ]);

    expect(groups.map((g) => g.label)).toEqual([
      "בניין א · דירה 2",
      "בניין א · דירה 10",
      "בניין ב · דירה 1",
    ]);
  });

  it("רשימה ריקה מחזירה קבוצות ריקות ולא נופלת", () => {
    expect(groupForTour([])).toEqual({ drafts: [], groups: [] });
  });
});
