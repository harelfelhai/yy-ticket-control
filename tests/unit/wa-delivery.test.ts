import { describe, expect, it } from "vitest";
import type { MessageState } from "@/generated/prisma/enums";
import { waDelivery } from "@/lib/whatsapp/delivery";

/**
 * מצב המסירה של הודעה יוצאת — חישוב אחד למסך 17 (הודעת הבדיקה) ולשיחה במסך 7
 * (הודעות האישור). הנוסח שונה בין המסכים; החישוב לא.
 */

const T = new Date("2026-10-07T10:00:00Z");

function delivery(state: MessageState, at: { deliveredAt?: Date; readAt?: Date } = {}) {
  return waDelivery({ state, deliveredAt: at.deliveredAt ?? null, readAt: at.readAt ?? null });
}

describe("waDelivery", () => {
  it.each<[string, MessageState, { deliveredAt?: Date; readAt?: Date }, string]>([
    ["יצאה, בלי סטטוס מ-Meta — נשלחה", "SENT", {}, "sent"],
    ["נמסרה", "SENT", { deliveredAt: T }, "delivered"],
    ["נקראה גוברת על נמסרה", "SENT", { deliveredAt: T, readAt: T }, "read"],
    ["נקראה גם בלי נמסרה — Meta לא שולחת לפי הסדר", "SENT", { readAt: T }, "read"],
    ["נכשלה", "FAILED", {}, "failed"],
    ["נכשלה גוברת על סטטוס קודם", "FAILED", { deliveredAt: T }, "failed"],
    ["דולגה — לא נשלחה", "SKIPPED", {}, "failed"],
  ])("%s", (_name, state, at, expected) => {
    expect(delivery(state, at)).toBe(expected);
  });
});
