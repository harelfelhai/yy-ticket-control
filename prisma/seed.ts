import "dotenv/config";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../src/lib/auth";
import { db } from "../src/lib/db";

/**
 * נתוני התחלה: משתמש מנהל מערכת, אתר לדוגמה, ורשימת התחומים.
 *
 * ה-seed הוא idempotent — הרצה חוזרת אינה משכפלת ואינה דורסת. הוא מיועד
 * לרוץ גם על סביבה חיה בפעם הראשונה, ושם דריסה של סיסמת המנהל הקיים היא
 * בדיוק מה שאסור שיקרה בטעות.
 *
 * הרצה: npx tsx prisma/seed.ts
 */

/**
 * רשימת התחומים ההתחלתית (Gate G2 בתוכנית — הרשימה בפועל טרם התקבלה מהמנהל).
 * הרשימה נלמדת ממילא: הזנת תחום שאינו קיים יוצרת אותו. אלה רק ערכי פתיחה
 * כדי שמנהל עבודה לא יתחיל מול שדה ריק.
 */
const DOMAINS = [
  "חשמל",
  "אינסטלציה",
  "אלומיניום",
  "ריצוף",
  "טיח וצבע",
  "נגרות",
  "דלתות",
  "איטום",
  "מיזוג",
  "גבס",
];

const DEMO_SITE = "אתר לדוגמה";
const ADMIN_PHONE = "0500000000";

async function main() {
  for (const name of DOMAINS) {
    await db.domain.upsert({ where: { name }, update: {}, create: { name } });
  }
  console.log(`תחומים: ${DOMAINS.length}`);

  const site = await db.site.upsert({
    where: { name: DEMO_SITE },
    update: {},
    create: { name: DEMO_SITE },
  });

  for (const buildingName of ["בניין א", "בניין ב"]) {
    const building = await db.building.upsert({
      where: { siteId_name: { siteId: site.id, name: buildingName } },
      update: {},
      create: { siteId: site.id, name: buildingName },
    });

    for (const number of ["1", "2", "3"]) {
      await db.apartment.upsert({
        where: { buildingId_number: { buildingId: building.id, number } },
        update: {},
        create: { buildingId: building.id, number },
      });
    }
  }
  console.log(`אתר "${site.name}": 2 בניינים, 6 דירות`);

  const existing = await db.user.findUnique({ where: { phone: ADMIN_PHONE } });
  if (existing) {
    console.log(`משתמש מנהל כבר קיים (${ADMIN_PHONE}) — הסיסמה לא שונתה.`);
    return;
  }

  // סיסמה קבועה מותרת רק כשמעבירים אותה במפורש (בדיקות E2E). בכל מקרה אחר
  // נוצרת סיסמה אקראית ומודפסת פעם אחת — כדי שלא תיווצר סביבה חיה עם
  // סיסמת ברירת מחדל ידועה.
  const password = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(9).toString("base64url");

  await db.user.create({
    data: {
      role: "ADMIN",
      // שם ולא תיאור תפקיד: הכותרת מציגה "שם · תפקיד", ו-"מנהל מערכת ·
      // מנהל מערכת" נקרא כתקלה. המשתמש האמיתי ישנה את השם בכל מקרה.
      name: "מנהל ראשי",
      phone: ADMIN_PHONE,
      passwordHash: await hashPassword(password),
    },
  });

  console.log("\n─────────────────────────────────────");
  console.log("נוצר משתמש מנהל מערכת:");
  console.log(`  טלפון:  ${ADMIN_PHONE}`);
  console.log(`  סיסמה:  ${password}`);
  console.log("שמור אותה — היא לא תוצג שוב.");
  console.log("─────────────────────────────────────\n");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
