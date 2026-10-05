import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WebhookParseError, parseWebhook, type WaInboundMessage } from "@/lib/whatsapp/webhook";

/**
 * פענוח משלוח webhook של וואטסאפ — על **גופים אמיתיים** מהספייק W0
 * (`tests/fixtures/whatsapp/`, אחרי החלפת המזהים).
 *
 * הסוגים שלא נאספו לפני שחשבון הבדיקה ננעל (תגובה, מסמך, סטיקר, תגובת אימוג'י,
 * מיקום, הודעה מועברת) **נגזרים** מהודעה אמיתית ומהמבנה בתיעוד של Meta, ומסומנים
 * כך בשם הבדיקה — כדי שלא ייראו כמדידה (docs/research/whatsapp-spikes.md §7).
 */

const FIXTURES = join(process.cwd(), "tests", "fixtures", "whatsapp");

function raw(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.json`), "utf8");
}

/** הודעה מהגוף האמיתי של `text-report`, עם שינויים — לסוגים שלא נאספו */
function derived(patch: (message: Record<string, unknown>) => void): string {
  const body = JSON.parse(raw("text-report"));
  const message = body.entry[0].changes[0].value.messages[0];
  patch(message);
  return JSON.stringify(body);
}

function onlyMessage(rawBody: string): WaInboundMessage {
  const items = parseWebhook(rawBody);
  expect(items).toHaveLength(1);
  const [item] = items;
  if (item?.kind !== "message") throw new Error(`ציפיתי להודעה, התקבל ${item?.kind}`);
  return item.message;
}

describe("parseWebhook — גופים אמיתיים", () => {
  it("דיווח בטקסט: המספר העסקי, השולח, ה-BSUID, השם, הזמן והטקסט", () => {
    const message = onlyMessage(raw("text-report"));
    expect(message).toMatchObject({
      phoneNumberId: "300000000000002",
      wabaId: "200000000000002",
      waId: "972500000002",
      bsuid: "IL.1000000000000000002",
      profileName: "בודק 2",
      type: "text",
      text: "תקלה בדירה 12 — נזילה במטבח",
      contextWamid: null,
      forwarded: false,
      media: null,
    });
    expect(message.wamid).toMatch(/^wamid\./);
    // `timestamp` הוא שניות, כמחרוזת
    expect(message.sentAt.toISOString()).toBe(new Date(1791132696 * 1000).toISOString());
  });

  it("תמונה עם כיתוב: הכיתוב הוא הטקסט, וה-sha256 מומר מ-base64 ל-hex", () => {
    const message = onlyMessage(raw("image-caption"));
    expect(message.type).toBe("image");
    expect(message.text).toBe("תקלה");
    expect(message.media).toEqual({
      mediaId: "1000000000000101",
      mimeType: "image/jpeg",
      sha256: Buffer.from("KgY+0sVdg7BrN0SDdKeLBY0KEyhHomnay9hjMSQs6rM=", "base64").toString("hex"),
      filename: null,
      voice: false,
    });
    expect(message.media?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("הקלטה קולית: `voice` ו-`audio/ogg; codecs=opus`, בלי טקסט", () => {
    const message = onlyMessage(raw("voice"));
    expect(message.type).toBe("audio");
    expect(message.text).toBeNull();
    expect(message.media).toMatchObject({ mediaId: "1000000000000102", mimeType: "audio/ogg; codecs=opus", voice: true });
  });

  it("סטטוס failed: ההודעה שלנו, הקוד והכותרת", () => {
    const items = parseWebhook(raw("status-failed"));
    expect(items).toEqual([
      {
        kind: "status",
        status: expect.objectContaining({
          phoneNumberId: "300000000000002",
          status: "failed",
          errorCode: 131031,
          errorTitle: "Business Account locked",
        }),
      },
    ]);
  });

  it("אירוע Test מה-Dashboard מתפענח כהודעה רגילה", () => {
    const message = onlyMessage(raw("meta-test-sample"));
    expect(message).toMatchObject({ type: "text", text: "this is a text message", bsuid: "US.1000000000000000001" });
  });
});

describe("parseWebhook — סוגים שלא נאספו (נגזרים מהודעה אמיתית ומהתיעוד)", () => {
  it("תגובה (Reply): `context.id` הוא ההודעה שצוטטה", () => {
    const message = onlyMessage(
      derived((m) => {
        m.context = { from: "15550001234", id: "wamid.OUR-ACK" };
      }),
    );
    expect(message.contextWamid).toBe("wamid.OUR-ACK");
    expect(message.forwarded).toBe(false);
  });

  it("הודעה מועברת: `context.forwarded`, בלי הודעה מצוטטת", () => {
    const forwarded = onlyMessage(derived((m) => (m.context = { forwarded: true })));
    expect(forwarded).toMatchObject({ forwarded: true, contextWamid: null });
    const frequently = onlyMessage(derived((m) => (m.context = { frequently_forwarded: true })));
    expect(frequently.forwarded).toBe(true);
  });

  it("מסמך: שם הקובץ והכיתוב", () => {
    const message = onlyMessage(
      derived((m) => {
        m.type = "document";
        delete m.text;
        m.document = { caption: "תקלה", filename: "report.pdf", mime_type: "application/pdf", id: "doc-1" };
      }),
    );
    expect(message.text).toBe("תקלה");
    expect(message.media).toMatchObject({ mediaId: "doc-1", mimeType: "application/pdf", filename: "report.pdf", sha256: null });
  });

  it("סטיקר, תגובת אימוג'י ומיקום עוברים עם הסוג — הסולם מכריע עליהם", () => {
    const sticker = onlyMessage(
      derived((m) => {
        m.type = "sticker";
        delete m.text;
        m.sticker = { mime_type: "image/webp", id: "st-1", animated: false };
      }),
    );
    expect(sticker).toMatchObject({ type: "sticker", text: null });

    const reaction = onlyMessage(
      derived((m) => {
        m.type = "reaction";
        delete m.text;
        m.reaction = { message_id: "wamid.X", emoji: "👍" };
      }),
    );
    expect(reaction).toMatchObject({ type: "reaction", text: null, media: null });

    const location = onlyMessage(
      derived((m) => {
        m.type = "location";
        delete m.text;
        m.location = { latitude: 32.08, longitude: 34.78 };
      }),
    );
    expect(location.type).toBe("location");
  });

  it("סוג שאינו מוכר אינו נזרק: עובר כמחרוזת", () => {
    const message = onlyMessage(
      derived((m) => {
        m.type = "something_new";
        delete m.text;
      }),
    );
    expect(message.type).toBe("something_new");
  });

  it("שולח עם שם משתמש: בלי `from`, ומזוהה רק ב-BSUID", () => {
    const body = JSON.parse(raw("text-report"));
    const value = body.entry[0].changes[0].value;
    delete value.messages[0].from;
    delete value.contacts[0].wa_id;
    const message = onlyMessage(JSON.stringify(body));
    expect(message).toMatchObject({ waId: null, bsuid: "IL.1000000000000000002", profileName: "בודק 2" });
  });

  it("כמה הודעות במשלוח אחד — כל אחת פריט, לפי הסדר", () => {
    const body = JSON.parse(raw("text-report"));
    const value = body.entry[0].changes[0].value;
    value.messages.push({ ...value.messages[0], id: "wamid.SECOND", text: { body: "עוד" } });
    const items = parseWebhook(JSON.stringify(body));
    expect(items.map((item) => (item.kind === "message" ? item.message.text : item.kind))).toEqual([
      "תקלה בדירה 12 — נזילה במטבח",
      "עוד",
    ]);
  });

  it("sha256 שאינו 32 בתים אינו גיבוב — נזרק ל-null", () => {
    const message = onlyMessage(
      derived((m) => {
        m.type = "image";
        delete m.text;
        m.image = { mime_type: "image/jpeg", id: "img-1", sha256: "c2hvcnQ=" };
      }),
    );
    expect(message.media?.sha256).toBeNull();
  });
});

describe("parseWebhook — מה שאינו במבנה אינו נבלע", () => {
  it("הודעה בלי מזהה הופכת לפריט `invalid` עם המספר העסקי, והשאר מתפענחות", () => {
    const body = JSON.parse(raw("text-report"));
    const value = body.entry[0].changes[0].value;
    value.messages.unshift({ from: "972500000002", timestamp: "1791132696", type: "text", text: { body: "x" } });
    const items = parseWebhook(JSON.stringify(body));
    expect(items[0]).toMatchObject({ kind: "invalid", field: "messages", phoneNumberId: "300000000000002" });
    expect(items[1]?.kind).toBe("message");
  });

  it("שדה שאינו `messages` (account_update) — רק השם, בלי פענוח", () => {
    const body = { object: "whatsapp_business_account", entry: [{ id: "200000000000002", changes: [{ field: "account_update", value: { event: "PARTNER_REMOVED" } }] }] };
    expect(parseWebhook(JSON.stringify(body))).toEqual([
      { kind: "other", field: "account_update", wabaId: "200000000000002", phoneNumberId: null },
    ]);
  });

  it("`messages` בלי phone_number_id — פריט `invalid`, לא הודעה ממספר לא ידוע", () => {
    const body = JSON.parse(raw("text-report"));
    delete body.entry[0].changes[0].value.metadata;
    expect(parseWebhook(JSON.stringify(body))).toEqual([
      { kind: "invalid", field: "messages", reason: "אין phone_number_id", phoneNumberId: null },
    ]);
  });

  it("גוף שאינו JSON, או JSON שאינו במבנה של Meta — זורק, והגוף נשאר שמור אצל הקורא", () => {
    expect(() => parseWebhook("not json")).toThrow(WebhookParseError);
    expect(() => parseWebhook(JSON.stringify({ hello: "world" }))).toThrow(WebhookParseError);
    expect(() => parseWebhook(JSON.stringify({ object: "x", entry: [{ id: 1 }] }))).toThrow(WebhookParseError);
  });
});
