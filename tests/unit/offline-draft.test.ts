import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type OfflineDraft,
  clearDraft,
  isEmptyDraft,
  isNetworkFailure,
  loadDraft,
  resolveDraftSite,
  saveDraft,
} from "@/lib/offline-draft";

/**
 * השמירה המקומית של טופס הפנייה — המימוש של "פנייה לא הולכת לאיבוד".
 *
 * ‏fake-indexeddb ולא mock ידני: זהו מימוש מלא של המפרט, ולכן הבדיקות
 * מאמתות את הקוד שרץ באמת ולא את ההנחות שלי לגבי IndexedDB. mock היה
 * מאשר בשמחה גם שימוש שגוי ב-API.
 */

function draft(overrides: Partial<OfflineDraft> = {}): OfflineDraft {
  return {
    siteId: "site-1",
    buildingId: "b-1",
    apartmentId: "a-1",
    domainId: "d-1",
    room: null,
    description: "אין חשמל בסלון",
    recipientIds: [{ kind: "professional", id: "p-1" }],
    mediaIds: [],
    savedAt: Date.now(),
    pending: false,
    ...overrides,
  };
}

beforeEach(async () => {
  await clearDraft();
});

describe("שמירה וטעינה", () => {
  it("מחזיר את מה שנשמר", async () => {
    await saveDraft(draft());

    const loaded = await loadDraft();
    expect(loaded?.description).toBe("אין חשמל בסלון");
    expect(loaded?.recipientIds).toEqual([{ kind: "professional", id: "p-1" }]);
  });

  it("שמירה חוזרת דורסת ואינה מצטברת", async () => {
    await saveDraft(draft({ description: "ראשון" }));
    await saveDraft(draft({ description: "שני" }));

    expect((await loadDraft())?.description).toBe("שני");
  });

  it("מחזיר null כשאין טיוטה", async () => {
    expect(await loadDraft()).toBeNull();
  });

  it("מנקה", async () => {
    await saveDraft(draft());
    await clearDraft();
    expect(await loadDraft()).toBeNull();
  });

  it("שומר את סימון ההמתנה לשיגור חוזר", async () => {
    // זו ההבחנה בין "הקלדתי ולא סיימתי" לבין "לחצתי שלח ולא הייתה קליטה".
    await saveDraft(draft({ pending: true }));
    expect((await loadDraft())?.pending).toBe(true);
  });
});

describe("התיישנות", () => {
  it("מתעלם מטיוטה בת יותר מיממה, ומוחק אותה", async () => {
    // טיוטה כזו כנראה נזנחה, ושחזור שלה מבלבל יותר משהוא עוזר.
    const old = Date.now() - 25 * 60 * 60 * 1000;
    await saveDraft(draft({ savedAt: old }));

    expect(await loadDraft()).toBeNull();
    // גם אחרי בדיקה מאותו רגע היא כבר לא שם — היא נמחקה ולא רק הוסתרה.
    expect(await loadDraft(old + 1000)).toBeNull();
  });

  it("שומר טיוטה מלפני שעה", async () => {
    await saveDraft(draft({ savedAt: Date.now() - 60 * 60 * 1000 }));
    expect(await loadDraft()).not.toBeNull();
  });
});

describe("isEmptyDraft", () => {
  it("מזהה טופס שלא נגעו בו", async () => {
    // בלי זה כל כניסה למסך הייתה כותבת טיוטה ריקה, וכל כניסה הבאה הייתה
    // "משחזרת" אותה ומציגה באנר על לא כלום.
    expect(
      isEmptyDraft(
        draft({
          buildingId: null,
          apartmentId: null,
          domainId: null,
          description: "   ",
          recipientIds: [],
        }),
      ),
    ).toBe(true);
  });

  it("תיאור לבדו מספיק כדי שיהיה מה לשמור", async () => {
    expect(
      isEmptyDraft(
        draft({
          buildingId: null,
          apartmentId: null,
          domainId: null,
          description: "משהו",
          recipientIds: [],
        }),
      ),
    ).toBe(false);
  });

  it("קובץ מצורף לבדו מספיק", async () => {
    // הצילום הוא המידע שהכי קשה לשחזר.
    expect(
      isEmptyDraft(
        draft({
          buildingId: null,
          apartmentId: null,
          domainId: null,
          description: "",
          recipientIds: [],
          mediaIds: ["m-1"],
        }),
      ),
    ).toBe(false);
  });
});

describe("isNetworkFailure", () => {
  it("מזהה כשל רשת של fetch", () => {
    // ההבחנה קובעת מה קורה אחר כך: כשל תקשורת מנסה שוב, שגיאה עסקית לא.
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("אינו מזהה שגיאה עסקית ככשל רשת", () => {
    // "לא ניתן לשגר — חסר תחום" הוא משהו שרק המשתמש יכול לתקן, וניסיון
    // חוזר עליו הוא לולאה אינסופית שקטה.
    expect(isNetworkFailure(new Error("לא ניתן לשגר — חסר תחום"))).toBe(false);
  });
});

/**
 * הכלל הזה **התהפך** כשהאתר הפך משדה במסך שקדם לטופס לשדה בתוכו, והוא
 * נכתב כאן דווקא מפני שקודם לא היה לו אוכף: התנאי ישב בתוך הקומפוננטה
 * (`create-ticket-form.tsx`), אף בדיקה לא נגעה בו, והחלפתו לא הייתה
 * מאדימה דבר.
 */
describe("resolveDraftSite", () => {
  it("טיוטה קובעת את האתר, גם כשהמסך נפתח על אחר", () => {
    // זה השינוי עצמו: קודם טיוטה כזו נזרקה, והמשתמש איבד מה שהקליד.
    expect(resolveDraftSite("site-2", ["site-1", "site-2"])).toBe("site-2");
  });

  it("טיוטה בלי אתר אינה דורסת את בחירת המסך", () => {
    // הוקלד תיאור לפני שנבחר אתר — אין כאן החלטה לשחזר.
    expect(resolveDraftSite(null, ["site-1"])).toBeUndefined();
  });

  it("אתר שאינו מוצע עוד למשתמש דוחה את הטיוטה כולה", () => {
    // ‏null ולא undefined: הבניין והדירה שבטיוטה שייכים לאתר שאינו שלו,
    // ושחזורם היה נכשל בשיגור בלי שיבין למה.
    expect(resolveDraftSite("site-9", ["site-1", "site-2"])).toBeNull();
  });

  it("רשימת אתרים ריקה דוחה כל טיוטה עם אתר", () => {
    expect(resolveDraftSite("site-1", [])).toBeNull();
  });
});
