/**
 * בדיקת עשן ידנית לחיבור ה-DB: כותב, קורא דרך יחס, ומנקה אחריו.
 * לא מחליפה את הבדיקות האוטומטיות — נועדה לאמת שהצינור עצמו
 * (adapter → Postgres → סכימה) עובד מקצה לקצה.
 *
 * הרצה: npx tsx scripts/db-smoke.ts
 */
import "dotenv/config";
import { db } from "../src/lib/db";

const SITE_NAME = "__smoke__";

async function main() {
  await db.site.deleteMany({ where: { name: SITE_NAME } });

  const site = await db.site.create({
    data: {
      name: SITE_NAME,
      buildings: {
        create: { name: "בניין א", apartments: { create: [{ number: "1" }, { number: "2" }] } },
      },
    },
    include: { buildings: { include: { apartments: true } } },
  });

  console.log("נוצר אתר:", site.name);
  console.log("בניין:", site.buildings[0]?.name);
  console.log("דירות:", site.buildings[0]?.apartments.map((a) => a.number).join(", "));

  const roundTrip = await db.apartment.findFirst({
    where: { building: { site: { name: SITE_NAME } }, number: "2" },
    include: { building: { include: { site: true } } },
  });
  console.log("קריאה חוזרת דרך שני יחסים:", roundTrip?.building.site.name, roundTrip?.number);

  // ‏Restrict אמור למנוע מחיקת אתר שיש לו בניינים — מאמת שהתנהגות
  // המחיקה שהוגדרה בסכימה באמת נאכפת ב-DB ולא רק בקוד.
  let blocked = false;
  try {
    await db.site.delete({ where: { id: site.id } });
  } catch {
    blocked = true;
  }
  console.log("מחיקת אתר עם בניינים נחסמה:", blocked);

  await db.apartment.deleteMany({ where: { building: { siteId: site.id } } });
  await db.building.deleteMany({ where: { siteId: site.id } });
  await db.site.delete({ where: { id: site.id } });
  console.log("ניקוי הושלם.");

  if (!blocked) {
    throw new Error("אילוץ Restrict לא נאכף — בדוק את הסכימה");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
