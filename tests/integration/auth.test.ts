import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { authenticate, hashPassword, identifierCandidates, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { resetDb } from "../helpers/reset-db";

const PASSWORD = "s0d-heshbon-nakhon";

async function createUser(overrides: Partial<Parameters<typeof db.user.create>[0]["data"]> = {}) {
  return db.user.create({
    data: {
      role: "ADMIN",
      name: "מנהל",
      phone: "0501112222",
      email: "manager@example.com",
      passwordHash: await hashPassword(PASSWORD),
      ...overrides,
    },
  });
}

describe("גיבוב סיסמאות", () => {
  it("מייצר גיבוב argon2id ולא שומר את הסיסמה עצמה", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).not.toContain(PASSWORD);
  });

  it("שני גיבובים של אותה סיסמה שונים זה מזה", async () => {
    // ‏salt אקראי לכל גיבוב: בלעדיו טבלת קשת אחת הייתה שוברת את כל החשבונות.
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it("מאמת סיסמה נכונה ודוחה שגויה", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, "לא נכון")).toBe(false);
  });

  it("גיבוב פגום נכשל בשקט ולא מפיל את הבקשה", async () => {
    expect(await verifyPassword("זבל שאינו גיבוב", PASSWORD)).toBe(false);
  });
});

describe("identifierCandidates", () => {
  it("מייל מנורמל לאותיות קטנות", () => {
    expect(identifierCandidates("  Manager@Example.COM ").email).toBe("manager@example.com");
  });

  it("טלפון מנורמל לצורה מקומית אחת", () => {
    expect(identifierCandidates("050-111-2222").phone).toBe("0501112222");
  });
});

describe("authenticate", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("מזהה לפי טלפון", async () => {
    const user = await createUser();
    const result = await authenticate("0501112222", PASSWORD);
    expect(result?.id).toBe(user.id);
    expect(result?.role).toBe("ADMIN");
  });

  it("מזהה לפי מייל", async () => {
    const user = await createUser();
    expect((await authenticate("manager@example.com", PASSWORD))?.id).toBe(user.id);
  });

  it("מזהה מייל גם באותיות גדולות ועם רווחים", async () => {
    await createUser();
    expect(await authenticate("  Manager@Example.com  ", PASSWORD)).not.toBeNull();
  });

  it("מזהה טלפון שהוקלד עם מקפים, אף שהוא נשמר בלעדיהם", async () => {
    // המשתמש לא זוכר באיזו צורה הוקלד המספר שלו במערכת. שתי הצורות חייבות לעבוד.
    await createUser();
    expect(await authenticate("050-111-2222", PASSWORD)).not.toBeNull();
    expect(await authenticate("+972 50 111 2222", PASSWORD)).not.toBeNull();
  });

  it("דוחה סיסמה שגויה", async () => {
    await createUser();
    expect(await authenticate("0501112222", "סיסמה אחרת")).toBeNull();
  });

  it("דוחה משתמש שאינו קיים", async () => {
    expect(await authenticate("0509999999", PASSWORD)).toBeNull();
  });

  it("דוחה משתמש מושבת גם עם הסיסמה הנכונה", async () => {
    // עובד שעזב — ההשבתה חייבת לחסום כניסה מיידית, לא רק להסתיר מסכים.
    await createUser({ active: false });
    expect(await authenticate("0501112222", PASSWORD)).toBeNull();
  });

  it("מחזיר את שיוך האתר, שעליו נשענות ההרשאות של מנהל עבודה", async () => {
    const site = await db.site.create({ data: { name: "אתר" } });
    await createUser({ role: "SITE_MANAGER", siteId: site.id });

    const result = await authenticate("0501112222", PASSWORD);
    expect(result?.siteId).toBe(site.id);
    expect(result?.role).toBe("SITE_MANAGER");
  });

  it("אינו מחזיר לעולם את גיבוב הסיסמה", async () => {
    await createUser();
    const result = await authenticate("0501112222", PASSWORD);
    expect(Object.keys(result ?? {})).toEqual(["id", "name", "role", "siteId"]);
  });
});
