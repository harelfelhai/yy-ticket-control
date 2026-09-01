import "dotenv/config";
import { db } from "../src/lib/db";

/**
 * זורע 25 פניות סגורות תחת אתר ייעודי — התשתית של `board-load-more.spec.ts`.
 *
 * רץ כסקריפט נפרד (tsx) עם `DATABASE_URL` של סביבת ה-E2E, באותה תבנית שבה
 * ‏`global-setup.ts` מריץ את ה-seed הראשי: ייבוא `db` בתוך spec של Playwright
 * היה נקשר לבסיס הפיתוח של הסביבה במקום לבסיס הבדיקות.
 *
 * **בניין ייעודי בתוך האתר הקיים — ולא אתר חדש.** בדיקות אחרות באותה ריצה
 * סוגרות פניות משלהן, ומספר הארכיון הגלובלי אינו יציב; סינון לפי הבניין
 * הזה נותן ל-spec רשימה שגודלה ידוע — 25 — ויחד איתה גם את עצם תרחיש
 * הסינון.
 *
 * > **הגרסה הראשונה יצרה כאן אתר חדש, וזה הפיל את כל החבילה.**
 * > ‏`tickets/new/page.tsx:73` בוחר אתר אוטומטית **רק כשיש בדיוק אחד**, וכל
 * > עשרת קובצי ה-spec שיוצרים פנייה נשענים על כך בשתיקה — אף אחד מהם אינו
 * > בוחר אתר במפורש. אתר שני פירושו שלא נבחר אתר, שבורר הבניין נשאר מושבת,
 * > ושכל בדיקה שיוצרת פנייה נופלת בפסק זמן. ומכיוון ש-`board-load-more`
 * > מקדים אלפביתית את `board.spec`, ה-`beforeAll` הזה הרעיל את כל מה שרץ
 * > אחריו. **פיקסטורה של בדיקה אחת אינה משנה מצב גלובלי שאחרות תלויות בו.**
 *
 * אידמפוטנטי: ריצה חוזרת (הבדיקות רצות פעם למובייל ופעם לדסקטופ) מזהה את
 * הבניין הקיים ואינה מוסיפה דבר.
 */

const BUILDING_NAME = "בניין עומס";
const CLOSED_COUNT = 25;

async function main(): Promise<void> {
  const existing = await db.building.findFirst({ where: { name: BUILDING_NAME } });
  if (existing) {
    console.log(`"${BUILDING_NAME}" כבר קיים — הזריעה כבר רצה בריצה הזו.`);
    return;
  }

  const admin = await db.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) throw new Error("אין מנהל בבסיס ה-E2E — global-setup אמור היה לזרוע אותו");

  // האתר של ה-seed הראשי, ולא אתר חדש. ראה האזהרה למעלה.
  const site = await db.site.findFirst({ orderBy: { createdAt: "asc" } });
  if (!site) throw new Error("אין אתר בבסיס ה-E2E — global-setup אמור היה לזרוע אותו");

  const now = new Date();
  const building = await db.building.create({ data: { siteId: site.id, name: BUILDING_NAME } });
  const domain =
    (await db.domain.findFirst()) ?? (await db.domain.create({ data: { name: "תחום עומס" } }));
  const pro = await db.professional.create({
    data: { name: "קבלן ארכיון", phone: "050-9990001" },
  });

  for (let i = 0; i < CLOSED_COUNT; i++) {
    const apartment = await db.apartment.create({
      data: { buildingId: building.id, number: String(i + 1) },
    });
    const ticket = await db.ticket.create({
      data: {
        siteId: site.id,
        buildingId: building.id,
        apartmentId: apartment.id,
        domainId: domain.id,
        channel: "SELF",
        description: `פנייה ארכיונית ${i + 1}`,
        createdById: admin.id,
        // מדורג — כדי שלמיון ברירת המחדל (תנועה אחרונה) יהיה סדר יציב וידוע.
        lastActivityAt: new Date(now.getTime() - i * 3_600_000),
        closedAt: new Date(now.getTime() - i * 3_600_000),
        closedById: admin.id,
      },
    });
    await db.assignment.create({
      data: { ticketId: ticket.id, professionalId: pro.id, status: "DONE" },
    });
  }

  console.log(`נזרעו ${CLOSED_COUNT} פניות סגורות תחת "${BUILDING_NAME}".`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
