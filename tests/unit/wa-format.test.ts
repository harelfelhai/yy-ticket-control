import { describe, expect, it } from "vitest";
import { whatsappBold } from "@/lib/whatsapp/format";

/**
 * ההדגשה של וואטסאפ כמקטעים (`whatsapp/format.ts`) — ההפך של `render.ts`, כדי
 * ששיחת הוואטסאפ במסך 7 תציג את מה שהשולח ראה ולא כוכביות.
 */
describe("whatsappBold", () => {
  it("כותרת מודגשת בהודעת אישור — כמו ש-render.ts כותב אותה", () => {
    expect(whatsappBold("*בטיוטה עכשיו:*\nאתר: נווה שאנן")).toEqual([
      { text: "בטיוטה עכשיו:", bold: true },
      { text: "\nאתר: נווה שאנן", bold: false },
    ]);
  });

  it("כמה הדגשות באותה שורה, והטקסט שביניהן נשמר כמו שהוא", () => {
    expect(whatsappBold("א *ב* ג *ד*")).toEqual([
      { text: "א ", bold: false },
      { text: "ב", bold: true },
      { text: " ג ", bold: false },
      { text: "ד", bold: true },
    ]);
  });

  it.each([
    ["כוכבית שאחריה רווח", "5 * 3 = 15"],
    ["רווח לפני הכוכבית הסוגרת", "*לא מודגש *"],
    ["מקטע שחוצה שורה", "*שורה\nשנייה*"],
    ["כוכביות ריקות", "**"],
    ["כוכבית בודדת", "כוכבית * לבד"],
  ])("%s — אינה הדגשה, והטקסט נשאר כמו שהוא", (_name, text) => {
    expect(whatsappBold(text)).toEqual([{ text, bold: false }]);
  });

  it("טקסט בלי הדגשה — מקטע אחד", () => {
    expect(whatsappBold("תקלה בדירה 12")).toEqual([{ text: "תקלה בדירה 12", bold: false }]);
  });

  it("טקסט ריק — אין מקטעים", () => {
    expect(whatsappBold("")).toEqual([]);
  });
});
