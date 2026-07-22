import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, claimNextJob, completeJob, enqueue, failJob } from "@/jobs/queue";
import { JOB_TYPES } from "@/jobs/types";
import { drainJobs, processNextJob } from "@/jobs/worker";
import { db } from "@/lib/db";
import type { EmailMessage, EmailTransport } from "@/lib/notifier/types";
import { resetDb } from "../helpers/reset-db";

/**
 * תור העבודות: מה שמפריד בין "הפעולה הצליחה" לבין "ההודעה יצאה".
 *
 * הבדיקות כאן קוראות ל-`processNextJob` ישירות ואינן ממתינות ללולאה.
 * בדיקה שתלויה בטיימר של שתי שניות נעשית לא יציבה, ואז מבוטלת — ואז אין
 * כיסוי בכלל למנגנון שכל ההתראות עוברות דרכו.
 */

/** ערוץ מדומה שסופר מה נשלח, ויכול להיכשל לפי דרישה */
function fakeTransport(options: { failTimes?: number } = {}) {
  const sent: EmailMessage[] = [];
  let failuresLeft = options.failTimes ?? 0;

  const transport: EmailTransport = {
    name: "fake",
    async send(message) {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error("שרת המייל אינו זמין");
      }
      sent.push(message);
    },
  };

  return { transport, sent };
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("claimNextJob", () => {
  it("תופס עבודה ממתינה ומעלה את מונה הניסיונות", async () => {
    await enqueue(db, JOB_TYPES.notify, { event: "ASSIGNED", assignmentId: "x" });

    const job = await claimNextJob();

    expect(job?.status).toBe("RUNNING");
    expect(job?.attempts).toBe(1);
  });

  it("אינו תופס עבודה שזמנה טרם הגיע", async () => {
    // כך נראה ניסיון חוזר שממתין: הוא בטבלה, אבל לא ייתפס לפני הזמן.
    const future = new Date(Date.now() + 60_000);
    await db.job.create({
      data: { type: JOB_TYPES.notify, payload: {}, runAt: future },
    });

    expect(await claimNextJob()).toBeNull();
    expect(await claimNextJob(new Date(future.getTime() + 1))).not.toBeNull();
  });

  it("אינו תופס עבודה שכבר רצה", async () => {
    await enqueue(db, JOB_TYPES.notify, { event: "ASSIGNED", assignmentId: "x" });

    expect(await claimNextJob()).not.toBeNull();
    expect(await claimNextJob()).toBeNull();
  });

  it("מחזיר null כשהתור ריק", async () => {
    expect(await claimNextJob()).toBeNull();
  });
});

describe("failJob", () => {
  it("מחזיר לתור עם השהיה כל עוד נותרו ניסיונות", async () => {
    await enqueue(db, JOB_TYPES.notify, { event: "ASSIGNED", assignmentId: "x" });
    const job = await claimNextJob();
    const now = new Date();

    await failJob(job?.id ?? "", 1, new Error("נפילה זמנית"), now);

    const stored = await db.job.findFirstOrThrow();
    expect(stored.status).toBe("PENDING");
    expect(stored.lastError).toBe("נפילה זמנית");
    expect(stored.runAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it("נועל כ-FAILED אחרי המכסה, והשורה נשארת", async () => {
    // העבודה שנכשלה היא הראיה היחידה לכך שקבלן מסוים לא קיבל הודעה.
    await enqueue(db, JOB_TYPES.notify, { event: "ASSIGNED", assignmentId: "x" });
    const job = await claimNextJob();

    await failJob(job?.id ?? "", MAX_ATTEMPTS, new Error("סופי"));

    const stored = await db.job.findFirstOrThrow();
    expect(stored.status).toBe("FAILED");
    expect(stored.lastError).toBe("סופי");
  });
});

describe("processNextJob", () => {
  it("מחזיר null כשאין מה לעשות", async () => {
    expect(await processNextJob(fakeTransport().transport)).toBeNull();
  });

  it("מסמן DONE אחרי הצלחה", async () => {
    // אין שיוך כזה — הג'וב מדלג ומסתיים בהצלחה, כי אין מה לנסות שוב.
    await enqueue(db, JOB_TYPES.notify, { event: "ASSIGNED", assignmentId: "לא-קיים" });

    const result = await processNextJob(fakeTransport().transport);

    expect(result?.status).toBe("done");
    expect((await db.job.findFirstOrThrow()).status).toBe("DONE");
  });

  it("סוג עבודה לא מוכר נכשל במקום להיבלע", async () => {
    await db.job.create({ data: { type: "משהו-אחר", payload: {} } });

    const result = await processNextJob(fakeTransport().transport);

    expect(result?.status).toBe("failed");
    expect((await db.job.findFirstOrThrow()).lastError).toContain("משהו-אחר");
  });

  it("עבודה שהושלמה ידנית מנקה את השגיאה הקודמת", async () => {
    // אחרי ניסיון שנכשל וניסיון שהצליח, `lastError` הישן היה נראה כאילו
    // ההודעה עדיין תקועה.
    const job = await db.job.create({
      data: { type: JOB_TYPES.notify, payload: {}, lastError: "כשל קודם" },
    });

    await completeJob(job.id);

    const stored = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe("DONE");
    expect(stored.lastError).toBeNull();
  });
});

describe("drainJobs", () => {
  it("מרוקן את כל מה שהגיע זמנו", async () => {
    for (let i = 0; i < 3; i += 1) {
      await enqueue(db, JOB_TYPES.notify, { event: "ASSIGNED", assignmentId: `לא-קיים-${i}` });
    }

    const results = await drainJobs(fakeTransport().transport);

    expect(results).toHaveLength(3);
    expect(await db.job.count({ where: { status: "DONE" } })).toBe(3);
  });

  it("אינו לוקח יותר מהתקרה בסבב אחד", async () => {
    // ‏50 עבודות בבת אחת הן תרחיש אמיתי (הזנה מרוכזת מבדק בית). ריקון של
    // כולן בלולאה אחת חוסם את התהליך שמגיש את המסכים.
    for (let i = 0; i < 5; i += 1) {
      await enqueue(db, JOB_TYPES.notify, { event: "ASSIGNED", assignmentId: `לא-קיים-${i}` });
    }

    const results = await drainJobs(fakeTransport().transport, new Date(), 2);

    expect(results).toHaveLength(2);
    expect(await db.job.count({ where: { status: "PENDING" } })).toBe(3);
  });

  it("אינו נכנס ללולאה אינסופית כשעבודה נכשלת", async () => {
    // כישלון מחזיר את העבודה לתור עם `runAt` עתידי, ולכן היא אינה נתפסת
    // שוב באותה ריקון. בלי ההשהיה הזו הלולאה הייתה רצה עד קריסה.
    await db.job.create({ data: { type: "לא-מוכר", payload: {} } });

    const results = await drainJobs(fakeTransport().transport);

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("failed");
  });
});
