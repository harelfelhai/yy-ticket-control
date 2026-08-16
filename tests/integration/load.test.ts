import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AssignmentStatus } from "@/generated/prisma/enums";
import { getBoard } from "@/lib/services/board";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/session";
import { resetDb } from "../helpers/reset-db";

/**
 * תרחיש העומס של האפיון: בדק בית מזין עשרות פניות ברצף, והלוח חייב להיטען
 * מהר. הבדיקה זורעת 60 פניות ומודדת את `getBoard` — **שאילתת הנתונים של
 * הלוח**, שהיא החלק שגדל עם מספר הפניות. רינדור 60 כרטיסים זניח וקבוע מולה,
 * ולכן זמן השאילתה הוא הקירוב הנכון ל"כמה מהר נטען הלוח".
 */

const NOW = new Date("2026-07-24T09:00:00Z");
const TICKET_COUNT = 60;
const STATUSES: AssignmentStatus[] = ["SENT", "VIEWED", "DONE"];

/** זורע 60 פניות מפוזרות על בניינים, סטטוסים, הסלמות וסגירות — מצב מציאותי */
async function seedLoad(): Promise<SessionUser> {
  const site = await db.site.create({ data: { name: "אתר עומס" } });
  const admin = await db.user.create({
    data: { role: "ADMIN", name: "מנהל", phone: "0500000009", passwordHash: "x" },
  });
  const domain = await db.domain.create({ data: { name: "חשמל" } });
  const buildings = await Promise.all(
    [1, 2, 3].map((n) => db.building.create({ data: { siteId: site.id, name: `בניין ${n}` } })),
  );
  const pros = await Promise.all(
    [1, 2, 3].map((n) =>
      db.professional.create({ data: { name: `קבלן ${n}`, phone: `05000000${n}0` } }),
    ),
  );

  for (let i = 0; i < TICKET_COUNT; i++) {
    const building = buildings[i % buildings.length];
    const apartment = await db.apartment.create({
      data: { buildingId: building.id, number: String(i + 1) },
    });
    const closed = i % 10 === 0;
    const ticket = await db.ticket.create({
      data: {
        siteId: site.id,
        buildingId: building.id,
        apartmentId: apartment.id,
        domainId: domain.id,
        channel: "SELF",
        description: `ליקוי מספר ${i + 1} — נדרש טיפול`,
        createdById: admin.id,
        lastActivityAt: new Date(NOW.getTime() - i * 3_600_000),
        escalated: i % 7 === 0 && !closed,
        closedAt: closed ? NOW : null,
        closedById: closed ? admin.id : null,
      },
    });

    await db.assignment.create({
      data: {
        ticketId: ticket.id,
        professionalId: pros[i % pros.length].id,
        status: STATUSES[i % STATUSES.length],
      },
    });
    // חלק מהפניות עם שני נמענים — כדי שגזירת הסטטוס תעבוד על מצב מעורב
    if (i % 3 === 0) {
      await db.assignment.create({
        data: {
          ticketId: ticket.id,
          professionalId: pros[(i + 1) % pros.length].id,
          status: "DONE",
        },
      });
    }
  }

  return { id: admin.id, name: admin.name, role: admin.role, siteId: admin.siteId };
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("עומס: 60 פניות", () => {
  it("הלוח נשלף הרבה מתחת לתקציב ה-2 שניות", async () => {
    const admin = await seedLoad();

    const start = performance.now();
    const board = await getBoard(admin, {}, NOW);
    const elapsedMs = performance.now() - start;

    const total =
      board.sections.ACTION_REQUIRED.length +
      board.sections.WITH_RECIPIENTS.length +
      board.sections.ARCHIVE.length;
    expect(total).toBe(TICKET_COUNT);

    console.log(`getBoard ל-${TICKET_COUNT} פניות: ${elapsedMs.toFixed(0)}ms`);
    // סף שמרני: הרבה מתחת ל-2 שניות, ורחוק דיו מהזמן הנמדד כדי לא להיות
    // רגיש לעומס מכונה, אך צמוד דיו כדי לתפוס רגרסיה של N+1 שתקפיץ אותו.
    expect(elapsedMs).toBeLessThan(1000);
  });
});
