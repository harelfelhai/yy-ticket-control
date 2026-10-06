import { describe, expect, it } from "vitest";
import { AiRequestError, type AiErrorKind } from "@/lib/ai/gemini";
import {
  EXTRACTION_BUDGET_MS,
  EXTRACTION_RETRY_MS,
  extractionUnavailableDetail,
  shouldRetryExtraction,
} from "@/lib/intake/defer-policy";

/**
 * הקו החד של EM-11: מתי כשל של המחלץ נדחה לניסיון נוסף, ומתי הוא הופך להכרעה
 * "החילוץ אינו זמין" — משותף למייל ולוואטסאפ. כל שורה בטבלה היא מקרה אחד.
 */

const RECEIVED = new Date("2026-10-06T10:00:00Z");
/** דקה אחרי ההגעה — הרבה בתוך התקציב של ארבע הדקות */
const EARLY = new Date(RECEIVED.getTime() + 60_000);
/** התקציב כבר עבר */
const LATE = new Date(RECEIVED.getTime() + EXTRACTION_BUDGET_MS);

function retry(kind: AiErrorKind, now: Date, extractionAttempts: number): boolean {
  return shouldRetryExtraction({ kind, now, receivedAt: RECEIVED, extractionAttempts });
}

describe("shouldRetryExtraction — מתי ניסיון נוסף, ומתי \"החילוץ אינו זמין\"", () => {
  it.each<[string, AiErrorKind, Date, number, boolean]>([
    ["זמני, בתוך התקציב — עוד ניסיון", "transient", EARLY, 3, true],
    ["זמני, אחרי התקציב, ניסיון ראשון — עוד אחד (הרצפה של שני ניסיונות)", "transient", LATE, 1, true],
    ["זמני, אחרי התקציב, אחרי שני ניסיונות — הכרעה", "transient", LATE, 2, false],
    ["מכסה — כמו זמני", "quota", EARLY, 3, true],
    ["מכסה אחרי התקציב ושני ניסיונות — הכרעה", "quota", LATE, 2, false],
    ["§7 שורה 114 — תשובה פגומה, ניסיון ראשון: עוד אחד", "malformed", EARLY, 1, true],
    ["§7 שורה 114 — תשובה פגומה, ניסיון ראשון אחרי התקציב: עוד אחד", "malformed", LATE, 1, true],
    ["§7 שורה 114 — תשובה פגומה פעמיים: הכרעה, גם כשיש עוד תקציב", "malformed", EARLY, 2, false],
    ["קבוע (4xx) — הכרעה מיד, גם בתוך התקציב", "permanent", EARLY, 1, false],
    ["הרשאה — הכרעה מיד", "auth", EARLY, 1, false],
  ])("%s", (_name, kind, now, attempts, expected) => {
    expect(retry(kind, now, attempts)).toBe(expected);
  });

  it("הגבול של התקציב: ניסיון שיסתיים אחרי ארבע הדקות אינו נדחה עוד", () => {
    const edge = new Date(RECEIVED.getTime() + EXTRACTION_BUDGET_MS - EXTRACTION_RETRY_MS);
    expect(retry("transient", new Date(edge.getTime() - 1), 3)).toBe(true);
    expect(retry("transient", edge, 3)).toBe(false);
  });
});

describe("extractionUnavailableDetail — מה נרשם על ההודעה לאבחון", () => {
  it("סוג הכשל וההודעה שלו", () => {
    expect(extractionUnavailableDetail(new AiRequestError("תשובת Gemini אינה JSON: שלום", "malformed"))).toBe(
      "החילוץ אינו זמין — malformed: תשובת Gemini אינה JSON: שלום",
    );
  });

  it("אין מחלץ בסביבה", () => {
    expect(extractionUnavailableDetail(null)).toBe("החילוץ אינו זמין — אין מנוע חילוץ בסביבה");
  });

  it("מקוצר ל-1000 תווים, כמו כל `detail`", () => {
    expect(extractionUnavailableDetail(new AiRequestError("x".repeat(2000), "permanent"))).toHaveLength(1000);
  });
});
