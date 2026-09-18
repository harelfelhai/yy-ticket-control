import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMAIL_POLL_INTERVAL_MS, startEmailPoller } from "@/jobs/email-poller";
import { enqueue, MAX_ATTEMPTS } from "@/jobs/queue";
import { JOB_TYPES } from "@/jobs/types";
import { MailSourceError, type MailSource } from "@/lib/email-intake/source";
import { db } from "@/lib/db";
import {
  EMAIL_CHANNEL,
  type EmailPollResult,
  MAX_PAGES_PER_QUERY,
  runEmailPoll,
  selectMailSource,
  STUCK_AFTER_MS,
} from "@/lib/services/email-poll";
import { getHeartbeat, HEARTBEAT, setHeartbeat } from "@/watchdog/heartbeat";
import { fakeMailSource, type FakeMailSource } from "../helpers/fake-mail-source";
import {
  ARRIVED_AT,
  firstMail,
  MAILBOX,
  OTHER_SENDER,
  SENDER,
  STRANGER,
} from "../helpers/mail-fixtures";
import { resetDb } from "../helpers/reset-db";
import { stripComments } from "../unit/source-scan";

/**
 * סבב הגילוי מול בסיס נתונים אמיתי (S6, מודול B).
 *
 * **בדיקת אינטגרציה ולא יחידה, מסיבה אחת:** כל הערובות של הסבב הן ערובות
 * של בסיס הנתונים — האינדקס הייחודי על `gmailMessageId` הוא מה שמונע
 * קליטה כפולה (EM-21), והטרנזאקציה היא מה שמונע שורה בלי ג׳וב. מול כפיל
 * של Prisma הבדיקות היו מאמתות את הכפיל.
 *
 * **התיבה תמיד מזויפת** (`fakeMailSource`): אין כאן רשת, ואי אפשר להוסיף
 * אותה בלי לשנות את הכפיל.
 */

/** ההפעלה, במיילים שנבדקים — שעה ורבע לפני שההודעה של ה-fixtures הגיעה */
const ACTIVATED_AT = new Date("2026-09-16T06:00:00.000Z");
/** "עכשיו" של רוב הסבבים — 18 דקות אחרי `ARRIVED_AT` */
const NOW = new Date("2026-09-16T07:30:00.000Z");

const envBackup = {
  GMAIL_USER: process.env.GMAIL_USER,
  EMAIL_INTAKE_PILOT_ADDRESSES: process.env.EMAIL_INTAKE_PILOT_ADDRESSES,
  EMAIL_INTAKE_ENABLED: process.env.EMAIL_INTAKE_ENABLED,
  EMAIL_INTAKE_NONPROD: process.env.EMAIL_INTAKE_NONPROD,
};

function setEnv(name: keyof typeof envBackup, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(async () => {
  await resetDb();
  setEnv("GMAIL_USER", MAILBOX);
  setEnv("EMAIL_INTAKE_PILOT_ADDRESSES", undefined);
  setEnv("EMAIL_INTAKE_ENABLED", undefined);
  setEnv("EMAIL_INTAKE_NONPROD", undefined);
});

afterAll(async () => {
  for (const [name, value] of Object.entries(envBackup)) {
    setEnv(name as keyof typeof envBackup, value);
  }
  await db.$disconnect();
});

// ─────────────────────────────── עזרי זריעה ───────────────────────────────

let userSeq = 0;

async function seedUser(
  email: string | null,
  overrides: { active?: boolean; emailIntakeEnabled?: boolean; aliases?: string[] } = {},
): Promise<string> {
  userSeq += 1;
  const user = await db.user.create({
    data: {
      role: "ADMIN",
      name: `משתמש ${userSeq}`,
      phone: `05000000${String(userSeq).padStart(2, "0")}`,
      email,
      passwordHash: "hash",
      active: overrides.active ?? true,
      emailIntakeEnabled: overrides.emailIntakeEnabled ?? true,
      ...(overrides.aliases?.length
        ? { emailAliases: { create: overrides.aliases.map((address) => ({ address })) } }
        : {}),
    },
    select: { id: true },
  });
  return user.id;
}

async function activate(at: Date = ACTIVATED_AT): Promise<void> {
  await db.mailChannelState.create({
    data: { channel: EMAIL_CHANNEL, mailbox: MAILBOX, activatedAt: at },
  });
}

function channelState() {
  return db.mailChannelState.findUnique({ where: { channel: EMAIL_CHANNEL } });
}

function intakeJobs() {
  return db.job.findMany({ where: { type: JOB_TYPES.emailIntake }, orderBy: { createdAt: "asc" } });
}

/** המזהים שכל השאילתות של הסבב הכילו, כמחרוזת אחת */
function queryText(source: FakeMailSource): string {
  return source
    .callsTo("listIds")
    .map((call) => call.query ?? "")
    .join(" | ");
}

// ─────────────────────────────── 1. שומר התיבה ───────────────────────────────

describe("EM-20 — שומר התיבה", () => {
  it("EM-20 — תיבה שאינה זו שהוגדרה עוצרת את הסבב ואינה מגלה דבר", async () => {
    await seedUser(SENDER);
    const source = fakeMailSource({ messages: [firstMail()], profile: "someone-else@example.com" });

    const result = await runEmailPoll({ source, now: NOW });

    expect(result.status).toBe("halted");
    expect(result.reason).toContain("someone-else@example.com");
    // לא נשאלה שום שאילתה — העצירה היא **לפני** הקריאה, לא אחריה
    expect(source.callsTo("listIds")).toHaveLength(0);
    expect(await db.mailboxMessage.count()).toBe(0);
    expect(await db.job.count()).toBe(0);
  });

  it("EM-22 — סבב שנעצר אינו יוצר שורת ערוץ, ולכן אינו קובע רצפת הפעלה", async () => {
    const source = fakeMailSource({ profile: "someone-else@example.com" });

    await runEmailPoll({ source, now: NOW });

    // שורת ערוץ שנוצרה בכישלון הייתה קובעת `activatedAt` לפי הסבב הראשון
    // שנכשל, ומשאירה את כל הדואר שמאז מתחת לרצפה.
    expect(await db.mailChannelState.count()).toBe(0);
    expect(await getHeartbeat(HEARTBEAT.emailPoll)).toBeNull();
  });

  it("EM-20 — היקף הרשאה חסר עוצר ברעש ואינו מקדם את חלון הזמן", async () => {
    await activate();
    await seedUser(SENDER);
    const source = fakeMailSource({
      messages: [firstMail()],
      failures: [{ method: "getProfile", kind: "scope", times: Number.POSITIVE_INFINITY }],
    });

    const result = await runEmailPoll({ source, now: NOW });

    expect(result.status).toBe("halted");
    const state = await channelState();
    expect(state?.lastPollError).toContain("scope");
    expect(state?.lastPollOkAt).toBeNull();
    expect(state?.lastPollAt?.toISOString()).toBe(NOW.toISOString());
    expect(await getHeartbeat(HEARTBEAT.emailPoll)).toBeNull();
  });

  it("EM-20 — טוקן שנשלל (auth) עוצר ברעש", async () => {
    await activate();
    const source = fakeMailSource({
      failures: [{ method: "getProfile", kind: "auth", times: Number.POSITIVE_INFINITY }],
    });

    expect((await runEmailPoll({ source, now: NOW })).status).toBe("halted");
  });

  it("EM-20 — כשל חולף נדחה ואינו עצירה: אין פעימה, והחלון נשאר רחב", async () => {
    await activate();
    const source = fakeMailSource({
      failures: [{ method: "getProfile", kind: "transient", times: Number.POSITIVE_INFINITY }],
    });

    const result = await runEmailPoll({ source, now: NOW });

    expect(result.status).toBe("deferred");
    const state = await channelState();
    expect(state?.lastPollError).toContain("transient");
    expect(state?.lastPollOkAt).toBeNull();
    expect(await getHeartbeat(HEARTBEAT.emailPoll)).toBeNull();
  });

  it("EM-20 — בלי GMAIL_USER אין מול מה לאמת, והסבב נעצר", async () => {
    setEnv("GMAIL_USER", undefined);
    const source = fakeMailSource();

    const result = await runEmailPoll({ source, now: NOW });

    expect(result.status).toBe("halted");
    expect(result.reason).toContain("GMAIL_USER");
    expect(source.calls).toHaveLength(0);
  });
});

// ─────────────────────────────── 2. הפעלה ───────────────────────────────

describe("EM-22 — רצפת ההפעלה", () => {
  it("EM-22 — הסבב המוצלח הראשון יוצר את שורת הערוץ עם רצפה = עכשיו", async () => {
    const source = fakeMailSource();

    await runEmailPoll({ source, now: NOW });

    const state = await channelState();
    expect(state?.activatedAt.toISOString()).toBe(NOW.toISOString());
    expect(state?.mailbox).toBe(MAILBOX);
    expect(state?.lastPollOkAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("EM-20 — סבב מוצלח מוחק כשל קודם ומרענן את כתובת התיבה", async () => {
    await activate();

    // סבב ראשון: כשל חולף מול Gmail — המסלול השגרתי ביותר של המודול
    const failing = fakeMailSource({
      failures: [{ method: "getProfile", kind: "transient", times: Number.POSITIVE_INFINITY }],
    });
    expect((await runEmailPoll({ source: failing, now: NOW })).status).toBe("deferred");
    expect((await channelState())?.lastPollError).toContain("transient");

    // התיבה הוחלפה: גם `GMAIL_USER` וגם הטוקן מצביעים עכשיו על כתובת אחרת.
    // `activateChannel` הוא `upsert` עם `update: {}` ולכן לעולם אינו נוגע
    // בכתובת של שורה קיימת — הסבב המוצלח הוא המקום היחיד שמרענן אותה.
    const moved = "office-2@example.com";
    setEnv("GMAIL_USER", moved);

    const second = await runEmailPoll({
      source: fakeMailSource({ profile: moved }),
      now: new Date(NOW.getTime() + 60_000),
    });

    expect(second.status).toBe("ok");
    const state = await channelState();
    // כשל שנפתר לפני שבוע ונשאר רשום מטעה את מי שמאבחן
    expect(state?.lastPollError).toBeNull();
    // `MailChannelState.mailbox` אינו תיעוד עצמי: `email-intake.ts` קורא
    // ממנו כדי לזהות מייל של התיבה עצמה (§7 שורה 83), וערך מיושן שם משבש
    // את שלב 4 בסולם ההכרעה.
    expect(state?.mailbox).toBe(moved);
    // והרצפה עצמה אינה זזה גם כשהכתובת התחלפה
    expect(state?.activatedAt.toISOString()).toBe(ACTIVATED_AT.toISOString());
  });

  it("EM-22 — סבב מאוחר אינו מזיז את הרצפה", async () => {
    await activate();
    const source = fakeMailSource();

    await runEmailPoll({ source, now: NOW });
    await runEmailPoll({ source, now: new Date(NOW.getTime() + 60_000) });

    const state = await channelState();
    expect(state?.activatedAt.toISOString()).toBe(ACTIVATED_AT.toISOString());
    expect(state?.lastPollOkAt?.toISOString()).toBe(new Date(NOW.getTime() + 60_000).toISOString());
  });

  it("EM-22 — דואר שקדם להפעלה אינו נקלט, ומה שהגיע אחריה כן", async () => {
    await seedUser(SENDER);
    const old = firstMail({ id: "gmail-old", messageId: "old@example.com", receivedAt: ARRIVED_AT });
    const source = fakeMailSource({ messages: [old] });

    // הסבב הראשון הוא גם ההפעלה: הרצפה נקבעת ל-NOW, והדואר הישן נופל מתחתיה
    const first = await runEmailPoll({ source, now: NOW });
    expect(first.discovered).toBe(0);

    const later = new Date(NOW.getTime() + 5 * 60_000);
    source.deliver(firstMail({ id: "gmail-new", messageId: "new@example.com", receivedAt: later }));
    const second = await runEmailPoll({ source, now: new Date(NOW.getTime() + 10 * 60_000) });

    expect(second.discovered).toBe(1);
    const rows = await db.mailboxMessage.findMany({ select: { gmailMessageId: true } });
    expect(rows.map((row) => row.gmailMessageId)).toEqual(["gmail-new"]);
  });
});

// ─────────────────────────────── 3. השולחים ───────────────────────────────

describe("EM-04 — מי נכנס לשאילתה", () => {
  it("EM-04 — משתמש מושבת אינו נשאל, וגם הדואר שלו אינו נקלט", async () => {
    await seedUser(SENDER);
    await seedUser(OTHER_SENDER, { active: false });
    const source = fakeMailSource({
      messages: [firstMail(), firstMail({ id: "gmail-other", messageId: "o@example.com", from: OTHER_SENDER })],
    });
    await activate();

    const result = await runEmailPoll({ source, now: NOW });

    expect(queryText(source)).toContain(SENDER);
    expect(queryText(source)).not.toContain(OTHER_SENDER);
    expect(result.discovered).toBe(1);
  });

  it("EM-U04 — משתמש שההרשאה שלו בוטלה אינו נשאל", async () => {
    await seedUser(SENDER, { emailIntakeEnabled: false });
    await activate();
    const source = fakeMailSource({ messages: [firstMail()] });

    const result = await runEmailPoll({ source, now: NOW });

    // אין אף שולח מורשה, ולכן אין שאילתה כלל
    expect(source.callsTo("listIds")).toHaveLength(0);
    expect(result.senders).toBe(0);
    expect(result.discovered).toBe(0);
  });

  it("EM-04 — כתובת נוספת של משתמש מורשה נשאלת כמו המייל הראשי", async () => {
    await seedUser(SENDER, { aliases: [OTHER_SENDER] });
    await activate();
    const source = fakeMailSource({
      messages: [firstMail({ id: "gmail-alias", messageId: "a@example.com", from: OTHER_SENDER })],
    });

    const result = await runEmailPoll({ source, now: NOW });

    expect(queryText(source)).toContain(OTHER_SENDER);
    expect(result.discovered).toBe(1);
  });

  it("EM-U06 — משתמש בלי מייל ובלי כתובות נוספות אינו תורם שולח", async () => {
    await seedUser(null);
    await activate();
    const source = fakeMailSource();

    const result = await runEmailPoll({ source, now: NOW });

    expect(result.senders).toBe(0);
    expect(source.callsTo("listIds")).toHaveLength(0);
  });

  it("EM-04 — כתובת התיבה עצמה לעולם אינה שולח (§7 שורה 83)", async () => {
    // מצב חוקי לגמרי: התיבה המשותפת רשומה כמייל של משתמש במערכת
    await seedUser(MAILBOX);
    await seedUser(SENDER);
    await activate();
    const source = fakeMailSource({
      messages: [firstMail({ id: "gmail-self", messageId: "self@example.com", from: MAILBOX })],
    });

    const result = await runEmailPoll({ source, now: NOW });

    expect(queryText(source)).not.toContain(MAILBOX);
    expect(result.senders).toBe(1);
    expect(result.discovered).toBe(0);
  });

  it("EM-04 — מצב פיילוט מצמצם את הרשימה ואינו מרחיב אותה", async () => {
    await seedUser(SENDER);
    await seedUser(OTHER_SENDER);
    // כתובת שלישית ברשימת הפיילוט שאינה של משתמש מורשה — חיתוך, לא תוספת
    setEnv("EMAIL_INTAKE_PILOT_ADDRESSES", `${OTHER_SENDER.toUpperCase()}, ${STRANGER}`);
    await activate();
    const source = fakeMailSource({
      messages: [
        firstMail(),
        firstMail({ id: "gmail-other", messageId: "o@example.com", from: OTHER_SENDER }),
        firstMail({ id: "gmail-stranger", messageId: "s@example.com", from: STRANGER }),
      ],
    });

    const result = await runEmailPoll({ source, now: NOW });

    expect(result.senders).toBe(1);
    expect(queryText(source)).toContain(OTHER_SENDER);
    expect(queryText(source)).not.toContain(SENDER);
    expect(queryText(source)).not.toContain(STRANGER);
    expect(result.discovered).toBe(1);
  });

  it("EM-04 — רשימת שולחים ריקה מסיימת את הסבב בלי שאילתה, ובכל זאת בהצלחה", async () => {
    await activate();
    const source = fakeMailSource({ messages: [firstMail()] });

    const result = await runEmailPoll({ source, now: NOW });

    expect(result.status).toBe("ok");
    expect(result.queries).toBe(0);
    expect(source.callsTo("listIds")).toHaveLength(0);
    // סבב תקין שאין בו מה לקרוא הוא עדיין סבב תקין: בלי הפעימה כאן,
    // מערכת שטרם הוזן בה משתמש מורשה הייתה מתריעה כל רבע שעה.
    expect((await getHeartbeat(HEARTBEAT.emailPoll))?.toISOString()).toBe(NOW.toISOString());
    expect((await channelState())?.lastPollOkAt?.toISOString()).toBe(NOW.toISOString());
  });
});

// ─────────────────────────── 4+5. השאילתה והעימוד ───────────────────────────

describe("EM-21 — השאילתה והעימוד", () => {
  it("EM-21 — השאילתה סורקת את כל התיקיות ולעולם אינה נשענת על 'לא נקרא'", async () => {
    await seedUser(SENDER);
    await activate();
    const source = fakeMailSource({ messages: [firstMail()] });

    await runEmailPoll({ source, now: NOW });

    const query = queryText(source);
    expect(query).toContain("in:anywhere");
    expect(query).toContain("-in:spam");
    expect(query).toContain("-from:me");
    expect(query).not.toContain("is:unread");
  });

  it("EM-20 — הסבב מונה מזהים בלבד ואינו קורא אף הודעה", async () => {
    await seedUser(SENDER);
    await activate();
    const source = fakeMailSource({ messages: [firstMail()] });

    await runEmailPoll({ source, now: NOW });

    // גוף ההודעה אינו עניינו של הסבב: ההכרעה קוראת אותו, ורק אחרי שנקבע
    // שהיא שלנו. כך מייל של מערכת אחרת בתיבה המשותפת אינו נקרא כלל.
    expect(source.callsTo("getMessage")).toHaveLength(0);
    expect(source.callsTo("getAttachment")).toHaveLength(0);
  });

  it("EM-21 — העימוד ממשיך דרך אסימון העמוד ואוסף את כל המזהים", async () => {
    await seedUser(SENDER);
    await activate();
    const messages = [0, 1, 2].map((index) =>
      firstMail({ id: `gmail-${index}`, messageId: `m${index}@example.com` }),
    );
    const source = fakeMailSource({ messages, pageSize: 2 });

    const result = await runEmailPoll({ source, now: NOW });

    expect(result.pages).toBe(2);
    expect(result.saturated).toBe(0);
    expect(result.discovered).toBe(3);
  });

  it("EM-21 — תקרת העמודים מדווחת כרוויה ואינה מסתובבת לנצח", async () => {
    await seedUser(SENDER);
    await activate();
    const messages = Array.from({ length: MAX_PAGES_PER_QUERY + 5 }, (_, index) =>
      firstMail({ id: `gmail-${index}`, messageId: `m${index}@example.com` }),
    );
    const source = fakeMailSource({ messages, pageSize: 1 });

    const result = await runEmailPoll({ source, now: NOW });

    expect(result.pages).toBe(MAX_PAGES_PER_QUERY);
    expect(result.saturated).toBe(1);
    expect(result.discovered).toBe(MAX_PAGES_PER_QUERY);
    expect(result.status).toBe("ok");
  });

  it("EM-21 — כשל חולף באמצע הרשימה אינו מקדם את חלון הזמן ואינו מוחק את שנאסף", async () => {
    await seedUser(SENDER);
    await activate();
    const messages = [0, 1, 2, 3].map((index) =>
      firstMail({ id: `gmail-${index}`, messageId: `m${index}@example.com` }),
    );
    const inner = fakeMailSource({ messages, pageSize: 2 });
    // העמוד הראשון עובר והשני נופל. הכפיל מפיל לפי שיטה ולא לפי מספר
    // הקריאה, ולכן העטיפה כאן — היא מה שמייצר את הכשל **באמצע** הסבב,
    // שהוא המצב שנבדק: מה שכבר נאסף חייב להישאר.
    let listCalls = 0;
    const source: MailSource = {
      ...inner,
      async listIds(query, opts) {
        listCalls += 1;
        if (listCalls === 2) throw new MailSourceError("הרשימה נפלה", "transient", { status: 503 });
        return inner.listIds(query, opts);
      },
    };

    const result = await runEmailPoll({ source, now: NOW });

    expect(result.status).toBe("deferred");
    expect(result.discovered).toBe(2);
    expect(await db.mailboxMessage.count()).toBe(2);
    const state = await channelState();
    expect(state?.lastPollOkAt).toBeNull();
    expect(await getHeartbeat(HEARTBEAT.emailPoll)).toBeNull();
  });
});

// ─────────────────────────── 6. רישום ביומן ───────────────────────────

describe("EM-21 — היומן והייחודיות", () => {
  it("EM-02 — כל מזהה חדש מקבל שורה אחת וג׳וב EMAIL_INTAKE אחד, באותה טרנזאקציה", async () => {
    await seedUser(SENDER);
    await activate();
    const source = fakeMailSource({ messages: [firstMail()] });

    const result = await runEmailPoll({ source, now: NOW });

    expect(result.discovered).toBe(1);
    const rows = await db.mailboxMessage.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ direction: "INBOUND", state: "PENDING", gmailMessageId: "gmail-first" });
    // השורה נשמרת בלי כותרת ובלי גוף: הכרעה עדיין לא נעשתה, והתיבה משותפת
    expect(rows[0].subject).toBeNull();
    expect(rows[0].bodyText).toBeNull();

    const jobs = await intakeJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toEqual({ mailboxMessageId: rows[0].id });
  });

  it("EM-21 — סבב שני על אותם מזהים אינו מכניס דבר לתור", async () => {
    await seedUser(SENDER);
    await activate();
    const source = fakeMailSource({
      messages: [firstMail(), firstMail({ id: "gmail-2", messageId: "m2@example.com" })],
    });

    const first = await runEmailPoll({ source, now: NOW });
    const second = await runEmailPoll({ source, now: new Date(NOW.getTime() + 60_000) });

    expect(first.discovered).toBe(2);
    expect(second.discovered).toBe(0);
    expect(second.skipped).toBe(2);
    expect(await db.mailboxMessage.count()).toBe(2);
    expect(await intakeJobs()).toHaveLength(2);
  });

  it("EM-21 — שני סבבים במקביל על אותו מזהה מסתיימים בשורה אחת ובלי חריגה", async () => {
    await seedUser(SENDER);
    await activate();
    // הפעימה נזרעת מראש: שני סבבים שמריצים `upsert` על אותו מפתח בו-זמנית
    // הם מרוץ של הבדיקה ולא של הקוד הנבדק.
    await setHeartbeat(HEARTBEAT.emailPoll, ACTIVATED_AT);

    const one = fakeMailSource({ messages: [firstMail()] });
    const two = fakeMailSource({ messages: [firstMail()] });

    const [a, b] = await Promise.all([
      runEmailPoll({ source: one, now: NOW }),
      runEmailPoll({ source: two, now: NOW }),
    ]);

    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    expect(await db.mailboxMessage.count()).toBe(1);
    expect(await intakeJobs()).toHaveLength(1);
    // מזהה אחד, שני סבבים: אחד יצר, השני ראה אותו כידוע או הפסיד במרוץ
    expect(a.discovered + b.discovered).toBe(1);
    expect(a.skipped + b.skipped + a.raced + b.raced).toBe(1);
  });
});

// ─────────────────────────── 7. סריקת התקועים ───────────────────────────

describe("EM-12 — רשת הביטחון לשורה תקועה", () => {
  async function seedPending(overrides: { createdAt: Date; nextAttemptAt?: Date }): Promise<string> {
    const row = await db.mailboxMessage.create({
      data: {
        direction: "INBOUND",
        state: "PENDING",
        gmailMessageId: `stuck-${Math.random().toString(36).slice(2)}`,
        createdAt: overrides.createdAt,
        ...(overrides.nextAttemptAt ? { nextAttemptAt: overrides.nextAttemptAt } : {}),
      },
      select: { id: true },
    });
    return row.id;
  }

  it("EM-12 — שורה שממתינה מעל 10 דקות בלי ג׳וב חוזרת לתור, ופעם אחת בלבד", async () => {
    await activate();
    const id = await seedPending({ createdAt: new Date(NOW.getTime() - STUCK_AFTER_MS - 60_000) });
    const source = fakeMailSource();

    const first = await runEmailPoll({ source, now: NOW });
    const second = await runEmailPoll({ source, now: new Date(NOW.getTime() + 60_000) });

    expect(first.requeued).toBe(1);
    // הסבב הבא רואה ג׳וב חי ומדלג — אחרת כל דקה הייתה מוסיפה ג׳וב נוסף
    expect(second.requeued).toBe(0);

    const jobs = await intakeJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toEqual({ mailboxMessageId: id });
  });

  /** מדמה ג׳וב שזרק דטרמיניסטית עד שהתור נעל אותו — `failJob` אחרי המכסה */
  async function exhaustJobsFor(mailboxMessageId: string): Promise<void> {
    await enqueue(db, JOB_TYPES.emailIntake, { mailboxMessageId });
    await db.job.updateMany({
      where: { type: JOB_TYPES.emailIntake, status: "PENDING" },
      data: { status: "FAILED", attempts: MAX_ATTEMPTS, lastError: "באג פרסור MIME" },
    });
  }

  it("EM-12 — שורה שהג׳וב שלה מיצה את המכסה אינה מוחזרת לתור, ולא בשום סבב אחר כך", async () => {
    await activate();
    const id = await seedPending({ createdAt: new Date(NOW.getTime() - STUCK_AFTER_MS - 60_000) });
    await exhaustJobsFor(id);

    // שלושה סבבים על פני 20 דקות, כשבין סבב לסבב העובד שורף את שלושת
    // הניסיונות של כל ג׳וב חדש — זהו בדיוק מחזור ה-7 דקות (1+5 דקות backoff
    // ואז נעילה ל-FAILED) שמייצר לולאה בלי סוף.
    const rounds: EmailPollResult[] = [];
    for (const minutes of [0, 7, 14]) {
      rounds.push(await runEmailPoll({ source: fakeMailSource(), now: new Date(NOW.getTime() + minutes * 60_000) }));
      await db.job.updateMany({
        where: { type: JOB_TYPES.emailIntake, status: "PENDING" },
        data: { status: "FAILED", attempts: MAX_ATTEMPTS, lastError: "באג פרסור MIME" },
      });
    }

    // ג׳וב שמיצה את שלושת ניסיונותיו נראה בבסיס הנתונים **בדיוק** כמו ג׳וב
    // שנעלם: שניהם אינם PENDING ואינם RUNNING. ההחייאה על סמך ההיעדר לבדו
    // מבטלת את מכסת התור — כל סבב מחזיר לתור הודעה שנכשלת דטרמיניסטית,
    // ואיתה את כל מה שקודם לטרנזאקציה: `getMessage`, הורדת קבצים, כתיבה
    // ל-R2 וקריאה למנוע החילוץ.
    expect(rounds.map((round) => round.requeued)).toEqual([0, 0, 0]);
    expect(rounds[0].exhausted).toBe(1);
    expect(await intakeJobs()).toHaveLength(1);
  });

  it("EM-12 — ג׳וב שהושלם בעוד השורה נשארה PENDING עדיין מוחזר לתור", async () => {
    await activate();
    const id = await seedPending({ createdAt: new Date(NOW.getTime() - STUCK_AFTER_MS - 60_000) });
    // ג׳וב שהושלם בהצלחה אך השורה נשארה PENDING (שני כתיבות שלא הסתיימו
    // יחד) — זה עדיין מצב בלי בעלים, והרשת חייבת לתפוס אותו.
    await enqueue(db, JOB_TYPES.emailIntake, { mailboxMessageId: id });
    await db.job.updateMany({ where: { type: JOB_TYPES.emailIntake }, data: { status: "DONE" } });

    const result = await runEmailPoll({ source: fakeMailSource(), now: NOW });

    expect(result.requeued).toBe(1);
    expect(result.exhausted).toBe(0);
    expect(await intakeJobs()).toHaveLength(2);
  });

  it("EM-12 — ג׳וב של שורה אחרת שמיצה את המכסה אינו חוסם שורה תקועה", async () => {
    await activate();
    const stuck = await seedPending({ createdAt: new Date(NOW.getTime() - STUCK_AFTER_MS - 60_000) });
    const poisoned = await seedPending({ createdAt: new Date(NOW.getTime() - STUCK_AFTER_MS - 60_000) });
    await exhaustJobsFor(poisoned);

    const result = await runEmailPoll({ source: fakeMailSource(), now: NOW });

    // ההבחנה היא לפי `mailboxMessageId` שבמטען, ולא לפי סוג הג׳וב
    expect(result.requeued).toBe(1);
    expect(result.exhausted).toBe(1);
    const jobs = await intakeJobs();
    expect(jobs.filter((job) => job.status === "PENDING").map((job) => job.payload)).toEqual([
      { mailboxMessageId: stuck },
    ]);
  });

  it("EM-12 — שורה שיש לה ג׳וב ממתין אינה מוחזרת לתור", async () => {
    await activate();
    const id = await seedPending({ createdAt: new Date(NOW.getTime() - STUCK_AFTER_MS - 60_000) });
    await enqueue(db, JOB_TYPES.emailIntake, { mailboxMessageId: id });

    const result = await runEmailPoll({ source: fakeMailSource(), now: NOW });

    expect(result.requeued).toBe(0);
    // ולא "מוצתה": ג׳וב שממתין לניסיון חוזר הוא המסלול התקין, ודיווח עליו
    // כתקלה דטרמיניסטית היה פותח issue ב-Sentry בכל backoff רגיל מול Gmail.
    expect(result.exhausted).toBe(0);
    expect(await intakeJobs()).toHaveLength(1);
  });

  it("EM-12 — שורה צעירה מ-10 דקות אינה נחשבת תקועה", async () => {
    await activate();
    await seedPending({ createdAt: new Date(NOW.getTime() - 5 * 60_000) });

    const result = await runEmailPoll({ source: fakeMailSource(), now: NOW });

    expect(result.requeued).toBe(0);
    expect(await intakeJobs()).toHaveLength(0);
  });

  it("EM-12 — שורה שנדחתה לניסיון חוזר עתידי אינה תקועה אלא ממתינה", async () => {
    await activate();
    await seedPending({
      createdAt: new Date(NOW.getTime() - 2 * 60 * 60_000),
      nextAttemptAt: new Date(NOW.getTime() + 30 * 60_000),
    });

    const result = await runEmailPoll({ source: fakeMailSource(), now: NOW });

    expect(result.requeued).toBe(0);
  });

  it("EM-12 — שורה יוצאת שממתינה לשליחה אינה עניינה של הסריקה", async () => {
    await activate();
    await db.mailboxMessage.create({
      data: {
        direction: "OUTBOUND",
        state: "PENDING",
        createdAt: new Date(NOW.getTime() - 60 * 60_000),
      },
    });

    const result = await runEmailPoll({ source: fakeMailSource(), now: NOW });

    expect(result.requeued).toBe(0);
    expect(await intakeJobs()).toHaveLength(0);
  });
});

// ─────────────────────────── 8. סגירת הסבב ───────────────────────────

describe("EM-12 — פעימת הסבב", () => {
  it("EM-12 — סבב מוצלח כותב פעימה בזמן שלו", async () => {
    await activate();
    await seedUser(SENDER);

    await runEmailPoll({ source: fakeMailSource({ messages: [firstMail()] }), now: NOW });

    expect((await getHeartbeat(HEARTBEAT.emailPoll))?.toISOString()).toBe(NOW.toISOString());
  });

  it("EM-12 — פעימה ישנה נשארת ישנה כשהסבב נעצר", async () => {
    await activate();
    await setHeartbeat(HEARTBEAT.emailPoll, ACTIVATED_AT);
    const source = fakeMailSource({ profile: "someone-else@example.com" });

    await runEmailPoll({ source, now: NOW });

    expect((await getHeartbeat(HEARTBEAT.emailPoll))?.toISOString()).toBe(ACTIVATED_AT.toISOString());
  });
});

// ─────────────────────────── בחירת התיבה ───────────────────────────

describe("EM-20 — בחירת מקור הקריאה", () => {
  it("EM-20 — בלי טוקן אין נפילה חיננית: `selectMailSource` זורק", async () => {
    const backup = process.env.GMAIL_REFRESH_TOKEN;
    delete process.env.GMAIL_REFRESH_TOKEN;
    try {
      expect(() => selectMailSource()).toThrow(/GMAIL_REFRESH_TOKEN/);
    } finally {
      if (backup === undefined) delete process.env.GMAIL_REFRESH_TOKEN;
      else process.env.GMAIL_REFRESH_TOKEN = backup;
    }
  });
});

// ─────────────────────── הטיימר מחובר לעליית העובד ───────────────────────

describe("EM-12 — אתר הקריאה לטיימר", () => {
  /**
   * **בדיקת מקור כטקסט, ובכוונה.**
   *
   * כל שאר הקובץ בודק את הסבב ואת הטיימר עצמם, ושניהם עוברים בשלמות גם
   * כשאיש אינו מפעיל אותם: `startEmailPoller` הוא `export` שאין לו אף אתר
   * קריאה ב-`src/`. במצב הזה, עם `EMAIL_INTAKE_ENABLED=1` בפרודקשן, אף סבב
   * לא ירוץ — לא תיווצר `MailChannelState`, לא תיווצר שורת `MailboxMessage`
   * ואף ג׳וב `EMAIL_INTAKE` לא ייכנס לתור — **בלי שום שגיאה**. זהו הכשל
   * השקט המושלם, והוא בדיוק מה שהצינור כולו נבנה כדי למנוע.
   *
   * אי אפשר לתפוס אותו בבדיקה התנהגותית בלי להעלות את `startWorker` עצמו
   * (שתי לולאות תור, watchdog וטיימר — בתהליך הבדיקה), ולכן הטענה נבדקת על
   * הטקסט: הקובץ שמעלה את העובד חייב להכיל את הקריאה.
   *
   * `src/jobs/worker.ts` אינו בבעלות המודול הזה (מודול A), ולכן התיקון הוא
   * שורה אחת שם ולא כאן.
   */
  it("EM-12 — `startWorker` מפעיל את טיימר הקליטה", () => {
    const worker = stripComments(readFileSync(join(process.cwd(), "src", "jobs", "worker.ts"), "utf8"));

    expect(worker, "חסר ב-src/jobs/worker.ts: import { startEmailPoller } from \"./email-poller\"").toContain(
      "startEmailPoller",
    );
    expect(worker, "חסר ב-startWorker(): הקריאה startEmailPoller(); ליד startLaneLoop").toMatch(
      /startEmailPoller\s*\(/,
    );
  });
});

// ─────────────────────────── הטיימר ───────────────────────────

describe("EM-12 — הטיימר", () => {
  const OK_RESULT: EmailPollResult = {
    status: "ok",
    senders: 0,
    queries: 0,
    pages: 0,
    discovered: 0,
    skipped: 0,
    raced: 0,
    saturated: 0,
    requeued: 0,
    exhausted: 0,
  };

  let stop: (() => void) | null = null;

  afterEach(() => {
    stop?.();
    stop = null;
    vi.useRealTimers();
  });

  function enableFeature(): void {
    setEnv("EMAIL_INTAKE_ENABLED", "1");
    setEnv("EMAIL_INTAKE_NONPROD", "1");
  }

  it("EM-12 — היכולת כבויה: לא נוצר טיימר כלל", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => OK_RESULT);

    stop = startEmailPoller({ run });
    await vi.advanceTimersByTimeAsync(5 * EMAIL_POLL_INTERVAL_MS);

    expect(run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("EM-12 — היכולת דלוקה: סבב בכל פעימה", async () => {
    enableFeature();
    vi.useFakeTimers();
    const run = vi.fn(async () => OK_RESULT);

    stop = startEmailPoller({ run });
    await vi.advanceTimersByTimeAsync(3 * EMAIL_POLL_INTERVAL_MS);

    expect(run).toHaveBeenCalledTimes(3);
  });

  it("EM-12 — סבב שעדיין רץ אינו נחפף בסבב שני", async () => {
    enableFeature();
    vi.useFakeTimers();
    // סבב שאינו נגמר — 20 עמודים מול תיבה איטית חורגים מדקה
    const run = vi.fn(() => new Promise<never>(() => {}));

    stop = startEmailPoller({ run });
    await vi.advanceTimersByTimeAsync(5 * EMAIL_POLL_INTERVAL_MS);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("EM-12 — קריאה שנייה אינה יוצרת טיימר שני", async () => {
    enableFeature();
    vi.useFakeTimers();
    const run = vi.fn(async () => OK_RESULT);

    stop = startEmailPoller({ run });
    const second = startEmailPoller({ run });
    await vi.advanceTimersByTimeAsync(EMAIL_POLL_INTERVAL_MS);

    expect(run).toHaveBeenCalledTimes(1);
    expect(second).toBe(stop);
  });

  it("EM-12 — הפעלת הטיימר זורעת את הפעימה, לפני שה-watchdog מספיק לשאול", async () => {
    enableFeature();
    // בלי זריעה `getHeartbeat` מחזיר null, `heartbeatStale(null)` אמיתי,
    // וריצת ה-watchdog הראשונה (30 שניות אחרי העלייה) פותחת issue "מעולם לא
    // רץ" — עוד לפני שהסבב הראשון (60 שניות) הספיק לרוץ. כלומר כל פריסה
    // שבה היכולת דלוקה מייצרת התראת שווא, וההתראה מפסיקה להבדיל בין
    // "הטיימר מת" ל"הטיימר עוד לא הספיק".
    expect(await getHeartbeat(HEARTBEAT.emailPoll)).toBeNull();
    const run = vi.fn(async () => OK_RESULT);

    stop = startEmailPoller({ run, intervalMs: 10 });

    await vi.waitFor(
      async () => {
        expect(await getHeartbeat(HEARTBEAT.emailPoll)).not.toBeNull();
      },
      { timeout: 5_000, interval: 20 },
    );
  });

  it("EM-12 — הזריעה אינה דורסת פעימה קיימת", async () => {
    enableFeature();
    // `seedHeartbeat` ולא `setHeartbeat`: פעימה ישנה **נשארת ישנה**, אחרת
    // כל פריסה הייתה מאפסת את שעון ההתיישנות ומשתיקה את ה-watchdog — בדיוק
    // הבאג שהסתיר 32 לילות גיבוי כושלים (`heartbeat.ts`).
    await setHeartbeat(HEARTBEAT.emailPoll, ACTIVATED_AT);
    const run = vi.fn(async () => OK_RESULT);

    stop = startEmailPoller({ run, intervalMs: 10 });
    // שלוש פעימות של 10ms — בזמן הזה הזריעה, שנשלחה ב-t=0, כבר חזרה מה-DB
    await vi.waitFor(() => expect(run.mock.calls.length).toBeGreaterThanOrEqual(3), {
      timeout: 5_000,
      interval: 20,
    });

    expect((await getHeartbeat(HEARTBEAT.emailPoll))?.toISOString()).toBe(ACTIVATED_AT.toISOString());
  });

  it("EM-12 — היכולת כבויה: אין טיימר ואין זריעה", async () => {
    stop = startEmailPoller({ run: vi.fn(async () => OK_RESULT), intervalMs: 10 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // פעימה שנזרעת כשהיכולת כבויה הייתה מייצרת שורה שאיש אינו מעדכן —
    // וה-check עצמו מדלג ממילא כשהדגל כבוי, ולכן אין לה שום צרכן.
    expect(await getHeartbeat(HEARTBEAT.emailPoll)).toBeNull();
  });

  it("EM-12 — סבב שזרק אינו הורג את הטיימר", async () => {
    enableFeature();
    vi.useFakeTimers();
    const run = vi.fn(async () => {
      throw new Error("בסיס הנתונים אינו נגיש");
    });

    stop = startEmailPoller({ run });
    await vi.advanceTimersByTimeAsync(3 * EMAIL_POLL_INTERVAL_MS);

    expect(run).toHaveBeenCalledTimes(3);
  });

  it("EM-12 — בלי הזרקה הטיימר מריץ את `runEmailPoll` האמיתי, עד בסיס הנתונים", async () => {
    enableFeature();

    /**
     * **הבדיקה היחידה שמפעילה את ברירת המחדל של `run`.** בכל האחרות מוזרק
     * `run`, ולכן הן עוברות גם אילו הטיימר היה מנותק מהסבב לגמרי. כדי
     * להבחין, צריך סימן שרק `runEmailPoll` האמיתי יכול לייצר — וכאן זה
     * `lastPollError` שנכתב על שורת הערוץ.
     *
     * **ואין כאן רשת.** שלושת משתני ה-OAuth מקובעים לערכים מזויפים כדי
     * ש-`selectMailSource()` יצליח (הבנייה עצמה אינה פונה לשום מקום), אבל
     * `GMAIL_USER` מוסר — ולכן `guardMailbox` נעצר בשורתו הראשונה ומחזיר
     * `halted` **לפני** הקריאה ל-`getProfile()`. זה המסלול היחיד בסבב
     * שמגיע לבסיס הנתונים בלי לגעת ב-Gmail.
     */
    const oauthBackup = {
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
      GMAIL_REFRESH_TOKEN: process.env.GMAIL_REFRESH_TOKEN,
      GMAIL_USER: process.env.GMAIL_USER,
    };
    process.env.GOOGLE_CLIENT_ID = "fake-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "fake-client-secret";
    process.env.GMAIL_REFRESH_TOKEN = "fake-refresh-token";
    delete process.env.GMAIL_USER;
    await activate();

    try {
      stop = startEmailPoller({ intervalMs: 10 });

      await vi.waitFor(
        async () => {
          expect((await channelState())?.lastPollError).toContain("GMAIL_USER");
        },
        { timeout: 5_000, interval: 20 },
      );

      // והטיימר שרד את הסבב שנעצר: `lastPollAt` ממשיך להתקדם
      const firstAt = (await channelState())?.lastPollAt;
      await vi.waitFor(
        async () => {
          const at = (await channelState())?.lastPollAt;
          expect(at?.getTime() ?? 0).toBeGreaterThan(firstAt?.getTime() ?? 0);
        },
        { timeout: 5_000, interval: 20 },
      );

      // סבב שנעצר אינו מקדם דבר ואינו קולט דבר
      expect((await channelState())?.lastPollOkAt).toBeNull();
      expect(await db.mailboxMessage.count()).toBe(0);
    } finally {
      for (const [name, value] of Object.entries(oauthBackup)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
