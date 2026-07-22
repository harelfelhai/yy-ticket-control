import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import {
  DirectoryError,
  createProfessional,
  findOrCreateApartment,
  findOrCreateBuilding,
  findOrCreateDomain,
  findOrCreateProfessional,
  listSiteDirectory,
  prepareProfessional,
} from "@/lib/services/directory";
import { resetDb } from "../helpers/reset-db";

let siteId: string;

beforeEach(async () => {
  await resetDb();
  siteId = (await db.site.create({ data: { name: "אתר" } })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("בניינים נלמדים", () => {
  it("יוצר בניין חדש בהזנה ראשונה", async () => {
    const building = await findOrCreateBuilding(siteId, "בניין א");
    expect(building.name).toBe("בניין א");
    expect(await db.building.count()).toBe(1);
  });

  it("מחזיר את הקיים בהזנה חוזרת ולא מייצר כפילות", async () => {
    const first = await findOrCreateBuilding(siteId, "בניין א");
    const second = await findOrCreateBuilding(siteId, "בניין א");
    expect(second.id).toBe(first.id);
    expect(await db.building.count()).toBe(1);
  });

  it("רווחים מיותרים אינם יוצרים בניין נוסף", async () => {
    const first = await findOrCreateBuilding(siteId, "בניין א");
    const second = await findOrCreateBuilding(siteId, "  בניין   א  ");
    expect(second.id).toBe(first.id);
  });

  it("אותו שם בשני אתרים הוא שני בניינים", async () => {
    const other = await db.site.create({ data: { name: "אתר שני" } });
    const a = await findOrCreateBuilding(siteId, "בניין א");
    const b = await findOrCreateBuilding(other.id, "בניין א");
    expect(b.id).not.toBe(a.id);
  });

  it("שם ריק נדחה עם הודעה בעברית", async () => {
    await expect(findOrCreateBuilding(siteId, "   ")).rejects.toThrow(
      he.directory.buildingNameRequired,
    );
  });

  it("שתי יצירות במקביל מחזירות רשומה אחת", async () => {
    // תרחיש אמיתי: הזנה מרוכזת מדוח בדק בית יוצרת עשרות פניות ברצף באותו בניין.
    const results = await Promise.all([
      findOrCreateBuilding(siteId, "בניין ג"),
      findOrCreateBuilding(siteId, "בניין ג"),
      findOrCreateBuilding(siteId, "בניין ג"),
    ]);
    expect(new Set(results.map((b) => b.id)).size).toBe(1);
  });
});

describe("דירות נלמדות", () => {
  it("מנרמל אפס מוביל כך ש-07 ו-7 הן אותה דירה", async () => {
    const building = await findOrCreateBuilding(siteId, "בניין א");
    const first = await findOrCreateApartment(building.id, "07");
    const second = await findOrCreateApartment(building.id, "7");
    expect(second.id).toBe(first.id);
    expect(first.number).toBe("7");
  });

  it("אותו מספר בשני בניינים הוא שתי דירות", async () => {
    const a = await findOrCreateBuilding(siteId, "בניין א");
    const b = await findOrCreateBuilding(siteId, "בניין ב");
    const first = await findOrCreateApartment(a.id, "5");
    const second = await findOrCreateApartment(b.id, "5");
    expect(second.id).not.toBe(first.id);
  });

  it("מספר ריק נדחה", async () => {
    const building = await findOrCreateBuilding(siteId, "בניין א");
    await expect(findOrCreateApartment(building.id, " ")).rejects.toThrow(DirectoryError);
  });
});

describe("תחומים נלמדים", () => {
  it("יוצר פעם אחת ומחזיר את הקיים אחר כך", async () => {
    const first = await findOrCreateDomain("חשמל");
    const second = await findOrCreateDomain("  חשמל ");
    expect(second.id).toBe(first.id);
    expect(await db.domain.count()).toBe(1);
  });
});

describe("prepareProfessional — אכיפת פרטי קשר", () => {
  it("דורש טלפון או מייל, כי בלעדיהם אי אפשר לשגר", () => {
    expect(() => prepareProfessional({ name: "יוסי" })).toThrow(
      he.notices.cannotSendNoContact,
    );
  });

  it("מסתפק בטלפון בלבד", () => {
    expect(prepareProfessional({ name: "יוסי", phone: "050-123-4567" })).toEqual({
      name: "יוסי",
      phone: "0501234567",
      email: null,
    });
  });

  it("מסתפק במייל בלבד", () => {
    expect(prepareProfessional({ name: "יוסי", email: " Yossi@Example.COM " })).toEqual({
      name: "יוסי",
      phone: null,
      email: "yossi@example.com",
    });
  });

  it("דוחה מייל שאינו תקין, גם כשיש טלפון", () => {
    // ‏מייל שגוי שנשמר בשקט מתגלה רק כשההתראה לא מגיעה — ואז מאוחר מדי.
    expect(() => prepareProfessional({ name: "יוסי", phone: "0501234567", email: "yossi@" })).toThrow(
      he.directory.invalidEmail,
    );
  });

  it("דורש שם", () => {
    expect(() => prepareProfessional({ name: "  ", phone: "0501234567" })).toThrow(
      he.directory.professionalNameRequired,
    );
  });

  it("מחרוזת ריקה נשמרת כ-null ולא כערך ריק", () => {
    // ‏"" ב-DB היה מתחזה לפרטי קשר קיימים ומכשיל את בדיקת "יש טלפון או מייל".
    expect(prepareProfessional({ name: "יוסי", phone: "0501234567", email: "" }).email).toBeNull();
  });
});

describe("איש מקצוע — זיהוי כפילות", () => {
  it("מזהה קבלן קיים לפי טלפון גם כשהשם נכתב אחרת", async () => {
    const first = await createProfessional({ name: "יוסי", phone: "0501234567" });
    const second = await findOrCreateProfessional({ name: "יוסי חשמלאי", phone: "050-123-4567" });
    expect(second.id).toBe(first.id);
    expect(await db.professional.count()).toBe(1);
  });

  it("מזהה קבלן קיים לפי מייל", async () => {
    const first = await createProfessional({ name: "יוסי", email: "yossi@example.com" });
    const second = await findOrCreateProfessional({ name: "יוסי", email: "YOSSI@example.com" });
    expect(second.id).toBe(first.id);
  });

  it("אותו שם עם טלפון אחר הוא איש מקצוע נפרד", async () => {
    // שני קבלנים בשם "יוסי" הם מציאות רגילה באתר בנייה.
    await createProfessional({ name: "יוסי", phone: "0501234567" });
    await findOrCreateProfessional({ name: "יוסי", phone: "0509999999" });
    expect(await db.professional.count()).toBe(2);
  });
});

describe("listSiteDirectory", () => {
  it("מחזיר בניינים עם הדירות שלהם, ממוינים", async () => {
    const b = await findOrCreateBuilding(siteId, "בניין ב");
    const a = await findOrCreateBuilding(siteId, "בניין א");
    await findOrCreateApartment(a.id, "2");
    await findOrCreateApartment(a.id, "1");
    await findOrCreateDomain("חשמל");

    const directory = await listSiteDirectory(siteId);

    expect(directory.buildings.map((x) => x.name)).toEqual(["בניין א", "בניין ב"]);
    expect(directory.buildings[0]?.apartments.map((x) => x.number)).toEqual(["1", "2"]);
    expect(directory.domains.map((d) => d.name)).toEqual(["חשמל"]);
    expect(b.siteId).toBe(siteId);
  });

  it("אינו מחזיר בניינים של אתר אחר", async () => {
    const other = await db.site.create({ data: { name: "אתר שני" } });
    await findOrCreateBuilding(other.id, "בניין זר");
    await findOrCreateBuilding(siteId, "בניין שלי");

    const directory = await listSiteDirectory(siteId);
    expect(directory.buildings.map((x) => x.name)).toEqual(["בניין שלי"]);
  });
});
