import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type OfflineDraft,
  clearDraft,
  isEmptyDraft,
  isNetworkFailure,
  loadDraft,
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
