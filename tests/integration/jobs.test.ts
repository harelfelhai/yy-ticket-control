import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  claimNextJob,
  completeJob,
  enqueue,
  failJob,
  reclaimOrphanedJobs,
} from "@/jobs/queue";
import { JOB_TYPES, MAIL_JOB_TYPES, jobLaneOf } from "@/jobs/types";
import { drainJobs, ensureDailyRescheduled, processNextJob } from "@/jobs/worker";
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
      // `EmailSendResult` ריק: הכפיל אינו מדמה מזהים של ספק, ומה שנבדק
      // כאן הוא התור ולא השרשור.
      return {};
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
    expect(await processNextJob({ transport: fakeTransport().transport })).toBeNull();
  });

  it("מסמן DONE אחרי הצלחה", async () => {
    // אין שיוך כזה — הג'וב מדלג ומסתיים בהצלחה, כי אין מה לנסות שוב.
    await enqueue(db, JOB_TYPES.notify, { event: "ASSIGNED", assignmentId: "לא-קיים" });

    const result = await processNextJob({ transport: fakeTransport().transport });

    expect(result?.status).toBe("done");
    expect((await db.job.findFirstOrThrow()).status).toBe("DONE");
  });

  it("סוג עבודה לא מוכר נכשל במקום להיבלע", async () => {
    await db.job.create({ data: { type: "משהו-אחר", payload: {} } });

    const result = await processNextJob({ transport: fakeTransport().transport });

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

    const results = await drainJobs({ transport: fakeTransport().transport });

    expect(results).toHaveLength(3);
    expect(await db.job.count({ where: { status: "DONE" } })).toBe(3);
  });

  it("אינו לוקח יותר מהתקרה בסבב אחד", async () => {
    // ‏50 עבודות בבת אחת הן תרחיש אמיתי (הזנה מרוכזת מבדק בית). ריקון של
    // כולן בלולאה אחת חוסם את התהליך שמגיש את המסכים.
    for (let i = 0; i < 5; i += 1) {
      await enqueue(db, JOB_TYPES.notify, { event: "ASSIGNED", assignmentId: `לא-קיים-${i}` });
    }

    const results = await drainJobs({ transport: fakeTransport().transport }, new Date(), 2);

    expect(results).toHaveLength(2);
    expect(await db.job.count({ where: { status: "PENDING" } })).toBe(3);
  });

  it("אינו נכנס ללולאה אינסופית כשעבודה נכשלת", async () => {
    // כישלון מחזיר את העבודה לתור עם `runAt` עתידי, ולכן היא אינה נתפסת
    // שוב באותה ריקון. בלי ההשהיה הזו הלולאה הייתה רצה עד קריסה.
    await db.job.create({ data: { type: "לא-מוכר", payload: {} } });

    const results = await drainJobs({ transport: fakeTransport().transport });

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("failed");
  });
});

describe("reclaimOrphanedJobs — עבודות יתומות שנתקעו ב-RUNNING", () => {
  it("מחזיר ל-PENDING עבודה שנותרו לה ניסיונות — תילקח שוב מיד", async () => {
    const job = await db.job.create({
      data: { type: JOB_TYPES.notify, payload: {}, status: "RUNNING", attempts: 1 },
    });

    expect(await reclaimOrphanedJobs()).toEqual({ requeued: 1, failed: 0 });
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PENDING");
  });

  it("מסמן FAILED עבודה שמיצתה ניסיונות — נשארת גלויה ולא נלקחת שוב", async () => {
    const job = await db.job.create({
      data: { type: JOB_TYPES.notify, payload: {}, status: "RUNNING", attempts: MAX_ATTEMPTS },
    });

    expect(await reclaimOrphanedJobs()).toEqual({ requeued: 0, failed: 1 });
    const stored = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe("FAILED");
    expect(stored.lastError).toContain("נקטעה");
  });

  it("אינו נוגע בעבודות PENDING או DONE", async () => {
    await db.job.create({ data: { type: JOB_TYPES.notify, payload: {}, status: "PENDING" } });
    await db.job.create({ data: { type: JOB_TYPES.notify, payload: {}, status: "DONE" } });

    expect(await reclaimOrphanedJobs()).toEqual({ requeued: 0, failed: 0 });
  });
});

describe("ensureDailyRescheduled — שרשרת יומית שורדת כשל סופי", () => {
  it("יוצר ג'וב יומי למחר כשאין ממתין (אחרי כשל סופי)", async () => {
    await ensureDailyRescheduled(JOB_TYPES.escalate, new Date("2026-03-15T12:00:00Z"));

    expect(
      await db.job.count({ where: { type: JOB_TYPES.escalate, status: "PENDING" } }),
    ).toBe(1);
  });

  it("אינו יוצר כפיל כשכבר קיים ממתין (חלון ה-retry)", async () => {
    await db.job.create({ data: { type: JOB_TYPES.backup, payload: {}, status: "PENDING" } });
    await ensureDailyRescheduled(JOB_TYPES.backup, new Date());

    expect(await db.job.count({ where: { type: JOB_TYPES.backup } })).toBe(1);
  });

  it("no-op לסוג עבודה שאינו יומי", async () => {
    await ensureDailyRescheduled(JOB_TYPES.notify, new Date());
    expect(await db.job.count()).toBe(0);
  });
});

/**
 * נתיבי התור (EM-12).
 *
 * ההבטחה במייל הנכנס היא תשובה תוך חמש דקות. העובד מריץ עבודה אחת בכל רגע,
 * ולכן ההבטחה תלויה לא בקוד של השליחה אלא ב**מי עומד בתור לפניה**. הבדיקות
 * כאן נועלות בדיוק את זה: מי כל נתיב תופס, ומי הוא בוודאות לא.
 */
describe("נתיבי התור — EM-12", () => {
  it("EM-12 — ג'וב דואר אינו נתפס בנתיב הכללי", async () => {
    await enqueue(db, JOB_TYPES.emailIntake, { mailboxMessageId: "m1" });

    expect(await claimNextJob(new Date(), "general")).toBeNull();
    expect((await claimNextJob(new Date(), "mail"))?.type).toBe(JOB_TYPES.emailIntake);
  });

  it("EM-12 — ג'וב כללי אינו נתפס בנתיב הדואר", async () => {
    await enqueue(db, JOB_TYPES.transcribe, { mediaId: "x" });

    expect(await claimNextJob(new Date(), "mail")).toBeNull();
    expect((await claimNextJob(new Date(), "general"))?.type).toBe(JOB_TYPES.transcribe);
  });

  it("EM-12 — תשובה אינה ממתינה מאחורי ג'וב כללי ותיק ממנה", async () => {
    // זה הכשל שהנתיבים נועדו למנוע: הזנה מרוכזת יוצרת עשרות ג'ובי חילוץ,
    // וכולם ותיקים מהתשובה שנוצרה אחריהם. בתור יחיד התשובה הייתה אחרונה.
    const now = new Date("2026-09-18T08:00:00Z");
    await db.job.create({
      data: {
        type: JOB_TYPES.extract,
        payload: { mediaId: "ותיק" },
        runAt: new Date(now.getTime() - 60_000),
      },
    });
    await enqueue(db, JOB_TYPES.emailReply, { mailboxMessageId: "m2" }, now);

    expect((await claimNextJob(now, "mail"))?.type).toBe(JOB_TYPES.emailReply);
  });

  it("EM-12 — בלי נתיב נתפס הכול, וכל קורא קיים ממשיך לעבוד", async () => {
    // `conformance/run-job.ts drain` והבדיקות אינן מכירות נתיבים כלל.
    await enqueue(db, JOB_TYPES.emailIntake, { mailboxMessageId: "m3" });
    await enqueue(db, JOB_TYPES.notify, { event: "ASSIGNED", assignmentId: "לא-קיים" });

    const first = await claimNextJob();
    const second = await claimNextJob();

    expect([first?.type, second?.type].sort()).toEqual(
      [JOB_TYPES.emailIntake, JOB_TYPES.notify].sort(),
    );
  });

  it("EM-12 — כל סוג עבודה שייך לנתיב אחד בדיוק", () => {
    const all = Object.values(JOB_TYPES);
    const mail = all.filter((type) => jobLaneOf(type) === "mail");
    const general = all.filter((type) => jobLaneOf(type) === "general");

    expect(mail).toEqual([...MAIL_JOB_TYPES]);
    expect(mail.length + general.length).toBe(all.length);
  });

  it("EM-12 — סוג עבודה שאינו מוכר נופל לנתיב הכללי ולא נשאר PENDING לנצח", async () => {
    // הכשל השקט שנמנע כאן: אילו הנתיב הכללי היה רשימת סוגים מפורשת, שורה
    // שנוצרה בגרסה חדשה יותר לא הייתה נתפסת על ידי אף לולאה — בלי שגיאה.
    await db.job.create({ data: { type: "סוג-עתידי", payload: {} } });

    expect(await claimNextJob(new Date(), "mail")).toBeNull();
    expect((await claimNextJob(new Date(), "general"))?.type).toBe("סוג-עתידי");
  });

  it("EM-12 — drainJobs בנתיב הדואר מרוקן רק ג'ובי דואר", async () => {
    await enqueue(db, JOB_TYPES.notify, { event: "ASSIGNED", assignmentId: "לא-קיים" });
    await enqueue(db, JOB_TYPES.emailIntake, { mailboxMessageId: "m4" });

    const results = await drainJobs(
      { transport: fakeTransport().transport },
      new Date(),
      20,
      "mail",
    );

    // הסטטוס אינו נבדק כאן בכוונה — הנבדק הוא **מי נלקח**, לא מה עשה
    // המטפל. הג'וב הכללי חייב להישאר ממתין ללולאה שלו.
    expect(results.map((r) => r.job.type)).toEqual([JOB_TYPES.emailIntake]);
    expect(await db.job.count({ where: { type: JOB_TYPES.notify, status: "PENDING" } })).toBe(1);
  });

  it("EM-12 — שתי הלולאות במקביל אינן תופסות עבודה פעמיים", async () => {
    for (let i = 0; i < 4; i += 1) {
      await enqueue(db, JOB_TYPES.notify, { event: "ASSIGNED", assignmentId: `לא-קיים-${i}` });
      await enqueue(db, JOB_TYPES.emailReply, { mailboxMessageId: `m-${i}` });
    }

    // `now` נלקח **אחרי** ההכנסה: `runAt` נקבע בברירת מחדל לשעון ה-DB ברגע
    // ה-INSERT, וחותמת שנלקחה לפניו הייתה משאירה את השורות "טרם הגיע זמנן".
    const now = new Date();
    const deps = { transport: fakeTransport().transport };
    const [general, mail] = await Promise.all([
      drainJobs(deps, now, 20, "general"),
      drainJobs(deps, now, 20, "mail"),
    ]);

    const ids = [...general, ...mail].map((r) => r.job.id);
    expect(new Set(ids).size).toBe(8);
    expect(new Set(general.map((r) => r.job.type))).toEqual(new Set([JOB_TYPES.notify]));
    expect(new Set(mail.map((r) => r.job.type))).toEqual(new Set([JOB_TYPES.emailReply]));
  });

  it("EM-12 — תפיסה מקבילה של אותה שורה מצליחה פעם אחת בלבד", async () => {
    // ההגנה שמאפשרת שתי לולאות באותו תהליך, ותישאר נכונה גם עם instance שני.
    await enqueue(db, JOB_TYPES.notify, { event: "ASSIGNED", assignmentId: "לא-קיים" });

    const claimed = await Promise.all([claimNextJob(), claimNextJob()]);

    expect(claimed.filter(Boolean)).toHaveLength(1);
  });
});
