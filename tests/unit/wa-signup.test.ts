import { describe, expect, it } from "vitest";
import { decodeIssue, encodeIssue } from "@/lib/whatsapp/connection-issue";
import { isFacebookOrigin, parseSignupMessage } from "@/lib/whatsapp/signup";

/**
 * ההודעה מחלון החיבור של Meta, וקודי התקלה של החיבור — מסך 17.
 *
 * **המקור הוא גבול אבטחה:** חשבון שנמסר ממקור אחר היה נשלח לשרת כאילו בחר אותו
 * מנהל המערכת. השרת בודק שוב מול הטוקן (`managedWabaIds`), אבל הדף אינו אמור
 * להעביר הלאה הודעה שלא באה מ-facebook.com.
 */

describe("isFacebookOrigin", () => {
  it.each(["https://www.facebook.com", "https://web.facebook.com", "https://facebook.com"])("%s — כן", (origin) => {
    expect(isFacebookOrigin(origin)).toBe(true);
  });

  it.each([
    "https://evilfacebook.com",
    "https://facebook.com.evil.example",
    "http://www.facebook.com",
    "https://www.facebook.co",
    "null",
    "",
  ])("%s — לא", (origin) => {
    expect(isFacebookOrigin(origin)).toBe(false);
  });
});

describe("parseSignupMessage", () => {
  const message = (event: string, data: Record<string, unknown> = {}) =>
    JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event, data, version: 3 });

  it("חיבור מהאפליקציה בטלפון — רק החשבון, ו-coexistence", () => {
    expect(parseSignupMessage(message("FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", { waba_id: "200" }))).toEqual({
      kind: "finish",
      coexistence: true,
      wabaId: "200",
      phoneNumberId: null,
    });
  });

  it("חיבור רגיל (FINISH) — עם המספר, ובלי coexistence", () => {
    expect(parseSignupMessage(message("FINISH", { waba_id: "200", phone_number_id: "300", business_id: "1" }))).toEqual({
      kind: "finish",
      coexistence: false,
      wabaId: "200",
      phoneNumberId: "300",
    });
  });

  it("אובייקט ולא מחרוזת — מתקבל באותה צורה", () => {
    const parsed = parseSignupMessage({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH_ONLY_WABA", data: { waba_id: 200 } });
    expect(parsed).toEqual({ kind: "finish", coexistence: false, wabaId: "200", phoneNumberId: null });
  });

  it("ביטול ושגיאה", () => {
    expect(parseSignupMessage(message("CANCEL", { current_step: "PHONE_NUMBER_SETUP" }))).toEqual({ kind: "cancel" });
    expect(parseSignupMessage(message("ERROR", { error_message: "boom", error_code: "1" }))).toEqual({
      kind: "error",
      message: "boom",
    });
  });

  it.each([
    ["הודעה של מישהו אחר", JSON.stringify({ type: "OTHER", event: "FINISH", data: { waba_id: "1" } })],
    ["סיום בלי חשבון", JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: {} })],
    ["אירוע לא מוכר", JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "SOMETHING", data: {} })],
    ["מחרוזת שאינה JSON", "not json"],
    ["null", null],
  ])("%s — null", (_label, raw) => {
    expect(parseSignupMessage(raw)).toBeNull();
  });
});

describe("קודי התקלה של החיבור", () => {
  it("הלוך ושוב — כולל הסיבה של הניתוק", () => {
    for (const issue of [
      { code: "token_revoked" as const },
      { code: "subscription_lost" as const },
      { code: "partner_removed" as const, reason: "PRIMARY_INACTIVITY" },
      { code: "partner_removed" as const, reason: null },
      { code: "sync_overdue" as const },
    ]) {
      expect(decodeIssue(encodeIssue(issue))).toEqual(issue);
    }
  });

  it("ערך שאינו קוד מוכר — null, ולא תקלה ממוצאת", () => {
    expect(decodeIssue("Graph החזיר 500")).toBeNull();
    expect(decodeIssue(null)).toBeNull();
    expect(decodeIssue("")).toBeNull();
  });
});
