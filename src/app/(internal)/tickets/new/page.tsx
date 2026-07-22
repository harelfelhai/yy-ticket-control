import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import { listSiteDirectory } from "@/lib/services/directory";
import { CreateTicketForm } from "./create-ticket-form";

export const metadata = { title: `${he.ticket.createTitle} — ${he.app.name}` };

/**
 * מסך יצירת פנייה מהירה (מסך 4 באפיון).
 *
 * הרשימות נטענות בשרת ומגיעות מוכנות ללקוח, כדי שהמסך ייפתח מלא בשטח ולא
 * ידרוש סבב רשת נוסף לפני שאפשר להתחיל להקליד.
 *
 * בחירת האתר: מנהל עבודה משויך לאתר אחד ולכן אין לו מה לבחור. מנהל מערכת
 * ובעלים פועלים בכל האתרים, ולכן הם **בוחרים במפורש**. בחירה שרירותית
 * ("האתר הראשון") הייתה משייכת פניות לאתר הלא נכון בלי שאיש ישים לב.
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

  const site =
    sites.length === 1
      ? sites[0]
      : sites.find((s) => s.id === requestedSiteId);

  if (!site) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <h1 className="text-xl font-bold">{he.ticket.createTitle}</h1>
        <p className="text-muted">{he.ticket.chooseSite}</p>
        <ul className="flex flex-col gap-2">
          {sites.map((option) => (
            <li key={option.id}>
              <Link
                href={`/tickets/new?site=${option.id}`}
                className="flex min-h-12 items-center rounded-xl border border-border bg-surface px-4 text-base font-medium"
              >
                {option.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const [directory, internalUsers] = await Promise.all([
    listSiteDirectory(site.id),
    db.user.findMany({
      where: { active: true, OR: [{ siteId: site.id }, { siteId: null }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
  ]);

  return (
    <CreateTicketForm
      siteId={site.id}
      siteName={site.name}
      buildings={directory.buildings.map((building) => ({
        id: building.id,
        label: building.name,
        apartments: building.apartments.map((a) => ({ id: a.id, label: a.number })),
      }))}
      domains={directory.domains.map((d) => ({ id: d.id, label: d.name }))}
      recipients={[
        ...directory.professionals.map((p) => ({
          id: p.id,
          label: p.name,
          hint: p.phone ?? p.email ?? undefined,
          kind: "professional" as const,
        })),
        // נמענים פנימיים כוללים את המשתמש עצמו — כך נוצר תזכורן אישי.
        ...internalUsers.map((u) => ({
          id: u.id,
          label: u.name,
          hint: he.role[u.role],
          kind: "user" as const,
        })),
      ]}
    />
  );
}
