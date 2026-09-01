import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { canCloseTicket, canViewTicket, toViewerFromUser } from "./helpers";
import { resetDb } from "../../helpers/reset-db";

/**
 * חוקים שאין דרך לראות בדפדפן בתוך ריצה, או שנאכפים בשכבת השירות ולא ב-UI.
 *
 * שני סוגים:
 * 1. **אכיפת שרת** — ה-UI מסתיר כפתור, אך השאלה האמיתית היא מה קורה כשמישהו
 *    קורא לפעולה ישירות. בדיקת דפדפן אינה יכולה לזייף קריאת Server Action.
 * 2. **מצבים תלויי זמן** — §3.5 כלל שאין דרך להגיע אליו דרך המסך.
 */

async function makeUser(role: "ADMIN" | "OWNER" | "SITE_MANAGER", siteId: string | null) {
  return db.user.create({
    data: {
      role,
      name: `${role}-${Math.random().toString(36).slice(2, 8)}`,
      phone: `05${Math.floor(Math.random() * 100_000_000)}`.slice(0, 10),
      passwordHash: await hashPassword("conformance-1234"),
      siteId,
    },
  });
}

describe("§5.ז — אכיפת ההרשאות בשכבת השירות, לא רק ב-UI", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("BR-05/A2-07 — בעלים אינו סוגר פנייה שלא פתח, גם בקריאה ישירה", async () => {
    const site = await db.site.create({ data: { name: "אתר" } });
    const manager = await makeUser("SITE_MANAGER", site.id);
    const owner = await makeUser("OWNER", null);
    const ticket = await db.ticket.create({
      data: { siteId: site.id, createdById: manager.id, channel: "SELF", description: "תקלה" },
    });

    expect(canCloseTicket(toViewerFromUser(owner), ticket)).toBe(false);
    expect(canCloseTicket(toViewerFromUser(manager), ticket)).toBe(true);
  });

  it("A3-01 — מנהל עבודה רואה פנייה של אתר אחר ששויכה אליו", async () => {
    /**
     * §5.ז על נמען לטיפול: "אך ורק פניות ששויכו אליו, **מכל האתרים**".
     *
     * **הבדיקה הזו תיעדה את הפער עד 1.9.2026 והפכה כיוון (GAP-A2).** קודם
     * היא הצהירה `false`: `canViewTicket` עבור SITE_MANAGER בדק אך ורק
     * שייכות לאתר ולא הביט בשיוכים, ולכן מנהל ששויך כנמען פנימי לפנייה
     * באתר אחר קיבל עליה מייל ונחת על 404.
     *
     * §5.ז מונה את מנהל העבודה ואת הנמען לטיפול כשני סעיפים נפרדים, ואותו
     * אדם יכול לחבוש את שני הכובעים. ההרחבה אינה פורצת את המידור: היא
     * נפתחת אך ורק על פנייה ששויך אליה במפורש, ונסגרת עם הסרת השיוך.
     */
    const siteA = await db.site.create({ data: { name: "אתר א" } });
    const siteB = await db.site.create({ data: { name: "אתר ב" } });
    const managerA = await makeUser("SITE_MANAGER", siteA.id);
    const managerB = await makeUser("SITE_MANAGER", siteB.id);
    const ticket = await db.ticket.create({
      data: { siteId: siteB.id, createdById: managerB.id, channel: "SELF", description: "תקלה" },
    });
    const assignment = await db.assignment.create({
      data: { ticketId: ticket.id, userId: managerA.id },
    });

    const assignments = [
      { professionalId: assignment.professionalId, userId: assignment.userId, status: assignment.status },
    ];
    expect(canViewTicket(toViewerFromUser(managerA), ticket, assignments)).toBe(true);

    // המידור עצמו לא זז: בלי שיוך, אותה פנייה נשארת סגורה בפניו.
    expect(canViewTicket(toViewerFromUser(managerA), ticket, [])).toBe(false);
  });
});
