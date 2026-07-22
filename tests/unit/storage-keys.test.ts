import { describe, expect, it } from "vitest";
import { buildStorageKey, isAllowedMimeType } from "@/lib/storage";

/**
 * שני שומרי הסף של המדיה: מה מותר להעלות, ואיך נקרא הקובץ באחסון.
 *
 * שניהם נראים טכניים אבל שניהם מגינים על אותו דבר — קלט שמגיע ממכשיר של
 * משתמש. שם קובץ ממכשיר אמיתי הוא טקסט חופשי לכל דבר.
 */

const at = new Date("2026-07-22T10:00:00Z");

describe("isAllowedMimeType", () => {
  it("מקבל את מה שמצלמת טלפון וסורק מסמכים מייצרים", () => {
    for (const type of ["image/jpeg", "image/png", "image/heic", "application/pdf", "video/mp4"]) {
      expect(isAllowedMimeType(type)).toBe(true);
    }
  });

  it("מתעלם מפרמטר codecs שמגיע מהקלטה", () => {
    // ‏MediaRecorder מדווח `audio/webm;codecs=opus`. השוואה מדויקת הייתה
    // דוחה כל הקלטה קולית.
    expect(isAllowedMimeType("audio/webm;codecs=opus")).toBe(true);
    expect(isAllowedMimeType("video/webm; codecs=vp8,opus")).toBe(true);
  });

  it("אינו רגיש לאותיות גדולות", () => {
    expect(isAllowedMimeType("IMAGE/JPEG")).toBe(true);
  });

  it("דוחה כל מה שאינו ברשימה", () => {
    // רשימת היתר ולא רשימת איסור: סוג שלא חשבנו עליו נדחה, ולא מתקבל.
    for (const type of ["text/html", "application/x-msdownload", "", "image", "application/zip"]) {
      expect(isAllowedMimeType(type)).toBe(false);
    }
  });
});

describe("buildStorageKey", () => {
  it("מחלק לפי שנה וחודש", () => {
    // החלוקה נועדה לג'וב הגיבוי: לסנכרן רק את מה שהתווסף.
    expect(buildStorageKey("image/jpeg", at)).toMatch(/^media\/2026\/07\/[0-9a-f-]{36}\.jpg$/);
  });

  it("משלים חודש חד-ספרתי באפס", () => {
    expect(buildStorageKey("image/png", new Date("2026-03-01T00:00:00Z"))).toContain(
      "media/2026/03/",
    );
  });

  it("מייצר מפתח שונה בכל קריאה", () => {
    // שני מנהלים יעלו "IMG_0001.jpg" באותו רגע.
    const keys = new Set(Array.from({ length: 50 }, () => buildStorageKey("image/jpeg", at)));
    expect(keys.size).toBe(50);
  });

  it("אינו נושא את שם הקובץ המקורי", () => {
    // שם שמגיע מהמשתמש עלול להכיל תווים שמשמעותם נתיב.
    const key = buildStorageKey("image/jpeg", at);
    expect(key).not.toContain(" ");
    expect(key).not.toContain("..");
  });

  it("נותן סיומת לכל סוג נתמך, ו-bin לכל השאר", () => {
    expect(buildStorageKey("application/pdf", at)).toMatch(/\.pdf$/);
    expect(buildStorageKey("audio/webm;codecs=opus", at)).toMatch(/\.webm$/);
    expect(buildStorageKey("video/quicktime", at)).toMatch(/\.mov$/);
    expect(buildStorageKey("משהו/אחר", at)).toMatch(/\.bin$/);
  });
});
