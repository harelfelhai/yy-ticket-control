import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  anonymize,
  classify,
  createBook,
  createShadowSource,
  formatCensus,
  guardedFetch,
  parseArgs,
  parseSince,
  redactPersonal,
  runShadow,
  writeFixtures,
  type RequestRecord,
  type ShadowOptions,
} from "../../scripts/email-intake-shadow.mjs";
import type { MailEnvelope, MailPart } from "@/lib/email-intake/types";

/**
 * ריצת הצל (השער של S5) — הליבה שלה, בלי רשת ובלי בסיס נתונים.
 *
 * הסקריפט עצמו רץ ביד מול תיבה אמיתית ולכן אינו נבדק כאן; מה שכן נבדק הוא
 * כל מה שהוא מחליט: ההכרעה על הודעה, המפקד, ההבטחה שאין בקשה שאינה GET,
 * וההבטחה שהפלט והמתקנים אינם נושאים זהויות. שלוש האחרונות הן הסיבה שמותר
 * להריץ אותו על התיבה המשותפת ולהדביק את הפלט בצ׳אט.
 */

const NOW = new Date("2026-09-18T09:00:00.000Z");
const OPTIONS: ShadowOptions = { limit: 100, since: new Date("2026-09-16T09:00:00.000Z"), outDir: null };

function envelope(over: Partial<MailEnvelope> = {}): MailEnvelope {
  return {
    sourceId: "m1",
    sourceThreadId: "t1",
    rfcMessageId: "a@sender.example",
    inReplyTo: null,
    references: [],
    from: { address: "dana@example.com", name: "דנה כהן" },
    to: [{ address: "mailbox@example.com", name: null }],
    cc: [],
    subject: "תקלה בדירה 12",
    receivedAt: new Date("2026-09-17T10:00:00.000Z"),
    headers: { "content-type": 'text/plain; charset="windows-1255"' },
    contentType: "text/plain",
    text: "המקרר לא עובד",
    html: null,
    parts: [],
    ...over,
  };
}

function part(over: Partial<MailPart> = {}): MailPart {
  return {
    index: 0,
    filename: "doc.pdf",
    mimeType: "application/octet-stream",
    sizeBytes: 1024,
    contentId: null,
    disposition: "attachment",
    data: null,
    sourceRef: "att-1",
    ...over,
  };
}

/** מקור מזויף: אותו ממשק בדיוק, בלי רשת. `pages` מאפשר לבדוק דפדוף */
function fakeSource(messages: MailEnvelope[], over: Partial<{ pages: string[][]; fail: Map<string, unknown>; gone: string[] }> = {}) {
  const ids = messages.map((message) => message.sourceId);
  const pages = over.pages ?? [ids];
  const calls: { query: string; pageToken?: string }[] = [];
  return {
    name: "fake",
    calls,
    getProfile: async () => ({ emailAddress: "mailbox@example.com" }),
    listIds: async (query: string, opts?: { pageToken?: string }) => {
      calls.push({ query, pageToken: opts?.pageToken });
      const at = opts?.pageToken ? Number(opts.pageToken) : 0;
      return { ids: pages[at] ?? [], nextPageToken: at + 1 < pages.length ? String(at + 1) : undefined };
    },
    getMessage: async (id: string) => {
      const failure = over.fail?.get(id);
      if (failure) throw failure;
      if (over.gone?.includes(id)) return null;
      return messages.find((message) => message.sourceId === id) ?? null;
    },
    getAttachment: async () => {
      throw new Error("ריצת הצל אינה מורידה קבצים");
    },
  };
}

const baseInput = {
  senders: new Set(["dana@example.com"]),
  rejected: [] as string[],
  activatedAt: null,
  names: [] as string[],
  options: OPTIONS,
  now: NOW,
};

// ─────────────────────────────── ארגומנטים ───────────────────────────────

describe("parseArgs", () => {
  it("ברירות המחדל: 200 הודעות, חלון נגזר, בלי מתקנים", () => {
    expect(parseArgs([], NOW)).toEqual({ limit: 200, since: null, outDir: null });
  });

  it("קורא את שלושת הדגלים", () => {
    const options = parseArgs(["--limit", "5", "--since", "2026-09-01T00:00:00.000Z", "--out", ".shadow"], NOW);
    expect(options.limit).toBe(5);
    expect(options.since).toEqual(new Date("2026-09-01T00:00:00.000Z"));
    expect(options.outDir).toBe(".shadow");
  });

  it("דגל לא מוכר מפיל את הריצה ואינו מתעלם בשקט", () => {
    expect(() => parseArgs(["--limits", "5"], NOW)).toThrow(/לא מוכר/);
  });

  it.each([["0"], ["-3"], ["abc"], ["2.5"]])("--limit לא תקין (%s) זורק", (value) => {
    expect(() => parseArgs(["--limit", value], NOW)).toThrow(/limit/);
  });

  it("--since ו---out בלי ערך זורקים", () => {
    expect(() => parseArgs(["--since"], NOW)).toThrow(/since/);
    expect(() => parseArgs(["--out"], NOW)).toThrow(/out/);
  });
});

describe("parseSince", () => {
  it("משך בימים ובשעות", () => {
    expect(parseSince("7d", NOW)).toEqual(new Date("2026-09-11T09:00:00.000Z"));
    expect(parseSince("48h", NOW)).toEqual(new Date("2026-09-16T09:00:00.000Z"));
  });

  it("תאריך ISO", () => {
    expect(parseSince("2026-09-01T00:00:00.000Z", NOW)).toEqual(new Date("2026-09-01T00:00:00.000Z"));
  });

  it("ערך שאינו נקרא זורק ואינו נופל לחלון ברירת מחדל", () => {
    expect(() => parseSince("שבוע", NOW)).toThrow(/since/);
    expect(() => parseSince("7x", NOW)).toThrow(/since/);
  });
});

// ─────────────────────────────── EM-20 ───────────────────────────────

describe("EM-20 — ריצת הצל אינה יכולה לשנות דבר בתיבה", () => {
  const ok = () => Promise.resolve(new Response("{}", { status: 200 }));

  it("בקשת GET עוברת ונרשמת", async () => {
    const log: { method: string; path: string; status: number }[] = [];
    const inner = vi.fn(ok);
    const response = await guardedFetch(inner, log)("https://gmail.googleapis.com/gmail/v1/users/me/profile");
    expect(response.status).toBe(200);
    expect(log).toEqual([{ method: "GET", path: "/gmail/v1/users/me/profile", status: 200 }]);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it.each([["POST"], ["PUT"], ["PATCH"], ["DELETE"]])("בקשת %s נחסמת לפני היציאה לרשת", async (method) => {
    const log: { method: string; path: string; status: number }[] = [];
    const inner = vi.fn(ok);
    await expect(guardedFetch(inner, log)("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method })).rejects.toThrow(
      /קריאה בלבד/,
    );
    expect(inner).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });

  it("שיטה שמגיעה על אובייקט Request ולא ב-init נחסמת גם היא", async () => {
    const inner = vi.fn(ok);
    const request = new Request("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST" });
    await expect(guardedFetch(inner, [])(request)).rejects.toThrow(/POST/);
    expect(inner).not.toHaveBeenCalled();
  });

  it("היומן שומר את הנתיב בלי השאילתה — שם יושבות כתובות השולחים", async () => {
    const log: { method: string; path: string; status: number }[] = [];
    await guardedFetch(ok, log)("https://gmail.googleapis.com/gmail/v1/users/me/messages?q=from:(dana@example.com)");
    expect(log[0].path).toBe("/gmail/v1/users/me/messages");
    expect(JSON.stringify(log)).not.toContain("dana@example.com");
  });
});

// ─────────────────────────── חיווט המקור האמיתי ───────────────────────────

/**
 * מה שקושר את השומר, את המקור ואת ספק הטוקן — המקום שבו ריצת הצל פוגשת את
 * הרשת. הוא נבדק כאן ולא נשאר ב-`main`, מפני שהטעות היחידה שאפשרית בו מפילה
 * את הריצה כולה לפני הבקשה הראשונה, ואף בדיקה אחרת אינה נוגעת בו.
 */
describe("createShadowSource", () => {
  const OAUTH = { clientId: "id", clientSecret: "secret", refreshToken: "refresh" };

  function transport(handler?: (url: string) => Response) {
    const calls: { method: string; url: string }[] = [];
    const call = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push({ method: (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(), url });
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      return handler?.(url) ?? new Response(JSON.stringify({ emailAddress: "mailbox@example.com" }), { status: 200 });
    };
    return { calls, call };
  }

  it("EM-20 — השומר עוטף את התיבה, ולא את הנפקת הטוקן", async () => {
    // הטוקן מונפק ב-POST אל oauth2.googleapis.com — לא אל התיבה. שומר שחל גם
    // עליו חוסם את הבקשה הראשונה של הריצה, וריצת הצל מתה לפני שקראה דבר.
    const { calls, call } = transport();
    const requests: RequestRecord[] = [];
    const source = await createShadowSource(OAUTH, { fetch: call, requests });

    await expect(source.getProfile()).resolves.toEqual({ emailAddress: "mailbox@example.com" });
    expect(calls.map((entry) => entry.method)).toEqual(["POST", "GET"]);
    expect(calls[0].url).toContain("oauth2.googleapis.com/token");
    // היומן שמודפס בסוף הוא יומן התיבה בלבד, ולכן "כולן GET" נשאר אמירה נכונה
    expect(requests.map((entry) => entry.method)).toEqual(["GET"]);
    expect(requests[0].path).toBe("/gmail/v1/users/me/profile");
  });

  it("EM-20 — התיבה עצמה עדיין מוגנת: בקשה משנה דרך המקור נחסמת", async () => {
    const { call } = transport();
    const requests: RequestRecord[] = [];
    await createShadowSource(OAUTH, { fetch: call, requests });

    // אותו שומר בדיוק שהמקור קיבל, עם אותו יומן
    await expect(
      guardedFetch(call, requests)("https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/modify", { method: "POST" }),
    ).rejects.toThrow(/קריאה בלבד/);
  });

  it("ה-JSON הגולמי של הודעה נלכד בלי בקשה נוספת, ורק של הודעה בודדת", async () => {
    const payload = { mimeType: "text/plain", headers: [{ name: "Content-Type", value: "text/plain; charset=utf-8" }] };
    const { calls, call } = transport((url) =>
      /\/messages\/m1\?/.test(url)
        ? new Response(JSON.stringify({ id: "m1", threadId: "t1", internalDate: "1758100000000", payload }), { status: 200 })
        : new Response(JSON.stringify({ messages: [{ id: "m1", threadId: "t1" }] }), { status: 200 }),
    );
    const rawPayloads = new Map<string, unknown>();
    const requests: RequestRecord[] = [];
    const source = await createShadowSource(OAUTH, { fetch: call, requests, rawPayloads: rawPayloads as never });

    await source.listIds("q");
    await source.getMessage("m1");

    expect(rawPayloads.get("m1")).toEqual(payload);
    // רשימה + הודעה + טוקן אחד = שלוש בקשות, ולא ארבע
    expect(calls).toHaveLength(3);
  });
});

// ─────────────────────────────── הכרעה ───────────────────────────────

describe("classify", () => {
  const context = { mailbox: "mailbox@example.com", senders: new Set(["dana@example.com"]), activatedAt: null };

  it("EM-01 — מייל חדש מכתובת מורשה עם 'תקלה' בכותרת היה פותח טיוטה", () => {
    expect(classify(envelope(), context).verdict).toBe("DRAFT_CREATED");
  });

  it("EM-01 — אותו מייל בלי המילה בכותרת נדחה על הכותרת", () => {
    expect(classify(envelope({ subject: "שאלה על החניה" }), context).verdict).toBe("IGNORED_SUBJECT");
  });

  it("EM-22 — מייל שהגיע לפני רצפת ההפעלה אינו נקלט", () => {
    const withFloor = { ...context, activatedAt: new Date("2026-09-17T12:00:00.000Z") };
    expect(classify(envelope(), withFloor).verdict).toBe("IGNORED_BEFORE_ACTIVATION");
  });

  it("EM-23 — תשובה אוטומטית מזוהה, והסימן נשמר", () => {
    const result = classify(envelope({ headers: { "auto-submitted": "auto-replied" } }), context);
    expect(result.verdict).toBe("IGNORED_AUTO_REPLY");
    expect(result.signal).toBe("auto-submitted");
  });

  it("מייל מהתיבה עצמה מסומן כשלנו ולא כשולח לא מורשה", () => {
    const own = envelope({ from: { address: "Mailbox@Example.com", name: null } });
    expect(classify(own, context).verdict).toBe("IGNORED_OWN_MESSAGE");
  });

  it("EM-02 — שולח שאינו ברשימה נדחה, גם כשהכותרת עונה לכלל", () => {
    const stranger = envelope({ from: { address: "zar@example.com", name: null } });
    expect(classify(stranger, context).verdict).toBe("IGNORED_UNAUTHORIZED");
  });

  it("הודעה בלי שולח מפוענח נדחית ואינה מתפרשת ככתובת ריקה מורשית", () => {
    expect(classify(envelope({ from: null }), context).verdict).toBe("IGNORED_UNAUTHORIZED");
  });

  it("תשובה מסומנת בנפרד — בצל אין MailThread שמולו אפשר לזהות אותה", () => {
    const reply = classify(envelope({ inReplyTo: "x@y", subject: "Re: תקלה" }), context);
    expect(reply.verdict).toBe("REPLY_UNKNOWN_THREAD");
    expect(reply.isReply).toBe(true);
    // References לבדו מספיק: יש לקוחות ששולחים אותו בלי In-Reply-To
    expect(classify(envelope({ references: ["x@y"] }), context).verdict).toBe("REPLY_UNKNOWN_THREAD");
  });

  it("תשובה אוטומטית מכתובת מורשה מתויגת לפי הסימן ולא לפי ההרשאה", () => {
    const bounce = envelope({ from: { address: "zar@example.com", name: null }, headers: { precedence: "bulk" } });
    expect(classify(bounce, context).verdict).toBe("IGNORED_AUTO_REPLY");
  });
});

// ─────────────────────────────── המפקד ───────────────────────────────

describe("runShadow", () => {
  it("סופר מזהים ייחודיים משאילתות מרובות ומדפדף עד הסוף", async () => {
    const messages = [envelope({ sourceId: "a" }), envelope({ sourceId: "b" }), envelope({ sourceId: "c" })];
    const source = fakeSource(messages, { pages: [["a", "b"], ["b", "c"]] });
    const result = await runShadow({ ...baseInput, source });

    expect(result.census.listed).toBe(3);
    expect(result.census.fetched).toBe(3);
    expect(source.calls.map((call) => call.pageToken)).toEqual([undefined, "1"]);
    expect(result.mailbox).toBe("mailbox@example.com");
  });

  it("הודעה שנמחקה מהתיבה נספרת כ-GONE ואינה מפילה את הריצה", async () => {
    const source = fakeSource([envelope({ sourceId: "a" })], { pages: [["a", "b"]], gone: ["b"] });
    const result = await runShadow({ ...baseInput, source });
    expect(result.census.gone).toBe(1);
    expect(result.census.fetched).toBe(1);
  });

  it("שגיאת מקור נספרת לפי הסיווג שלה, והריצה ממשיכה להודעה הבאה", async () => {
    const fail = new Map<string, unknown>([["a", Object.assign(new Error("429"), { kind: "transient" })]]);
    const source = fakeSource([envelope({ sourceId: "b" })], { pages: [["a", "b"]], fail });
    const result = await runShadow({ ...baseInput, source });
    expect(result.census.errors.get("transient")).toBe(1);
    expect(result.census.fetched).toBe(1);
  });

  it("--limit מגביל את ההבאה ולא את הרשימה", async () => {
    const messages = [envelope({ sourceId: "a" }), envelope({ sourceId: "b" }), envelope({ sourceId: "c" })];
    const source = fakeSource(messages);
    const result = await runShadow({ ...baseInput, source, options: { ...OPTIONS, limit: 2 } });
    expect(result.census.listed).toBe(3);
    expect(result.census.fetched).toBe(2);
  });

  it("EM-13 — מפקד הציטוט מבדיל בין הוסר-ונשאר, לא-הוסר והוסר-הכול", async () => {
    const reply = (id: string, text: string) => envelope({ sourceId: id, sourceThreadId: id, inReplyTo: "p@q", text });
    const source = fakeSource([
      reply("a", "תודה, אני בודק\n\n> הודעה קודמת\n> עוד שורה"),
      reply("b", "תודה, אני בודק"),
      reply("c", "> הכול ציטוט\n> ושורה שנייה"),
    ]);
    const result = await runShadow({ ...baseInput, source });

    expect(result.census.replies).toBe(3);
    expect(result.census.quotes.get("clean")).toBe(1);
    expect(result.census.quotes.get("none")).toBe(1);
    expect(result.census.quotes.get("emptied")).toBe(1);
  });

  it("EM-13 — ציטוט שרק ההשוואה למייל הקודם זיהתה נספר כ'נוקה', ולא כ'לא זוהה'", async () => {
    // `removePriorBodies` הוא השכבה השלישית, וכל קיומה הוא הלקוח שמצטט בלי שום
    // סימון. בתשובה כזו הגוף הפשוט ריק והציטוט יושב ב-HTML, ולכן בדיקה של
    // ההשוואה מול **הגוף הפשוט** תמיד מחזירה "לא הוסר" — והמפקד היה מדווח
    // "הציטוט לא זוהה" דווקא על המקרה שהשכבה הזו נכתבה בשבילו. המדידה חייבת
    // לרוץ על אותו טקסט ש-`extractNewText` הריץ עליו.
    const previous = [
      "שורה ראשונה של המייל הקודם",
      "שורה שנייה של המייל הקודם",
      "שורה שלישית של המייל הקודם",
    ];
    const first = envelope({ sourceId: "p", sourceThreadId: "th", text: previous.join("\n") });
    const reply = envelope({
      sourceId: "r",
      sourceThreadId: "th",
      inReplyTo: "p@q",
      text: "",
      html: ["<div>תודה, אני בודק</div>", ...previous.map((line) => `<div>${line}</div>`)].join(""),
    });

    const result = await runShadow({ ...baseInput, source: fakeSource([first, reply]) });

    expect(result.census.quotes.get("clean")).toBe(1);
    expect(result.census.quotes.get("none")).toBeUndefined();
  });

  it("EM-13 — מסיר הציטוט אינו רץ על מייל ראשון, וספירת התמונות שהוסרו היא של תשובות בלבד", async () => {
    // `quote.ts` אוסר במפורש להריץ את המסיר על מייל ראשון: בהעברה (`Fwd:`)
    // הבלוק המועבר **הוא** הדיווח (§7 שורה 73, EM-A04). ספירה של "תמונות
    // שהוסרו עם הציטוט" על מייל כזה מדווחת על תמונה שהצינור דווקא ישמור,
    // והיא מודפסת תחת שורת התשובות — שבה נספרו אפס.
    const forwarded = envelope({
      sourceId: "f",
      subject: "תקלה שהועברה",
      text: "ראו מצורף",
      html: '<div>ראו מצורף</div><blockquote type="cite"><div>מהדייר <img src="cid:logo@x"></div></blockquote>',
    });

    const result = await runShadow({ ...baseInput, source: fakeSource([forwarded]) });

    expect(result.census.replies).toBe(0);
    expect(result.census.quotedInlineImages).toBe(0);
  });

  it("EM-13 — תשובה שגופה HTML בלבד נמדדת לפי מה שהוסר, ולא לפי אורך הגוף הפשוט", async () => {
    // Outlook ו-Gmail שולחים תשובות שהגוף הפשוט שלהן ריק, והציטוט מסומן
    // במבנה ה-HTML. `extractNewText` מעדיף את מסלול ה-HTML, ולכן השוואה מול
    // אורך הגוף הפשוט (0) הייתה מדווחת "הציטוט לא זוהה" על הלקוח הנפוץ ביותר
    // בתיבה — כלומר המדד המרכזי של השער היה יוצא הפוך.
    const htmlReply = envelope({
      sourceId: "h",
      sourceThreadId: "h",
      inReplyTo: "p@q",
      text: "",
      html: '<div>תודה, אני בודק</div><blockquote type="cite"><div>הודעה קודמת</div></blockquote>',
    });
    const result = await runShadow({ ...baseInput, source: fakeSource([htmlReply]) });

    expect(result.census.replies).toBe(1);
    expect(result.census.quotes.get("clean")).toBe(1);
    expect(result.census.quotes.get("none")).toBeUndefined();
  });

  it("מפקד הקבצים מבדיל בין הסוג שהוצהר לסוג שנפתר, וסופר תמונות משובצות", async () => {
    const pdf = Buffer.from("%PDF-1.7\n%aaa");
    const message = envelope({
      parts: [
        part({ index: 0, filename: "חשבונית.pdf", mimeType: "application/octet-stream", data: pdf, sourceRef: null }),
        part({ index: 1, filename: "logo.png", mimeType: "image/png", contentId: "cid-1", disposition: "inline" }),
      ],
    });
    const result = await runShadow({ ...baseInput, source: fakeSource([message]) });

    expect(result.census.declaredTypes.get("application/octet-stream")).toBe(1);
    expect(result.census.resolvedTypes.get("application/pdf")).toBe(1);
    expect(result.census.inlineImages).toBe(1);
    expect(result.census.attachmentsInline).toBe(1);
    expect(result.census.attachmentsByRef).toBe(1);
  });

  it("EM-06a — תמונה משובצת נספרת לפי ה-Content-ID, ולא לפי Content-Disposition", async () => {
    // הכלל באפיון הוא "תמונה משובצת בגוף" — כלומר תמונה שיש לה `Content-ID`
    // וה-HTML מפנה אליה. Outlook ולקוחות נוספים שולחים בדיוק תמונה כזו עם
    // `Content-Disposition: attachment`, ולפעמים בלי הכותרת בכלל
    // (`disposition: null`). ספירה שדורשת `inline` הייתה מדווחת "אין תמונות
    // משובצות בתיבה" על התיבה שכולה Outlook — והמסקנה מהשער הייתה הפוכה.
    const message = envelope({
      parts: [
        part({ index: 0, filename: "image001.png", mimeType: "image/png", contentId: "img1@outlook", disposition: "attachment" }),
        part({ index: 1, filename: "image002.png", mimeType: "image/png", contentId: "img2@outlook", disposition: null }),
      ],
    });

    const result = await runShadow({ ...baseInput, source: fakeSource([message]) });

    expect(result.census.inlineImages).toBe(2);
  });

  it("EM-06a — צרופה רגילה בלי Content-ID אינה נספרת כתמונה משובצת", async () => {
    const message = envelope({ parts: [part({ mimeType: "image/png", filename: "photo.png", contentId: null })] });

    const result = await runShadow({ ...baseInput, source: fakeSource([message]) });

    expect(result.census.inlineImages).toBe(0);
  });

  it("ה-charsets נקראים מה-JSON הגולמי שנלכד, בלי בקשה נוספת", async () => {
    const raw = {
      mimeType: "multipart/alternative",
      headers: [{ name: "Content-Type", value: "multipart/alternative; boundary=x" }],
      parts: [
        { mimeType: "text/plain", headers: [{ name: "Content-Type", value: 'text/plain; charset="windows-1255"' }] },
        { mimeType: "text/html", headers: [{ name: "Content-Type", value: "text/html; charset=UTF-8" }] },
      ],
    };
    const result = await runShadow({ ...baseInput, source: fakeSource([envelope()]), rawPayload: () => raw });
    expect(result.census.charsets.get("windows-1255")).toBe(1);
    expect(result.census.charsets.get("utf-8")).toBe(1);
  });

  it("בלי חלון מפורש החלון נגזר כמו בצינור עצמו — 48 שעות אחורה", async () => {
    const result = await runShadow({ ...baseInput, source: fakeSource([]), options: { ...OPTIONS, since: null } });
    expect(result.since).toEqual(new Date("2026-09-16T09:00:00.000Z"));
  });

  it("רצפת ההפעלה גוברת על חלון 48 השעות", async () => {
    const activatedAt = new Date("2026-09-17T00:00:00.000Z");
    const result = await runShadow({
      ...baseInput,
      source: fakeSource([]),
      activatedAt,
      options: { ...OPTIONS, since: null },
    });
    expect(result.since).toEqual(activatedAt);
  });

  it("מתקנים נאספים רק כשביקשו --out", async () => {
    const source = fakeSource([envelope()]);
    expect((await runShadow({ ...baseInput, source })).fixtures).toEqual([]);
    const withOut = await runShadow({ ...baseInput, source, options: { ...OPTIONS, outDir: ".shadow" } });
    expect(withOut.fixtures).toHaveLength(1);
  });
});

describe("formatCensus", () => {
  it("הפלט הוא ספירות בלבד: אין בו כותרת, שם ולא כתובת שולח", async () => {
    const message = envelope({ subject: "תקלה אצל משפחת לוי", from: { address: "dana@example.com", name: "דנה כהן" } });
    const result = await runShadow({ ...baseInput, source: fakeSource([message]) });
    const text = formatCensus(result, { rejected: [], senders: baseInput.senders, requests: [], options: OPTIONS });

    expect(text).not.toContain("משפחת לוי");
    expect(text).not.toContain("דנה כהן");
    expect(text).not.toContain("dana@example.com");
    expect(text).toContain("DRAFT_CREATED 1");
    // כתובת התיבה כן מודפסת: היא מה שמאשר שהטוקן מצביע על התיבה הנכונה
    expect(text).toContain("mailbox@example.com");
  });

  it("מדווח על כתובות מורשות שנדחו מהשאילתה — בצינור הן אובדן שקט", async () => {
    const result = await runShadow({ ...baseInput, source: fakeSource([]) });
    const text = formatCensus(result, {
      rejected: ["o'brien@example.com"],
      senders: baseInput.senders,
      requests: [{ method: "GET", path: "/x", status: 200 }],
      options: OPTIONS,
    });
    expect(text).toContain("נדחו מהשאילתה: 1");
    expect(text).toContain("GET 1");
  });
});

// ─────────────────────────────── עיקור זהות ───────────────────────────────

describe("redactPersonal", () => {
  it("כתובת מוחלפת בכינוי יציב, ואותה כתובת מקבלת אותו כינוי", () => {
    const book = createBook([]);
    const first = redactPersonal("כתבו אל dana@example.com", book);
    const second = redactPersonal("שוב DANA@example.com ואז other@example.com", book);
    expect(first).toBe("כתבו אל user-1@example.invalid");
    expect(second).toBe("שוב user-1@example.invalid ואז user-2@example.invalid");
  });

  it("שם מבסיס הנתונים מוסר גם באמצע משפט", () => {
    const book = createBook(["דנה כהן", "דנה"]);
    const out = redactPersonal("דנה כהן דיווחה, ודנה הוסיפה", book);
    expect(out).not.toContain("כהן");
    expect(out).toMatch(/person-1/);
  });

  it("שם ארוך מוחלף לפני שם קצר שמוכל בו", () => {
    const book = createBook(["ישראל", "ישראל ישראלי"]);
    expect(redactPersonal("ישראל ישראלי הגיע", book)).toBe("person-1 הגיע");
  });

  it("טלפון ישראלי בכל צורה מוחלף", () => {
    const book = createBook([]);
    expect(redactPersonal("חייגו 050-1234567 או +972521234567", book)).toBe("חייגו 0500000000 או 0500000000");
  });

  it("מה שאינו מזהה נשאר: המבנה הוא כל מה שהמתקן שווה", () => {
    const book = createBook([]);
    expect(redactPersonal("יש תקלה בדירה 12, בניין א'", book)).toBe("יש תקלה בדירה 12, בניין א'");
  });
});

describe("anonymize", () => {
  const book = createBook(["דנה כהן"]);
  const source = envelope({
    subject: "תקלה אצל דנה כהן",
    text: "המקרר לא עובד. dana@example.com, 050-1234567",
    html: "<div>המקרר לא עובד</div>",
    inReplyTo: "parent@sender.example",
    references: ["parent@sender.example"],
    parts: [part({ data: Buffer.from("secret bytes"), sourceRef: null, contentId: "cid@x" })],
    headers: { "content-type": "text/plain", "x-originating-ip": "[1.2.3.4]", "auto-submitted": "no" },
  });
  const fixture = anonymize(source, book, { verdict: "DRAFT_CREATED" });
  const json = JSON.stringify(fixture);

  it("אין במתקן אף כתובת, שם או טלפון אמיתיים", () => {
    expect(json).not.toContain("dana@example.com");
    expect(json).not.toContain("דנה כהן");
    expect(json).not.toContain("1234567");
    expect(json).not.toContain("sender.example");
  });

  it("אין במתקן אף בית של קובץ — גם לא תמונה שהוטבעה בגוף ה-HTML", () => {
    // `data:` URI הוא הדרך היחידה שבה בתים של קובץ נכנסים למתקן אף שהוא מדלג
    // על `parts`: הם יושבים בתוך ה-HTML עצמו, שנכתב כמו שהוא. המתקנים נועדו
    // לריפו הציבורי, ותמונה מתיבה אמיתית אינה יכולה להיכנס אליו.
    const payload = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const embedded = anonymize(envelope({ html: `<div>ראו</div><img src="data:image/png;base64,${payload}">` }), createBook([]), {});

    expect(JSON.stringify(embedded)).not.toContain(payload);
    // המבנה נשאר: שיש תמונה מוטבעת, ומאיזה סוג, הוא בדיוק מה שהמתקן נועד לספר
    expect(embedded.html).toContain("data:image/png;base64,");
  });

  it("אין במתקן אף בית של קובץ — רק הגודל והסוג", () => {
    expect(json).not.toContain("secret bytes");
    expect(fixture.parts).toEqual([
      expect.objectContaining({ mimeType: "application/octet-stream", sizeBytes: 1024, hasData: true, hasSourceRef: false }),
    ]);
  });

  it("המבנה נשמר: שרשור, סוג תוכן, והכרעה שהתלוותה", () => {
    expect(fixture.sourceThreadId).toBe("thr-1");
    expect(fixture.inReplyTo).toBe(fixture.references![0 as keyof typeof fixture.references]);
    expect(fixture.contentType).toBe("text/plain");
    expect(fixture.verdict).toBe("DRAFT_CREATED");
    expect(fixture.text).toContain("המקרר לא עובד");
  });

  it("שם קובץ מוחלף בכינוי, והסיומת נשמרת", () => {
    // שם של צרופה הוא אחד המקומות שבהם שם של אדם או של דירה מגיע בלי לעבור
    // באף רשימה ("דוח ליקויים - דירה 12 - משפחת כהן.pdf"), והמתקנים האלה
    // נועדו להיכנס לריפו הציבורי. הסיומת נשארת, כי `classifyAttachment` נשען
    // עליה כדי לפתור סוג שהוצהר גנרי — היא המבנה, והשם אינו.
    const named = anonymize(
      envelope({ parts: [part({ filename: "דוח ליקויים - משפחת ברקוביץ.PDF" })] }),
      createBook([]),
      {},
    );
    const files = named.parts as { filename: string | null }[];

    expect(files[0].filename).toBe("file-1.PDF");
    expect(JSON.stringify(named)).not.toContain("ברקוביץ");
  });

  it("נשמרות רק הכותרות המבניות — לא כל מה שהשרתים הוסיפו", () => {
    expect(Object.keys(fixture.headers as object)).toEqual(["content-type", "auto-submitted"]);
  });
});

describe("writeFixtures", () => {
  const dir = mkdtempSync(join(tmpdir(), "shadow-fixtures-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("כותב קובץ להודעה, עם ההכרעה בשם, ויוצר את התיקייה", async () => {
    const source = fakeSource([
      envelope({ sourceId: "a" }),
      envelope({ sourceId: "b", subject: "שאלה" }),
    ]);
    const result = await runShadow({ ...baseInput, source, options: { ...OPTIONS, outDir: dir } });
    const nested = join(dir, "run-1");
    const names = writeFixtures(nested, result.fixtures);

    expect(names).toEqual(["001-draft_created.json", "002-ignored_subject.json"]);
    expect(readdirSync(nested).sort()).toEqual(names);

    const written = JSON.parse(readFileSync(join(nested, names[0]), "utf8")) as Record<string, unknown>;
    expect(written.verdict).toBe("DRAFT_CREATED");
    expect(written.sourceId).toBe("msg-1");
    // מה שנכתב לדיסק חייב להיות מעוקר — זו כל הסיבה שהמתקנים מותרים בכלל
    expect(readFileSync(join(nested, names[0]), "utf8")).not.toContain("dana@example.com");
  });
});
