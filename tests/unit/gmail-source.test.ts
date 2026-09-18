import { describe, expect, it } from "vitest";
import { gmailSource, toEnvelope, type GmailMessage } from "@/lib/email-intake/gmail-source";
import { classifyMailError, MailSourceError } from "@/lib/email-intake/source";
import type { GmailMessagePart } from "@/lib/email-intake/mime";

/**
 * המתאם ל-Gmail: קריאה בלבד (EM-20) והמרה למעטפה (EM-04, EM-06, EM-06a, EM-14).
 *
 * **בלי רשת, לעולם.** כל בדיקה כאן מזריקה `fetch` מזויף ואסימון קבוע; אין
 * טוקן קריאה למכונה הזו, והתיבה האמיתית משותפת עם מערכת אחרת. מה שנבדק הוא
 * מה שהמתאם *שולח* (שיטה, כתובת, פרמטרים) ומה הוא *בונה* ממה שחזר — שני
 * הדברים שכשל בהם אינו מפיל דבר אלא מאבד מייל בשקט.
 */

// ─────────────────────────────── עזרים ───────────────────────────────

const CONFIG = { clientId: "client-id", clientSecret: "client-secret", refreshToken: "refresh-token" };

interface Route {
  status?: number;
  body?: unknown;
  /** גוף גולמי, כשהבדיקה צריכה תשובה שאינה JSON */
  text?: string;
  /** כשל רשת: `fetch` שזורק ולא מחזיר תשובה */
  throws?: unknown;
}

interface RecordedCall {
  url: URL;
  method: string | undefined;
  body: BodyInit | null | undefined;
  authorization: string | undefined;
}

/** `fetch` מזויף שמתעד כל בקשה ומשיב לפי הנתיב */
function fakeGmail(handler: (url: URL) => Route) {
  const calls: RecordedCall[] = [];

  const fetchImpl = (async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, method: init?.method, body: init?.body, authorization: headers["authorization"] });

    const route = handler(url);
    if (route.throws) throw route.throws;
    return new Response(route.text ?? JSON.stringify(route.body ?? {}), { status: route.status ?? 200 });
  }) satisfies typeof globalThis.fetch;

  return { fetchImpl, calls };
}

/** מתאם עם אסימון קבוע — מטמון הטוקן נבדק בנפרד (`gmail-token.test.ts`) */
function sourceWith(handler: (url: URL) => Route) {
  const { fetchImpl, calls } = fakeGmail(handler);
  return { source: gmailSource(CONFIG, { fetch: fetchImpl, getAccessToken: async () => "access-token" }), calls };
}

const b64 = (bytes: string | Uint8Array) =>
  (typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes)).toString("base64url");

/**
 * קידוד windows-1255 לעברית ול-ASCII — מה ש-Outlook בעברית שולח בפועל.
 * (מקביל לעזר ב-`email-mime.test.ts`; שם הוא נבדק מול הפענוח עצמו.)
 */
function windows1255(text: string): Uint8Array {
  return Uint8Array.from(
    [...text].map((ch) => {
      const code = ch.charCodeAt(0);
      if (code >= 0x05d0 && code <= 0x05ea) return code - 0x05d0 + 0xe0;
      if (code < 0x80) return code;
      throw new Error(`תו שאינו נתמך בעזר: ${ch}`);
    }),
  );
}

/** מילה מקודדת RFC 2047 ב-windows-1255 — כך מגיעים כותרת ושם קובץ בעברית */
const encodedWord = (text: string) => `=?windows-1255?B?${Buffer.from(windows1255(text)).toString("base64")}?=`;

const headers = (entries: Record<string, string>) => Object.entries(entries).map(([name, value]) => ({ name, value }));

const JPEG_HEAD = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

// ─────────────────────── הודעה מלאה, כפי ש-Gmail מוסר אותה ───────────────────────

const BODY_TEXT = "שלום, יש תקלה בדירה 12";
const BODY_HTML = '<div dir="rtl">יש תקלה בדירה 12<img src="cid:image001.jpg@01DA0B"></div>';

const INLINE_IMAGE: GmailMessagePart = {
  partId: "1.2",
  mimeType: "image/jpeg",
  filename: "image001.jpg",
  headers: headers({
    "Content-Type": 'image/jpeg; name="image001.jpg"',
    "Content-ID": "<image001.jpg@01DA0B>",
    "Content-Disposition": "inline; filename=image001.jpg",
  }),
  body: { size: JPEG_HEAD.length, data: b64(JPEG_HEAD) },
};

/**
 * PDF שהוצהר `application/octet-stream` ונמסר כהפניה בלבד — הצירוף הנפוץ
 * ביותר של Outlook וסורק משרדי.
 */
const PDF_ATTACHMENT: GmailMessagePart = {
  partId: "2",
  mimeType: "application/octet-stream",
  filename: "דוח.pdf",
  headers: headers({
    "Content-Type": `application/octet-stream; name="${encodedWord("דוח")}.pdf"`,
    "Content-Disposition": `attachment; filename="${encodedWord("דוח")}.pdf"`,
  }),
  body: { size: 84_213, attachmentId: "ANGjdJ-pdf-ref" },
};

const OUTLOOK_MESSAGE: GmailMessage = {
  id: "18f1a2b3c4d5e6f7",
  threadId: "18f1a2b3c4d5e600",
  internalDate: "1757318400000",
  payload: {
    partId: "",
    mimeType: "multipart/mixed",
    filename: "",
    headers: headers({
      Subject: `RE: ${encodedWord("תקלה בבניין א")}`,
      From: `"${encodedWord("ישראל ישראלי")}" <yossi@example.com>`,
      To: "office@example.com",
      Cc: `${encodedWord("דנה")} <dana@example.com>, avi@example.com`,
      "Message-ID": "<AB1234@mail.example.com>",
      "In-Reply-To": "<yy-1@yy-ticket-control.local>",
      References: "<root@example.com> <yy-1@yy-ticket-control.local>",
      Date: "Mon, 8 Sep 2025 10:00:00 +0300",
      "Content-Type": 'multipart/mixed; boundary="000_abc"',
    }),
    body: { size: 0 },
    parts: [
      {
        partId: "1",
        mimeType: "multipart/related",
        filename: "",
        headers: headers({ "Content-Type": 'multipart/related; boundary="000_def"' }),
        body: { size: 0 },
        parts: [
          {
            partId: "1.1",
            mimeType: "multipart/alternative",
            filename: "",
            headers: headers({ "Content-Type": 'multipart/alternative; boundary="000_ghi"' }),
            body: { size: 0 },
            parts: [
              {
                partId: "1.1.1",
                mimeType: "text/plain",
                filename: "",
                headers: headers({ "Content-Type": 'text/plain; charset="windows-1255"' }),
                body: { size: 40, data: b64(windows1255(BODY_TEXT)) },
              },
              {
                partId: "1.1.2",
                mimeType: "text/html",
                filename: "",
                headers: headers({ "Content-Type": 'text/html; charset="windows-1255"' }),
                body: { size: 90, data: b64(windows1255(BODY_HTML)) },
              },
            ],
          },
          INLINE_IMAGE,
        ],
      },
      PDF_ATTACHMENT,
    ],
  },
};

// ─────────────────────────────── toEnvelope ───────────────────────────────

describe("toEnvelope", () => {
  const envelope = toEnvelope(OUTLOOK_MESSAGE);

  it("EM-14 — מזהי ההודעה והשרשרת נשמרים, ומזהי RFC מנורמלים בלי סוגריים", () => {
    expect(envelope.sourceId).toBe("18f1a2b3c4d5e6f7");
    expect(envelope.sourceThreadId).toBe("18f1a2b3c4d5e600");
    expect(envelope.rfcMessageId).toBe("AB1234@mail.example.com");
    expect(envelope.inReplyTo).toBe("yy-1@yy-ticket-control.local");
    expect(envelope.references).toEqual(["root@example.com", "yy-1@yy-ticket-control.local"]);
  });

  it("EM-04 — השולח והנמענים מפוענחים, כולל שם עברי ב-windows-1255", () => {
    expect(envelope.from).toEqual({ address: "yossi@example.com", name: "ישראל ישראלי" });
    expect(envelope.to).toEqual([{ address: "office@example.com", name: null }]);
    expect(envelope.cc).toEqual([
      { address: "dana@example.com", name: "דנה" },
      { address: "avi@example.com", name: null },
    ]);
  });

  it("EM-01 — הכותרת מגיעה מפוענחת מ-RFC 2047, עם הקידומת כפי שנכתבה", () => {
    // `subject.ts` מניח טקסט קריא; כותרת שנשארת מקודדת אינה מכילה "תקלה"
    // ולכן המייל לא היה נקלט כלל.
    expect(envelope.subject).toBe("RE: תקלה בבניין א");
  });

  it("EM-22 — זמן הקבלה נלקח מ-internalDate של Gmail ולא מכותרת השולח", () => {
    expect(envelope.receivedAt.toISOString()).toBe(new Date(1_757_318_400_000).toISOString());
  });

  it("EM-23 — הכותרות נמסרות כמפה בשמות באותיות קטנות, כפי ש-`auto-reply.ts` מצפה", () => {
    expect(envelope.headers["message-id"]).toBe("<AB1234@mail.example.com>");
    expect(envelope.headers["date"]).toBe("Mon, 8 Sep 2025 10:00:00 +0300");
    expect(envelope.contentType).toBe("multipart/mixed");
  });

  it("EM-06 — הגוף נקרא משתי החלופות, מפוענח לפי windows-1255", () => {
    expect(envelope.text).toBe(BODY_TEXT);
    expect(envelope.html).toBe(BODY_HTML);
  });

  it("EM-06a — תמונה משובצת מגיעה עם הבתים, עם Content-ID ובלי סוגריים", () => {
    const image = envelope.parts[0]!;
    expect(image.mimeType).toBe("image/jpeg");
    expect(image.disposition).toBe("inline");
    expect(image.contentId).toBe("image001.jpg@01DA0B");
    expect(image.data && Uint8Array.from(image.data)).toEqual(JPEG_HEAD);
    expect(image.sourceRef).toBeNull();
  });

  it("EM-06 — קובץ גדול מגיע כהפניה בלבד, עם הסוג **כפי שהוצהר**", () => {
    const pdf = envelope.parts[1]!;
    expect(pdf.filename).toBe("דוח.pdf");
    // ההצהרה נשמרת כמות שהיא. פתרון הסוג האמיתי (`classifyAttachment`) נעשה
    // אחרי ההורדה, כשיש בתים — סיווג כאן לפי ההצהרה בלבד היה נותן תשובה
    // אחרת מזו שתתקבל אחר כך, ושתי תשובות לקובץ אחד הן בדיוק הבאג השקט.
    expect(pdf.mimeType).toBe("application/octet-stream");
    expect(pdf.data).toBeNull();
    expect(pdf.sourceRef).toBe("ANGjdJ-pdf-ref");
    expect(pdf.sizeBytes).toBe(84_213);
  });

  it("EM-06 — אין חלקים נוספים מעבר לשניים, ומספורם לפי סדר ההופעה", () => {
    expect(envelope.parts.map((part) => part.index)).toEqual([0, 1]);
  });

  it("הודעה בלי payload אינה מפילה — מעטפה ריקה עם המזהים", () => {
    const empty = toEnvelope({ id: "m1", threadId: "t1", internalDate: "1757318400000" });
    expect(empty.text).toBe("");
    expect(empty.html).toBeNull();
    expect(empty.parts).toEqual([]);
    expect(empty.from).toBeNull();
    expect(empty.subject).toBe("");
  });

  it("כותרת שקופלה מתאחדת לשורה אחת", () => {
    // שארית קיפול הייתה גם שוברת את כלל הכותרת וגם פותחת שורת כותרת חדשה
    // במייל החוזר.
    const folded = toEnvelope({
      id: "m2",
      threadId: "t2",
      internalDate: "1757318400000",
      payload: { headers: headers({ Subject: "תקלה  בבניין\r\n א" }) },
    });
    expect(folded.subject).toBe("תקלה בבניין א");
  });

  it("בלי internalDate — הזמן נלקח מכותרת Date", () => {
    const envelopeFromHeader = toEnvelope({
      id: "m3",
      threadId: "t3",
      payload: { headers: headers({ Date: "Mon, 8 Sep 2025 10:00:00 +0300" }) },
    });
    expect(envelopeFromHeader.receivedAt.toISOString()).toBe("2025-09-08T07:00:00.000Z");
  });

  it("בלי זמן בכלל — נזרק, ולא מנוחש", () => {
    expect(() => toEnvelope({ id: "m4", threadId: "t4" })).toThrow(MailSourceError);
    expect(() => toEnvelope({ id: "m4", threadId: "t4" })).toThrow(/internalDate/);
  });

  it("EM-22 — זמן מחוץ לטווח נזרק ואינו הופך ל-Invalid Date שקט", () => {
    // `Number.isFinite` עובר על 1e17, אבל `new Date(1e17)` הוא Invalid Date —
    // ותאריך כזה שממשיך הלאה נכשל **בשקט** בכל השוואה: גבול ההפעלה (EM-22)
    // ו"מי מאוחר יותר" (§5.ה4) שניהם מחזירים false, ואיש אינו רואה למה.
    expect(() => toEnvelope({ id: "m5", threadId: "t5", internalDate: "99999999999999999" })).toThrow(MailSourceError);
    // ויש גיבוי: כשיש כותרת Date תקינה היא זו שנלקחת, ולא זריקה.
    const fallback = toEnvelope({
      id: "m6",
      threadId: "t6",
      internalDate: "99999999999999999",
      payload: { headers: headers({ Date: "Mon, 8 Sep 2025 10:00:00 +0300" }) },
    });
    expect(fallback.receivedAt.toISOString()).toBe("2025-09-08T07:00:00.000Z");
  });
});

// ─────────────────────────────── קריאה בלבד ───────────────────────────────

describe("gmailSource — EM-20: המערכת אינה משנה דבר בתיבה", () => {
  it("כל בקשה שהמתאם שולח היא GET, בלי גוף", async () => {
    const { source, calls } = sourceWith((url) => {
      if (url.pathname.endsWith("/profile")) return { body: { emailAddress: "office@example.com" } };
      if (url.pathname.endsWith("/attachments/a1")) return { body: { data: b64("pdf") } };
      if (/\/messages\/[^/]+$/.test(url.pathname)) return { body: OUTLOOK_MESSAGE };
      return { body: { messages: [{ id: "m1", threadId: "t1" }] } };
    });

    await source.getProfile();
    await source.listIds("from:(a@b.c) after:1");
    await source.getMessage("18f1a2b3c4d5e6f7");
    await source.getAttachment("18f1a2b3c4d5e6f7", "a1");

    expect(calls).toHaveLength(4);
    expect(calls.map((call) => call.method)).toEqual(["GET", "GET", "GET", "GET"]);
    expect(calls.map((call) => call.body)).toEqual([undefined, undefined, undefined, undefined]);
    // כל הכתובות תחת users/me, ואף אחת אינה נוגעת בפעולה שמשנה
    for (const call of calls) {
      expect(call.url.origin).toBe("https://gmail.googleapis.com");
      expect(call.url.pathname.startsWith("/gmail/v1/users/me/")).toBe(true);
      expect(call.url.pathname).not.toMatch(/modify|trash|delete|send|import|insert/);
      expect(call.authorization).toBe("Bearer access-token");
    }
  });

  it("MailSource אינו חושף פעולה נוספת מעבר לארבע הקריאות", () => {
    const { source } = sourceWith(() => ({ body: {} }));
    // הגנה על הממשק עצמו: תוספת של פעולה משנה תיתפס כאן ולא רק בסקירת קוד.
    expect(Object.keys(source).sort()).toEqual(["getAttachment", "getMessage", "getProfile", "listIds", "name"]);
  });
});

// ─────────────────────────────── הפעולות ───────────────────────────────

describe("gmailSource — פעולות", () => {
  it("getProfile מחזיר את כתובת התיבה שהטוקן פותח", async () => {
    const { source, calls } = sourceWith(() => ({ body: { emailAddress: "office@example.com", messagesTotal: 9 } }));

    expect(await source.getProfile()).toEqual({ emailAddress: "office@example.com" });
    expect(calls[0]!.url.pathname).toBe("/gmail/v1/users/me/profile");
  });

  it("getProfile בלי כתובת — נזרק כבאג ולא מוחזר ריק", async () => {
    const { source } = sourceWith(() => ({ body: {} }));

    await expect(source.getProfile()).rejects.toMatchObject({ kind: "permanent" });
  });

  it("listIds שולח את השאילתה ואת maxResults, ומחזיר מזהים בלבד", async () => {
    const { source, calls } = sourceWith(() => ({
      body: { messages: [{ id: "m1", threadId: "t1" }, { id: "m2", threadId: "t1" }], resultSizeEstimate: 2 },
    }));

    expect(await source.listIds("from:(a@b.c) after:1757318400 in:anywhere")).toEqual({ ids: ["m1", "m2"] });
    expect(calls[0]!.url.pathname).toBe("/gmail/v1/users/me/messages");
    expect(calls[0]!.url.searchParams.get("q")).toBe("from:(a@b.c) after:1757318400 in:anywhere");
    expect(calls[0]!.url.searchParams.get("maxResults")).toBe("100");
    expect(calls[0]!.url.searchParams.get("pageToken")).toBeNull();
  });

  it("listIds — עמוד שני נקרא עם ה-pageToken שהוחזר", async () => {
    const { source, calls } = sourceWith((url) =>
      url.searchParams.get("pageToken") === "page-2"
        ? { body: { messages: [{ id: "m3", threadId: "t3" }] } }
        : { body: { messages: [{ id: "m1", threadId: "t1" }], nextPageToken: "page-2" } },
    );

    const first = await source.listIds("q");
    expect(first).toEqual({ ids: ["m1"], nextPageToken: "page-2" });

    const second = await source.listIds("q", { pageToken: first.nextPageToken! });
    expect(second).toEqual({ ids: ["m3"] });
    expect(calls[1]!.url.searchParams.get("pageToken")).toBe("page-2");
  });

  it("listIds — תיבה בלי התאמות מחזירה רשימה ריקה ולא שגיאה", async () => {
    // Gmail משמיט את `messages` לגמרי כשאין תוצאות, וזה המצב הרגיל ברוב הסבבים.
    const { source } = sourceWith(() => ({ body: { resultSizeEstimate: 0 } }));

    expect(await source.listIds("q")).toEqual({ ids: [] });
  });

  it("getMessage קורא את ההודעה במלואה (format=full) ומחזיר מעטפה", async () => {
    const { source, calls } = sourceWith(() => ({ body: OUTLOOK_MESSAGE }));

    const envelope = await source.getMessage("18f1a2b3c4d5e6f7");
    expect(envelope?.subject).toBe("RE: תקלה בבניין א");
    expect(calls[0]!.url.pathname).toBe("/gmail/v1/users/me/messages/18f1a2b3c4d5e6f7");
    expect(calls[0]!.url.searchParams.get("format")).toBe("full");
  });

  it("getMessage — הודעה שנמחקה מהתיבה (404) מחזירה null ואינה זורקת", async () => {
    // ההכרעה `GONE`: בין הרשימה לקריאה מישהו מחק את המייל. קורה, ואינו כשל.
    const { source } = sourceWith(() => ({ status: 404, body: { error: { message: "Requested entity was not found." } } }));

    expect(await source.getMessage("gone")).toBeNull();
  });

  it("getAttachment מפענח base64url לבתים", async () => {
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0xfb, 0xff]);
    const { source, calls } = sourceWith(() => ({ body: { size: bytes.length, data: bytes.toString("base64url") } }));

    expect(await source.getAttachment("m1", "ANGjdJ-pdf-ref")).toEqual(bytes);
    expect(calls[0]!.url.pathname).toBe("/gmail/v1/users/me/messages/m1/attachments/ANGjdJ-pdf-ref");
  });

  it("getAttachment — קובץ באורך אפס אינו נחשב כשל", async () => {
    const { source } = sourceWith(() => ({ body: { size: 0, data: "" } }));

    expect(await source.getAttachment("m1", "a1")).toEqual(Buffer.alloc(0));
  });

  it("getAttachment — 404 נזרק ואינו הופך ל-null", async () => {
    // רק הודעה חסרה היא `GONE`; קובץ שאינו שם הוא מצב שהצינור חייב לראות.
    const { source } = sourceWith(() => ({ status: 404, body: { error: {} } }));

    await expect(source.getAttachment("m1", "a1")).rejects.toMatchObject({ kind: "not_found" });
  });
});

// ─────────────────────────────── סיווג שגיאות ───────────────────────────────

describe("classifyMailError", () => {
  it.each([
    [401, "", "auth"],
    [401, '{"error":"invalid_token"}', "auth"],
    [403, '{"error":{"message":"Request had insufficient authentication scopes."}}', "scope"],
    [403, '{"error":{"details":[{"reason":"ACCESS_TOKEN_SCOPE_INSUFFICIENT"}]}}', "scope"],
    [403, '{"error":{"errors":[{"reason":"insufficientPermissions"}]}}', "scope"],
    // הגבלת קצב של Gmail חוזרת כ-403 ולא כ-429 — סיווג לפי הקוד בלבד היה
    // עוצר את הערוץ ברעש בכל תיבה עמוסה.
    [403, '{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}', "transient"],
    [403, '{"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}', "transient"],
    [403, '{"error":{"errors":[{"reason":"quotaExceeded"}]}}', "transient"],
    [404, "", "not_found"],
    [408, "", "transient"],
    [429, "", "transient"],
    [500, "", "transient"],
    [503, '{"error":{"status":"UNAVAILABLE"}}', "transient"],
    [400, '{"error":{"message":"Invalid query"}}', "permanent"],
    [422, "", "permanent"],
  ])("%i מסווג לפי הגוף → %s", (status, body, kind) => {
    expect(classifyMailError(status, body)).toBe(kind);
  });

  it("כשל בלי תשובה (רשת, פסק זמן) הוא חולף", () => {
    expect(classifyMailError(null, "")).toBe("transient");
    expect(classifyMailError(undefined, "")).toBe("transient");
  });
});

describe("gmailSource — שגיאות", () => {
  it("403 בלי היקף מספיק נעצר כ-scope, והגוף נכנס להודעה", async () => {
    const { source } = sourceWith(() => ({
      status: 403,
      body: { error: { message: "Request had insufficient authentication scopes." } },
    }));

    await expect(source.listIds("q")).rejects.toMatchObject({ kind: "scope", status: 403 });
    // בלי הגוף, `Job.lastError` היה אומר "403" ותו לא — ושתי תקלות שונות
    // לגמרי (הרשאה שנשללה, היקף חסר) היו נראות זהות.
    await expect(source.listIds("q")).rejects.toThrow(/insufficient authentication scopes/);
  });

  it("401 הוא auth — הטוקן אינו תקף עוד", async () => {
    const { source } = sourceWith(() => ({ status: 401, body: { error: { message: "Invalid Credentials" } } }));

    await expect(source.getProfile()).rejects.toMatchObject({ kind: "auth", status: 401 });
  });

  it("5xx הוא transient", async () => {
    const { source } = sourceWith(() => ({ status: 503, text: "backend error" }));

    await expect(source.listIds("q")).rejects.toMatchObject({ kind: "transient", status: 503 });
  });

  it("כשל רשת הוא transient, והסיבה המקורית נשמרת", async () => {
    const cause = new TypeError("fetch failed");
    const { source } = sourceWith(() => ({ throws: cause }));

    const error = (await source.listIds("q").catch((err: unknown) => err)) as MailSourceError;
    expect(error).toBeInstanceOf(MailSourceError);
    expect(error.kind).toBe("transient");
    expect(error.cause).toBe(cause);
    expect(error.status).toBeUndefined();
  });

  it("תשובת 200 שאינה JSON היא transient ולא קריסה", async () => {
    // דף שגיאה של שרת ביניים — מצב חולף, לא באג אצלנו.
    const { source } = sourceWith(() => ({ text: "<html>502 Bad Gateway</html>" }));

    await expect(source.listIds("q")).rejects.toMatchObject({ kind: "transient" });
  });
});

// ─────────────────────────────── האסימון ───────────────────────────────

describe("gmailSource — אסימון", () => {
  it("בלי getAccessToken מוזרק, האסימון מונפק מהמטמון המשותף ונשלח בכותרת", async () => {
    // S5 מודול A: אותו refresh token משמש לשליחה ולקריאה, ולכן גם אותו מטמון.
    const { fetchImpl, calls } = fakeGmail((url) =>
      url.hostname === "oauth2.googleapis.com"
        ? { body: { access_token: "fresh-token", expires_in: 3600 } }
        : { body: { emailAddress: "office@example.com" } },
    );

    const source = gmailSource(CONFIG, { fetch: fetchImpl });
    await source.getProfile();

    expect(calls.map((call) => call.url.hostname)).toEqual(["oauth2.googleapis.com", "gmail.googleapis.com"]);
    expect(calls[1]!.authorization).toBe("Bearer fresh-token");
    expect(calls[1]!.method).toBe("GET");
  });

  /**
   * **כשל בהנפקת הטוקן הוא כשל של הקריאה, ועם אותו סיווג.**
   *
   * הטוקן מונפק לפני כל בקשה, ולכן כל תקלה שלו מגיעה לצינור דרך הפעולות
   * האלה. בלי סיווג היא נופלת אצלו למסלול "שגיאה לא מוכרת": `invalid_grant`
   * — הכשל היחיד כאן שלעולם אינו חולף — היה נכנס לניסיונות חוזרים, והתיבה
   * הייתה שותקת ימים בזמן שהג׳וב "רץ".
   */
  const tokenRoute = (route: Route) => (url: URL) =>
    url.hostname === "oauth2.googleapis.com" ? route : { body: { emailAddress: "office@example.com" } };

  it("refresh token שנשלל (invalid_grant) נעצר כ-auth ודורש אדם", async () => {
    const { fetchImpl } = fakeGmail(
      tokenRoute({ status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } }),
    );
    const source = gmailSource(CONFIG, { fetch: fetchImpl });

    await expect(source.getProfile()).rejects.toMatchObject({ kind: "auth" });
    // הגוף נכנס להודעה: זהו המקום היחיד שבו `invalid_grant` מופיע.
    await expect(source.getProfile()).rejects.toThrow(/invalid_grant/);
  });

  it("5xx בהנפקת הטוקן הוא transient — אותה בקשה תצליח בסבב הבא", async () => {
    const { fetchImpl } = fakeGmail(tokenRoute({ status: 503, text: "backend error" }));
    const source = gmailSource(CONFIG, { fetch: fetchImpl });

    await expect(source.listIds("q")).rejects.toMatchObject({ kind: "transient" });
  });

  it("נפילת רשת בהנפקת הטוקן היא transient, והסיבה נשמרת", async () => {
    const cause = new TypeError("fetch failed");
    const { fetchImpl } = fakeGmail(tokenRoute({ throws: cause }));
    const source = gmailSource(CONFIG, { fetch: fetchImpl });

    const error = (await source.listIds("q").catch((err: unknown) => err)) as MailSourceError;
    expect(error).toBeInstanceOf(MailSourceError);
    expect(error.kind).toBe("transient");
  });
});
