import { describe, expect, it } from "vitest";
import { BURST_CEILING_MS, BURST_QUIET_MS, type BurstMessage, planBurst } from "@/lib/whatsapp/burst";

/**
 * קיבוץ הודעות לדיווחים (WA-02, §7 שורה 93): 90 שניות שקט כשיש מילה או
 * תגובה, ובלעדיהן עד 10 דקות מההודעה הראשונה; תגובה פותחת דיווח משלה.
 */

const T0 = new Date("2026-10-04T10:00:00Z").getTime();
const at = (ms: number) => new Date(T0 + ms);
const SEC = 1000;

function msg(id: string, offsetMs: number, extra: Partial<BurstMessage> = {}): BurstMessage {
  return { id, sentAt: at(offsetMs), contextWamid: null, keyword: false, ...extra };
}

describe("planBurst — מתי דיווח מוכרע", () => {
  it("הודעה עם המילה: מחכים 90 שניות שקט, ואז מכריעים", () => {
    const messages = [msg("a", 0, { keyword: true })];
    expect(planBurst(messages, at(89 * SEC))).toEqual({ ready: [], waitUntil: at(BURST_QUIET_MS) });
    expect(planBurst(messages, at(BURST_QUIET_MS)).ready).toEqual([
      { messageIds: ["a"], contextWamid: null, keyword: true },
    ]);
  });

  it("תמונות ואחריהן המילה: דיווח אחד שכולל את התמונות", () => {
    const messages = [msg("img1", 0), msg("img2", 20 * SEC), msg("text", 180 * SEC, { keyword: true })];
    const plan = planBurst(messages, at(180 * SEC + BURST_QUIET_MS));
    expect(plan.ready).toEqual([{ messageIds: ["img1", "img2", "text"], contextWamid: null, keyword: true }]);
    expect(plan.waitUntil).toBeNull();
  });

  it("בלי מילה ובלי תגובה: אין הכרעה לפני התקרה, גם אחרי דקות של שקט", () => {
    const messages = [msg("img", 0)];
    expect(planBurst(messages, at(5 * 60 * SEC))).toEqual({ ready: [], waitUntil: at(BURST_CEILING_MS) });
    expect(planBurst(messages, at(BURST_CEILING_MS)).ready).toEqual([
      { messageIds: ["img"], contextWamid: null, keyword: false },
    ]);
  });

  it("התקרה גוברת על שקט: דיווח עם המילה שממשיך להתארך מוכרע בעשר דקות", () => {
    const messages = [0, 60, 120, 180, 240, 300, 360, 420, 480, 540].map((s) => msg(`m${s}`, s * SEC, { keyword: s === 0 }));
    const plan = planBurst(messages, at(BURST_CEILING_MS));
    expect(plan.ready).toHaveLength(1);
    expect(plan.ready[0]?.messageIds).toHaveLength(10);
  });

  it("המתנה של דיווח עם המילה אינה עוברת את התקרה", () => {
    // הודעה כל 80 שניות: 90 השניות של השקט אחרי האחרונה (560) היו מסתיימות ב-650
    const messages = [0, 80, 160, 240, 320, 400, 480, 560].map((s) => msg(`m${s}`, s * SEC, { keyword: s === 0 }));
    expect(planBurst(messages, at(561 * SEC))).toEqual({ ready: [], waitUntil: at(BURST_CEILING_MS) });
  });
});

describe("planBurst — תגובה (Reply)", () => {
  it("תגובה פותחת דיווח משלה ומוכרעת אחרי שקט, גם בלי המילה", () => {
    const messages = [msg("report", 0, { keyword: true }), msg("reply", 30 * SEC, { contextWamid: "wamid.ACK" })];
    const plan = planBurst(messages, at(30 * SEC + BURST_QUIET_MS));
    expect(plan.ready).toEqual([
      { messageIds: ["report"], contextWamid: null, keyword: true },
      { messageIds: ["reply"], contextWamid: "wamid.ACK", keyword: false },
    ]);
  });

  it("הודעה בלי ציטוט מיד אחרי תגובה מצטרפת אליה (\"…ועוד תמונה\")", () => {
    const messages = [msg("reply", 0, { contextWamid: "wamid.ACK" }), msg("photo", 20 * SEC)];
    expect(planBurst(messages, at(20 * SEC + BURST_QUIET_MS)).ready).toEqual([
      { messageIds: ["reply", "photo"], contextWamid: "wamid.ACK", keyword: false },
    ]);
  });

  it("שתי תגובות רצופות — שני דיווחים, אולי לשתי טיוטות", () => {
    const messages = [msg("r1", 0, { contextWamid: "wamid.A" }), msg("r2", 10 * SEC, { contextWamid: "wamid.B" })];
    const plan = planBurst(messages, at(10 * SEC + BURST_QUIET_MS));
    expect(plan.ready.map((unit) => unit.contextWamid)).toEqual(["wamid.A", "wamid.B"]);
  });
});

describe("planBurst — הודעות שנצברו (השרת היה למטה)", () => {
  it("מתחלקות בדיוק כמו בזמן אמת: שקט ארוך אחרי המילה סוגר את הדיווח", () => {
    const messages = [msg("a", 0, { keyword: true }), msg("b", 5 * 60 * SEC)];
    const plan = planBurst(messages, at(60 * 60 * SEC));
    expect(plan.ready.map((unit) => unit.messageIds)).toEqual([["a"], ["b"]]);
  });

  it("הודעה שהגיעה אחרי התקרה של דיווח בלי מילה פותחת דיווח חדש", () => {
    const messages = [msg("img", 0), msg("late", BURST_CEILING_MS + SEC, { keyword: true })];
    const plan = planBurst(messages, at(60 * 60 * SEC));
    expect(plan.ready).toEqual([
      { messageIds: ["img"], contextWamid: null, keyword: false },
      { messageIds: ["late"], contextWamid: null, keyword: true },
    ]);
  });

  it("הסדר לפי זמן הכתיבה, לא לפי סדר ההגעה; זמן שווה — לפי המזהה", () => {
    const messages = [msg("c", 30 * SEC, { keyword: true }), msg("a", 0), msg("b", 0)];
    expect(planBurst(messages, at(30 * SEC + BURST_QUIET_MS)).ready[0]?.messageIds).toEqual(["a", "b", "c"]);
  });

  it("בלי הודעות — אין מה להכריע", () => {
    expect(planBurst([], at(0))).toEqual({ ready: [], waitUntil: null });
  });
});
