import "dotenv/config";
import { hashPassword } from "../src/lib/auth";
import { db } from "../src/lib/db";
import {
  APARTMENTS,
  BUILDINGS_B,
  CAST,
  PROS,
  SITE_A,
  SITE_B,
  type CastMember,
} from "./fixtures/cast";

/**
 * מרחיב את ה-seed לצוות המלא שחבילת ההתאמה זקוקה לו.
 *
 * רץ כתהליך נפרד (`tsx conformance/provision-cast.ts`) ולא כפונקציה בתוך
 * ה-globalSetup, מאותה סיבה שבגללה `prisma/seed.ts` רץ כך: `src/lib/db.ts`
 * קורא את `DATABASE_URL` **בזמן הייבוא**. השמה מאוחרת יותר במשתנה הסביבה
 * לא הייתה משנה את החיבור, והבדיקות היו נכתבות לבסיס הפיתוח.
 *
 * ‏idempotent — upsert בלבד, כדי שהרצה חוזרת לא תשכפל ולא תדרוס.
 */

async function upsertUser(member: CastMember, siteId: string | null): Promise<void> {
  const passwordHash = await hashPassword(member.password);
  await db.user.upsert({
    where: { phone: member.phone },
    update: { role: member.role, name: member.name, siteId, active: true },
    create: {
      role: member.role,
      name: member.name,
      phone: member.phone,
      email: member.email ?? null,
      passwordHash,
      siteId,
    },
  });
}

async function main() {
  const siteA = await db.site.upsert({
    where: { name: SITE_A },
    update: {},
    create: { name: SITE_A },
  });

  // אתר שני עם בניין ודירות משלו — בלעדיו אין מה לאמת ב"אך ורק האתר שלו".
  const siteB = await db.site.upsert({
    where: { name: SITE_B },
    update: {},
    create: { name: SITE_B },
  });

  for (const name of BUILDINGS_B) {
    const building = await db.building.upsert({
      where: { siteId_name: { siteId: siteB.id, name } },
      update: {},
      create: { siteId: siteB.id, name },
    });
    for (const number of APARTMENTS) {
      await db.apartment.upsert({
        where: { buildingId_number: { buildingId: building.id, number } },
        update: {},
        create: { buildingId: building.id, number },
      });
    }
  }

  const sites: Record<string, string> = { [SITE_A]: siteA.id, [SITE_B]: siteB.id };

  for (const member of Object.values(CAST) as CastMember[]) {
    if (member.key === "admin") continue; // נוצר ב-seed, והסיסמה שלו כבר ידועה
    const siteId = member.site ? (sites[member.site] ?? null) : null;
    await upsertUser(member, siteId);
  }

  for (const pro of Object.values(PROS)) {
    const existing = await db.professional.findFirst({ where: { phone: pro.phone } });
    if (existing) {
      await db.professional.update({
        where: { id: existing.id },
        data: { name: pro.name, email: "email" in pro ? pro.email : null },
      });
      continue;
    }
    await db.professional.create({
      data: {
        name: pro.name,
        phone: pro.phone,
        email: "email" in pro ? pro.email : null,
      },
    });
  }

  const users = await db.user.count();
  const pros = await db.professional.count();
  console.log(`צוות ההתאמה מוכן: ${users} משתמשים, 2 אתרים, ${pros} אנשי מקצוע`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
