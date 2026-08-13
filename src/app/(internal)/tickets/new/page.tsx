import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import { listSiteDirectory } from "@/lib/services/directory";
import { listTags } from "@/lib/services/tags";
import { CreateTicketForm } from "./create-ticket-form";

export const metadata = { title: `${he.ticket.createTitle} — ${he.app.name}` };

/**
 * מסך יצירת פנייה מהירה (מסך 4 באפיון).
 *
 * הרשימות נטענות בשרת ומגיעות מוכנות ללקוח, כדי שהמסך ייפתח מלא בשטח ולא
 * ידרוש סבב רשת נוסף לפני שאפשר להתחיל להקליד.
 *
 * **בחירת האתר היא שדה בטופס ולא מסך שקודם לו.** מנהל עבודה משויך לאתר
 * אחד ורואה אותו כשדה נעול; מנהל מערכת ובעלים בוחרים מתוך רשימה. הנוסח
 * הקודם היה מסך ביניים של קישורים, שממנו לא הייתה דרך חזרה — החלפת אתר
 * דרשה לנחש את הכתובת. בחירה עדיין **מפורשת**: אין ברירת מחדל שרירותית
 * למי שיש לו יותר מאתר אחד, כי היא הייתה משייכת פניות לאתר הלא נכון.
 *
 * הבניינים נטענים לכל האתרים בבת אחת (שלושה אתרים, ~50 דירות לאתר), כדי
 * שהחלפת אתר לא תדרוש סבב רשת ולא תזרוק את מה שכבר הוקלד. תחומים ואנשי
 * מקצוע גלובליים ממילא; משתמשים פנימיים מסוננים לפי האתר בצד הלקוח.
 */
export default async function NewTicketPage(props: PageProps<"/tickets/new">) {
  const user = await requireUser();
  const { site: requestedSiteId } = await props.searchParams;

  const sites = user.siteId
    ? await db.site.findMany({ where: { id: user.siteId } })
    : await db.site.findMany({ orderBy: { name: "asc" } });

  if (sites.length === 0) {
    return <p className="p-6 text-muted">{he.ticket.noSite}</p>;
  }

  const [directories, internalUsers, tags] = await Promise.all([
    Promise.all(sites.map((site) => listSiteDirectory(site.id))),
    db.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, siteId: true },
    }),
    listTags(),
  ]);

  // התחומים ואנשי המקצוע זהים בכל האתרים (`listSiteDirectory` אינו מסנן
  // אותם), ולכן נלקחים מהתוצאה הראשונה במקום להישלח שוב לכל אתר.
  const first = directories[0];

  const buildingsBySite = Object.fromEntries(
    sites.map((site, index) => [
      site.id,
      directories[index].buildings.map((building) => ({
        id: building.id,
        label: building.name,
        apartments: building.apartments.map((a) => ({ id: a.id, label: a.number })),
      })),
    ]),
  );

  return (
    <CreateTicketForm
      sites={sites.map((site) => ({ id: site.id, label: site.name }))}
      // אתר יחיד נבחר מאליו; ליותר מאחד הבחירה נשארת מפורשת, ו-`?site=`
      // שומר על קישורים ישנים שהצביעו ישירות על אתר.
      initialSiteId={
        sites.length === 1
          ? sites[0].id
          : (sites.find((s) => s.id === requestedSiteId)?.id ?? null)
      }
      buildingsBySite={buildingsBySite}
      domains={first.domains.map((d) => ({ id: d.id, label: d.name }))}
      professionals={first.professionals.map((p) => ({
        id: p.id,
        label: p.name,
        hint: p.phone ?? p.email ?? undefined,
        kind: "professional" as const,
      }))}
      // נמענים פנימיים כוללים את המשתמש עצמו — כך נוצר תזכורן אישי.
      // ‏`siteId` נשלח כדי שהסינון לפי האתר הנבחר ייעשה בלי סבב רשת:
      // ‏null פירושו מנהל מערכת או בעלים, שזמינים בכל האתרים.
      internalUsers={internalUsers.map((u) => ({
        id: u.id,
        label: u.name,
        hint: he.role[u.role],
        kind: "user" as const,
        siteId: u.siteId,
      }))}
      tags={tags.map((t) => ({ id: t.id, label: t.name }))}
    />
  );
}
