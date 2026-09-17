import { describe, expect, it } from "vitest";
import {
  extractNewText,
  htmlToText,
  removePriorBodies,
  stripQuotedHtml,
  stripQuotedText,
} from "@/lib/email-intake/quote";

/**
 * הפיקסצ׳רים משחזרים את המבנה שכל לקוח דואר מייצר בתשובה (שמות מחלקות,
 * מזהים, שבירת שורות, תווי כיווניות) — לא את התוכן המדויק. תווי כיווניות
 * כתובים כ-`\u` בכוונה: Gmail בעברית עוטף בהם את שורת הייחוס, והם חייבים
 * להיות בקלט כדי שהבדיקה תוכיח שהזיהוי עומד בהם.
 */

// ─────────────────────────── המייל הקודם בשרשרת ───────────────────────────

/** המייל החוזר של המערכת, כפי שהשולח קיבל אותו — מה שמצוטט בתשובה */
const SYSTEM_MAIL_LINES = [
  "שלום משה,",
  "",
  "קיבלנו את המייל ופתחנו ממנו טיוטה. היא עדיין לא נשלחה לאיש.",
  "",
  "מה יש בטיוטה עכשיו:",
  "אתר: הרצל 5 · בניין: א · דירה: 12 · חדר: מטבח · תחום: אינסטלציה · נמענים: —",
  "תיאור: נזילה מתחת לכיור במטבח",
  "",
  "חסר:",
  "נמענים (מי יטפל בתקלה)",
  "",
  "איך משלימים: משיבים למייל הזה וכותבים רק מה שחסר או צריך תיקון, או משלימים במערכת: https://tickets.example.com/drafts/abc",
];
const SYSTEM_MAIL = SYSTEM_MAIL_LINES.join("\n");
const SYSTEM_MAIL_HTML = `<div dir="rtl" lang="he">${SYSTEM_MAIL_LINES.join("<br>")}</div>`;
/** ציטוט בסגנון `>` של הטקסט הפשוט */
const SYSTEM_MAIL_QUOTED = SYSTEM_MAIL_LINES.map((line) => (line ? `> ${line}` : ">")).join("\n");

/** מה שאסור שיגיע לחילוץ מתוך הציטוט */
const QUOTED_VALUES = ["דירה: 12", "חדר: מטבח", "נזילה מתחת לכיור"];

function expectNoQuote(text: string) {
  for (const value of QUOTED_VALUES) expect(text).not.toContain(value);
}

// ─────────────────────────────── htmlToText ───────────────────────────────

describe("htmlToText", () => {
  it("EM-13 — זורק head, style, script ו-title", () => {
    const html =
      "<html><head><title>כותרת</title><style>p{color:red}</style></head>" +
      "<body><script>alert(1)</script><p>דירה 14</p></body></html>";
    expect(htmlToText(html)).toBe("דירה 14");
  });

  it("EM-13 — זורק את ה-CSS וההערות המותנות של Outlook", () => {
    const html =
      '<html><head><!--[if !mso]><style>v\\:* {behavior:url(#default#VML);}</style><![endif]-->' +
      "<style><!--\np.MsoNormal {margin:0cm;}\n--></style>" +
      '<!--[if gte mso 9]><xml><o:shapedefaults v:ext="edit" spidmax="1026" /></xml><![endif]-->' +
      "</head><body lang=HE><div class=WordSection1><p class=MsoNormal dir=RTL>" +
      "<span lang=HE>דירה 14<o:p></o:p></span></p></div></body></html>";
    expect(htmlToText(html)).toBe("דירה 14");
  });

  it("EM-13 — br ובלוקים הופכים לירידות שורה", () => {
    const html = "<div>שורה 1<br>שורה 2</div><p>שורה 3</p><ul><li>א</li><li>ב</li></ul><h2>כותרת</h2>";
    expect(htmlToText(html)).toBe("שורה 1\nשורה 2\nשורה 3\nא\nב\nכותרת");
  });

  it("EM-13 — br בסוף בלוק אינו מוסיף שורה ריקה, ובלוק שכולו br כן", () => {
    expect(htmlToText("<div>א<br></div><div>ב</div>")).toBe("א\nב");
    expect(htmlToText("<div>א</div><div><br></div><div>ב</div>")).toBe("א\n\nב");
  });

  it("EM-13 — שורה ריקה של Outlook (`<p>&nbsp;</p>`) נשמרת כשורה ריקה", () => {
    const html = "<p class=MsoNormal>א</p><p class=MsoNormal><o:p>&nbsp;</o:p></p><p class=MsoNormal>ב</p>";
    expect(htmlToText(html)).toBe("א\n\nב");
  });

  it("EM-13 — שורה ריקה אחת לכל היותר", () => {
    expect(htmlToText("א<br><br><br><br><br>ב")).toBe("א\n\nב");
  });

  it("EM-13 — כמה פסקאות ריקות רצופות של Outlook (`<p>&nbsp;</p>`) הן שורה ריקה אחת", () => {
    const empty = "<p class=MsoNormal><o:p>&nbsp;</o:p></p>";
    const html = `<p class=MsoNormal>דירה 14</p>${empty}${empty}${empty}<p class=MsoNormal>חדר רחצה</p>`;
    expect(htmlToText(html)).toBe("דירה 14\n\nחדר רחצה");
  });

  it("EM-13 — ההערות המותנות הגלויות של Word/Outlook (`<![if !supportLists]>`) אינן נקראות כטקסט", () => {
    // Outlook הקלאסי עוטף בהן כל מספור ברשימה וכל תמונה. בלי הסרה הן נכנסות
    // לחילוץ ומשם לתיאור הפנייה כ"<![if !supportLists]>1. <![endif]>".
    const html =
      "<p class=MsoListParagraph dir=RTL><![if !supportLists]><span dir=LTR><span style='mso-list:Ignore'>1." +
      "<span style='font:7.0pt \"Times New Roman\"'>&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>" +
      "<span lang=HE>דירה 14 ולא 12<o:p></o:p></span></p>" +
      '<p class=MsoNormal><![if !vml]><img width=120 height=40 src="cid:image001.png@01DD"><![endif]><o:p></o:p></p>';
    expect(htmlToText(html)).toBe("1. דירה 14 ולא 12");
    // ההערה המותנית של `<!--[if gte mso 9]>…<![endif]-->` נשארת הערה ונזרקת כולה
    expect(htmlToText("<!--[if gte mso 9]><xml><o:x>ישן</o:x></xml><![endif]--><p>דירה 14</p>")).toBe("דירה 14");
  });

  it("EM-13 — מפענח ישויות ו-&nbsp; לרווח", () => {
    expect(htmlToText("<p>יוסי&nbsp;כהן &lt;yossi@example.com&gt; &amp; דני &quot;השרברב&quot;</p>")).toBe(
      'יוסי כהן <yossi@example.com> & דני "השרברב"',
    );
  });

  it("EM-13 — מכווץ רווחים וירידות שורה שבמקור ה-HTML, ומסיר רווחים בשוליים", () => {
    const html = "\n  <div>\n    דירה    14\n    ולא   12\n  </div>\n  <div>   תודה   </div>\n";
    expect(htmlToText(html)).toBe("דירה 14 ולא 12\nתודה");
  });

  it("EM-13 — עטיפות RTL יוצאות כטקסט רגיל, בסדר הלוגי", () => {
    const html = '<div dir="rtl"><div dir="rtl" style="text-align:right"><span dir="ltr">Apt 14</span> דירה 14</div></div>';
    expect(htmlToText(html)).toBe("Apt 14 דירה 14");
  });

  it("EM-13 — ב-pre ירידות השורה שבמקור נשמרות", () => {
    expect(htmlToText("<pre>שורה 1\nשורה 2</pre>")).toBe("שורה 1\nשורה 2");
  });

  it("EM-13 — DOCTYPE ו-`<?xml:namespace?>` של Outlook אינם נקראים כטקסט", () => {
    const html =
      '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN"><html><body>' +
      '<?xml:namespace prefix = "o" ns = "urn:schemas-microsoft-com:office:office" /><p>דירה 14</p></body></html>';
    expect(htmlToText(html)).toBe("דירה 14");
  });

  it("EM-13 — תאי טבלה מופרדים ברווח ושורות טבלה בירידת שורה", () => {
    expect(htmlToText("<table><tr><td>דירה</td><td>14</td></tr><tr><td>חדר</td><td>רחצה</td></tr></table>")).toBe(
      "דירה 14\nחדר רחצה",
    );
  });

  it.each(["", "   ", "<div></div>", "<<<>>>", "</div></div><p", "<div <p>>"])(
    "EM-13 — קלט ריק או שבור אינו זורק (%j)",
    (html) => {
      expect(() => htmlToText(html)).not.toThrow();
    },
  );
});

// ─────────────────────────────── stripQuotedHtml ───────────────────────────────

describe("stripQuotedHtml", () => {
  it("EM-13 — HTML בלי ציטוט מוחזר כמו שהוא", () => {
    const html = '<div dir="rtl">דירה 14 ולא 12</div>';
    expect(stripQuotedHtml(html)).toEqual({ html, removed: false, quotedContentIds: [] });
  });

  it("EM-13 — מסיר div.gmail_quote_container בלי gmail_quote", () => {
    const html = '<div>חדש</div><div class="gmail_quote_container"><div>ישן</div></div>';
    const result = stripQuotedHtml(html);
    expect(result.removed).toBe(true);
    expect(htmlToText(result.html)).toBe("חדש");
  });

  it("EM-13 — מסיר רק את אלמנט הציטוט, וטקסט שנכתב מתחתיו נשאר", () => {
    const html =
      '<div>מעל</div><div class="gmail_quote"><blockquote class="gmail_quote">ישן</blockquote></div><div>מתחת</div>';
    expect(htmlToText(stripQuotedHtml(html).html)).toBe("מעל\nמתחת");
  });

  it("EM-13 — #appendonsend: מסיר אותו ואת כל מה שאחריו, גם מחוץ לעטיפה שלו", () => {
    const html =
      '<div>חדש</div><div><div id="appendonsend"></div><hr></div>' +
      '<div id="divRplyFwdMsg"><b>From:</b> X</div><div>ישן</div>';
    const result = stripQuotedHtml(html);
    expect(result.removed).toBe(true);
    expect(htmlToText(result.html)).toBe("חדש");
  });

  it("EM-13 — moz-cite-prefix מוסר עם ה-blockquote שאחריו גם בלי type=cite", () => {
    const html = '<p>חדש</p><div class="moz-cite-prefix">X כתב:</div><blockquote>ישן</blockquote><p>מתחת</p>';
    expect(htmlToText(stripQuotedHtml(html).html)).toBe("חדש\nמתחת");
  });

  it("EM-06a — מחזיר את ה-cid של תמונות שבציטוט בלבד, בלי `cid:`, בלי כפילויות", () => {
    const html =
      '<div>חדש<img src="cid:new-photo@x"></div>' +
      '<blockquote type="cite"><img src="cid:old-1@x"><img src="CID:old-2@x"><img src="cid:old-1@x">' +
      '<img src="https://example.com/remote.png"></blockquote>';
    const result = stripQuotedHtml(html);
    expect(result.quotedContentIds).toEqual(["old-1@x", "old-2@x"]);
  });

  it("EM-06a — תמונה שמשובצת גם בגוף החדש (לוגו בחתימה) אינה נחשבת תמונה בציטוט", () => {
    const html =
      '<div>חדש<br><img src="cid:logo@x"></div>' +
      '<div class="gmail_quote"><img src="cid:logo@x"><img src="cid:photo@x"></div>';
    expect(stripQuotedHtml(html).quotedContentIds).toEqual(["photo@x"]);
  });

  it("EM-06a — cid מקודד כ-URL מפוענח", () => {
    const html = '<blockquote type="cite"><img src="cid:image001.png%4001DD2A.5F3C1B20"></blockquote>';
    expect(stripQuotedHtml(html).quotedContentIds).toEqual(["image001.png@01DD2A.5F3C1B20"]);
  });

  it("EM-13 — Outlook הקלאסי (בלי מזהים) נחתך לפי בלוק הכותרות, כולל הטקסט שאחרי העטיפה", () => {
    const html =
      "<div class=WordSection1><p class=MsoNormal>חדש</p>" +
      "<div><div style='border:none;border-top:solid #E1E1E1 1.0pt'><p class=MsoNormal>" +
      "<b>From:</b> A &lt;a@example.com&gt;<br><b>Sent:</b> Wednesday, September 16, 2026 10:12 AM<br>" +
      "<b>To:</b> B<br><b>Subject:</b> RE: תקלה</p></div></div>" +
      '<p class=MsoNormal>ישן<img src="cid:image002.jpg@01DD"></p></div>';
    const result = stripQuotedHtml(html);
    expect(htmlToText(result.html)).toBe("חדש");
    expect(result.quotedContentIds).toEqual(["image002.jpg@01DD"]);
  });

  it("EM-13 — \"מאת:\" בלי \"נשלח:\" ו\"אל:\" אינו בלוק כותרות", () => {
    const html = "<p>מאת: יוסי מהקומה השנייה</p><p>דירה 14</p>";
    expect(stripQuotedHtml(html).removed).toBe(false);
  });

  it("EM-13 — שורת ייחוס מחוץ ל-blockquote (Roundcube): מוסרת לבדה, והתשובה שמתחת לציטוט נשארת", () => {
    const html =
      "<p>שלום</p><p>On 2026-09-16 10:12, YY Tickets wrote:</p>" +
      '<blockquote type="cite" style="padding-left:5px;border-left:#1010ff 2px solid">דירה: 12</blockquote>' +
      "<p>דירה 14 ולא 12</p>";
    const result = stripQuotedHtml(html);
    expect(result.removed).toBe(true);
    expect(htmlToText(result.html)).toBe("שלום\nדירה 14 ולא 12");
  });

  it("EM-13 — שורת ייחוס שמפוצלת בין כמה אלמנטים (קישור) מוסרת כולה", () => {
    const html =
      '<div>On Wed, Sep 16, 2026 at 10:12 AM <a href="mailto:tickets@example.com">YY Tickets</a> wrote:</div>' +
      '<blockquote type="cite">דירה: 12</blockquote><div>דירה 14</div>';
    expect(htmlToText(stripQuotedHtml(html).html)).toBe("דירה 14");
  });

  it("EM-13 — שורה של השולח שנגמרת ב\"כתב:\" מעל מכל gmail_quote נשארת (הייחוס של Gmail בתוך המכל)", () => {
    const html = '<div>הנה מה שהשכן כתב:</div><div class="gmail_quote"><div class="gmail_attr">On … wrote:</div>ישן</div>';
    expect(htmlToText(stripQuotedHtml(html).html)).toBe("הנה מה שהשכן כתב:");
  });

  it("EM-13 — blockquote עם type=\"CITE\" באותיות גדולות", () => {
    const result = stripQuotedHtml('<p>חדש</p><blockquote type="CITE">ישן</blockquote>');
    expect(result.removed).toBe(true);
    expect(htmlToText(result.html)).toBe("חדש");
  });

  it("EM-13 — גוף ב-pre: החיתוך במפריד אינו מוחק את הטקסט שמעליו באותו צומת", () => {
    const html = "<pre>דירה 14 &amp; חדר רחצה\n\n-----Original Message-----\nFrom: YY Tickets\nדירה: 12</pre>";
    const result = stripQuotedHtml(html);
    expect(result.removed).toBe(true);
    expect(htmlToText(result.html)).toBe("דירה 14 & חדר רחצה");
  });

  it("EM-13 — שורות `&gt;` ב-HTML (טקסט פשוט שהומר) מוסרות", () => {
    const result = stripQuotedHtml("דירה 14<br><br>&gt; דירה: 12<br>&gt; חדר: מטבח");
    expect(result.removed).toBe(true);
    expect(htmlToText(result.html)).toBe("דירה 14");
  });
});

// ─────────────────────────────── stripQuotedText ───────────────────────────────

describe("stripQuotedText", () => {
  it("EM-13 — טקסט בלי ציטוט מוחזר כמו שהוא", () => {
    const text = "דירה 14 ולא 12\n\nתודה,\nמשה";
    expect(stripQuotedText(text)).toEqual({ text, removed: false });
  });

  it("EM-13 — Gmail באנגלית, שורת הייחוס שבורה לשתי שורות", () => {
    const text = [
      "Apartment 14, not 12.",
      "",
      "On Wed, Sep 16, 2026 at 10:12 AM YY Tickets <tickets@example.com>",
      "wrote:",
      "",
      SYSTEM_MAIL_QUOTED,
    ].join("\n");
    expect(stripQuotedText(text)).toEqual({ text: "Apartment 14, not 12.", removed: true });
  });

  it("EM-13 — Gmail בעברית, עם תווי כיווניות ושבירה באמצע הכתובת", () => {
    const text = [
      "דירה 14 ולא 12",
      "",
      "\u202Bבתאריך יום ד׳, 16 בספט׳ 2026 ב-10:12 מאת \u202AYY Tickets\u202C\u200F <\u202A",
      "tickets@example.com\u202C\u200F>:\u202C",
      "",
      SYSTEM_MAIL_QUOTED,
    ].join("\n");
    expect(stripQuotedText(text).text).toBe("דירה 14 ולא 12");
  });

  it("EM-13 — \"בתאריך … מאת …:\" בלי שורות `>` אחריו חותך עד הסוף", () => {
    const text = ["דירה 14", "בתאריך יום ד׳, 16 בספט׳ 2026 ב-10:12 מאת YY Tickets <tickets@example.com>:", SYSTEM_MAIL].join(
      "\n",
    );
    expect(stripQuotedText(text).text).toBe("דירה 14");
  });

  it.each([
    ["iOS בעברית", "ב-16 בספט׳ 2026, בשעה 10:12, \u200FYY Tickets <tickets@example.com> כתב/ה:"],
    ["iOS באנגלית", "On 16 Sep 2026, at 10:12, YY Tickets <tickets@example.com> wrote:"],
    ["Thunderbird בעברית", "בתאריך 16/09/2026 10:12, YY Tickets כתב:"],
    ["Yahoo בעברית", "ביום רביעי, 16 בספטמבר 2026, 10:12:03 GMT+3, YY Tickets <tickets@example.com> כתב:"],
  ])("EM-13 — שורת ייחוס של %s חותכת", (_client, attribution) => {
    const text = ["דירה 14 ולא 12", "", attribution, "", SYSTEM_MAIL].join("\n");
    const result = stripQuotedText(text);
    expect(result.text).toBe("דירה 14 ולא 12");
    expectNoQuote(result.text);
  });

  it.each([
    ["-----Original Message-----"],
    ["-----הודעה מקורית-----"],
    ["-------- Original message --------"],
    ["---------- Forwarded message ---------"],
  ])("EM-13 — %s חותך", (separator) => {
    const text = ["דירה 14", "", separator, "From: YY Tickets", SYSTEM_MAIL].join("\n");
    expect(stripQuotedText(text).text).toBe("דירה 14");
  });

  it("EM-13 — קו תחתונים ואחריו \"מאת:\" (Outlook באינטרנט) חותך מהקו", () => {
    const text = ["חדר רחצה ולא מטבח", "", "________________________________", "מאת: YY Tickets <tickets@example.com>", SYSTEM_MAIL].join(
      "\n",
    );
    expect(stripQuotedText(text).text).toBe("חדר רחצה ולא מטבח");
  });

  it("EM-13 — קו תחתונים שאינו לפני כותרות נשאר", () => {
    const text = "חתימה\n________________________________\nמשה לוי";
    expect(stripQuotedText(text).removed).toBe(false);
  });

  it.each([
    [
      "Outlook בעברית",
      ["מאת: YY Tickets <tickets@example.com>", "נשלח: יום רביעי 16 ספטמבר 2026 10:12", "אל: משה לוי <moshe@example.com>", "נושא: RE: תקלה בדירה 12"],
    ],
    [
      "Outlook באנגלית, עם Cc",
      ["From: YY Tickets <tickets@example.com>", "Sent: Wednesday, September 16, 2026 10:12 AM", "Cc: Dana", "To: Moshe Levi", "Subject: RE: תקלה"],
    ],
    [
      "Outlook מועבר דרך Gmail (כוכביות)",
      ["*From:* YY Tickets <tickets@example.com>", "*Sent:* Wednesday, September 16, 2026 10:12 AM", "*To:* Moshe Levi"],
    ],
  ])("EM-13 — בלוק כותרות של %s חותך", (_client, header) => {
    const text = ["דירה 14 ולא 12", "", ...header, "", SYSTEM_MAIL].join("\n");
    expect(stripQuotedText(text).text).toBe("דירה 14 ולא 12");
  });

  it("EM-13 — שורות `>` בסוף מוסרות", () => {
    const text = `דירה 14 ולא 12\n\n${SYSTEM_MAIL_QUOTED}`;
    expect(stripQuotedText(text)).toEqual({ text: "דירה 14 ולא 12", removed: true });
  });

  it("EM-13 — שורות `>` משולבות בטקסט החדש מוסרות, והתשובות שביניהן נשארות", () => {
    const text = ["> דירה: 12", "דירה 14", "> חדר: מטבח", "חדר רחצה", ">> ציטוט מקונן", "תודה"].join("\n");
    expect(stripQuotedText(text).text).toBe("דירה 14\nחדר רחצה\nתודה");
  });

  it("EM-13 — שורת ייחוס מתוארכת ואחריה `>`: הטקסט שנכתב מתחת לציטוט נשאר", () => {
    const text = [
      "On Wed, Sep 16, 2026 at 10:12 AM YY Tickets <tickets@example.com> wrote:",
      SYSTEM_MAIL_QUOTED,
      "",
      "Apartment 14, not 12.",
    ].join("\n");
    expect(stripQuotedText(text).text).toBe("Apartment 14, not 12.");
  });

  it("EM-13 — שורת \"כתב:\" בלי תאריך מוסרת רק כשאחריה בלוק `>`", () => {
    expect(stripQuotedText("דירה 14\n\nמשה כתב:\n> דירה 12").text).toBe("דירה 14");
    const plain = "הדייר בדירה 12 כתב:\nיש נזילה גם בתקרה";
    expect(stripQuotedText(plain)).toEqual({ text: plain, removed: false });
  });

  it.each([
    ["משפט שנגמר ב\"כתב:\" עם מספר דירה בלבד", "בדירה 12 השכן כתב:\nשהנזילה חזרה"],
    ["\"On\" בלי תאריך", "On Monday the plumber wrote:\nthat the pipe is fixed"],
    ["\"מאת:\" בלי \"נשלח:\"", "מאת: יוסי מהקומה השנייה\nאל תשכחו את הצנרת"],
  ])("EM-13 — אינו חותך טקסט של השולח: %s", (_case, text) => {
    expect(stripQuotedText(text)).toEqual({ text, removed: false });
  });

  it("EM-13 — מקבל ירידות שורה של Windows", () => {
    const text = "דירה 14\r\n\r\nFrom: A\r\nSent: Wed, 16 Sep 2026 10:12\r\nTo: B\r\n\r\nדירה: 12";
    expect(stripQuotedText(text).text).toBe("דירה 14");
  });
});

// ─────────────────────────────── removePriorBodies ───────────────────────────────

describe("removePriorBodies", () => {
  it("EM-13 — מסיר מייל קודם שמצוטט מתחת לטקסט החדש בלי שום סימון", () => {
    const text = `דירה 14 ולא 12\n\n${SYSTEM_MAIL}`;
    expect(removePriorBodies(text, [SYSTEM_MAIL])).toEqual({ text: "דירה 14 ולא 12", removed: true });
  });

  it("EM-13 — מסיר מייל קודם שמצוטט **מעל** הטקסט החדש", () => {
    const text = `${SYSTEM_MAIL}\n\nדירה 14 ולא 12`;
    expect(removePriorBodies(text, [SYSTEM_MAIL]).text).toBe("דירה 14 ולא 12");
  });

  it("EM-13 — ציטוט שהלקוח שבר מחדש לשורות קצרות עדיין מזוהה", () => {
    const rewrapped = SYSTEM_MAIL_LINES.flatMap((line) =>
      line.length > 40 ? [line.slice(0, line.lastIndexOf(" ", 40)), line.slice(line.lastIndexOf(" ", 40) + 1)] : [line],
    ).join("\n");
    const result = removePriorBodies(`דירה 14\n\n${rewrapped}`, [SYSTEM_MAIL]);
    expect(result.text).toBe("דירה 14");
  });

  it("EM-13 — מתעלם מתווי כיווניות, מרווחים ומסימוני `>` בהשוואה", () => {
    const quoted = SYSTEM_MAIL_LINES.map((line) => `>  \u200F${line}  `).join("\n");
    expect(removePriorBodies(`דירה 14\n${quoted}`, [SYSTEM_MAIL]).text).toBe("דירה 14");
  });

  it("EM-13 — שורות קצרות שחוזרות במקרה (\"תודה\", שם בחתימה) אינן מוסרות", () => {
    const prior = "יש נזילה בכיור\nתודה\nמשה לוי";
    const text = "דירה 14 ולא 12\nתודה\nמשה לוי";
    expect(removePriorBodies(text, [prior])).toEqual({ text, removed: false });
  });

  it("EM-13 — שתי שורות קצרות רצופות מתחת לסף אינן מוסרות, ושלוש מוסרות", () => {
    const prior = "בניין א\nדירה 12\nחדר מטבח\nתחום אינסטלציה";
    expect(removePriorBodies("בניין א\nדירה 12", [prior]).removed).toBe(false);
    expect(removePriorBodies("בניין א\nדירה 12\nחדר מטבח", [prior])).toEqual({ text: "", removed: true });
  });

  it("EM-13 — שורה בודדת של 80 תווים ומעלה שמופיעה במייל קודם מוסרת", () => {
    const longLine = "אתר: הרצל 5 · בניין: א · דירה: 12 · חדר: מטבח · תחום: אינסטלציה · נמענים: יוסי כהן";
    expect(longLine.length).toBeGreaterThanOrEqual(80);
    expect(removePriorBodies(`דירה 14\n${longLine}`, [`שלום\n${longLine}\nתודה`]).text).toBe("דירה 14");
  });

  it("EM-13 — ההתאמה היא למילים שלמות: \"דירה 12\" אינה חלק מ\"דירה 112\"", () => {
    const prior = "בניין א\nדירה 112\nחדר מטבח";
    const text = "בניין א\nדירה 12\nחדר מטבח";
    expect(removePriorBodies(text, [prior]).removed).toBe(false);
  });

  it("EM-13 — שורות שאינן רצופות במייל הקודם אינן רצף", () => {
    const prior = "שורה ראשונה כאן\nשורה שנייה כאן\nשורה שלישית כאן";
    const text = "שורה ראשונה כאן\nשורה שלישית כאן\nשורה שנייה כאן";
    expect(removePriorBodies(text, [prior]).removed).toBe(false);
  });

  it("EM-13 — רצף נמצא גם כשהשורה הראשונה שלו מופיעה קודם במייל בלי ההמשך", () => {
    const prior = "בניין א\nשורה אחרת לגמרי\nבניין א\nדירה 12\nחדר מטבח";
    expect(removePriorBodies("דירה 14\nבניין א\nדירה 12\nחדר מטבח", [prior]).text).toBe("דירה 14");
  });

  it("EM-13 — רצף אינו נמתח מסוף מייל קודם אחד לתחילת המייל שאחריו", () => {
    const first = "שורה ראשונה כאן\nשורה שנייה כאן";
    const second = "שורה שלישית כאן\nשורה רביעית כאן";
    const text = "שורה שנייה כאן\nשורה שלישית כאן\nשורה רביעית כאן";
    expect(removePriorBodies(text, [first, second]).removed).toBe(false);
  });

  it("EM-13 — בלי מיילים קודמים, או עם גוף ריק, דבר אינו מוסר", () => {
    expect(removePriorBodies(SYSTEM_MAIL, [])).toEqual({ text: SYSTEM_MAIL, removed: false });
    expect(removePriorBodies(SYSTEM_MAIL, ["", "  \n "])).toEqual({ text: SYSTEM_MAIL, removed: false });
  });

  it("EM-13 — בודק מול כל המיילים הקודמים בשרשרת", () => {
    const firstMail = "יש נזילה מתחת לכיור במטבח\nבניין א דירה 12\nאפשר לתאם עם הדייר";
    const text = `חדר רחצה ולא מטבח\n\n${SYSTEM_MAIL}\n\n${firstMail}`;
    expect(removePriorBodies(text, [firstMail, SYSTEM_MAIL]).text).toBe("חדר רחצה ולא מטבח");
  });
});

// ─────────────────────────────── extractNewText ───────────────────────────────

/** תשובה אמיתית: גוף HTML וגוף טקסט של אותה הודעה */
interface ReplyFixture {
  html: string | null;
  text: string;
}

const GMAIL_WEB_HE: ReplyFixture = {
  html:
    '<div dir="rtl">דירה 14 ולא 12</div><br>' +
    '<div class="gmail_quote gmail_quote_container"><div dir="rtl" class="gmail_attr">' +
    "\u202Bבתאריך יום ד׳, 16 בספט׳ 2026 ב-10:12 מאת \u202AYY Tickets\u202C\u200F &lt;" +
    '<a href="mailto:tickets@example.com">tickets@example.com</a>&gt;:\u202C<br></div>' +
    '<blockquote class="gmail_quote" style="margin:0px 0.8ex 0px 0px;border-right:1px solid rgb(204,204,204);padding-right:1ex">' +
    `${SYSTEM_MAIL_HTML}</blockquote></div>`,
  text: [
    "דירה 14 ולא 12",
    "",
    "\u202Bבתאריך יום ד׳, 16 בספט׳ 2026 ב-10:12 מאת \u202AYY Tickets\u202C\u200F <\u202A",
    "tickets@example.com\u202C\u200F>:\u202C",
    "",
    SYSTEM_MAIL_QUOTED,
  ].join("\n"),
};

const GMAIL_WEB_EN: ReplyFixture = {
  html:
    '<div dir="ltr">Apartment 14, not 12.<br clear="all"><div><br></div><span class="gmail_signature_prefix">-- </span><br>' +
    '<div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature">Moshe Levi<br>Site manager</div></div><br>' +
    '<div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">' +
    'On Wed, Sep 16, 2026 at 10:12 AM YY Tickets &lt;<a href="mailto:tickets@example.com">tickets@example.com</a>&gt; wrote:<br></div>' +
    '<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">' +
    `${SYSTEM_MAIL_HTML}</blockquote></div>`,
  text: [
    "Apartment 14, not 12.",
    "",
    "-- ",
    "Moshe Levi",
    "Site manager",
    "",
    "",
    "On Wed, Sep 16, 2026 at 10:12 AM YY Tickets <tickets@example.com>",
    "wrote:",
    "",
    SYSTEM_MAIL_QUOTED,
  ].join("\n"),
};

const GMAIL_ANDROID: ReplyFixture = {
  html:
    '<div dir="auto">חדר רחצה ולא מטבח</div><br><div class="gmail_quote">' +
    '<div dir="ltr" class="gmail_attr">\u202Bבתאריך יום ד׳, 16 בספט׳ 2026, 10:12, מאת YY Tickets \u200F&lt;' +
    '<a href="mailto:tickets@example.com">tickets@example.com</a>&gt;:\u202C<br></div>' +
    '<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">' +
    `${SYSTEM_MAIL_HTML}</blockquote></div>`,
  text: [
    "חדר רחצה ולא מטבח",
    "",
    "\u202Bבתאריך יום ד׳, 16 בספט׳ 2026, 10:12, מאת YY Tickets \u200F<",
    "tickets@example.com>:\u202C",
    "",
    SYSTEM_MAIL_QUOTED,
  ].join("\n"),
};

/** Outlook הקלאסי (Word): אין אף מזהה — רק div עם קו עליון ובו "מאת:" */
const OUTLOOK_DESKTOP_HE: ReplyFixture = {
  html:
    '<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">' +
    '<head><meta http-equiv=Content-Type content="text/html; charset=utf-8">' +
    '<meta name=Generator content="Microsoft Word 15 (filtered medium)">' +
    "<style><!--\np.MsoNormal {margin:0cm;font-size:11.0pt;}\n--></style></head>" +
    "<body lang=HE link=\"#0563C1\" vlink=\"#954F72\" style='word-wrap:break-word'><div class=WordSection1>" +
    "<p class=MsoNormal dir=RTL><span lang=HE>דירה 14 ולא 12<o:p></o:p></span></p>" +
    "<p class=MsoNormal dir=RTL><span lang=HE><o:p>&nbsp;</o:p></span></p>" +
    "<p class=MsoNormal dir=RTL><span lang=HE>משה לוי | מנהל עבודה<o:p></o:p></span></p>" +
    '<p class=MsoNormal dir=RTL><span lang=HE><img width=120 height=40 id="Picture_x0020_1" src="cid:image001.png@01DD2A.5F3C1B20" alt="logo"></span></p>' +
    "<p class=MsoNormal dir=RTL><span lang=HE><o:p>&nbsp;</o:p></span></p>" +
    "<div><div style='border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0cm 0cm 0cm'>" +
    "<p class=MsoNormal align=right style='text-align:right;direction:rtl;unicode-bidi:embed'>" +
    "<b><span lang=HE>מאת:</span></b><span lang=HE> YY Tickets &lt;tickets@example.com&gt; <br>" +
    "<b>נשלח:</b> יום רביעי 16 ספטמבר 2026 10:12<br><b>אל:</b> משה לוי &lt;moshe@example.com&gt;<br>" +
    "<b>נושא:</b> RE: תקלה בדירה 12<o:p></o:p></span></p></div></div>" +
    "<p class=MsoNormal dir=RTL><o:p>&nbsp;</o:p></p>" +
    `<div>${SYSTEM_MAIL_HTML}<p class=MsoNormal><img src="cid:image002.jpg@01DD2A.5F3C1B20"></p></div>` +
    "</div></body></html>",
  text: [
    "דירה 14 ולא 12",
    "",
    "משה לוי | מנהל עבודה",
    "",
    "[logo]",
    "",
    "מאת: YY Tickets <tickets@example.com>",
    "נשלח: יום רביעי 16 ספטמבר 2026 10:12",
    "אל: משה לוי <moshe@example.com>",
    "נושא: RE: תקלה בדירה 12",
    "",
    SYSTEM_MAIL,
  ].join("\n"),
};

/** Outlook החדש / Microsoft 365 באנגלית: #appendonsend, קו, ו-#divRplyFwdMsg */
const OUTLOOK_DESKTOP_EN: ReplyFixture = {
  html:
    '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8">' +
    '<style type="text/css" style="display:none;"> P {margin-top:0;margin-bottom:0;} </style></head>' +
    '<body dir="ltr"><div class="elementToProof" style="font-family: Aptos, Calibri, Helvetica, sans-serif; font-size: 12pt;">' +
    "Bathroom, not kitchen.</div>" +
    '<div class="elementToProof" style="font-size: 12pt;"><br></div>' +
    '<div id="Signature"><div style="font-size: 11pt;">Moshe Levi</div></div>' +
    '<div id="appendonsend"></div><hr style="display:inline-block;width:98%" tabindex="-1">' +
    '<div id="divRplyFwdMsg" dir="ltr"><font face="Calibri, sans-serif" style="font-size:11pt" color="#000000">' +
    "<b>From:</b> YY Tickets &lt;tickets@example.com&gt;<br><b>Sent:</b> Wednesday, September 16, 2026 10:12 AM<br>" +
    "<b>To:</b> Moshe Levi &lt;moshe@example.com&gt;<br><b>Subject:</b> Re: תקלה בדירה 12</font><div>&nbsp;</div></div>" +
    `${SYSTEM_MAIL_HTML}</body></html>`,
  text: [
    "Bathroom, not kitchen.",
    "",
    "Moshe Levi",
    "________________________________",
    "From: YY Tickets <tickets@example.com>",
    "Sent: Wednesday, September 16, 2026 10:12 AM",
    "To: Moshe Levi <moshe@example.com>",
    "Subject: Re: תקלה בדירה 12",
    "",
    SYSTEM_MAIL,
  ].join("\n"),
};

/** Outlook באינטרנט בעברית: #divRplyFwdMsg בלבד, והציטוט באח שאחריו */
const OUTLOOK_WEB_HE: ReplyFixture = {
  html:
    '<html><head></head><body dir="rtl">' +
    '<div class="elementToProof" dir="rtl" style="font-size:12pt;">בניין ב ולא א</div>' +
    '<hr style="display:inline-block;width:98%" tabindex="-1">' +
    '<div id="divRplyFwdMsg" dir="rtl"><font face="Calibri, sans-serif" style="font-size:11pt" color="#000000">' +
    "<b>מאת:</b> YY Tickets &lt;tickets@example.com&gt;<br><b>נשלח:</b> יום רביעי 16 ספטמבר 2026 10:12<br>" +
    "<b>אל:</b> משה לוי &lt;moshe@example.com&gt;<br><b>נושא:</b> Re: תקלה בדירה 12</font><div>&nbsp;</div></div>" +
    `<div dir="rtl">${SYSTEM_MAIL_HTML}<img src="cid:ii_quoted_photo"></div></body></html>`,
  text: ["בניין ב ולא א", "", "________________________________", "מאת: YY Tickets <tickets@example.com>", SYSTEM_MAIL].join(
    "\n",
  ),
};

/** Outlook ל-Mac: כל הציטוט בתוך מכל אחד */
const OUTLOOK_MAC: ReplyFixture = {
  html:
    '<html><head></head><body><div dir="rtl">תחום חשמל</div><div><br></div>' +
    '<div id="mail-editor-reference-message-container"><div class="ms-outlook-mobile-reference-message skipProofing">' +
    '<div style="border:none;border-top:solid #B5C4DF 1.0pt;padding:3.0pt 0in 0in 0in"><b>From: </b>YY Tickets &lt;tickets@example.com&gt;<br>' +
    "<b>Date: </b>Wednesday, 16 September 2026 at 10:12<br><b>To: </b>Moshe Levi<br><b>Subject: </b>Re: תקלה</div>" +
    `<div><br></div>${SYSTEM_MAIL_HTML}</div></div></body></html>`,
  text: "",
};

/** iPhone Mail: גם שורת הייחוס בתוך blockquote type=cite, ותמונה בציטוט */
const IPHONE_MAIL: ReplyFixture = {
  html:
    '<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"></head><body dir="auto">' +
    '<div dir="rtl">דירה 14 ולא 12</div>' +
    '<div dir="rtl"><img src="cid:9A1B2C3D-0000-4A2B-9C3D-000000000002" alt="IMG_0413.jpeg"></div>' +
    '<div dir="rtl"><br id="lineBreakAtBeginningOfSignature"><div dir="rtl">נשלח מה-iPhone שלי</div>' +
    '<div dir="rtl"><br><blockquote type="cite">\u202Bב-16 בספט׳ 2026, בשעה 10:12, \u200FYY Tickets &lt;tickets@example.com&gt; כתב/ה:\u202C<br><br></blockquote></div>' +
    `<blockquote type="cite"><div dir="rtl">${SYSTEM_MAIL_HTML}` +
    '<img src="cid:9A1B2C3D-0000-4A2B-9C3D-000000000001" alt="IMG_0412.jpeg"></div></blockquote></div></body></html>',
  text: [
    "דירה 14 ולא 12",
    "",
    "נשלח מה-iPhone שלי",
    "",
    "> \u202Bב-16 בספט׳ 2026, בשעה 10:12, \u200FYY Tickets <tickets@example.com> כתב/ה:\u202C",
    "> ",
    SYSTEM_MAIL_QUOTED,
  ].join("\n"),
};

const THUNDERBIRD: ReplyFixture = {
  html:
    '<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head><body>' +
    '<p dir="rtl">בניין ב ולא א<br></p>' +
    '<div class="moz-cite-prefix">בתאריך 16/09/2026 10:12, YY Tickets כתב:<br></div>' +
    '<blockquote type="cite" cite="mid:reply-1@tickets.example.com">' +
    `<meta http-equiv="content-type" content="text/html; charset=UTF-8">${SYSTEM_MAIL_HTML}</blockquote><br></body></html>`,
  text: ["בניין ב ולא א", "", "בתאריך 16/09/2026 10:12, YY Tickets כתב:", SYSTEM_MAIL_QUOTED].join("\n"),
};

const YAHOO: ReplyFixture = {
  html:
    '<html><head></head><body><div class="ydp3f0a yahoo-style-wrap" style="font-family:Helvetica Neue, Helvetica, Arial, sans-serif;font-size:13px;">' +
    '<div dir="rtl" data-setdir="false">התחום הוא חשמל</div></div>' +
    '<div id="yahoo_quoted_8812345" class="yahoo_quoted"><div style="font-family:\'Helvetica Neue\', Helvetica, Arial, sans-serif;font-size:13px;color:#26282a;">' +
    "<div>ביום רביעי, 16 בספטמבר 2026, 10:12:03 GMT+3, YY Tickets &lt;tickets@example.com&gt; כתב:</div>" +
    `<div><br></div><div><br></div><div>${SYSTEM_MAIL_HTML}</div></div></div></body></html>`,
  text: "",
};

/** Apple Mail ל-Mac: שורת הייחוס בתוך ה-blockquote, והכול בתוך div עוטף */
const APPLE_MAIL_MAC: ReplyFixture = {
  html:
    '<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"></head>' +
    '<body style="overflow-wrap: break-word;" dir="auto"><div dir="rtl">חדר רחצה ולא מטבח</div>' +
    '<div><br><div><br><blockquote type="cite"><div>On 16 Sep 2026, at 10:12, YY Tickets &lt;tickets@example.com&gt; wrote:</div>' +
    '<br class="Apple-interchange-newline"><div>' +
    `${SYSTEM_MAIL_HTML}<img src="cid:F00D-QUOTED@apple"></div></blockquote></div><br></div></body></html>`,
  text: "",
};

/** Roundcube, תשובה מתחת לציטוט: שורת הייחוס לפני ה-blockquote ולא בתוכו */
const ROUNDCUBE_BOTTOM_POST: ReplyFixture = {
  html:
    '<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8" /></head>' +
    '<body style="font-size: 10pt; font-family: Verdana,Geneva,sans-serif">' +
    "<p>On 2026-09-16 10:12, YY Tickets wrote:</p>\n" +
    '<blockquote type="cite" style="padding: 0 0.4em; border-left: #1010ff 2px solid; margin: 0">' +
    `<!-- html ignored -->${SYSTEM_MAIL_HTML}</blockquote>\n<p>דירה 14 ולא 12</p>\n</body></html>`,
  text: ["On 2026-09-16 10:12, YY Tickets wrote:", SYSTEM_MAIL_QUOTED, "", "דירה 14 ולא 12"].join("\n"),
};

describe("extractNewText", () => {
  it.each<[string, ReplyFixture, string]>([
    ["Apple Mail ל-Mac", APPLE_MAIL_MAC, "חדר רחצה ולא מטבח"],
    ["Roundcube, תשובה מתחת לציטוט", ROUNDCUBE_BOTTOM_POST, "דירה 14 ולא 12"],
    ["Gmail באינטרנט בעברית", GMAIL_WEB_HE, "דירה 14 ולא 12"],
    ["Gmail באינטרנט באנגלית (החתימה נשארת)", GMAIL_WEB_EN, "Apartment 14, not 12.\n\n--\nMoshe Levi\nSite manager"],
    ["Gmail באנדרואיד", GMAIL_ANDROID, "חדר רחצה ולא מטבח"],
    ["Outlook הקלאסי בעברית", OUTLOOK_DESKTOP_HE, "דירה 14 ולא 12\n\nמשה לוי | מנהל עבודה"],
    ["Outlook החדש באנגלית", OUTLOOK_DESKTOP_EN, "Bathroom, not kitchen.\n\nMoshe Levi"],
    ["Outlook באינטרנט בעברית", OUTLOOK_WEB_HE, "בניין ב ולא א"],
    ["Outlook ל-Mac", OUTLOOK_MAC, "תחום חשמל"],
    ["iPhone Mail", IPHONE_MAIL, "דירה 14 ולא 12\n\nנשלח מה-iPhone שלי"],
    ["Thunderbird", THUNDERBIRD, "בניין ב ולא א"],
    ["Yahoo", YAHOO, "התחום הוא חשמל"],
  ])("EM-13 — %s: רק הטקסט החדש", (_client, fixture, expected) => {
    const { newText } = extractNewText({ ...fixture, priorBodies: [] });
    expect(newText).toBe(expected);
    expectNoQuote(newText);
  });

  it.each<[string, ReplyFixture]>([
    ["Gmail באינטרנט בעברית", GMAIL_WEB_HE],
    ["Gmail באנדרואיד", GMAIL_ANDROID],
    ["Outlook הקלאסי בעברית", OUTLOOK_DESKTOP_HE],
    ["Outlook החדש באנגלית", OUTLOOK_DESKTOP_EN],
    ["iPhone Mail", IPHONE_MAIL],
    ["Thunderbird", THUNDERBIRD],
    ["Roundcube, תשובה מתחת לציטוט", ROUNDCUBE_BOTTOM_POST],
  ])("EM-13 — %s: גם מסלול הטקסט הפשוט לבדו מסיר את הציטוט", (_client, fixture) => {
    const { newText } = extractNewText({ html: null, text: fixture.text, priorBodies: [] });
    expect(newText).not.toBe("");
    expectNoQuote(newText);
  });

  it("EM-13 — טקסט פשוט עם שורות `>`", () => {
    const text = `דירה 14 ולא 12\n\nMoshe wrote:\n${SYSTEM_MAIL_QUOTED}`;
    expect(extractNewText({ html: null, text, priorBodies: [SYSTEM_MAIL] }).newText).toBe("דירה 14 ולא 12");
  });

  it("EM-13 — תשובה מעל המייל הקודם בלי שום סימון: רק ההשוואה למיילים קודמים תופסת אותה", () => {
    const text = `דירה 14 ולא 12\n\n${SYSTEM_MAIL}`;
    const html = `<div dir="rtl">דירה 14 ולא 12</div><div><br></div>${SYSTEM_MAIL_HTML}`;
    // בלי המיילים הקודמים הציטוט עובר — זו ההוכחה ששום שכבה אחרת לא תפסה אותו
    expect(extractNewText({ html, text, priorBodies: [] }).newText).toContain("דירה: 12");
    const { newText } = extractNewText({ html, text, priorBodies: [SYSTEM_MAIL] });
    expect(newText).toBe("דירה 14 ולא 12");
  });

  it("EM-13 — תשובה שכולה שורת תיקון אחת עוברת כמו שהיא", () => {
    const result = extractNewText({
      html: '<div dir="rtl">דירה 14 ולא 12</div>',
      text: "דירה 14 ולא 12",
      priorBodies: [SYSTEM_MAIL],
    });
    expect(result).toEqual({ newText: "דירה 14 ולא 12", quotedContentIds: [] });
  });

  it("EM-06a — תמונה בציטוט מדווחת, ותמונה משובצת בטקסט החדש לא", () => {
    const { quotedContentIds } = extractNewText({ ...IPHONE_MAIL, priorBodies: [] });
    expect(quotedContentIds).toEqual(["9A1B2C3D-0000-4A2B-9C3D-000000000001"]);
  });

  it("EM-06a — Outlook הקלאסי: התמונה בציטוט מדווחת, הלוגו בחתימה החדשה לא", () => {
    const { quotedContentIds } = extractNewText({ ...OUTLOOK_DESKTOP_HE, priorBodies: [] });
    expect(quotedContentIds).toEqual(["image002.jpg@01DD2A.5F3C1B20"]);
  });

  it("EM-06a — Outlook באינטרנט: תמונה באח שאחרי #divRplyFwdMsg מדווחת", () => {
    expect(extractNewText({ ...OUTLOOK_WEB_HE, priorBodies: [] }).quotedContentIds).toEqual(["ii_quoted_photo"]);
  });

  it("EM-06a — Apple Mail ל-Mac: תמונה בתוך blockquote type=cite מדווחת", () => {
    expect(extractNewText({ ...APPLE_MAIL_MAC, priorBodies: [] }).quotedContentIds).toEqual(["F00D-QUOTED@apple"]);
  });

  it("EM-13 — Gmail, תשובות בין שורות הציטוט ושום דבר מעליו: מסלול ה-HTML ריק, והטקסט הפשוט שומר את התשובות", () => {
    // Gmail משאיר את התשובות בתוך div.gmail_quote, והמכל מוסר כולו (בספק — ציטוט).
    // בטקסט הפשוט הן שורות בלי `>`, ולכן שם הן נשמרות.
    const html =
      '<div dir="rtl"><br></div><div class="gmail_quote"><div dir="ltr" class="gmail_attr">' +
      "On Wed, Sep 16, 2026 at 10:12 AM YY Tickets &lt;tickets@example.com&gt; wrote:<br></div>" +
      '<blockquote class="gmail_quote">דירה: 12</blockquote><div>דירה 14</div>' +
      '<blockquote class="gmail_quote">חדר: מטבח</blockquote><div>חדר רחצה</div></div>';
    const text = [
      "",
      "On Wed, Sep 16, 2026 at 10:12 AM YY Tickets <tickets@example.com> wrote:",
      "",
      "> דירה: 12",
      "",
      "דירה 14",
      "",
      "> חדר: מטבח",
      "",
      "חדר רחצה",
    ].join("\n");
    expect(extractNewText({ html, text, priorBodies: [] }).newText).toBe("דירה 14\n\nחדר רחצה");
  });

  it("EM-13 — כשמסלול ה-HTML ריק (תמונה בלבד) והטקסט לא, נלקח הטקסט", () => {
    const html = '<div><img src="cid:photo@x"></div><div class="gmail_quote">ישן</div>';
    const result = extractNewText({ html, text: "דירה 14\n\n> ישן", priorBodies: [] });
    expect(result).toEqual({ newText: "דירה 14", quotedContentIds: [] });
  });

  it("EM-13 — quotedContentIds מגיע ממסלול ה-HTML גם כשהטקסט נלקח מהגוף הפשוט", () => {
    const html = '<div class="gmail_quote"><img src="cid:old@x"></div>';
    const result = extractNewText({ html, text: "דירה 14", priorBodies: [] });
    expect(result).toEqual({ newText: "דירה 14", quotedContentIds: ["old@x"] });
  });

  it("EM-13 — בלי HTML נלקח הטקסט הפשוט", () => {
    expect(extractNewText({ html: null, text: "דירה 14\n\n\n\nתודה", priorBodies: [] })).toEqual({
      newText: "דירה 14\n\nתודה",
      quotedContentIds: [],
    });
  });

  it("EM-13 — שורות שכולן רווחים או טאבים אינן משאירות רצף של שורות ריקות", () => {
    const text = "דירה 14\n  \n\t\n \nתודה";
    expect(extractNewText({ html: null, text, priorBodies: [] }).newText).toBe("דירה 14\n\nתודה");
  });

  it("EM-13 — תשובה שכולה ציטוט מחזירה טקסט ריק", () => {
    const result = extractNewText({ html: null, text: SYSTEM_MAIL_QUOTED, priorBodies: [SYSTEM_MAIL] });
    expect(result.newText).toBe("");
    const withInvisible = extractNewText({ html: "<div>\u200F</div>", text: "\u200F", priorBodies: [] });
    expect(withInvisible.newText).toBe("");
  });

  it("EM-13 — הטקסט עובר normalizeText: רווחים מכווצים, ירידות שורה נשמרות", () => {
    const html = "<div>דירה   14</div><div><br></div><div><br></div><div><br></div><div>  חדר רחצה </div>";
    expect(extractNewText({ html, text: "", priorBodies: [] }).newText).toBe("דירה 14\n\nחדר רחצה");
  });

  it("EM-A04 — גם בלוק מועבר מוסר, ולכן המודול מיועד לתשובות בלבד ולא למייל ראשון", () => {
    const forwarded = [
      "ראו למטה",
      "",
      "---------- Forwarded message ---------",
      "From: דייר <tenant@example.com>",
      "Date: Wed, Sep 16, 2026 at 9:00 AM",
      "Subject: נזילה",
      "To: <moshe@example.com>",
      "",
      "יש נזילה בדירה 12 בבניין א",
    ].join("\n");
    expect(extractNewText({ html: null, text: forwarded, priorBodies: [] }).newText).toBe("ראו למטה");
  });
});
