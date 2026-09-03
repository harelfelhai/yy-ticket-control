import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import type { SessionUser } from "@/lib/session";
import { changeOwnPassword } from "@/lib/services/account";
import { resetUserPassword } from "@/lib/services/admin";
import { resetDb } from "../helpers/reset-db";

/**
 * החלפת סיסמה ואיפוסה (הכרעת מימוש 1.1).
 *
 * הפער שנסגר: עד 1.1 `passwordHash` נכתב רק בהקמת משתמש, כלומר הסיסמה
 * שהמנהל הקליד הייתה צמיתה. שתי הפונקציות נבדקות יחד מפני שהן שני חצאים
 * של אותו חוזה — החלפה עצמית דורשת את הסיסמה הנוכחית, ומי ששכח אותה תלוי
 * באיפוס בידי מנהל.
 */

let admin: SessionUser;
let employee: SessionUser;

const OLD = "sod-yashan-1";
const NEW = "sod-chadash-2";

beforeEach(async () => {
  await resetDb();

  const adminUser = await db.user.create({
    data: {
      role: "ADMIN",
      name: "מנהל מערכת",
      phone: "0500000000",
      passwordHash: await hashPassword(OLD),
    },
  });
  admin = { id: adminUser.id, name: adminUser.name, role: adminUser.role, siteId: null };

  const employeeUser = await db.user.create({
    data: {
      role: "OWNER",
      name: "בעלים",
      phone: "0500000001",
      passwordHash: await hashPassword(OLD),
    },
  });
  employee = {
    id: employeeUser.id,
    name: employeeUser.name,
    role: employeeUser.role,
    siteId: null,
  };
});

afterAll(async () => {
  await db.$disconnect();
});

async function hashOf(id: string): Promise<string> {
  return (await db.user.findUniqueOrThrow({ where: { id } })).passwordHash;
}

describe("changeOwnPassword — החלפה עצמית", () => {
  it("מחליף, והסיסמה החדשה היא זו שעובדת מכאן והלאה", async () => {
    await changeOwnPassword(employee, OLD, NEW);

    const hash = await hashOf(employee.id);
    expect(await verifyPassword(hash, NEW)).toBe(true);
    expect(await verifyPassword(hash, OLD)).toBe(false);
  });

  it("סיסמה נוכחית שגויה נדחית, והגיבוב אינו משתנה", async () => {
    const before = await hashOf(employee.id);

    await expect(changeOwnPassword(employee, "לא-הסיסמה", NEW)).rejects.toThrow(
      he.account.currentPasswordWrong,
    );
    expect(await hashOf(employee.id)).toBe(before);
  });

  it("סיסמה חדשה קצרה מהמדיניות נדחית — אותה הודעה כמו בהקמה", async () => {
    await expect(changeOwnPassword(employee, OLD, "short")).rejects.toThrow(
      he.admin.passwordTooShort(8),
    );
    expect(await verifyPassword(await hashOf(employee.id), OLD)).toBe(true);
  });

  it("סיסמה חדשה זהה לנוכחית נדחית בהודעה מובנת ולא עוברת בשקט", async () => {
    await expect(changeOwnPassword(employee, OLD, OLD)).rejects.toThrow(he.account.samePassword);
  });

  it("סשן של משתמש שנמחק מאז אינו קורס אלא מקבל הודעה", async () => {
    const ghost: SessionUser = { id: "לא-קיים", name: "רפאים", role: "OWNER", siteId: null };
    await expect(changeOwnPassword(ghost, OLD, NEW)).rejects.toThrow(he.account.userGone);
  });

  it("משתמש אחד אינו יכול לשנות סיסמה של אחר — הפעולה חלה על המחובר בלבד", async () => {
    // אין פרמטר שמזהה מישהו אחר, ולכן ההחלפה נוגעת רק ב-`employee`.
    await changeOwnPassword(employee, OLD, NEW);
    expect(await verifyPassword(await hashOf(admin.id), OLD)).toBe(true);
  });
});

describe("resetUserPassword — איפוס בידי מנהל", () => {
  it("מנהל מאפס למשתמש אחר בלי לדעת את סיסמתו הנוכחית", async () => {
    await resetUserPassword(admin, employee.id, NEW);
    expect(await verifyPassword(await hashOf(employee.id), NEW)).toBe(true);
  });

  it("האיפוס הוא מסלול השחזור: מי ששכח נכנס שוב ואז מחליף בעצמו", async () => {
    // המשתמש החליף לסיסמה פרטית ושכח אותה.
    await changeOwnPassword(employee, OLD, "sod-praty-9");
    // המנהל מאפס, והמשתמש מחליף שוב לשלו.
    await resetUserPassword(admin, employee.id, "zmani-1234");
    await changeOwnPassword(employee, "zmani-1234", NEW);

    expect(await verifyPassword(await hashOf(employee.id), NEW)).toBe(true);
  });

  it("מדיניות האורך חלה גם כאן — אחרת האיפוס היה הדלת האחורית שלה", async () => {
    await expect(resetUserPassword(admin, employee.id, "1234")).rejects.toThrow(
      he.admin.passwordTooShort(8),
    );
  });

  it("מי שאינו מנהל מערכת אינו רשאי לאפס", async () => {
    await expect(resetUserPassword(employee, admin.id, NEW)).rejects.toThrow(he.admin.forbidden);
    expect(await verifyPassword(await hashOf(admin.id), OLD)).toBe(true);
  });

  it("משתמש שאינו קיים מחזיר הודעה מובנת", async () => {
    await expect(resetUserPassword(admin, "לא-קיים", NEW)).rejects.toThrow(he.admin.userNotFound);
  });
});
