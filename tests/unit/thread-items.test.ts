import { describe, expect, it } from "vitest";
import { type ThreadSourceMessage, buildThreadItems } from "@/lib/thread-items";
import type { ThreadMessageView } from "@/lib/thread-view";

/**
 * הרכבת השרשור עם מפרידי יום.
 *
 * הלוגיקה הזו נבדקת כאן ולא במסך, כי היא בדיוק הסוג שנשבר בשקט: מפריד יום
 * שגוי נראה כמו מפריד יום תקין, ואף צילום מסך לא יגלה שהוא מחושב לפי שעון
 * המכונה במקום לפי שעון ישראל.
 */

const LABELS = { today: "היום", yesterday: "אתמול" };

function view(id: string, at: Date, text = "שלום"): ThreadMessageView {
  return { id, authorName: "יוסי", own: false, text, media: [], createdAt: at };
}

function message(id: string, at: Date): ThreadSourceMessage {
  return {
    id,
    kind: "TEXT",
    eventType: null,
    eventMeta: null,
    createdAt: at,
    view: view(id, at),
  };
}

function event(id: string, at: Date): ThreadSourceMessage {
  return {
    id,
    kind: "EVENT",
    eventType: "CLOSED",
    eventMeta: { name: "יוסי" },
    createdAt: at,
    view: view(id, at, null as unknown as string),
  };
}

// ‏12:00 בשעון ישראל, כדי שהבדיקות לא יתלו בהיסט הקיץ/חורף.
const NOW = new Date("2026-08-14T09:00:00.000Z");
const TODAY = new Date("2026-08-14T07:00:00.000Z");
const YESTERDAY = new Date("2026-08-13T07:00:00.000Z");
const LAST_WEEK = new Date("2026-08-07T07:00:00.000Z");

describe("buildThreadItems", () => {
  it("ההודעה הפותחת היא הראשונה בשרשור, אחרי מפריד היום שלה", () => {
    const items = buildThreadItems({
      opening: view("opening", YESTERDAY, "אין חשמל בממ״ד"),
      messages: [message("m1", TODAY)],
      now: NOW,
      labels: LABELS,
    });

    expect(items.map((i) => i.kind)).toEqual(["day", "message", "day", "message"]);
    expect(items[0]).toMatchObject({ kind: "day", label: "אתמול" });
    expect(items[1]).toMatchObject({ kind: "message", key: "opening" });
    expect(items[2]).toMatchObject({ kind: "day", label: "היום" });
  });

  it("פנייה בלי תיאור אינה מייצרת בועה ריקה", () => {
    const items = buildThreadItems({
      opening: null,
      messages: [message("m1", TODAY)],
      now: NOW,
      labels: LABELS,
    });

    expect(items.filter((i) => i.kind === "message")).toHaveLength(1);
  });

  it("מפריד יום מופיע פעם אחת ליום, לא לכל הודעה", () => {
    const items = buildThreadItems({
      opening: null,
      messages: [
        message("m1", TODAY),
        message("m2", new Date(TODAY.getTime() + 60_000)),
        message("m3", new Date(TODAY.getTime() + 120_000)),
      ],
      now: NOW,
      labels: LABELS,
    });

    expect(items.filter((i) => i.kind === "day")).toHaveLength(1);
  });

  it("תאריך מלא ליום שאינו היום או אתמול", () => {
    const items = buildThreadItems({
      opening: null,
      messages: [message("m1", LAST_WEEK)],
      now: NOW,
      labels: LABELS,
    });

    const day = items[0];
    expect(day.kind).toBe("day");
    // לא "היום" ולא "אתמול" — תאריך שאפשר לקרוא.
    expect(day.kind === "day" && day.label).toMatch(/7/);
  });

  it("אירוע מערכת נשמר כפריט נפרד ואינו בועה", () => {
    const items = buildThreadItems({
      opening: null,
      messages: [message("m1", TODAY), event("e1", TODAY)],
      now: NOW,
      labels: LABELS,
    });

    expect(items.map((i) => i.kind)).toEqual(["day", "message", "event"]);
  });

  it("אירוע גם הוא פותח יום חדש — הוא קרה, ולכן שייך לציר הזמן", () => {
    const items = buildThreadItems({
      opening: null,
      messages: [message("m1", YESTERDAY), event("e1", TODAY)],
      now: NOW,
      labels: LABELS,
    });

    expect(items.map((i) => i.kind)).toEqual(["day", "message", "day", "event"]);
  });

  it("שרשור ריק לגמרי מחזיר רשימה ריקה, בלי מפריד יתום", () => {
    expect(buildThreadItems({ opening: null, messages: [], now: NOW, labels: LABELS })).toEqual([]);
  });

  it("מפתחות ייחודיים — אחרת React ממחזר בועות בין הודעות", () => {
    const items = buildThreadItems({
      opening: view("opening", YESTERDAY),
      messages: [message("m1", YESTERDAY), message("m2", TODAY)],
      now: NOW,
      labels: LABELS,
    });

    const keys = items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
