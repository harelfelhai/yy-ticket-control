import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/whatsapp/webhook/route";
import { JOB_TYPES } from "@/jobs/types";
import { processNextJob } from "@/jobs/worker";
import { db } from "@/lib/db";
import { processWebhookEvent } from "@/lib/services/wa-webhook";
import { resetDb } from "../helpers/reset-db";

/**
 * ה-webhook של וואטסאפ מקצה לקצה (אפיון §2.7, §5.ה5): חתימה, שמירה גולמית,
 * פענוח, יומן וההכרעות הזולות — על **גופים אמיתיים** מהספייק W0.
 *
 * ה-route נקרא ישירות, עם `Request` אמיתי; ההחתמה בסוד בדיקה (ראו
 * `wa-signature.test.ts`). השולח ב-fixtures הוא `972500000002`, ובכרטיס הוא
 * `0500000002`.
 */

const SECRET = "test-app-secret";
const VERIFY = "test-verify-token";
const ENDPOINT = "http://localhost:3100/api/whatsapp/webhook";
const PHONE_NUMBER_ID = "300000000000002";
const ACTIVATED = new Date("2026-10-04T16:00:00Z");
/** אחרי כל ה-fixtures (16:51–17:08) */
const NOW = new Date("2026-10-04T17:30:00Z");
const FIXTURES = join(process.cwd(), "tests", "fixtures", "whatsapp");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.json`), "utf8");
}

/** גוף אמיתי עם שינוי — לסוגים שלא נאספו בספייק */
function derivedBody(name: string, patch: (value: Record<string, unknown>) => void): string {
  const body = JSON.parse(fixture(name));
  patch(body.entry[0].changes[0].value);
  return JSON.stringify(body);
}

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function post(body: string, signature: string | null = sign(body)) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["x-hub-signature-256"] = signature;
  return POST(new Request(ENDPOINT, { method: "POST", headers, body }));
}

async function connectNumber(overrides: { status?: "CONNECTED" | "DISCONNECTED" | "ERROR"; activatedAt?: Date } = {}) {
  return db.waNumber.create({
    data: {
      phoneNumberId: PHONE_NUMBER_ID,
      wabaId: "200000000000002",
      displayPhone: "15550001234",
      tokenCipher: "cipher",
      activatedAt: ACTIVATED,
      ...overrides,
    },
  });
}

async function makeUser(overrides: { phone?: string; active?: boolean; whatsappIntakeEnabled?: boolean; whatsappUserId?: string } = {}) {
  return db.user.create({
    data: { role: "ADMIN", name: "בודק", phone: "0500000002", passwordHash: "x", ...overrides },
  });
}

/** שומר משלוח חתום ומעבד אותו, כמו ה-route ואחריו ג׳וב `WA_EVENT` */
async function deliver(body: string) {
  const response = await post(body);
  expect(response.status).toBe(200);
  const events = await db.waWebhookEvent.findMany({ where: { processedAt: null }, select: { id: true } });
  for (const event of events) await processWebhookEvent({ webhookEventId: event.id }, { now: NOW });
}

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", VERIFY);
  vi.stubEnv("WHATSAPP_INTAKE_ENABLED", "1");
  vi.stubEnv("WHATSAPP_INTAKE_NONPROD", "1");
  vi.stubEnv("WHATSAPP_INTAKE_PILOT_PHONES", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db.$disconnect();
});

// ─────────────────────────────── GET ───────────────────────────────

describe("GET — אימות כתובת ה-webhook מול Meta", () => {
  const verifyUrl = (params: Record<string, string>) => `${ENDPOINT}?${new URLSearchParams(params)}`;

  it("ה-verify token הנכון מחזיר את ה-challenge כטקסט", async () => {
    const response = await GET(
      new Request(verifyUrl({ "hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "1158201444" })),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("1158201444");
  });

  it("token שגוי, mode אחר או בלי challenge — 403", async () => {
    const cases: Record<string, string>[] = [
      { "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "1" },
      { "hub.mode": "unsubscribe", "hub.verify_token": VERIFY, "hub.challenge": "1" },
      { "hub.mode": "subscribe", "hub.verify_token": VERIFY },
    ];
    for (const params of cases) {
      expect((await GET(new Request(verifyUrl(params)))).status).toBe(403);
    }
  });

  it("בלי תצורה — 404: אין דרך לדעת שהבקשה מ-Meta", async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "");
    const response = await GET(
      new Request(verifyUrl({ "hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "1" })),
    );
    expect(response.status).toBe(404);
  });
});

// ─────────────────────────────── POST ───────────────────────────────

describe("POST — חתימה ושמירה גולמית", () => {
  it("חתימה תקינה: 200, הגוף נשמר כמו שהגיע, וג׳וב פענוח נוצר", async () => {
    const body = fixture("text-report");
    expect((await post(body)).status).toBe(200);

    const events = await db.waWebhookEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]?.body).toBe(body);
    const jobs = await db.job.findMany({ where: { type: JOB_TYPES.waEvent } });
    expect(jobs.map((job) => job.payload)).toEqual([{ webhookEventId: events[0]?.id }]);
  });

  it("חתימה שגויה, בסוד אחר או חסרה — 401, ולא נכתב דבר", async () => {
    const body = fixture("text-report");
    expect((await post(body, sign(body, "other-secret"))).status).toBe(401);
    expect((await post(body, "sha256=00")).status).toBe(401);
    expect((await post(body, null)).status).toBe(401);
    expect(await db.waWebhookEvent.count()).toBe(0);
    expect(await db.job.count()).toBe(0);
  });

  it("גוף ששונה אחרי החתימה — 401", async () => {
    const body = fixture("text-report");
    const response = await post(body.replace("נזילה", "נזילת"), sign(body));
    expect(response.status).toBe(401);
  });

  it("כשל בשמירה — 500, כדי ש-Meta תנסה שוב", async () => {
    vi.spyOn(db, "$transaction").mockRejectedValueOnce(new Error("db down"));
    expect((await post(fixture("text-report"))).status).toBe(500);
  });

  it("בלי תצורה — 404 גם עם חתימה", async () => {
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "");
    expect((await post(fixture("text-report"))).status).toBe(404);
    expect(await db.waWebhookEvent.count()).toBe(0);
  });
});

// ─────────────────────────────── הפענוח והיומן ───────────────────────────────

describe("processWebhookEvent — היומן וההכרעות הזולות", () => {
  it("WA-01/WA-04 — משתמש מורשה: שורה ממתינה עם הטקסט, השולח וג׳וב קיבוץ; הגוף מאופס", async () => {
    await connectNumber();
    const user = await makeUser();
    await deliver(fixture("text-report"));

    const [row] = await db.waMessage.findMany();
    expect(row).toMatchObject({
      direction: "INBOUND",
      state: "PENDING",
      outcome: null,
      authorUserId: user.id,
      type: "text",
      text: "תקלה בדירה 12 — נזילה במטבח",
      profileName: "בודק 2",
      waId: "972500000002",
      bsuid: "IL.1000000000000000002",
    });
    const jobs = await db.job.findMany({ where: { type: JOB_TYPES.waIntake } });
    expect(jobs.map((job) => job.payload)).toEqual([{ waMessageId: row?.id }]);
    // ההודעה ישנה מ-90 שניות, ולכן הג׳וב זמין מיד
    expect(jobs[0]?.runAt.getTime()).toBe(NOW.getTime());

    const [event] = await db.waWebhookEvent.findMany();
    expect(event).toMatchObject({ body: null, error: null });
    expect(event?.processedAt).not.toBeNull();
  });

  it("WA-21 — המזהה שוואטסאפ מצמידה לשולח נשמר על המשתמש בהודעה הראשונה שזוהתה לפי טלפון", async () => {
    await connectNumber();
    const user = await makeUser();
    await deliver(fixture("text-report"));
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).whatsappUserId).toBe("IL.1000000000000000002");
  });

  it("WA-21 — טלפון מוסתר ומזהה מוכר: מזוהה; מזהה לא מוכר עם \"תקלה\": נספר, ולא נקלט", async () => {
    await connectNumber();
    const hidden = (bsuid: string) =>
      derivedBody("text-report", (value) => {
        const messages = value.messages as Record<string, unknown>[];
        delete messages[0]?.from;
        if (messages[0]) messages[0].from_user_id = bsuid;
        value.contacts = [{ user_id: bsuid, profile: { name: "בודק 2" } }];
      });

    const user = await makeUser({ whatsappUserId: "IL.KNOWN" });
    await deliver(hidden("IL.KNOWN"));
    expect(await db.waMessage.findFirstOrThrow()).toMatchObject({ state: "PENDING", authorUserId: user.id });

    await resetDb();
    await connectNumber();
    await deliver(hidden("IL.STRANGER"));
    expect(await db.waMessage.findFirstOrThrow()).toMatchObject({
      state: "DONE",
      outcome: "IGNORED_UNIDENTIFIED",
      text: null,
      authorUserId: null,
    });
  });

  it("WA-04 — טלפון שאינו בכרטיס אינו מזוהה, גם כשהמזהה שלו מוכר", async () => {
    await connectNumber();
    await makeUser({ phone: "0509999999", whatsappUserId: "IL.1000000000000000002" });
    await deliver(fixture("text-report"));
    expect(await db.waMessage.findFirstOrThrow()).toMatchObject({ outcome: "IGNORED_UNAUTHORIZED", authorUserId: null });
  });

  it("WA-03 — מספר שאינו של משתמש: נשמרים מזהה, מספר והכרעה — בלי טקסט, שם או ג׳וב", async () => {
    await connectNumber();
    await deliver(fixture("text-report"));
    expect(await db.waMessage.findFirstOrThrow()).toMatchObject({
      state: "DONE",
      outcome: "IGNORED_UNAUTHORIZED",
      text: null,
      profileName: null,
      waId: "972500000002",
    });
    expect(await db.job.count({ where: { type: JOB_TYPES.waIntake } })).toBe(0);
  });

  it("משתמש מושבת, או שהמתג שלו כבוי — כמו מספר זר", async () => {
    await connectNumber();
    await makeUser({ active: false });
    await deliver(fixture("text-report"));
    expect((await db.waMessage.findFirstOrThrow()).outcome).toBe("IGNORED_UNAUTHORIZED");

    await resetDb();
    await connectNumber();
    await makeUser({ whatsappIntakeEnabled: false });
    await deliver(fixture("text-report"));
    expect((await db.waMessage.findFirstOrThrow()).outcome).toBe("IGNORED_UNAUTHORIZED");
  });

  it("פיילוט: רק הטלפונים שבו נקלטים", async () => {
    await connectNumber();
    await makeUser();
    vi.stubEnv("WHATSAPP_INTAKE_PILOT_PHONES", "0501111111");
    await deliver(fixture("text-report"));
    expect((await db.waMessage.findFirstOrThrow()).outcome).toBe("IGNORED_UNAUTHORIZED");

    await resetDb();
    await connectNumber();
    await makeUser();
    vi.stubEnv("WHATSAPP_INTAKE_PILOT_PHONES", "050-0000002");
    await deliver(fixture("text-report"));
    expect((await db.waMessage.findFirstOrThrow()).state).toBe("PENDING");
  });

  it("WA-19 — קליטה כבויה: IGNORED_DISABLED, בלי זיהוי ובלי תוכן", async () => {
    await connectNumber();
    const user = await makeUser();
    vi.stubEnv("WHATSAPP_INTAKE_ENABLED", "");
    await deliver(fixture("text-report"));
    expect(await db.waMessage.findFirstOrThrow()).toMatchObject({ outcome: "IGNORED_DISABLED", text: null, authorUserId: null });
    // הקליטה כבויה — גם המזהה אינו נלמד
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).whatsappUserId).toBeNull();
  });

  it("WA-19 — מספר שאינו מחובר: IGNORED_DISABLED", async () => {
    await connectNumber({ status: "DISCONNECTED" });
    await makeUser();
    await deliver(fixture("text-report"));
    expect((await db.waMessage.findFirstOrThrow()).outcome).toBe("IGNORED_DISABLED");
  });

  it("WA-14 — הודעה שנכתבה לפני חיבור המספר: היסטוריה, לא קלט", async () => {
    await connectNumber({ activatedAt: new Date("2026-10-04T17:00:00Z") });
    await makeUser();
    await deliver(fixture("text-report"));
    expect((await db.waMessage.findFirstOrThrow()).outcome).toBe("IGNORED_BEFORE_ACTIVATION");
  });

  it("WA-06 — סטיקר ממשתמש מורשה: IGNORED_UNSUPPORTED", async () => {
    await connectNumber();
    await makeUser();
    await deliver(
      derivedBody("text-report", (value) => {
        const message = (value.messages as Record<string, unknown>[])[0]!;
        message.type = "sticker";
        delete message.text;
        message.sticker = { mime_type: "image/webp", id: "st-1" };
      }),
    );
    expect((await db.waMessage.findFirstOrThrow()).outcome).toBe("IGNORED_UNSUPPORTED");
  });

  // המבנה לפי התיעוד של Meta (webhooks/reference/messages/edit, …/revoke — נבדק ב-6.10.2026):
  // סוג משלו בשדה `messages`, וההודעה המקורית ב-`original_message_id`. לא נאסף בספייק —
  // החשבון ננעל. המקרה המסוכן הוא עריכה שמוסיפה "תקלה": היא אינה הודעה חדשה.
  it.each([
    ["edit", { original_message_id: "wamid.ORIG", message: { type: "text", text: { body: "תקלה בדירה 12 — וגם בקיר" } } }],
    ["revoke", { original_message_id: "wamid.ORIG" }],
  ])(
    "WA-20 — %s של הודעה שכבר בטיוטה: IGNORED_UNSUPPORTED, והטיוטה וההודעה המקורית אינן משתנות",
    async (type, payload) => {
      const number = await connectNumber();
      const user = await makeUser();
      const ticket = await db.ticket.create({
        data: { createdById: user.id, channel: "WHATSAPP", isDraft: true, description: "נזילה מהתקרה" },
      });
      const thread = await db.waThread.create({ data: { ticketId: ticket.id } });
      const original = await db.waMessage.create({
        data: {
          direction: "INBOUND",
          state: "DONE",
          outcome: "DRAFT_CREATED",
          numberId: number.id,
          authorUserId: user.id,
          type: "text",
          text: "תקלה — נזילה מהתקרה",
          wamid: "wamid.ORIG",
          threadId: thread.id,
          receivedAt: ACTIVATED,
        },
      });

      await deliver(
        derivedBody("text-report", (value) => {
          const message = (value.messages as Record<string, unknown>[])[0]!;
          message.type = type;
          delete message.text;
          message[type] = payload;
        }),
      );

      expect(await db.waMessage.findFirstOrThrow({ where: { id: { not: original.id } } })).toMatchObject({
        state: "DONE",
        outcome: "IGNORED_UNSUPPORTED",
        text: null,
        threadId: null,
      });
      expect(await db.waMessage.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({
        text: "תקלה — נזילה מהתקרה",
        outcome: "DRAFT_CREATED",
      });
      expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).description).toBe("נזילה מהתקרה");
      expect(await db.job.count({ where: { type: JOB_TYPES.waIntake } })).toBe(0);
    },
  );

  it("תמונה עם כיתוב והקלטה: הקובץ נרשם לפי מזהה בלבד, וה-sha256 ב-hex", async () => {
    await connectNumber();
    await makeUser();
    await deliver(fixture("image-caption"));
    await deliver(fixture("voice"));

    const media = await db.waMedia.findMany({ orderBy: { waMediaId: "asc" } });
    expect(media).toMatchObject([
      { waMediaId: "1000000000000101", mimeType: "image/jpeg", voice: false, storageKey: null },
      { waMediaId: "1000000000000102", mimeType: "audio/ogg; codecs=opus", voice: true },
    ]);
    expect(media[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await db.waMessage.findFirstOrThrow({ where: { type: "image" } })).text).toBe("תקלה");
  });

  it("WA-13 — אותו משלוח פעמיים: שני אירועים, הודעה אחת וג׳וב קיבוץ אחד", async () => {
    await connectNumber();
    await makeUser();
    await deliver(fixture("text-report"));
    await deliver(fixture("text-report"));
    expect(await db.waWebhookEvent.count()).toBe(2);
    expect(await db.waMessage.count()).toBe(1);
    expect(await db.job.count({ where: { type: JOB_TYPES.waIntake } })).toBe(1);
  });

  it("WA-15 — הודעה שהצוות כתב מהאפליקציה בטלפון (smb_message_echoes) אינה נקלטת", async () => {
    await connectNumber();
    await makeUser();
    const body = JSON.parse(fixture("text-report"));
    const change = body.entry[0].changes[0];
    change.field = "smb_message_echoes";
    change.value.message_echoes = change.value.messages;
    delete change.value.messages;
    await deliver(JSON.stringify(body));
    expect(await db.waMessage.count()).toBe(0);
    expect(await db.waWebhookEvent.findFirstOrThrow()).toMatchObject({ body: null, error: null });
  });

  it("מספר עסקי שאינו מוכר (מערכת אחרת על אותה אפליקציה): אין שורה, והאירוע מעובד", async () => {
    await makeUser();
    await deliver(fixture("text-report"));
    expect(await db.waMessage.count()).toBe(0);
    expect((await db.waWebhookEvent.findFirstOrThrow()).processedAt).not.toBeNull();
  });

  it("סטטוס על הודעה שלנו: נכשלה עם הקוד; נמסרה ונקראה עם המועד", async () => {
    const number = await connectNumber();
    const failedWamid = JSON.parse(fixture("status-failed")).entry[0].changes[0].value.statuses[0].id as string;
    await db.waMessage.create({ data: { direction: "OUTBOUND", state: "SENT", numberId: number.id, type: "text", wamid: failedWamid } });

    await deliver(fixture("status-failed"));
    expect(await db.waMessage.findFirstOrThrow()).toMatchObject({ state: "FAILED", errorCode: 131031 });

    const delivered = derivedBody("status-failed", (value) => {
      const status = (value.statuses as Record<string, unknown>[])[0]!;
      status.status = "delivered";
      delete status.errors;
    });
    await db.waMessage.updateMany({ data: { state: "SENT", errorCode: null } });
    await deliver(delivered);
    expect((await db.waMessage.findFirstOrThrow()).deliveredAt).toEqual(new Date(1791133726 * 1000));
  });

  it("גוף שאינו במבנה של Meta: נשאר שמור עם השגיאה, ומסומן מעובד", async () => {
    await deliver(JSON.stringify({ hello: "world" }));
    const event = await db.waWebhookEvent.findFirstOrThrow();
    expect(event.body).toBe(JSON.stringify({ hello: "world" }));
    expect(event.error).toMatch(/מבנה/);
    expect(event.processedAt).not.toBeNull();
  });

  it("הודעה שאינה במבנה המינימלי: הגוף נשאר שמור, והשאר נקלטות", async () => {
    await connectNumber();
    await makeUser();
    await deliver(
      derivedBody("text-report", (value) => {
        (value.messages as unknown[]).unshift({ from: "972500000002", type: "text", text: { body: "בלי מזהה" } });
      }),
    );
    expect(await db.waMessage.count()).toBe(1);
    const event = await db.waWebhookEvent.findFirstOrThrow();
    expect(event.body).not.toBeNull();
    expect(event.error).toMatch(/הודעה/);
  });
});

// ─────────────────────────────── הנתיב המלא ───────────────────────────────

describe("הנתיב המלא — route ← תור ← הכרעה (shadow)", () => {
  it("\"תקלה בדירה 12\" ממשתמש מורשה: הכרעת shadow DRAFT_CREATED, בלי טיוטה ובלי הודעה", async () => {
    await connectNumber();
    await makeUser();
    expect((await post(fixture("text-report"))).status).toBe(200);

    // השעון האמיתי ולא NOW: ה-route יוצר את הג׳וב עם `runAt` של המסד, והעובד
    // תופס רק ג׳וב שזמנו הגיע. ה-fixtures מ-4.10.2026, ולכן "עכשיו" תמיד אחריהם.
    const now = new Date();
    const first = await processNextJob({}, now, "mail");
    expect(first?.job.type).toBe(JOB_TYPES.waEvent);
    const second = await processNextJob({}, now, "mail");
    expect(second?.job.type).toBe(JOB_TYPES.waIntake);

    expect(await db.waMessage.findFirstOrThrow()).toMatchObject({ state: "DONE", outcome: "DRAFT_CREATED", shadow: true });
    expect(await db.ticket.count()).toBe(0);
    expect(await db.waMessage.count({ where: { direction: "OUTBOUND" } })).toBe(0);
    expect(await processNextJob({}, now, "mail")).toBeNull();
  });
});
