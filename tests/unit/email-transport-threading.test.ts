import nodemailer from "nodemailer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeMessageId } from "@/lib/email-intake/headers";
import { consoleTransport, gmailTransport } from "@/lib/notifier/email";
import { buildRawMessage, gmailApiTransport } from "@/lib/notifier/gmail-api";
import type { EmailMessage } from "@/lib/notifier/types";

/**
 * השרשור בכיוון היוצא: שהמענה ינחת באותה שיחה של המייל שהוא עונה לו
 * (EM-12, אפיון §2.6 שלב 4), ושלא יפעיל את המשיב האוטומטי של הנמען
 * (EM-23).
 *
 * **מה נבדק כאן הוא ההודעה הבנויה, ולא הקריאה ל-nodemailer.** בדיקה
 * שמוודאת ש"השדה נמסר" מאמתת את הקוד מול עצמו; הכותרת שיוצאת בפועל היא
 * הדבר היחיד שהנמען רואה, ולכן ההודעה מפוענחת מ-base64url ונקראת כטקסט.
 *
 * שתי התקלות שהבדיקות האלה קיימות בשבילן שקטות לגמרי:
 * - שרשור שבור אינו שגיאה. המייל יוצא, מגיע, ורק נראה אצל השולח כשיחה
 *   חדשה — ואיש לא ידווח על כך.
 * - לולאת משיבים אוטומטיים אינה שגיאה. היא עובדת "כמתוכנן", בקצב של
 *   הודעה לשנייה, ומעדכנת טיוטה בכל סיבוב.
 */

const FROM = "בקרת פניות <office@example.com>";

const PLAIN: EmailMessage = {
  to: "yossi@example.com",
  subject: "פנייה 41 — נזילה",
  text: "שלום יוסי",
  html: "<p>שלום יוסי</p>",
};

/** ההודעה כטקסט RFC822, כפי שהיא נשלחת לגוגל */
async function rawText(message: EmailMessage): Promise<string> {
  return Buffer.from(await buildRawMessage(FROM, message), "base64url").toString("utf8");
}

/** רק הכותרות: הגוף עלול להכיל טקסט שנראה כמו כותרת */
function headerBlock(raw: string): string {
  return raw.split(/\n\n/)[0];
}

/**
 * מה שמשתנה בין שתי בניות של אותה הודעה: גבול ה-multipart, התאריך והמזהה
 * שנוצר אקראית. בלי הנרמול הזה אי אפשר להשוות שתי הודעות כלל.
 */
function normalizeRaw(raw: string): string {
  return raw
    .replace(/--_+[^\s"]+/g, "--BOUNDARY")
    .replace(/boundary="[^"]+"/g, 'boundary="BOUNDARY"')
    .replace(/^Message-ID:.*$/gm, "Message-ID: <GENERATED>")
    .replace(/^Date:.*$/gm, "Date: DATE");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EM-12 — כותרות השרשור בהודעה היוצאת", () => {
  it("כותב Message-ID, In-Reply-To ו-References כפי שנמסרו", async () => {
    const raw = headerBlock(
      await rawText({
        ...PLAIN,
        messageId: "reply-7@yy.local",
        inReplyTo: "CAF%2B1@mail.gmail.com",
        references: ["root@outlook.com", "CAF%2B1@mail.gmail.com"],
      }),
    );

    expect(raw).toContain("Message-ID: <reply-7@yy.local>");
    expect(raw).toContain("In-Reply-To: <CAF%2B1@mail.gmail.com>");
    expect(raw).toContain("References: <root@outlook.com> <CAF%2B1@mail.gmail.com>");
  });

  /**
   * המזהים נשמרים במסד בלי סוגריים, אבל מגיעים מהכותרת **עם**. אילו הצורה
   * נקבעה בשני מקומות, `<<id>>` היה מזהה אחר לכל לקוח דואר בעולם — והתשובה
   * לא הייתה מותאמת לטיוטה.
   */
  it("מזהה שכבר עטוף בסוגריים אינו נעטף פעמיים", async () => {
    const raw = headerBlock(await rawText({ ...PLAIN, messageId: "<already@wrapped>" }));

    expect(raw).toContain("Message-ID: <already@wrapped>");
    expect(raw).not.toContain("<<already@wrapped>>");
  });

  /**
   * המזהה מגיע ממייל שאדם זר שלח. ירידת שורה בתוכו הייתה מסיימת את כותרת
   * ה-`In-Reply-To` ופותחת כותרת משלו בהודעה שאנחנו שולחים — הזרקת כותרות.
   */
  it("מזהה עם ירידת שורה אינו פותח כותרת חדשה", async () => {
    const raw = headerBlock(
      await rawText({ ...PLAIN, inReplyTo: "abc@x\r\nBcc: attacker@evil.example" }),
    );

    expect(raw).toContain("In-Reply-To: <abc@x>");
    expect(raw).not.toMatch(/^Bcc:/m);
  });

  /**
   * מזהה פגום אינו סיבה לא לשלוח: מייל שלא יצא הוא נזק גדול משרשור שנשבר.
   * הכותרת פשוט נשמטת, ושאר ההודעה יוצאת כרגיל.
   */
  it("מזהה ריק נשמט ואינו מפיל את השליחה", async () => {
    const raw = headerBlock(
      await rawText({ ...PLAIN, inReplyTo: "<>", references: ["<>", "real@x"] }),
    );

    expect(raw).not.toMatch(/^In-Reply-To:/m);
    expect(raw).toContain("References: <real@x>");
    expect(raw).toContain("To: yossi@example.com");
  });

  it("רשימת References ריקה אינה יוצרת כותרת ריקה", async () => {
    const raw = headerBlock(await rawText({ ...PLAIN, references: [] }));

    expect(raw).not.toMatch(/^References:/m);
  });
});

describe("EM-23 — המענה אינו מפעיל משיב אוטומטי", () => {
  it("מוסיף Auto-Submitted ו-X-Auto-Response-Suppress כשההודעה היא מענה", async () => {
    const raw = headerBlock(await rawText({ ...PLAIN, autoReply: true }));

    expect(raw).toContain("Auto-Submitted: auto-replied");
    expect(raw).toContain("X-Auto-Response-Suppress: All");
  });

  /**
   * ההתראות אינן מענה אוטומטי אלא הודעה שמנהל גרם לה, והן **מבקשות**
   * תשובה. כותרת שאומרת "אל תענו" עליהן היא בדיוק ההפך מהמטרה.
   */
  it("התראה רגילה יוצאת בלי הכותרות האלה", async () => {
    const raw = headerBlock(await rawText(PLAIN));

    expect(raw).not.toContain("Auto-Submitted");
    expect(raw).not.toContain("X-Auto-Response-Suppress");
  });
});

/**
 * השדות נוספו למסלול שכבר עובד. הבדיקה הזו היא מה שמבטיח שההתראות — ארבעת
 * האירועים שיוצאים מאז 1.9 — ממשיכות לצאת בדיוק כפי שיצאו, בלי כותרת
 * נוספת ובלי שינוי במבנה ה-multipart.
 */
describe("EM-12 — הודעה בלי שדות השרשור אינה משתנה", () => {
  it("זהה להודעה שנבנתה במיפוי שקדם להם", async () => {
    const composer = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: "unix",
    });
    // המיפוי כפי שהיה לפני השינוי, מועתק במפורש: השוואה מול הקוד החדש
    // עצמו לא הייתה מוכיחה דבר.
    const before = await composer.sendMail({
      from: FROM,
      to: PLAIN.to,
      subject: PLAIN.subject,
      text: PLAIN.text,
      html: PLAIN.html,
    });

    const legacy = normalizeRaw((before.message as Buffer).toString("utf8"));
    const current = normalizeRaw(await rawText(PLAIN));

    expect(current).toBe(legacy);
  });
});

/**
 * `fetch` מוחלף בכפיל, בדיוק כמו ב-`gemini.test.ts`: מה שנבדק הוא החוזה
 * שלנו מול Gmail — מה נשלח ומה נשמר ממה שחזר — ולא Gmail עצמו. אין רשת
 * בבדיקות, ואין טוקן קריאה במכונה הזו.
 */
function mockGmail(sendResponse: unknown) {
  const calls: { url: string; body: unknown }[] = [];
  const spy = vi.fn().mockImplementation(async (url: string, init: { body?: string }) => {
    const isToken = url.includes("oauth2.googleapis.com");
    calls.push({
      url,
      body: isToken ? init.body : JSON.parse(init.body ?? "{}"),
    });
    const payload = isToken ? { access_token: "t", expires_in: 3600 } : sendResponse;
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  });
  vi.stubGlobal("fetch", spy);
  return calls;
}

const CONFIG = { clientId: "id", clientSecret: "secret", refreshToken: "refresh" };

describe("EM-12 / EM-14 — ערוץ Gmail API: שרשור ומזהים חוזרים", () => {
  it("מצרף threadId לגוף הבקשה כשנמסר", async () => {
    const calls = mockGmail({ id: "m1", threadId: "t1" });

    await gmailApiTransport(CONFIG, FROM).send({ ...PLAIN, threadId: "t1" });

    const send = calls.find((call) => call.url.includes("messages/send"));
    expect(send?.body).toMatchObject({ threadId: "t1" });
    expect(send?.body).toHaveProperty("raw");
  });

  /**
   * Gmail דוחה בקשה שבה ה-`threadId` אינו מתיישב עם הכותרות, ולכן שדה
   * שנשלח "ליתר ביטחון" הוא כשל שליחה ולא רשת ביטחון.
   */
  it("אינו מצרף threadId כשאין שרשור", async () => {
    const calls = mockGmail({ id: "m1" });

    await gmailApiTransport(CONFIG, FROM).send(PLAIN);

    const send = calls.find((call) => call.url.includes("messages/send"));
    expect(send?.body).not.toHaveProperty("threadId");
  });

  it("מחזיר את המזהים שגוגל ענתה", async () => {
    mockGmail({ id: "m1", threadId: "t1", labelIds: ["SENT"] });

    const result = await gmailApiTransport(CONFIG, FROM).send(PLAIN);

    expect(result).toEqual({ id: "m1", threadId: "t1" });
  });

  /**
   * המזהה שביקשנו **אינו** מוחזר כהד: Gmail רשאי לכתוב אחד משלו, ומזהה
   * שגוי שנשמר הוא הבטחה שקרית — תשובה שתגיע מחר לא תותאם אליו לעולם.
   */
  it("אינו מחזיר את ה-Message-ID שביקשנו", async () => {
    mockGmail({ id: "m1", threadId: "t1" });

    const result = await gmailApiTransport(CONFIG, FROM).send({
      ...PLAIN,
      messageId: "reply-7@yy.local",
    });

    expect(result.messageId).toBeUndefined();
  });

  /** ההודעה כבר יצאה. תשובה שאינה JSON אינה סיבה לשלוח אותה שוב. */
  it("תשובה שאינה JSON אינה זורקת", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => ({
        ok: true,
        status: 200,
        text: async () =>
          url.includes("oauth2") ? JSON.stringify({ access_token: "t", expires_in: 3600 }) : "<html>502</html>",
      })),
    );

    await expect(gmailApiTransport(CONFIG, FROM).send(PLAIN)).resolves.toEqual({});
  });
});

/**
 * ערוץ ה-SMTP אינו "הערוץ הישן שאיש לא מריץ": `selectEmailTransport` בוחר בו
 * בכל סביבה שבה הוגדר `GMAIL_APP_PASSWORD` בלי refresh token, וזו ההתקנה
 * שתעבוד במקום שבו 587 אינו חסום. מה שיוצא ממנו חייב להיות אותו דבר בדיוק.
 *
 * `createTransport` מוחלף בכפיל **בתוך הבדיקה בלבד**: הבדיקות שמעל בונות
 * הודעה אמיתית דרך nodemailer, וכפיל ברמת הקובץ היה מרוקן אותן.
 */
function fakeSmtp(info: { messageId?: string }) {
  const sendMail = vi.fn().mockResolvedValue(info);
  const spy = vi.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail } as never);
  return { sendMail, restore: () => spy.mockRestore() };
}

describe("EM-12 / EM-14 — ערוץ ה-SMTP: אותן כותרות, ואותה צורת מזהה", () => {
  it("EM-12 — כותרות השרשור והמניעה יוצאות גם במסלול ה-SMTP", async () => {
    const smtp = fakeSmtp({ messageId: "<reply-7@yy.local>" });
    try {
      await gmailTransport("office@example.com", "app-password", FROM).send({
        ...PLAIN,
        messageId: "reply-7@yy.local",
        inReplyTo: "root@outlook.com",
        references: ["root@outlook.com"],
        autoReply: true,
      });

      expect(smtp.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: "<reply-7@yy.local>",
          inReplyTo: "<root@outlook.com>",
          references: ["<root@outlook.com>"],
          headers: { "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All" },
        }),
      );
    } finally {
      smtp.restore();
    }
  });

  /**
   * **הצורה, לא רק הערך.** המזהה שנשמר ב-`MailboxMessage.rfcMessageId` מושווה
   * מחר מול ה-`In-Reply-To` של התשובה שתגיע, ואת זה הצד הנכנס מנרמל
   * ב-`normalizeMessageId` — בלי סוגריים משולשים. nodemailer מדווח דווקא את
   * ערך הכותרת, **עם** הסוגריים. שמירה של מה שהוא החזיר כמות שהוא הייתה
   * יוצרת שתי צורות לאותו מזהה, והתשובה לא הייתה נקשרת לטיוטה לעולם (EM-14)
   * — בלי שגיאה ובלי שאיש ישים לב.
   */
  it("EM-14 — המזהה החוזר מנורמל כמו בצד הנכנס", async () => {
    const smtp = fakeSmtp({ messageId: "<reply-7@yy.local>" });
    try {
      const result = await gmailTransport("office@example.com", "app-password", FROM).send({
        ...PLAIN,
        messageId: "reply-7@yy.local",
      });

      expect(result.messageId).toBe(normalizeMessageId("<reply-7@yy.local>"));
    } finally {
      smtp.restore();
    }
  });

  it("ערוץ שלא דיווח מזהה אינו ממציא אחד", async () => {
    const smtp = fakeSmtp({});
    try {
      const result = await gmailTransport("office@example.com", "app-password", FROM).send(PLAIN);

      expect(result.messageId).toBeUndefined();
    } finally {
      smtp.restore();
    }
  });
});

describe("EM-14 — ערוץ הקונסולה", () => {
  it("אינו ממציא מזהים להודעה שלא נשלחה", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    await expect(consoleTransport().send(PLAIN)).resolves.toEqual({});

    spy.mockRestore();
  });
});
