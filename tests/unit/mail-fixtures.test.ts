import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AiRequestError } from "@/lib/ai/gemini";
import { isAutoReply } from "@/lib/email-intake/auto-reply";
import { classifyAttachment } from "@/lib/email-intake/mime";
import { buildPollQueries } from "@/lib/email-intake/query";
import { extractNewText } from "@/lib/email-intake/quote";
import { MailSourceError } from "@/lib/email-intake/source";
import { isIntakeSubject } from "@/lib/email-intake/subject";
import { isAllowedMimeType } from "@/lib/storage/limits";
import { aiError, extractionOf, fakeFieldExtractor } from "../helpers/fake-field-extractor";
import { fakeMailSource } from "../helpers/fake-mail-source";
import {
  ARRIVED_AT,
  FIRST_MAIL_MESSAGE_ID,
  FIRST_MAIL_SUBJECT,
  MAILBOX,
  OUTGOING_REPLY_MESSAGE_ID,
  OTHER_SENDER,
  REPLY_NEW_TEXT,
  SAMPLE_APARTMENT,
  SENDER,
  SENDER_NAME,
  STRANGER,
  autoReplyMail,
  documentAttachmentPart,
  firstMail,
  forwardedMail,
  mailFromStranger,
  mailWithAttachments,
  mailWithoutKeyword,
  replyInThread,
} from "../helpers/mail-fixtures";

/**
 * הכפילים של צינור המייל, נבדקים מול המודולים שיצרכו אותם.
 *
 * **למה כפיל נבדק בכלל.** שלוש חבילות בדיקות (הסבב, ההכרעה, המענה) נשענות
 * על הקבצים האלה, וכפיל שמשקר אינו מפיל דבר — הוא מוריק. מעטפה שאין בה
 * כותרות מנטרלת בשקט את זיהוי התשובה האוטומטית; תיבה שמחזירה הכול לכל
 * שאילתה מאשרת סינון שאינו קיים. לכן כל טענה כאן נבדקת מול הפונקציה
 * **האמיתית** שתקרא את ה-fixture בצינור, ולא מול ציפייה שנכתבה ביד.
 */

// ─────────────────────────────── המעטפות ───────────────────────────────

describe("mail-fixtures", () => {
  it("EM-01 — כותרת המייל הראשון עונה על כלל הכותרת, וזו שבלעדיו אינה", () => {
    expect(isIntakeSubject(firstMail().envelope.subject)).toBe(true);
    expect(isIntakeSubject(mailWithoutKeyword().envelope.subject)).toBe(false);
  });

  it("EM-01 — הכותרת העברית נשלחת מקודדת (RFC 2047) ומגיעה מפוענחת", () => {
    const { envelope, message } = firstMail();
    const raw = (message.payload?.headers ?? []).find((header) => header.name === "Subject")?.value;

    expect(raw).toMatch(/^=\?UTF-8\?B\?/);
    expect(envelope.subject).toBe(FIRST_MAIL_SUBJECT);
  });

  it("EM-04 — השולח מפוענח לכתובת מנורמלת ולשם עברי", () => {
    const { envelope } = firstMail();

    expect(envelope.from).toEqual({ address: SENDER, name: SENDER_NAME });
    expect(envelope.to.map((address) => address.address)).toEqual([MAILBOX]);
  });

  it("EM-04 — מעטפה מכתובת שאינה מוכרת נושאת אותה ככתובת השולח", () => {
    expect(mailFromStranger().envelope.from?.address).toBe(STRANGER);
  });

  it("EM-22 — זמן הקבלה נלקח מ-internalDate ואינו 'עכשיו'", () => {
    expect(firstMail().envelope.receivedAt.getTime()).toBe(ARRIVED_AT.getTime());
  });

  it("EM-23 — התשובה האוטומטית מזוהה, והמייל הראשון אינו", () => {
    expect(isAutoReply(autoReplyMail().envelope)).toBe(true);
    expect(isAutoReply(firstMail().envelope)).toBe(false);
  });

  it("EM-23 — X-Auto-Response-Suppress לבדו אינו מסמן הודעה כאוטומטית", () => {
    const envelope = firstMail({ headers: { "X-Auto-Response-Suppress": "All" } }).envelope;

    expect(envelope.headers["x-auto-response-suppress"]).toBe("All");
    expect(isAutoReply(envelope)).toBe(false);
  });

  it("EM-14 — התשובה נושאת את מזהי השרשור ואת אותו threadId", () => {
    const { envelope } = replyInThread();

    expect(envelope.inReplyTo).toBe(OUTGOING_REPLY_MESSAGE_ID);
    expect(envelope.references).toEqual([FIRST_MAIL_MESSAGE_ID, OUTGOING_REPLY_MESSAGE_ID]);
    expect(envelope.sourceThreadId).toBe(firstMail().envelope.sourceThreadId);
  });

  it("EM-13 — מהתשובה מופק הטקסט החדש בלבד, בלי הציטוט", () => {
    const { envelope } = replyInThread();
    const { newText } = extractNewText({ text: envelope.text, html: envelope.html, priorBodies: [] });

    expect(newText).toBe(REPLY_NEW_TEXT);
    // הציטוט אכן היה שם — אחרת הבדיקה למעלה ירוקה מפני שאין מה להסיר
    expect(envelope.text).toContain("נפתחה עבורך טיוטת פנייה");
  });

  it("EM-A04 — במייל מועבר הבלוק המועבר נשאר בגוף", () => {
    expect(forwardedMail().envelope.text).toContain("המעלית בבניין א' נתקעת");
  });

  it("EM-06 — תמונה משובצת מגיעה עם הבתים, וה-PDF כהפניה להורדה", () => {
    const { envelope, attachments } = mailWithAttachments();
    const [image, pdf] = envelope.parts;

    expect(envelope.parts).toHaveLength(2);
    expect(image.disposition).toBe("inline");
    expect(image.contentId).toBeTruthy();
    expect(image.data).not.toBeNull();
    expect(pdf.data).toBeNull();
    expect(pdf.sourceRef).toBe("attachment-pdf");
    expect(attachments["attachment-pdf"]).toBeInstanceOf(Buffer);
  });

  it("EM-06 — שם קובץ עברי מגיע מפוענח עם סיומתו", () => {
    expect(mailWithAttachments().envelope.parts[1].filename).toBe("דוח בדק בית.pdf");
  });

  it("EM-06a — התמונה וה-PDF הם מדיה מותרת, והמסמך אינו מדיה", () => {
    const media = mailWithAttachments().envelope.parts.map((part) => classifyAttachment(part, part.data));
    expect(media.map((item) => item.isMedia)).toEqual([true, true]);
    expect(media.every((item) => isAllowedMimeType(item.mimeType))).toBe(true);

    const [document] = mailWithAttachments({ parts: [documentAttachmentPart()] }).envelope.parts;
    expect(classifyAttachment(document, document.data).isMedia).toBe(false);
  });

  it("כותרת שנגזרה ניתנת להסרה — הודעה בלי Message-ID", () => {
    expect(firstMail({ headers: { "Message-ID": null } }).envelope.rfcMessageId).toBeNull();
  });
});

// ─────────────────────────────── התיבה המזויפת ───────────────────────────────

describe("fakeMailSource", () => {
  it("מחזיר את כתובת התיבה ומתעד את הקריאה", async () => {
    const source = fakeMailSource();

    await expect(source.getProfile()).resolves.toEqual({ emailAddress: MAILBOX });
    expect(source.calls).toEqual([{ method: "getProfile" }]);
  });

  it("שאילתה אמיתית מחזירה רק את ההודעות מהשולחים שבה ואחרי הרצפה", async () => {
    const early = firstMail({ id: "early", receivedAt: new Date("2026-09-10T05:00:00.000Z") });
    const other = firstMail({ id: "other", from: OTHER_SENDER, fromName: null });
    const source = fakeMailSource({ messages: [firstMail(), early, other, mailFromStranger()] });

    const [query] = buildPollQueries([SENDER], new Date("2026-09-15T00:00:00.000Z"));
    await expect(source.listIds(query)).resolves.toEqual({ ids: ["gmail-first"] });
    expect(source.callsTo("listIds")[0].query).toBe(query);
  });

  it("עימוד: עמוד ראשון עם אסימון, ועמוד שני שמסיים", async () => {
    const source = fakeMailSource({
      messages: [firstMail({ id: "a" }), firstMail({ id: "b" }), firstMail({ id: "c" })],
      pageSize: 2,
      match: () => true,
    });

    const first = await source.listIds("q");
    expect(first).toEqual({ ids: ["a", "b"], nextPageToken: "offset-2" });
    await expect(source.listIds("q", { pageToken: first.nextPageToken })).resolves.toEqual({ ids: ["c"] });
  });

  it("אסימון עמוד שאינו שלנו הוא כשל permanent ולא חזרה לעמוד הראשון", async () => {
    const source = fakeMailSource({ messages: [firstMail()], pageSize: 1 });

    await expect(source.listIds("q", { pageToken: "nonsense" })).rejects.toMatchObject({ kind: "permanent" });
  });

  it("הודעה שנעלמה מהתיבה מחזירה null ולא שגיאה (הכרעה GONE)", async () => {
    const source = fakeMailSource({ messages: [firstMail()] });

    await expect(source.getMessage("gmail-first")).resolves.not.toBeNull();
    source.remove("gmail-first");
    await expect(source.getMessage("gmail-first")).resolves.toBeNull();
  });

  it("הבתים של קובץ מצורף מגיעים מה-fixture, ומזהה שאינו קיים הוא not_found", async () => {
    const fixture = mailWithAttachments();
    const source = fakeMailSource({ messages: [fixture] });

    const bytes = await source.getAttachment(fixture.envelope.sourceId, "attachment-pdf");
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    await expect(source.getAttachment(fixture.envelope.sourceId, "missing")).rejects.toMatchObject({
      kind: "not_found",
    });
  });

  it("כשל מתוכנן נזרק בסיווג שנקבע, ופעם אחת בלבד", async () => {
    const source = fakeMailSource({ messages: [firstMail()] });
    source.failNext({ method: "getMessage", kind: "transient", status: 503 });

    await expect(source.getMessage("gmail-first")).rejects.toBeInstanceOf(MailSourceError);
    await expect(source.getMessage("gmail-first")).resolves.not.toBeNull();
    // גם הקריאה שנכשלה נרשמה: בדיקה שסופרת ניסיונות חוזרים צריכה את שתיהן
    expect(source.callsTo("getMessage")).toHaveLength(2);
  });

  it("כשל אפשר לכוון להודעה אחת, ואחרות אינן נופלות", async () => {
    const source = fakeMailSource({ messages: [firstMail({ id: "a" }), firstMail({ id: "b" })] });
    source.failNext({ method: "getMessage", messageId: "b", kind: "auth" });

    await expect(source.getMessage("a")).resolves.not.toBeNull();
    await expect(source.getMessage("b")).rejects.toMatchObject({ kind: "auth" });
  });

  it("דואר שהגיע בין סבבים מופיע בסבב הבא בלבד", async () => {
    const source = fakeMailSource({ messages: [firstMail()], match: () => true });

    await expect(source.listIds("q")).resolves.toEqual({ ids: ["gmail-first"] });
    source.deliver(replyInThread());
    await expect(source.listIds("q")).resolves.toEqual({ ids: ["gmail-first", "gmail-reply"] });
  });

  it("EM-20 — לכפיל אין שום פעולה שמשנה את התיבה", () => {
    const source = fakeMailSource();
    const api = Object.entries(source)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name)
      .sort();

    // `deliver` ו-`remove` משנים את מצב הבדיקה, לא את התיבה: הם מדמים דואר
    // שהגיע והודעה שנמחקה בידי מישהו אחר — אין כאן "סמן כנקרא" ואין "מחק".
    expect(api).toEqual(
      ["callsTo", "clearCalls", "deliver", "failNext", "getAttachment", "getMessage", "getProfile", "listIds", "remove"].sort(),
    );
  });

  it("EM-20 — הכפילים אינם יכולים לפנות לרשת", () => {
    const files = ["fake-mail-source.ts", "fake-field-extractor.ts", "mail-fixtures.ts"];
    const offenders = files.filter((name) =>
      /\bfetch\s*\(|https?:\/\/|node:(?:http|https|net|dns)|XMLHttpRequest/.test(
        readFileSync(join(process.cwd(), "tests", "helpers", name), "utf8"),
      ),
    );

    expect(offenders).toEqual([]);
  });
});

// ─────────────────────────────── המחלץ המזויף ───────────────────────────────

describe("fakeFieldExtractor", () => {
  it("EM-05a — מחזיר את החילוץ שהוכן, כטקסט כפי שנכתב", async () => {
    const extractor = fakeFieldExtractor({
      result: { apartment: SAMPLE_APARTMENT, description: "נזילה מתחת לכיור" },
    });

    const extraction = await extractor.extract({
      subject: FIRST_MAIL_SUBJECT,
      text: "…",
      attachments: [],
      gazetteer: { sites: [], buildings: [], apartments: [], domains: [], professionals: [], users: [] },
    });

    expect(extraction.apartment).toEqual({ text: SAMPLE_APARTMENT, source: "text" });
    expect(extraction.description).toEqual({ op: "set", text: "נזילה מתחת לכיור" });
    expect(extraction.site).toEqual({ text: "", source: "none" });
  });

  it("EM-13 — הקלט נרשם, ולכן אפשר לבדוק מה בדיוק נשלח לחילוץ", async () => {
    const extractor = fakeFieldExtractor();

    await extractor.extract({
      subject: FIRST_MAIL_SUBJECT,
      text: REPLY_NEW_TEXT,
      attachments: [],
      gazetteer: { sites: [], buildings: [], apartments: [], domains: [], professionals: [], users: [] },
      isReply: true,
    });

    expect(extractor.calls).toHaveLength(1);
    expect(extractor.lastCall?.text).toBe(REPLY_NEW_TEXT);
    expect(extractor.lastCall?.isReply).toBe(true);
  });

  it("EM-11 — כשל חולף שנקבע לשני ניסיונות נופל פעמיים ואז מצליח", async () => {
    const extractor = fakeFieldExtractor({ result: extractionOf({ apartment: "14" }) });
    extractor.failNext(aiError("transient"), 2);

    const input = {
      subject: FIRST_MAIL_SUBJECT,
      text: "…",
      attachments: [],
      gazetteer: { sites: [], buildings: [], apartments: [], domains: [], professionals: [], users: [] },
    };

    await expect(extractor.extract(input)).rejects.toBeInstanceOf(AiRequestError);
    await expect(extractor.extract(input)).rejects.toMatchObject({ kind: "transient" });
    await expect(extractor.extract(input)).resolves.toMatchObject({ apartment: { text: "14", source: "text" } });
    expect(extractor.calls).toHaveLength(3);
  });

  it("EM-11 — כשל קבוע (permanent) נופל בכל קריאה", async () => {
    const extractor = fakeFieldExtractor({ error: aiError("permanent") });
    const input = {
      subject: FIRST_MAIL_SUBJECT,
      text: "…",
      attachments: [],
      gazetteer: { sites: [], buildings: [], apartments: [], domains: [], professionals: [], users: [] },
    };

    await expect(extractor.extract(input)).rejects.toMatchObject({ kind: "permanent" });
    await expect(extractor.extract(input)).rejects.toMatchObject({ kind: "permanent" });
  });
});
