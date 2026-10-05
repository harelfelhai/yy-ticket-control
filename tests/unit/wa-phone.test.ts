import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/normalize";
import { phoneFromWaId } from "@/lib/whatsapp/phone";

/**
 * הטלפון שוואטסאפ מוסרת ← הצורה שבה הוא שמור בכרטיס המשתמש (WA-04, §7 שורה
 * 104). הבדיקה העיקרית היא שהשניים נפגשים: מה שמנהל המערכת הקליד בהקמת
 * משתמש ומה שוואטסאפ מוסרת על אותו טלפון חייבים להיות אותה מחרוזת.
 */
describe("phoneFromWaId", () => {
  it.each([
    ["972501234567", "0501234567"],
    ["972521234567", "0521234567"],
    ["15551234567", "+15551234567"],
  ])("%s ← %s", (waId, expected) => {
    expect(phoneFromWaId(waId)).toBe(expected);
  });

  it.each(["050-1234567", "+972 50 123 4567", "0501234567", "00972501234567"])(
    "פוגש את מה שנשמר בכרטיס — %s",
    (asTyped) => {
      expect(phoneFromWaId("972501234567")).toBe(normalizePhone(asTyped));
    },
  );

  it("בלי מספר — null (משתמש שוואטסאפ הסתירה את הטלפון שלו)", () => {
    expect(phoneFromWaId(null)).toBeNull();
    expect(phoneFromWaId(undefined)).toBeNull();
    expect(phoneFromWaId("")).toBeNull();
    expect(phoneFromWaId("no digits")).toBeNull();
  });
});
