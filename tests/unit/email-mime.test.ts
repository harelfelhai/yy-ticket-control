import { describe, expect, it } from "vitest";
import {
  classifyAttachment,
  decodeBody,
  walkPayload,
  type GmailMessagePart,
} from "@/lib/email-intake/mime";

/**
 * פירוק עץ ה-MIME של Gmail (EM-06, EM-06a).
 *
 * הפיקסצ'רים בנויים לפי הצורה ש-Gmail API מחזיר ב-`format=full`: גוף כבר
 * מפוענח מ-transfer encoding ומקודד כ-base64url ב-`body.data`, קובץ גדול עם
 * `attachmentId` בלבד. כל לקוח דואר בונה עץ אחר, ומה שנבדק כאן הוא שהגוף
 * נקרא במלואו ושאף קובץ לא נבלע — שני כשלים שאינם מפילים דבר, רק מאבדים
 * מידע בשקט.
 */

// ─────────────────────────────── עזרים ───────────────────────────────

const b64 = (bytes: string | Uint8Array) =>
  (typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes)).toString("base64url");

/** קידוד windows-1255 לאותיות עבריות ו-ASCII — מה ש-Outlook ישן שולח */
function windows1255(text: string): Uint8Array {
  return Uint8Array.from([...text].map((ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x05d0 && code <= 0x05ea) return code - 0x05d0 + 0xe0;
    if (code < 0x80) return code;
    throw new Error(`תו שאינו נתמך בעזר: ${ch}`);
  }));
}

function headers(entries: Record<string, string>): { name: string; value: string }[] {
  return Object.entries(entries).map(([name, value]) => ({ name, value }));
}

function textPart(
  mimeType: "text/plain" | "text/html",
  content: string,
  extra: Partial<GmailMessagePart> & { charset?: string } = {},
): GmailMessagePart {
  const { charset = "UTF-8", ...rest } = extra;
  return {
    mimeType,
    filename: "",
    headers: headers({ "Content-Type": `${mimeType}; charset="${charset}"`, "Content-Transfer-Encoding": "quoted-printable" }),
    body: { size: Buffer.byteLength(content), data: b64(content) },
    ...rest,
  };
}

function multipart(mimeType: string, parts: GmailMessagePart[], extraHeaders: Record<string, string> = {}): GmailMessagePart {
  return {
    mimeType,
    filename: "",
    headers: headers({ "Content-Type": `${mimeType}; boundary="000000000000abc"`, ...extraHeaders }),
    body: { size: 0 },
    parts,
  };
}

const JPEG_HEAD = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_HEAD = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ascii = (text: string) => Buffer.from(text, "latin1");
const ftyp = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), ascii("ftyp"), ascii(brand), Buffer.alloc(8)]);
const riff = (kind: string) => Buffer.concat([ascii("RIFF"), Buffer.from([0x24, 0, 0, 0]), ascii(kind)]);

// ─────────────────────────────── decodeBody ───────────────────────────────

describe("decodeBody", () => {
  it("EM-06 — מפענח base64url עם התווים - ו-_ שאינם ב-base64 רגיל", () => {
    // "???>>>" מקודד ל-"Pz8_Pj4-" — שני התווים הייחודיים ל-base64url
    expect(b64("???>>>")).toBe("Pz8_Pj4-");
    expect(decodeBody("Pz8_Pj4-", "text/plain; charset=utf-8")).toBe("???>>>");
  });

  it("EM-06 — מקבל גם קידוד עם ריפוד (=)", () => {
    const padded = Buffer.from("שלום").toString("base64");
    expect(decodeBody(padded, "text/plain; charset=utf-8")).toBe("שלום");
  });

  it.each([
    ['text/plain; charset="windows-1255"'],
    ["text/plain; charset=windows-1255"],
    ["text/plain; charset=WINDOWS-1255; format=flowed"],
    ["text/plain;charset=windows-1255"],
    ["text/plain; format=flowed; charset = \"windows-1255\" "],
  ])("EM-06 — מפענח windows-1255 לפי הכותרת %s", (header) => {
    expect(decodeBody(b64(windows1255("נזילה בדירה 12")), header)).toBe("נזילה בדירה 12");
  });

  it.each([["iso-8859-8"], ["iso-8859-8-i"], ["ISO-8859-8-I"]])("EM-06 — מפענח %s (עברית חזותית/לוגית של לקוחות ישנים)", (charset) => {
    expect(decodeBody(b64(windows1255("מטבח")), `text/plain; charset=${charset}`)).toBe("מטבח");
  });

  it("EM-06 — charset שאינו מוכר נופל ל-UTF-8 ואינו זורק", () => {
    expect(decodeBody(b64("חשמל"), "text/plain; charset=x-no-such-charset")).toBe("חשמל");
    // TextDecoder זורק גם על utf-7 ועל תוויות שממופות ל-replacement
    expect(decodeBody(b64("חשמל"), "text/plain; charset=utf-7")).toBe("חשמל");
    expect(decodeBody(b64("חשמל"), "text/plain; charset=iso-2022-kr")).toBe("חשמל");
  });

  it("EM-06 — בלי charset ובלי כותרת בכלל — UTF-8", () => {
    expect(decodeBody(b64("אינסטלציה"), "text/plain")).toBe("אינסטלציה");
    expect(decodeBody(b64("אינסטלציה"), null)).toBe("אינסטלציה");
  });

  it("EM-06 — מסיר BOM של UTF-8", () => {
    expect(decodeBody(b64(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41])), "text/plain; charset=utf-8")).toBe("A");
  });

  it("EM-06 — מחרוזת ריקה מחזירה טקסט ריק", () => {
    expect(decodeBody("", "text/plain; charset=utf-8")).toBe("");
  });
});

// ─────────────────────────────── walkPayload ───────────────────────────────

describe("walkPayload — גוף ההודעה", () => {
  it("EM-06 — Gmail web: multipart/alternative נותן טקסט אחד ו-HTML אחד, בלי קבצים", () => {
    const payload = multipart("multipart/alternative", [
      textPart("text/plain", "יש נזילה בדירה 12\r\n"),
      textPart("text/html", '<div dir="rtl">יש נזילה בדירה 12</div>\r\n'),
    ]);
    payload.headers = headers({ From: "a@b.co", Subject: "תקלה", "Content-Type": 'multipart/alternative; boundary="x"' });

    const walked = walkPayload(payload);

    expect(walked).toEqual({
      contentType: "multipart/alternative",
      text: "יש נזילה בדירה 12\r\n",
      html: '<div dir="rtl">יש נזילה בדירה 12</div>\r\n',
      parts: [],
      emptyBody: false,
    });
  });

  it("EM-06 — הודעה פשוטה שאינה multipart: ה-payload עצמו הוא הגוף", () => {
    const walked = walkPayload({
      mimeType: "text/plain",
      filename: "",
      headers: headers({ Subject: "תקלה", "Content-Type": "text/plain; charset=utf-8" }),
      body: { size: 10, data: b64("אין מים חמים") },
    });
    expect(walked.contentType).toBe("text/plain");
    expect(walked.text).toBe("אין מים חמים");
    expect(walked.html).toBeNull();
    expect(walked.emptyBody).toBe(false);
  });

  it("EM-06a — iPhone Mail: תמונה משובצת בין שני חלקי טקסט — הטקסט מחובר והתמונה היא קובץ", () => {
    const image = JPEG_HEAD;
    const payload = multipart("multipart/mixed", [
      textPart("text/plain", "לפני התמונה", { charset: "utf-8" }),
      {
        mimeType: "image/jpeg",
        filename: "IMG_0412.jpeg",
        headers: headers({
          "Content-Type": 'image/jpeg; name="IMG_0412.jpeg"',
          "Content-Disposition": 'inline; filename="IMG_0412.jpeg"',
          "Content-Transfer-Encoding": "base64",
          "Content-Id": "<5C1B8E3A-0F2B-4B8E-9E0A-6C7E8F3A1D22>",
        }),
        body: { size: image.length, data: b64(image) },
      },
      textPart("text/plain", "אחרי התמונה"),
    ]);

    const walked = walkPayload(payload);

    expect(walked.contentType).toBe("multipart/mixed");
    expect(walked.text).toBe("לפני התמונה\nאחרי התמונה");
    expect(walked.html).toBeNull();
    expect(walked.parts).toEqual([
      {
        index: 0,
        filename: "IMG_0412.jpeg",
        mimeType: "image/jpeg",
        sizeBytes: image.length,
        contentId: "5C1B8E3A-0F2B-4B8E-9E0A-6C7E8F3A1D22",
        disposition: "inline",
        data: Buffer.from(image),
        sourceRef: null,
      },
    ]);
  });

  it("EM-06a — Apple Mail עם HTML: כמה חלקי HTML רצופים ב-mixed מחוברים, לא רק הראשון", () => {
    const payload = multipart("multipart/alternative", [
      textPart("text/plain", "לפני\n\nאחרי"),
      multipart("multipart/mixed", [
        textPart("text/html", "<html><body><div>לפני</div></body></html>"),
        {
          mimeType: "image/png",
          filename: "צילום מסך.png",
          headers: headers({ "Content-Type": "image/png", "Content-Disposition": "inline", "Content-ID": "<img1>" }),
          body: { size: 20000, attachmentId: "ANGjdJ_att1" },
        },
        textPart("text/html", "<html><body><div>אחרי</div></body></html>"),
      ]),
    ]);

    const walked = walkPayload(payload);

    expect(walked.text).toBe("לפני\n\nאחרי");
    expect(walked.html).toBe("<html><body><div>לפני</div></body></html>\n<html><body><div>אחרי</div></body></html>");
    expect(walked.parts).toHaveLength(1);
    expect(walked.parts[0]).toMatchObject({ filename: "צילום מסך.png", contentId: "img1", sourceRef: "ANGjdJ_att1", data: null });
  });

  it("EM-06 — גוף windows-1255 מפוענח לפי ה-charset של החלק", () => {
    const content = windows1255("התקלה במטבח, בניין א");
    const payload = multipart("multipart/alternative", [
      {
        mimeType: "text/plain",
        filename: "",
        headers: headers({ "Content-Type": 'text/plain; charset="windows-1255"' }),
        body: { size: content.length, data: b64(content) },
      },
      {
        mimeType: "text/html",
        filename: "",
        headers: headers({ "content-type": "text/html; charset=windows-1255" }),
        body: { size: content.length, data: b64(windows1255("<p>התקלה במטבח, בניין א</p>")) },
      },
    ]);

    const walked = walkPayload(payload);

    expect(walked.text).toBe("התקלה במטבח, בניין א");
    expect(walked.html).toBe("<p>התקלה במטבח, בניין א</p>");
  });

  it("EM-06 — HTML בלבד: text ריק ו-html מלא, והגוף אינו ריק", () => {
    const walked = walkPayload(textPart("text/html", '<div dir="rtl"><b>אין חשמל</b></div>'));
    expect(walked.text).toBe("");
    expect(walked.html).toBe('<div dir="rtl"><b>אין חשמל</b></div>');
    expect(walked.parts).toEqual([]);
    expect(walked.emptyBody).toBe(false);
  });

  it("EM-06 — payload ריק לגמרי: text/plain לפי ברירת המחדל של RFC 2045, גוף ריק", () => {
    expect(walkPayload({})).toEqual({ contentType: "text/plain", text: "", html: null, parts: [], emptyBody: true });
  });

  it("EM-06 — multipart בלי ילדים, או גוף של רווחים בלבד — emptyBody", () => {
    expect(walkPayload(multipart("multipart/mixed", [])).emptyBody).toBe(true);
    expect(walkPayload(multipart("multipart/alternative", [textPart("text/plain", " \r\n "), textPart("text/html", "\n")])).emptyBody).toBe(true);
  });

  it("EM-06 — הודעה עם קובץ בלבד וגוף ריק אינה emptyBody", () => {
    const walked = walkPayload(
      multipart("multipart/mixed", [
        textPart("text/plain", ""),
        { mimeType: "image/jpeg", filename: "a.jpg", headers: [], body: { size: 5, attachmentId: "att" } },
      ]),
    );
    expect(walked.text).toBe("");
    expect(walked.emptyBody).toBe(false);
  });

  it("EM-06 — ב-alternative נבחרת החלופה הראשונה שיש בה תוכן, ולא חלופה ריקה", () => {
    const walked = walkPayload(
      multipart("multipart/alternative", [
        textPart("text/plain", "   "),
        textPart("text/plain", "הטקסט האמיתי"),
        textPart("text/plain", "חלופה שלישית"),
        textPart("text/html", "<p>א</p>"),
        textPart("text/html", "<p>ב</p>"),
      ]),
    );
    expect(walked.text).toBe("הטקסט האמיתי");
    expect(walked.html).toBe("<p>א</p>");
  });

  it("EM-06 — כותרות בכל רישיות, ו-mimeType חסר נלקח מ-Content-Type", () => {
    const walked = walkPayload({
      headers: headers({ "CONTENT-TYPE": "Text/HTML; Charset=UTF-8" }),
      body: { data: b64("<p>שלום</p>") },
    });
    expect(walked.contentType).toBe("text/html");
    expect(walked.html).toBe("<p>שלום</p>");
  });

  it("EM-06 — מבנה multipart/report נשמר ב-contentType (מזהה הודעת מסירה)", () => {
    const walked = walkPayload(
      multipart("multipart/report", [
        textPart("text/plain", "Delivery failed"),
        { mimeType: "message/delivery-status", filename: "", headers: [], body: { size: 12, data: b64("Status: 5.1.1") } },
      ]),
    );
    expect(walked.contentType).toBe("multipart/report");
    expect(walked.parts.map((p) => p.mimeType)).toEqual(["message/delivery-status"]);
  });
});

describe("walkPayload — קבצים מצורפים", () => {
  it("EM-06 — קובץ קטן עם body.data ובלי attachmentId: הבתים ב-data, sourceRef ריק", () => {
    const pdf = ascii("%PDF-1.7\n%âãÏÓ\n1 0 obj");
    const walked = walkPayload(
      multipart("multipart/mixed", [
        textPart("text/plain", "מצורפת חשבונית"),
        {
          partId: "1",
          mimeType: "application/pdf",
          filename: "invoice.pdf",
          headers: headers({ "Content-Type": 'application/pdf; name="invoice.pdf"', "Content-Disposition": 'attachment; filename="invoice.pdf"' }),
          body: { size: pdf.length, data: b64(pdf) },
        },
      ]),
    );
    expect(walked.parts).toEqual([
      {
        index: 0,
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        sizeBytes: pdf.length,
        contentId: null,
        disposition: "attachment",
        data: pdf,
        sourceRef: null,
      },
    ]);
  });

  it("EM-06 — sizeBytes נגזר מאורך הבתים כש-body.size חסר", () => {
    const walked = walkPayload(
      multipart("multipart/mixed", [{ mimeType: "image/png", filename: "a.png", headers: [], body: { data: b64(PNG_HEAD) } }]),
    );
    expect(walked.parts[0]?.sizeBytes).toBe(PNG_HEAD.length);
  });

  it("EM-06 — קובץ גדול: attachmentId ב-sourceRef, data ריק, הגודל מ-body.size", () => {
    const walked = walkPayload(
      multipart("multipart/mixed", [
        textPart("text/plain", "סרטון"),
        { mimeType: "video/mp4", filename: "IMG_1.MOV", headers: [], body: { size: 8_000_000, attachmentId: "ANGjdJ-big" } },
      ]),
    );
    expect(walked.parts[0]).toMatchObject({ data: null, sourceRef: "ANGjdJ-big", sizeBytes: 8_000_000, disposition: null, contentId: null });
  });

  it("EM-06 — Outlook עם winmail.dat: החלק נשמר עם הסוג שהוצהר, והסיווג מסמן TNEF", () => {
    const payload = multipart("multipart/mixed", [
      multipart("multipart/alternative", [
        textPart("text/plain", "אין מים בדירה 4", { charset: "windows-1255", body: { size: 15, data: b64(windows1255("אין מים בדירה 4")) } }),
        textPart("text/html", "<p>אין מים בדירה 4</p>", { charset: "windows-1255", body: { size: 22, data: b64(windows1255("<p>אין מים בדירה 4</p>")) } }),
      ]),
      {
        mimeType: "application/ms-tnef",
        filename: "winmail.dat",
        headers: headers({ "Content-Type": 'application/ms-tnef; name="winmail.dat"', "Content-Disposition": 'attachment; filename="winmail.dat"' }),
        body: { size: 43_210, attachmentId: "tnef-att" },
      },
    ]);

    const walked = walkPayload(payload);

    expect(walked.text).toBe("אין מים בדירה 4");
    expect(walked.html).toBe("<p>אין מים בדירה 4</p>");
    expect(walked.parts).toHaveLength(1);
    const part = walked.parts[0]!;
    expect(part).toMatchObject({ filename: "winmail.dat", mimeType: "application/ms-tnef", sourceRef: "tnef-att" });
    expect(classifyAttachment(part)).toEqual({ mimeType: "application/ms-tnef", isMedia: false, isTnef: true });
  });

  it("EM-06 — PDF שהוצהר application/octet-stream: walkPayload שומר את ההצהרה, classifyAttachment מזהה PDF", () => {
    const walked = walkPayload(
      multipart("multipart/mixed", [
        textPart("text/plain", "מצורף"),
        {
          mimeType: "application/octet-stream",
          filename: "הצעת מחיר.pdf",
          headers: headers({ "Content-Type": 'application/octet-stream; name="=?UTF-8?B?15TXptei16og157Xl9eZ16gucGRm?="' }),
          body: { size: 120_000, attachmentId: "pdf-att" },
        },
      ]),
    );
    const part = walked.parts[0]!;
    expect(part.mimeType).toBe("application/octet-stream");
    expect(part.filename).toBe("הצעת מחיר.pdf");
    expect(classifyAttachment(part)).toEqual({ mimeType: "application/pdf", isMedia: true, isTnef: false });
  });

  it("EM-06a — שם קובץ מקודד RFC 2047 שנמצא רק בכותרת מפוענח, והסיומת שבו מזהה את הסוג", () => {
    // בלי פענוח השם נשאר "=?UTF-8?B?...?=", אין לו סיומת, וה-PDF שהוצהר
    // octet-stream היה מסווג כקובץ שאינו מדיה — ונשאר מחוץ לטיוטה בשקט.
    const walked = walkPayload(
      multipart("multipart/mixed", [
        textPart("text/plain", "מצורף"),
        {
          mimeType: "application/octet-stream",
          filename: "",
          headers: headers({ "Content-Type": 'application/octet-stream; name="=?UTF-8?B?15TXptei16og157Xl9eZ16gucGRm?="' }),
          body: { size: 120_000, attachmentId: "pdf-att" },
        },
        {
          mimeType: "application/octet-stream",
          filename: "",
          headers: headers({ "Content-Disposition": 'attachment; filename="=?UTF-8?B?15PXldeXLnBkZg==?="' }),
          body: { size: 10, attachmentId: "pdf-att-2" },
        },
      ]),
    );
    expect(walked.parts.map((p) => p.filename)).toEqual(["הצעת מחיר.pdf", "דוח.pdf"]);
    expect(classifyAttachment(walked.parts[0]!)).toEqual({ mimeType: "application/pdf", isMedia: true, isTnef: false });
  });

  it("EM-06a — text/plain עם שם קובץ הוא קובץ מצורף ולא חלק מהגוף", () => {
    const walked = walkPayload(
      multipart("multipart/mixed", [
        textPart("text/plain", "גוף ההודעה"),
        textPart("text/plain", "תוכן הקובץ", { filename: "notes.txt" }),
      ]),
    );
    expect(walked.text).toBe("גוף ההודעה");
    expect(walked.parts).toHaveLength(1);
    expect(walked.parts[0]).toMatchObject({ filename: "notes.txt", mimeType: "text/plain", data: Buffer.from("תוכן הקובץ") });
  });

  it("EM-06a — text/html עם Content-Disposition: attachment בלי שם הוא קובץ מצורף", () => {
    const walked = walkPayload(
      multipart("multipart/mixed", [
        textPart("text/plain", "גוף"),
        {
          ...textPart("text/html", "<p>דוח</p>"),
          headers: headers({ "Content-Type": "text/html; charset=utf-8", "Content-Disposition": "Attachment" }),
        },
      ]),
    );
    expect(walked.html).toBeNull();
    expect(walked.parts[0]).toMatchObject({ filename: null, mimeType: "text/html", disposition: "attachment" });
  });

  it("EM-06a — שם קובץ שמופיע רק בכותרות (בלי filename של Gmail) עדיין הופך את החלק לקובץ", () => {
    const walked = walkPayload(
      multipart("multipart/mixed", [
        textPart("text/plain", "גוף"),
        {
          mimeType: "text/plain",
          headers: headers({ "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": 'inline; filename="log.txt"' }),
          body: { size: 3, data: b64("abc") },
        },
      ]),
    );
    expect(walked.text).toBe("גוף");
    expect(walked.parts[0]).toMatchObject({ filename: "log.txt", disposition: "inline" });
  });

  it("EM-06a — Gmail web עם תמונה משובצת: related בתוך mixed, סדר DFS ומספור רציף", () => {
    const payload = multipart("multipart/mixed", [
      multipart("multipart/related", [
        multipart("multipart/alternative", [
          textPart("text/plain", "ראו תמונה\r\n[image: image.png]\r\n"),
          textPart("text/html", '<div dir="rtl">ראו תמונה<br><img src="cid:ii_m1a2b3c40" alt="image.png"></div>'),
        ]),
        {
          partId: "0.1",
          mimeType: "image/png",
          filename: "image.png",
          headers: headers({
            "Content-Type": 'image/png; name="image.png"',
            "Content-Disposition": 'inline; filename="image.png"',
            "Content-Transfer-Encoding": "base64",
            "Content-ID": "<ii_m1a2b3c40>",
            "X-Attachment-Id": "ii_m1a2b3c40",
          }),
          body: { size: 81_234, attachmentId: "inline-att" },
        },
      ]),
      { partId: "1", mimeType: "application/pdf", filename: "a.pdf", headers: [], body: { size: 10, attachmentId: "pdf-1" } },
      {
        partId: "2",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename: "דוח.docx",
        headers: [],
        body: { size: 10, attachmentId: "docx-1" },
      },
    ]);

    const walked = walkPayload(payload);

    expect(walked.text).toBe("ראו תמונה\r\n[image: image.png]\r\n");
    expect(walked.html).toContain("cid:ii_m1a2b3c40");
    expect(walked.parts.map((p) => [p.index, p.filename, p.contentId, p.disposition, p.sourceRef])).toEqual([
      [0, "image.png", "ii_m1a2b3c40", "inline", "inline-att"],
      [1, "a.pdf", null, null, "pdf-1"],
      [2, "דוח.docx", null, null, "docx-1"],
    ]);
  });

  it("EM-06a — תמונה בחלופת ה-HTML של alternative נקלטת גם כשהטקסט נלקח מחלופה אחרת", () => {
    const walked = walkPayload(
      multipart("multipart/alternative", [
        textPart("text/plain", "טקסט"),
        multipart("multipart/related", [
          textPart("text/html", '<p>טקסט<img src="cid:logo"></p>'),
          { mimeType: "image/gif", filename: "logo.gif", headers: headers({ "Content-ID": "logo" }), body: { size: 1, attachmentId: "g" } },
        ]),
      ]),
    );
    expect(walked.text).toBe("טקסט");
    expect(walked.html).toBe('<p>טקסט<img src="cid:logo"></p>');
    expect(walked.parts).toHaveLength(1);
    expect(walked.parts[0]?.contentId).toBe("logo");
  });

  it("EM-06a — message/rfc822 הוא קובץ מצורף אחד: לא יורדים לתוכו, והטקסט שבו אינו גוף", () => {
    const walked = walkPayload(
      multipart("multipart/mixed", [
        textPart("text/plain", "מעביר את המייל המצורף"),
        {
          mimeType: "message/rfc822",
          filename: "",
          headers: headers({ "Content-Type": "message/rfc822" }),
          body: { size: 5000 },
          parts: [
            multipart("multipart/mixed", [
              textPart("text/plain", "הטקסט של המייל המקורי"),
              { mimeType: "image/jpeg", filename: "inner.jpg", headers: [], body: { size: 4000, attachmentId: "inner" } },
            ]),
          ],
        },
      ]),
    );
    expect(walked.text).toBe("מעביר את המייל המצורף");
    expect(walked.parts).toEqual([
      { index: 0, filename: null, mimeType: "message/rfc822", sizeBytes: 5000, contentId: null, disposition: null, data: null, sourceRef: null },
    ]);
    expect(classifyAttachment(walked.parts[0]!)).toEqual({ mimeType: "message/rfc822", isMedia: false, isTnef: false });
  });

  it("EM-06 — חלק גוף ש-Gmail מסר רק כ-attachmentId (גוף גדול) אינו נבלע: הוא מוחזר כחלק", () => {
    const walked = walkPayload(
      multipart("multipart/alternative", [
        textPart("text/plain", "תקציר"),
        { mimeType: "text/html", filename: "", headers: headers({ "Content-Type": "text/html; charset=utf-8" }), body: { size: 3_000_000, attachmentId: "big-html" } },
      ]),
    );
    expect(walked.text).toBe("תקציר");
    expect(walked.html).toBeNull();
    expect(walked.parts).toEqual([
      { index: 0, filename: null, mimeType: "text/html", sizeBytes: 3_000_000, contentId: null, disposition: null, data: null, sourceRef: "big-html" },
    ]);
  });

  it("EM-06 — Content-Disposition לא מוכר נשמר כ-null; Content-ID בלי סוגריים נשמר כמו שהוא", () => {
    const walked = walkPayload(
      multipart("multipart/mixed", [
        { mimeType: "image/png", filename: "x.png", headers: headers({ "Content-Disposition": "form-data; name=x", "Content-ID": "  plain-id  " }), body: { size: 1, attachmentId: "a" } },
        { mimeType: "image/png", filename: "y.png", headers: headers({ "Content-ID": "<>" }), body: { size: 1, attachmentId: "b" } },
      ]),
    );
    expect(walked.parts.map((p) => [p.disposition, p.contentId])).toEqual([
      [null, "plain-id"],
      [null, null],
    ]);
  });

  it("EM-06 — ה-payload אינו משתנה: אותה תשובת API נקראת שוב בניסיון חוזר", () => {
    const deepFreeze = <T,>(value: T): T => {
      if (value && typeof value === "object") {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
      }
      return value;
    };
    const build = () =>
      multipart("multipart/mixed", [
        textPart("text/plain", "גוף"),
        { mimeType: "image/png", filename: "", headers: headers({ "Content-Disposition": 'inline; filename="=?UTF-8?B?15PXldeXLnBkZg==?="', "Content-ID": "<x>" }), body: { data: b64(PNG_HEAD) } },
      ]);
    const frozen = deepFreeze(build());
    expect(walkPayload(frozen)).toEqual(walkPayload(build()));
    expect(frozen).toEqual(build());
  });

  it("EM-06 — mimeType של חלק מנורמל לאותיות קטנות ובלי פרמטרים", () => {
    const walked = walkPayload(
      multipart("multipart/mixed", [{ mimeType: "IMAGE/JPEG", filename: "a.jpg", headers: [], body: { size: 1, attachmentId: "a" } }]),
    );
    expect(walked.parts[0]?.mimeType).toBe("image/jpeg");
  });
});

// ─────────────────────────────── classifyAttachment ───────────────────────────────

describe("classifyAttachment — סוג אמיתי ומדיה", () => {
  const OCTET = "application/octet-stream";

  it.each([
    ["photo.jpg", "image/jpeg"],
    ["photo.JPEG", "image/jpeg"],
    ["scan.png", "image/png"],
    ["anim.gif", "image/gif"],
    ["pic.webp", "image/webp"],
    ["IMG_0001.HEIC", "image/heic"],
    ["IMG_0001.heif", "image/heif"],
    ["invoice.pdf", "application/pdf"],
    ["clip.mp4", "video/mp4"],
    ["IMG_0002.MOV", "video/quicktime"],
    ["rec.webm", "video/webm"],
    ["voice.m4a", "audio/mp4"],
    ["song.mp3", "audio/mpeg"],
    ["note.ogg", "audio/ogg"],
    ["PTT-20260917-WA0001.opus", "audio/ogg"],
    ["memo.wav", "audio/wav"],
    ["memo.aac", "audio/aac"],
    ["call.amr", "audio/amr"],
    ["old.3gp", "video/3gpp"],
  ])("EM-06 — %s שהוצהר octet-stream מזוהה לפי הסיומת כ-%s ונחשב מדיה", (filename, expected) => {
    expect(classifyAttachment({ filename, mimeType: OCTET })).toEqual({ mimeType: expected, isMedia: true, isTnef: false });
  });

  it.each([
    ["", "a.pdf"],
    ["binary/octet-stream", "a.pdf"],
    ["application/unknown", "a.pdf"],
    ["application/force-download", "a.pdf"],
    ["Application/Octet-Stream; name=a.pdf", "a.pdf"],
  ])("EM-06 — סוג כללי '%s' נפתר לפי הסיומת", (mimeType, filename) => {
    expect(classifyAttachment({ filename, mimeType }).mimeType).toBe("application/pdf");
  });

  it.each([
    ["%PDF", "application/pdf", ascii("%PDF-1.4\n")],
    ["JPEG", "image/jpeg", JPEG_HEAD],
    ["PNG", "image/png", PNG_HEAD],
    ["GIF", "image/gif", ascii("GIF89a")],
    ["RIFF WEBP", "image/webp", riff("WEBP")],
    ["RIFF WAVE", "audio/wav", riff("WAVE")],
    ["OggS", "audio/ogg", ascii("OggS\0\x02")],
    ["ID3", "audio/mpeg", ascii("ID3\x04\0")],
    ["MP3 FF FB", "audio/mpeg", Uint8Array.from([0xff, 0xfb, 0x90, 0x64])],
    ["MP3 FF F3", "audio/mpeg", Uint8Array.from([0xff, 0xf3, 0x90, 0x64])],
    ["MP3 FF F2", "audio/mpeg", Uint8Array.from([0xff, 0xf2, 0x90, 0x64])],
    ["EBML", "video/webm", Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f])],
    ["ftyp heic", "image/heic", ftyp("heic")],
    ["ftyp heix", "image/heic", ftyp("heix")],
    ["ftyp mif1", "image/heic", ftyp("mif1")],
    ["ftyp M4A", "audio/mp4", ftyp("M4A ")],
    ["ftyp qt", "video/quicktime", ftyp("qt  ")],
    ["ftyp isom", "video/mp4", ftyp("isom")],
    ["ftyp mp42", "video/mp4", ftyp("mp42")],
  ])("EM-06 — בלי שם ועם סוג כללי, חתימת %s מזהה %s", (_name, expected, head) => {
    const result = classifyAttachment({ filename: null, mimeType: OCTET }, Buffer.from(head));
    expect(result).toEqual({ mimeType: expected, isMedia: true, isTnef: false });
  });

  it("EM-06 — חתימה גוברת על סיומת שסותרת אותה (הסיומת בשליטת השולח)", () => {
    expect(classifyAttachment({ filename: "photo.jpg", mimeType: OCTET }, Buffer.from(PNG_HEAD)).mimeType).toBe("image/png");
    expect(classifyAttachment({ filename: "IMG_1.jpg", mimeType: OCTET }, ftyp("heic")).mimeType).toBe("image/heic");
  });

  it("EM-06 — חתימת מכל (ftyp) אינה מכריעה אודיו מול וידאו, ולכן סיומת מאותה משפחה מדייקת", () => {
    expect(classifyAttachment({ filename: "voice.m4a", mimeType: OCTET }, ftyp("isom")).mimeType).toBe("audio/mp4");
    expect(classifyAttachment({ filename: "clip.mov", mimeType: OCTET }, ftyp("isom")).mimeType).toBe("video/quicktime");
    expect(classifyAttachment({ filename: "memo.aac", mimeType: OCTET }, ascii("ID3\x03\0")).mimeType).toBe("audio/aac");
  });

  it("EM-06 — מותג M4A בחתימה הוא אודיו: הצהרת וידאו או סיומת וידאו אינן הופכות אותו לווידאו", () => {
    // וידאו אינו מתומלל (services/media.ts), ולכן הקלטה שסווגה כווידאו מאבדת
    // את הטקסט שממנו מחולצים השדות. "M4A " הוא מותג של אודיו בלבד.
    expect(classifyAttachment({ filename: "voice.m4a", mimeType: "video/mp4" }, ftyp("M4A ")).mimeType).toBe("audio/mp4");
    expect(classifyAttachment({ filename: "voice.mp4", mimeType: OCTET }, ftyp("M4A ")).mimeType).toBe("audio/mp4");
    expect(classifyAttachment({ filename: null, mimeType: "audio/x-m4a" }, ftyp("M4A ")).mimeType).toBe("audio/mp4");
  });

  it("EM-06 — סוג מוצהר ספציפי גובר על הסיומת", () => {
    expect(classifyAttachment({ filename: "scan.jpg", mimeType: "application/pdf" })).toEqual({ mimeType: "application/pdf", isMedia: true, isTnef: false });
    expect(classifyAttachment({ filename: "notes.pdf", mimeType: "text/plain" })).toEqual({ mimeType: "text/plain", isMedia: false, isTnef: false });
  });

  it("EM-06 — סוג מוצהר ספציפי מתחלף כשהחתימה סותרת אותו", () => {
    expect(classifyAttachment({ filename: "a.png", mimeType: "image/png" }, Buffer.from(JPEG_HEAD)).mimeType).toBe("image/jpeg");
    expect(classifyAttachment({ filename: "notes.txt", mimeType: "text/plain" }, ascii("%PDF-1.5")).mimeType).toBe("application/pdf");
  });

  it("EM-06 — חתימה ממשפחה תואמת אינה נחשבת סתירה (הקלטה בדפדפן היא audio/webm, לא וידאו)", () => {
    const ebml = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
    expect(classifyAttachment({ filename: "rec.webm", mimeType: "audio/webm" }, ebml).mimeType).toBe("audio/webm");
    expect(classifyAttachment({ filename: null, mimeType: "audio/mp4" }, ftyp("isom")).mimeType).toBe("audio/mp4");
    expect(classifyAttachment({ filename: null, mimeType: "video/quicktime" }, ftyp("mp42")).mimeType).toBe("video/quicktime");
    expect(classifyAttachment({ filename: null, mimeType: "image/heif" }, ftyp("mif1")).mimeType).toBe("image/heif");
    expect(classifyAttachment({ filename: null, mimeType: "audio/ogg" }, ascii("OggS")).mimeType).toBe("audio/ogg");
  });

  it("EM-06 — חתימה שאינה מוכרת אינה סותרת את ההצהרה", () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(classifyAttachment({ filename: "a.jpg", mimeType: "image/jpeg" }, zip).mimeType).toBe("image/jpeg");
    expect(classifyAttachment({ filename: "a.pdf", mimeType: OCTET }, zip).mimeType).toBe("application/pdf");
  });

  it.each([
    ["image/jpg", "image/jpeg"],
    ["image/pjpeg", "image/jpeg"],
    ["audio/mp3", "audio/mpeg"],
    ["audio/x-m4a", "audio/mp4"],
    ["audio/x-wav", "audio/wav"],
    ["application/x-pdf", "application/pdf"],
  ])("EM-06 — כינוי לא תקני %s מנורמל ל-%s", (declared, expected) => {
    expect(classifyAttachment({ filename: null, mimeType: declared })).toEqual({ mimeType: expected, isMedia: true, isTnef: false });
  });

  it("EM-06 — חתימה חלקית או ריקה אינה זורקת ואינה מזהה דבר", () => {
    for (const head of [Buffer.alloc(0), Buffer.from([0xff]), Buffer.from([0xff, 0xd8]), ascii("RIFF"), ascii("RIFF\0\0\0\0WE"), Buffer.from([0, 0, 0, 0x18, 0x66, 0x74])]) {
      expect(classifyAttachment({ filename: null, mimeType: OCTET }, head).mimeType).toBe(OCTET);
    }
    expect(classifyAttachment({ filename: null, mimeType: OCTET }, null).mimeType).toBe(OCTET);
  });
});

describe("classifyAttachment — מה אינו מדיה (EM-06a)", () => {
  it.each([
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "דוח.docx"],
    ["application/msword", "old.doc"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "טבלה.xlsx"],
    ["application/vnd.ms-excel", "old.xls"],
    ["application/zip", "photos.zip"],
    ["application/x-rar-compressed", "a.rar"],
    ["text/plain", "notes.txt"],
    ["text/calendar", "invite.ics"],
    ["message/rfc822", null],
    ["application/pkcs7-signature", "smime.p7s"],
  ])("EM-06a — %s נשמר בהתכתבות בלבד", (mimeType, filename) => {
    expect(classifyAttachment({ filename, mimeType })).toEqual({ mimeType, isMedia: false, isTnef: false });
  });

  it("EM-06a — סוג כללי עם סיומת שאינה מדיה נשאר octet-stream ואינו מדיה", () => {
    expect(classifyAttachment({ filename: "דוח.docx", mimeType: "application/octet-stream" })).toEqual({
      mimeType: "application/octet-stream",
      isMedia: false,
      isTnef: false,
    });
    expect(classifyAttachment({ filename: null, mimeType: "" })).toEqual({ mimeType: "application/octet-stream", isMedia: false, isTnef: false });
    expect(classifyAttachment({ filename: "noext", mimeType: "application/octet-stream" }).isMedia).toBe(false);
  });

  it("EM-06a — SVG אינו נחשב מדיה: הוא מסמך שיכול להריץ סקריפט כשמוגש מהדומיין שלנו", () => {
    expect(classifyAttachment({ filename: "logo.svg", mimeType: "image/svg+xml" })).toEqual({ mimeType: "image/svg+xml", isMedia: false, isTnef: false });
  });

  it.each([
    [{ filename: "winmail.dat", mimeType: "application/ms-tnef" }],
    [{ filename: "WINMAIL.DAT", mimeType: "application/octet-stream" }],
    [{ filename: "winmail.dat", mimeType: "" }],
    [{ filename: null, mimeType: "application/ms-tnef" }],
    [{ filename: "att.dat", mimeType: "application/vnd.ms-tnef" }],
  ])("EM-06a — TNEF של Outlook מסומן ואינו מדיה: %o", (part) => {
    expect(classifyAttachment(part)).toEqual({ mimeType: "application/ms-tnef", isMedia: false, isTnef: true });
  });

  it("EM-06a — TNEF מזוהה גם לפי החתימה כשהשם והסוג כלליים", () => {
    const tnef = Buffer.from([0x78, 0x9f, 0x3e, 0x22, 0x01, 0x00]);
    expect(classifyAttachment({ filename: "att.bin", mimeType: "application/octet-stream" }, tnef)).toEqual({
      mimeType: "application/ms-tnef",
      isMedia: false,
      isTnef: true,
    });
  });
});
