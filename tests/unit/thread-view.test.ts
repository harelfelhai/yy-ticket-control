import { describe, expect, it } from "vitest";
import { toThreadMessageView } from "@/lib/thread-view";

/**
 * ההמרה לצורת התצוגה, ובעיקר חישוב `own` — הצד שאליו הבועה מיושרת.
 *
 * זהו החישוב היחיד ברכיב הבועה שיכול להיות **שגוי בשקט**: בועה בצד הלא נכון
 * נראית כמו בועה תקינה, ורק מי שיודע מי כתב מה יזהה את זה.
 */

const AT = new Date("2026-08-14T07:00:00.000Z");

describe("toThreadMessageView", () => {
  it("הודעה של הצופה מסומנת own", () => {
    const view = toThreadMessageView(
      { id: "m1", text: "שלום", createdAt: AT, authorUser: { id: "u1", name: "יעל" }, authorProfessional: null },
      [],
      { userId: "u1" },
    );
    expect(view.own).toBe(true);
  });

  it("הודעה של משתמש אחר אינה own", () => {
    const view = toThreadMessageView(
      { id: "m1", text: "שלום", createdAt: AT, authorUser: { id: "u2", name: "דנה" }, authorProfessional: null },
      [],
      { userId: "u1" },
    );
    expect(view.own).toBe(false);
    expect(view.authorName).toBe("דנה");
  });

  it("קבלן וצופה פנימי אינם חולקים מרחב מזהים — מזהה זהה אינו הופך אותם לאותו אדם", () => {
    // תרחיש קצה אמיתי: שני cuid-ים ממודלים שונים יכולים להיות שווים רק
    // במקרה, אבל השוואה לא-מסויגת הייתה מייחסת לצופה הודעה של קבלן.
    const view = toThreadMessageView(
      { id: "m1", text: "בדרך", createdAt: AT, authorUser: null, authorProfessional: { id: "x", name: "יוסי" } },
      [],
      { userId: "x" },
    );
    expect(view.own).toBe(false);
  });

  it("כשמזהה הכותב לא נשלף כלל — own הוא false ולא קריסה", () => {
    // זה בדיוק מה שהפורטל וצ׳אט התגית עושים: הם בוחרים `{name}` בלבד.
    const view = toThreadMessageView(
      { id: "m1", text: "בדרך", createdAt: AT, authorUser: { name: "יוסי" }, authorProfessional: null },
      [],
      { userId: "u1" },
    );
    expect(view.own).toBe(false);
    expect(view.authorName).toBe("יוסי");
  });

  it("בלי צופה כלל — כל ההודעות אחידות", () => {
    const view = toThreadMessageView(
      { id: "m1", text: "בדרך", createdAt: AT, authorUser: { id: "u1", name: "יעל" }, authorProfessional: null },
      [],
    );
    expect(view.own).toBe(false);
  });

  it("שם הכותב נופל לאיש המקצוע כשאין משתמש", () => {
    const view = toThreadMessageView(
      { id: "m1", text: null, createdAt: AT, authorUser: null, authorProfessional: { id: "p1", name: "יוסי חשמלאי" } },
      [],
      { professionalId: "p1" },
    );
    expect(view.authorName).toBe("יוסי חשמלאי");
    expect(view.own).toBe(true);
  });
});
