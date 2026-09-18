import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MAX_FILE_BYTES, assertWritableObject } from "@/lib/storage/limits";
import { localStorage, resolveKey } from "@/lib/storage/local";
import { r2Storage } from "@/lib/storage/r2";

/**
 * EM-06 — כתיבת בתים מהשרת.
 *
 * עד כאן כל קובץ במערכת הגיע מדפדפן שהעלה אותו בעצמו לכתובת חתומה, והשרת
 * לא נגע בבתים. קליטת מייל שוברת את ההנחה: הקובץ המצורף מגיע מ-Gmail אל
 * תהליך השרת, ומשם הוא צריך להגיע לאחסון. `MediaStorage.write` הוא המסלול
 * החדש הזה — ומה שנבדק כאן הוא בעיקר מה שהוא **מסרב** לעשות.
 *
 * הסיבה: מסלול ההעלאה מהדפדפן מוגן בשתי נקודות שאינן קיימות כאן — הרישום
 * (`registerMedia`) בודק סוג וגודל לפני שהוא מחזיר מפתח, ו-`confirmUpload`
 * מודד אחר כך את מה שבאמת נחת. כתיבה מהשרת עוקפת את שתיהן. בלי שומר סף
 * משלה, היא דלת אחורית לאחסון.
 *
 * אין רשת בבדיקה: הדרייבר המקומי כותב לתיקייה זמנית אמיתית, ו-R2 נבדק מול
 * כפיל של `S3Client` שרק רושם את הפקודה שנשלחה אליו.
 */

const { sent } = vi.hoisted(() => ({ sent: [] as unknown[] }));

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...actual,
    // רק הלקוח מוחלף. מחלקות הפקודה נשארות האמיתיות, אחרת הבדיקה הייתה
    // מאמתת שקראנו לכפיל שלנו ולא שבנינו PutObjectCommand תקין.
    S3Client: class FakeS3Client {
      constructor(readonly config: unknown) {}
      async send(command: unknown) {
        sent.push(command);
        return {};
      }
    },
  };
});

/**
 * תיקייה זמנית **בתוך** שורש המדיה.
 *
 * הדרייבר המקומי מחשב את השורש מ-`process.cwd()` ואינו מקבל אותו כפרמטר,
 * ולכן תיקייה ב-`os.tmpdir()` הייתה מחוץ להישג ידו. `resolveKey` הוא מה
 * שמגלה את השורש בלי לייצא אותו, ו-`mkdtemp` נותן שם ייחודי כדי ששתי
 * ריצות מקבילות לא ידרסו זו את זו.
 */
let prefix = "";

beforeAll(async () => {
  const root = path.dirname(resolveKey("probe"));
  await mkdir(root, { recursive: true });
  prefix = path.basename(await mkdtemp(path.join(root, "test-write-")));
});

afterAll(async () => {
  if (prefix) await rm(resolveKey(prefix), { recursive: true, force: true });
});

afterEach(() => {
  sent.length = 0;
});

/** מפתח ייחודי בתוך התיקייה הזמנית */
function key(name: string): string {
  return `${prefix}/${name}`;
}

const storage = localStorage("http://localhost:3100");

describe("EM-06 — הדרייבר המקומי", () => {
  it("כותב, מוצא, קורא ומוחק", async () => {
    const target = key("roundtrip.jpg");
    const bytes = Buffer.from("bytes-of-an-image");

    expect(await storage.head(target)).toBeNull();

    await storage.write(target, bytes, "image/jpeg");

    expect(await storage.head(target)).toEqual({ sizeBytes: bytes.byteLength });
    expect(await storage.read(target)).toEqual(bytes);

    await storage.remove(target);
    expect(await storage.head(target)).toBeNull();
  });

  it("יוצר תיקיות למפתח מקונן", async () => {
    // המפתחות של `buildStorageKey` הם `media/<שנה>/<חודש>/<uuid>` — התיקיות
    // אינן קיימות מראש, ובלי `recursive` הכתיבה הראשונה בכל חודש נופלת.
    const target = key("media/2026/09/nested.png");
    await storage.write(target, Buffer.from("png"), "image/png");

    expect(await storage.head(target)).toEqual({ sizeBytes: 3 });
  });

  it("שומר את הבתים בדיוק כפי שהתקבלו", async () => {
    // בתים בינאריים, לא טקסט: המרה שקטה ל-utf8 באמצע הייתה משחיתה כל
    // תמונה ו-PDF, והבדיקה על מחרוזת ASCII לא הייתה תופסת את זה.
    const target = key("binary.pdf");
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x80]);
    await storage.write(target, bytes, "application/pdf");

    expect(await storage.read(target)).toEqual(bytes);
  });

  it("דוחה סוג שאינו ברשימת ההיתר, ואינו כותב דבר", async () => {
    const target = key("archive.zip");
    await expect(storage.write(target, Buffer.from("PK"), "application/zip")).rejects.toThrow(
      /אינו מותר לאחסון/,
    );

    expect(await storage.head(target)).toBeNull();
  });

  it("דוחה בתים מעל התקרה, ואינו כותב דבר", async () => {
    const target = key("huge.mp4");
    const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
    await expect(storage.write(target, bytes, "video/mp4")).rejects.toThrow(/גדול מהמותר/);

    expect(await storage.head(target)).toBeNull();
  });

  it("דוחה בתים ריקים", async () => {
    // קובץ מצורף ריק היה יוצר רשומת מדיה שמצביעה על כלום — בדיוק המצב
    // ש-`head` נועד לגלות. עדיף שהקורא ידע, במקום לאחסן אפס בתים.
    const target = key("empty.png");
    await expect(storage.write(target, Buffer.alloc(0), "image/png")).rejects.toThrow(/ריק/);

    expect(await storage.head(target)).toBeNull();
  });

  it("אינו מאפשר יציאה מתיקיית המדיה", async () => {
    // המפתח כאן נבנה אצלנו ולא מגיע מהרשת, אבל בקליטת מייל הוא ייגזר
    // מנתונים של המייל — ושומר הנתיב הקיים חייב לחול גם על המסלול החדש.
    await expect(
      storage.write("../../.env", Buffer.from("secret"), "image/png"),
    ).rejects.toThrow(/אינו חוקי/);
  });
});

describe("EM-06 — שומר הסף", () => {
  // הגבול עצמו, בלי לשפוך 50MB לדיסק בכל ריצה: התנאי הוא `>` ולא `>=`,
  // כלומר קובץ ששוקל בדיוק את התקרה חוקי. הדרייברים קוראים לאותה פונקציה,
  // ולכן די לבדוק אותה פעם אחת.
  it("מקבל בדיוק את התקרה ודוחה בית אחד מעליה", () => {
    expect(() =>
      assertWritableObject("media/a.mp4", Buffer.alloc(MAX_FILE_BYTES), "video/mp4"),
    ).not.toThrow();
    expect(() =>
      assertWritableObject("media/a.mp4", Buffer.alloc(MAX_FILE_BYTES + 1), "video/mp4"),
    ).toThrow(/גדול מהמותר/);
  });

  it("מתעלם מפרמטרים אחרי סוג התוכן", () => {
    // הקלטת קול מגיעה כ-`audio/webm;codecs=opus`, ורשימת ההיתר מכירה את
    // הבסיס בלבד. אותה התנהגות כמו במסלול ההעלאה מהדפדפן.
    expect(() =>
      assertWritableObject("media/a.webm", Buffer.from("opus"), "audio/webm;codecs=opus"),
    ).not.toThrow();
  });

  it("נושא את המפתח בהודעת השגיאה", () => {
    // שגיאת מפתח שמגיעה ל-Sentry מתוך עובד התור: בלי המפתח אי אפשר לדעת
    // על איזה קובץ מצורף מדובר.
    expect(() =>
      assertWritableObject("media/2026/09/abc.zip", Buffer.from("PK"), "application/zip"),
    ).toThrow(/media\/2026\/09\/abc\.zip/);
  });
});

describe("EM-06 — דרייבר R2", () => {
  const r2 = r2Storage({
    accountId: "account",
    accessKeyId: "key",
    secretAccessKey: "secret",
    bucket: "yy-media",
  });

  it("שולח PutObjectCommand עם דלי, מפתח, בתים וסוג תוכן", async () => {
    const bytes = Buffer.from("%PDF-1.7");
    await r2.write("media/2026/09/report.pdf", bytes, "application/pdf");

    expect(sent).toHaveLength(1);
    const command = sent[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toEqual({
      Bucket: "yy-media",
      Key: "media/2026/09/report.pdf",
      Body: bytes,
      ContentType: "application/pdf",
    });
  });

  it("שומר על ContentType שהגיע עם פרמטרים", async () => {
    // רשימת ההיתר מתעלמת מהפרמטר, אבל האובייקט נשמר עם הערך המלא — זה מה
    // שהדפדפן היה שולח באותו קובץ, ושני המסלולים חייבים להיראות זהים.
    await r2.write("media/2026/09/voice.webm", Buffer.from("opus"), "audio/webm;codecs=opus");

    expect((sent[0] as PutObjectCommand).input.ContentType).toBe("audio/webm;codecs=opus");
  });

  it("דוחה לפני שנשלחת בקשה כלשהי", async () => {
    await expect(
      r2.write("media/2026/09/x.zip", Buffer.from("PK"), "application/zip"),
    ).rejects.toThrow(/אינו מותר לאחסון/);
    await expect(
      r2.write("media/2026/09/x.mp4", Buffer.alloc(MAX_FILE_BYTES + 1), "video/mp4"),
    ).rejects.toThrow(/גדול מהמותר/);

    // לא שגיאה מהשרת אלא סירוב מקומי: אובייקט חלקי ב-R2 הוא מה שהשומר
    // נועד למנוע, והוא היחיד שיודע לעצור לפני שהבקשה יוצאת.
    expect(sent).toHaveLength(0);
  });
});
