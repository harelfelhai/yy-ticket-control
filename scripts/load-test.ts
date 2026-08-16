import "dotenv/config";
import type { AssignmentStatus } from "../src/generated/prisma/enums";
import { db } from "../src/lib/db";

/**
 * זורע פניות לתוך DATABASE_URL כדי לבדוק את זמן טעינת הלוח בסביבה אמיתית
 * (תרחיש בדק בית — עשרות פניות ברצף).
 *
 * שימוש: npx tsx scripts/load-test.ts [מספר-פניות]   (ברירת מחדל 60)
 *
 * הכול נוצר תחת אתר מתוארך, כדי שהרצה חוזרת לא תתנגש באילוצי ייחודיות ולא
 * תזהם נתונים קיימים. אין למחוק — זו סביבת בדיקה שנועדה להצטבר.
 */

const STATUSES: AssignmentStatus[] = ["SENT", "VIEWED", "DONE"];

async function seedLoad(count: number, stamp: number): Promise<void> {
  const now = new Date();
  const site = await db.site.create({ data: { name: `אתר עומס ${stamp}` } });
  const admin = await db.user.create({
    data: {
      role: "ADMIN",
      name: `מנהל עומס ${stamp}`,
      phone: `04${String(stamp).slice(-8)}`,
      passwordHash: "x",
    },
  });
  const domain = await db.domain.create({ data: { name: `תחום עומס ${stamp}` } });
  const buildings = await Promise.all(
    [1, 2, 3].map((n) => db.building.create({ data: { siteId: site.id, name: `בניין ${n}` } })),
  );
  const pros = await Promise.all(
    [1, 2, 3].map((n) =>
      db.professional.create({ data: { name: `קבלן ${stamp}-${n}`, phone: `05${stamp}${n}` } }),
    ),
  );

  for (let i = 0; i < count; i++) {
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
        lastActivityAt: new Date(now.getTime() - i * 3_600_000),
        escalated: i % 7 === 0 && !closed,
        closedAt: closed ? now : null,
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
    if (i % 3 === 0) {
      await db.assignment.create({
        data: { ticketId: ticket.id, professionalId: pros[(i + 1) % pros.length].id, status: "DONE" },
      });
    }
  }
}

async function main(): Promise<void> {
  const count = Number(process.argv[2] ?? 60);
  if (!Number.isInteger(count) || count < 1) {
    console.error("שימוש: npx tsx scripts/load-test.ts [מספר-פניות]");
    process.exit(1);
  }

  const target = new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, "");
  console.log(`זורע ${count} פניות אל בסיס "${target}"…`);

  const start = Date.now();
  await seedLoad(count, Date.now());
  console.log(`הושלם ב-${Date.now() - start}ms. טען את /board ומדוד את זמן הטעינה.`);

  await db.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
