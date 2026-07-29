import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type DraftCompletionSnapshot,
  clearCompletion,
  isEmptyCompletion,
  loadCompletion,
  saveCompletion,
} from "@/lib/draft-completion-store";
import { clearDraft, loadDraft, saveDraft } from "@/lib/offline-draft";

/**
 * השמירה המקומית של מצב השלמת הטיוטה — המימוש של "מה שהוקלד לא אבד ב-
 * re-mount". ‏fake-indexeddb ולא mock: מימוש מלא של המפרט, כך שהבדיקות
 * מאמתות את הקוד שרץ באמת ולא הנחות על ה-API.
 */

function snapshot(overrides: Partial<DraftCompletionSnapshot> = {}): DraftCompletionSnapshot {
  return {
    ticketId: "t-1",
    buildingId: "b-1",
    apartmentId: "a-1",
    domainId: "d-1",
    description: "אין חשמל בסלון",
    recipientIds: [{ kind: "professional", id: "p-1" }],
    savedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(async () => {
  await clearCompletion("t-1");
  await clearCompletion("t-2");
});

describe("שמירה וטעינה", () => {
  it("מחזיר את מה שנשמר", async () => {
    await saveCompletion(snapshot());

    const loaded = await loadCompletion("t-1");
    expect(loaded?.domainId).toBe("d-1");
    expect(loaded?.description).toBe("אין חשמל בסלון");
    expect(loaded?.recipientIds).toEqual([{ kind: "professional", id: "p-1" }]);
  });

  it("שמירה חוזרת דורסת ואינה מצטברת", async () => {
    await saveCompletion(snapshot({ description: "ראשון" }));
    await saveCompletion(snapshot({ description: "שני" }));

    expect((await loadCompletion("t-1"))?.description).toBe("שני");
  });

  it("מחזיר null כשאין snapshot", async () => {
    expect(await loadCompletion("t-1")).toBeNull();
  });

  it("מנקה", async () => {
    await saveCompletion(snapshot());
    await clearCompletion("t-1");
    expect(await loadCompletion("t-1")).toBeNull();
  });
});

describe("בידוד פר-פנייה", () => {
  it("snapshot של פנייה אחת אינו דולף לאחרת", async () => {
    // שתי טיוטות פתוחות בכרטיסיות שונות — לכל אחת מצב השלמה משלה.
    await saveCompletion(snapshot({ ticketId: "t-1", domainId: "חשמל" }));
    await saveCompletion(snapshot({ ticketId: "t-2", domainId: "אינסטלציה" }));

    expect((await loadCompletion("t-1"))?.domainId).toBe("חשמל");
    expect((await loadCompletion("t-2"))?.domainId).toBe("אינסטלציה");
  });

  it("ניקוי פנייה אחת אינו נוגע באחרת", async () => {
    await saveCompletion(snapshot({ ticketId: "t-1" }));
    await saveCompletion(snapshot({ ticketId: "t-2" }));

    await clearCompletion("t-1");

    expect(await loadCompletion("t-1")).toBeNull();
    expect(await loadCompletion("t-2")).not.toBeNull();
  });
});

describe("בידוד מטיוטת טופס-היצירה", () => {
  it("אינו מתנגש ב-offline-draft באותה חנות IndexedDB", async () => {
    // שני הצרכנים חולקים חנות אחת; המפתחות שונים ולכן אינם דורסים זה את זה.
    await saveDraft({
      siteId: "s-1",
      buildingId: null,
      apartmentId: null,
      domainId: null,
      room: null,
      description: "טיוטת יצירה",
      recipientIds: [],
      mediaIds: [],
      savedAt: Date.now(),
      pending: false,
    });
    await saveCompletion(snapshot({ description: "מצב השלמה" }));

    expect((await loadDraft())?.description).toBe("טיוטת יצירה");
    expect((await loadCompletion("t-1"))?.description).toBe("מצב השלמה");

    await clearDraft();
  });
});

describe("התיישנות", () => {
  it("מתעלם מ-snapshot בן יותר מיממה, ומוחק אותו", async () => {
    const old = Date.now() - 25 * 60 * 60 * 1000;
    await saveCompletion(snapshot({ savedAt: old }));

    expect(await loadCompletion("t-1")).toBeNull();
    // נמחק ולא רק הוסתר — גם בדיקה מאותו רגע לא מוצאת אותו.
    expect(await loadCompletion("t-1", old + 1000)).toBeNull();
  });

  it("שומר snapshot מלפני שעה", async () => {
    await saveCompletion(snapshot({ savedAt: Date.now() - 60 * 60 * 1000 }));
    expect(await loadCompletion("t-1")).not.toBeNull();
  });
});

describe("isEmptyCompletion", () => {
  it("מזהה מצב שאין בו מה לשמור", async () => {
    expect(
      isEmptyCompletion(
        snapshot({
          buildingId: null,
          apartmentId: null,
          domainId: null,
          description: "   ",
          recipientIds: [],
        }),
      ),
    ).toBe(true);
  });

  it("תחום שנבחר לבדו מספיק כדי שיהיה מה לשמור", async () => {
    expect(
      isEmptyCompletion(
        snapshot({
          buildingId: null,
          apartmentId: null,
          domainId: "d-1",
          description: "",
          recipientIds: [],
        }),
      ),
    ).toBe(false);
  });

  it("נמען לבדו מספיק", async () => {
    // איש-מקצוע שנבחר תוך כדי השלמה הוא בדיוק מה שאסור לאבד ב-re-mount.
    expect(
      isEmptyCompletion(
        snapshot({
          buildingId: null,
          apartmentId: null,
          domainId: null,
          description: "",
          recipientIds: [{ kind: "professional", id: "p-9" }],
        }),
      ),
    ).toBe(false);
  });
});
