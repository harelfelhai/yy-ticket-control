import { describe, expect, it } from "vitest";
import {
  type BoardCard,
  SECTION_PAGE_SIZE,
  boardHref,
  sectionLimit,
  visibleCards,
} from "@/lib/board-view";

/**
 * תקרת התצוגה של קבוצה בלוח — "טען עוד" (ספק #38, הכרעת 0.9).
 *
 * שתי הטענות המרכזיות: (א) **החיתוך בא אחרי המיון** — "20 הראשונים" הם לפי
 * הסדר שהמשתמש רואה, לא לפי סדר ההכנסה; (ב) בונה הכתובות משמר את שאר מצב
 * הלוח — מסננים, תצוגה ומיון — כך ש"טען עוד" אינו מוחק דבר בדרך.
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

describe("sectionLimit — קריאת התקרה מהכתובת", () => {
  it("חסר מחזיר את ברירת המחדל", () => {
    expect(sectionLimit(undefined)).toBe(SECTION_PAGE_SIZE);
  });

  it("ערך תקין מתקבל", () => {
    expect(sectionLimit("40")).toBe(40);
  });

  it.each(["abc", "0", "-3", "2.5", ""])("ערך פגום (%j) נקרא כברירת המחדל", (value) => {
    // הכתובת היא קלט חיצוני — אותו כלל סלחני כמו `isSortKey`: קישור שבור
    // אינו מפיל מסך ואינו מרוקן אותו.
    expect(sectionLimit(value)).toBe(SECTION_PAGE_SIZE);
  });
});

describe("visibleCards — מיון ואז חיתוך", () => {
  it("בלי תקרה מחזיר הכול, בסדר המערכת", () => {
    const cards = [card({ seq: 1 }), card({ seq: 2 }), card({ seq: 3 })];
    expect(visibleCards(cards, null).map((c) => c.seq)).toEqual([1, 2, 3]);
  });

  it("עם תקרה מחזיר את הראשונים בסדר המערכת", () => {
    const cards = Array.from({ length: 25 }, (_, i) => card({ seq: i + 1 }));
    const visible = visibleCards(cards, null, 20);
    expect(visible).toHaveLength(20);
    expect(visible[0]?.seq).toBe(1);
    expect(visible[19]?.seq).toBe(20);
  });

  it("החיתוך בא אחרי המיון: מי שראשון בהכנסה ואחרון במיון נחתך", () => {
    // כרטיס שנכנס ראשון אך שמו האחרון באלף-בית חייב להיחתך כשהתקרה קטנה
    // מהרשימה — חיתוך לפני מיון היה משאיר אותו ומסלק את הראשון האמיתי.
    const last = card({ seq: 99, domainName: "תריסים" });
    const rest = Array.from({ length: 20 }, (_, i) =>
      card({ seq: i + 1, domainName: `אינסטלציה ${String(i + 1).padStart(2, "0")}` }),
    );
    const visible = visibleCards([last, ...rest], { key: "domain", direction: "asc" }, 20);
    expect(visible).toHaveLength(20);
    expect(visible.map((c) => c.seq)).not.toContain(99);
  });

  it("תקרה גדולה מהרשימה מחזירה את כולה", () => {
    const cards = [card({ seq: 1 }), card({ seq: 2 })];
    expect(visibleCards(cards, null, 20)).toHaveLength(2);
  });
});

describe("boardHref — בונה הכתובות של הלוח", () => {
  it("משמר מסננים, תצוגה ומיון קיימים ומוסיף את הדריסה", () => {
    const href = boardHref(
      { site: "s1", view: "table", sort: "domain", dir: "asc" },
      { moreArchive: "40" },
    );
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("site")).toBe("s1");
    expect(params.get("view")).toBe("table");
    expect(params.get("sort")).toBe("domain");
    expect(params.get("dir")).toBe("asc");
    expect(params.get("moreArchive")).toBe("40");
  });

  it("דריסת null מוחקת פרמטר", () => {
    expect(boardHref({ sort: "domain", dir: "asc" }, { sort: null, dir: null })).toBe("/board");
  });

  it("בלי פרמטרים כלל — הכתובת החשופה", () => {
    expect(boardHref({}, {})).toBe("/board");
  });

  it("ערכי מערך וריקים מהכתובת אינם מועתקים", () => {
    // ‏Next מוסר `string[]` כשפרמטר חוזר פעמיים — צורה שאין לה משמעות בלוח,
    // ולכן אינה משועתקת קדימה.
    const href = boardHref({ site: ["a", "b"], building: "", domain: "d1" }, {});
    expect(href).toBe("/board?domain=d1");
  });
});
