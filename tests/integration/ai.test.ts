import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { JOB_TYPES } from "@/jobs/types";
import { drainJobs } from "@/jobs/worker";
import type { TextExtractor, Transcriber } from "@/lib/ai/types";
import { db } from "@/lib/db";
import type { Viewer } from "@/lib/permissions";
import { confirmUpload, registerMedia } from "@/lib/services/media";
import { addMessage, createTicket } from "@/lib/services/tickets";
import type { SessionUser } from "@/lib/session";
import { writeLocalObject } from "@/lib/storage/local";
import { resetDb } from "../helpers/reset-db";

/**
 * עיבוד ה-AI: תמלול הקלטה וחילוץ טקסט מתמונה.
 *
 * הספקים מדומים, וזה בכוונה. מה שנבדק כאן הוא ההתנהגות סביבם — מה קורה
 * כשאין מפתח, כשהספק נופל, וכשהוא מחזיר טקסט — ולא איכות התמלול עצמו.
 * בדיקה שקוראת ל-OpenAI בכל ריצה עולה כסף, דורשת רשת, ונכשלת מסיבות שאין
 * להן קשר לקוד.
 */

function fakeTranscriber(text: string, options: { failTimes?: number } = {}): Transcriber {
  let failuresLeft = options.failTimes ?? 0;
  return {
    name: "fake-transcriber",
    async transcribe() {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error("שירות התמלול אינו זמין");
      }
      return text;
    },
  };
}

function fakeExtractor(text: string): TextExtractor {
  return {
    name: "fake-extractor",
    async extract() {
      return text;
    },
  };
}

/** ספקים שאינם קיימים — כך נראית סביבה בלי מפתחות */
const noEngines = { transcriber: null, extractor: null };

let manager: SessionUser;
let viewer: Viewer;
let siteId: string;
let base: Record<string, string>;

beforeEach(async () => {
  await resetDb();
  process.env.APP_BASE_URL ??= "http://localhost:3100";

  siteId = (await db.site.create({ data: { name: "אתר" } })).id;
  const building = await db.building.create({ data: { siteId, name: "בניין א" } });
  const apartment = await db.apartment.create({ data: { buildingId: building.id, number: "1" } });
  const domain = await db.domain.create({ data: { name: "חשמל" } });
  base = { buildingId: building.id, apartmentId: apartment.id, domainId: domain.id };

  const user = await db.user.create({
    data: { role: "SITE_MANAGER", name: "דוד", phone: "0500000001", passwordHash: "x", siteId },
  });
  manager = { id: user.id, name: user.name, role: user.role, siteId: user.siteId };
  viewer = { kind: "user", ...manager };
});

afterAll(async () => {
  await db.$disconnect();
});

async function makeTicket(description = "אין חשמל") {
  const professional = await db.professional.create({
    data: { name: `קבלן ${Math.random()}`, phone: "0501111111" },
  });
  const { ticket } = await createTicket(manager, {
    siteId,
    ...base,
    description,
    recipients: [{ kind: "professional", id: professional.id }],
  });
  return ticket;
}

/** מעלה קובץ במלואו: רישום, כתיבת בתים אמיתיים, ואישור */
async function uploadFile(ticketId: string, mimeType: string, body = "בתים") {
  const { mediaId } = await registerMedia(viewer, {
    ticketId,
    mimeType,
    sizeBytes: body.length,
    originalName: "file",
  });

  const media = await db.mediaFile.findUniqueOrThrow({ where: { id: mediaId } });
  await writeLocalObject(media.storageKey, Buffer.from(body, "utf8"));
  await confirmUpload(mediaId);

  return mediaId;
}

describe("אישור העלאה מכניס את העיבוד הנכון לתור", () => {
  it("אודיו → תמלול", async () => {
    const ticket = await makeTicket();
    await uploadFile(ticket.id, "audio/webm");

    expect(await db.job.count({ where: { type: JOB_TYPES.transcribe } })).toBe(1);
  });

  it("תמונה ו-PDF → חילוץ טקסט", async () => {
    const ticket = await makeTicket();
    await uploadFile(ticket.id, "image/png");
    await uploadFile(ticket.id, "application/pdf");

    expect(await db.job.count({ where: { type: JOB_TYPES.extract } })).toBe(2);
  });

  it("וידאו אינו מעובד ומסומן מיד כמדולג", async () => {
    // בלי הסימון הזה הממשק היה מציג "קורא את הטקסט…" שלא ייגמר לעולם.
    const ticket = await makeTicket();
    const mediaId = await uploadFile(ticket.id, "video/mp4");

    expect(await db.job.count()).toBe(1); // רק ג'וב השליחה של הפנייה
    const media = await db.mediaFile.findUniqueOrThrow({ where: { id: mediaId } });
    expect(media.aiStatus).toBe("SKIPPED");
  });

  it("אישור כפול אינו מייצר עיבוד כפול", async () => {
    // לקוח שמדווח פעמיים אינו נדיר, ותמלול כפול עולה כסף אמיתי.
    const ticket = await makeTicket();
    const mediaId = await uploadFile(ticket.id, "audio/webm");
    await confirmUpload(mediaId);

    expect(await db.job.count({ where: { type: JOB_TYPES.transcribe } })).toBe(1);
  });
});

describe("תמלול", () => {
  it("שומר את הטקסט ומסמן שהסתיים", async () => {
    const ticket = await makeTicket();
    const mediaId = await uploadFile(ticket.id, "audio/webm");

    await drainJobs({ transcriber: fakeTranscriber("יש נזילה מתחת לכיור") });

    const media = await db.mediaFile.findUniqueOrThrow({ where: { id: mediaId } });
    expect(media.transcription).toBe("יש נזילה מתחת לכיור");
    expect(media.aiStatus).toBe("DONE");
  });

  it("ממלא תיאור ריק של הפנייה", async () => {
    // זה כל הרעיון של פתיחת פנייה בקול: המנהל מדבר, והתיאור נכתב מעצמו.
    const ticket = await makeTicket("");
    const mediaId = await uploadFile(ticket.id, "audio/webm");
    await addMessage(viewer, ticket.id, "", [mediaId]);

    await drainJobs({ transcriber: fakeTranscriber("אין מים חמים בדירה") });

    const updated = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.description).toBe("אין מים חמים בדירה");
  });

  it("אינו דורס תיאור שאדם הקליד", async () => {
    // טקסט של אדם לעולם אינו נדרס בידי מכונה.
    const ticket = await makeTicket("מה שכתבתי בעצמי");
    const mediaId = await uploadFile(ticket.id, "audio/webm");
    await addMessage(viewer, ticket.id, "", [mediaId]);

    await drainJobs({ transcriber: fakeTranscriber("משהו אחר לגמרי") });

    const updated = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.description).toBe("מה שכתבתי בעצמי");
  });

  it("בלי מפתח — מדלג, לא נכשל", async () => {
    // הקלטה בלי תמלול היא עדיין הקלטה שאפשר להאזין לה. ג'וב שנכשל שוב
    // ושוב על הגדרה חסרה רק מייצר רעש אדום שמסתיר כשלים אמיתיים.
    const ticket = await makeTicket();
    const mediaId = await uploadFile(ticket.id, "audio/webm");

    await drainJobs(noEngines);

    const media = await db.mediaFile.findUniqueOrThrow({ where: { id: mediaId } });
    expect(media.aiStatus).toBe("SKIPPED");
    expect(await db.job.count({ where: { status: "FAILED" } })).toBe(0);
  });

  it("כשל זמני חוזר לתור ואינו מסומן ככשל בממשק", async () => {
    // הניסיון הבא יקרה בעוד דקה. אין סיבה שהמשתמש יראה "התמלול נכשל" על
    // משהו שייפתר לבדו.
    const ticket = await makeTicket();
    const mediaId = await uploadFile(ticket.id, "audio/webm");
    const transcriber = fakeTranscriber("הצליח בסוף", { failTimes: 1 });

    await drainJobs({ transcriber });

    expect(
      (await db.mediaFile.findUniqueOrThrow({ where: { id: mediaId } })).aiStatus,
    ).not.toBe("FAILED");

    const job = await db.job.findFirstOrThrow({ where: { type: JOB_TYPES.transcribe } });
    await drainJobs({ transcriber }, new Date(job.runAt.getTime() + 1000));

    const media = await db.mediaFile.findUniqueOrThrow({ where: { id: mediaId } });
    expect(media.transcription).toBe("הצליח בסוף");
  });

  it("כשל סופי מסומן על הקובץ, והקובץ נשאר", async () => {
    const ticket = await makeTicket();
    const mediaId = await uploadFile(ticket.id, "audio/webm");
    const transcriber = fakeTranscriber("", { failTimes: 99 });

    // שלושה סבבים — כמספר הניסיונות המותר
    let job = await db.job.findFirstOrThrow({ where: { type: JOB_TYPES.transcribe } });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await drainJobs({ transcriber }, new Date(job.runAt.getTime() + 1000));
      job = await db.job.findFirstOrThrow({ where: { type: JOB_TYPES.transcribe } });
    }

    const media = await db.mediaFile.findUniqueOrThrow({ where: { id: mediaId } });
    expect(media.aiStatus).toBe("FAILED");
    expect(media.aiError).toContain("שירות התמלול");
    // הקובץ עצמו לא נגע בו איש — הוא המקור, התמלול נגזרת.
    expect(media.storageKey).toBeTruthy();
    expect(job.status).toBe("FAILED");
  });
});

describe("חילוץ טקסט", () => {
  it("שומר את הטקסט שזוהה", async () => {
    const ticket = await makeTicket();
    const mediaId = await uploadFile(ticket.id, "image/png");

    await drainJobs({ extractor: fakeExtractor("ליקוי 12: רטיבות בקיר המערבי") });

    const media = await db.mediaFile.findUniqueOrThrow({ where: { id: mediaId } });
    expect(media.extractedText).toBe("ליקוי 12: רטיבות בקיר המערבי");
    expect(media.aiStatus).toBe("DONE");
  });

  it("אינו ממלא את תיאור הפנייה", async () => {
    // תמלול הוא מה שהמנהל אמר על הפנייה; טקסט מתוך תמונה הוא תוכן של
    // מסמך שצורף אליה, ואינו התיאור שלה.
    const ticket = await makeTicket("");
    const mediaId = await uploadFile(ticket.id, "image/png");
    await addMessage(viewer, ticket.id, "", [mediaId]);

    await drainJobs({ extractor: fakeExtractor("טקסט מהתמונה") });

    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).description).toBe("");
  });

  it("בלי מפתח — מדלג", async () => {
    const ticket = await makeTicket();
    const mediaId = await uploadFile(ticket.id, "image/png");

    await drainJobs(noEngines);

    expect((await db.mediaFile.findUniqueOrThrow({ where: { id: mediaId } })).aiStatus).toBe(
      "SKIPPED",
    );
  });

  it("תוצאה ריקה נשמרת כ-null ולא כמחרוזת ריקה", async () => {
    // כך החיפוש והתצוגה מבדילים בין "אין טקסט" לבין "טרם עובד".
    const ticket = await makeTicket();
    const mediaId = await uploadFile(ticket.id, "image/png");

    await drainJobs({ extractor: fakeExtractor("   ") });

    const media = await db.mediaFile.findUniqueOrThrow({ where: { id: mediaId } });
    expect(media.extractedText).toBeNull();
    expect(media.aiStatus).toBe("DONE");
  });
});
