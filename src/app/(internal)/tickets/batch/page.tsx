import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import { listSiteDirectory } from "@/lib/services/directory";
import { BatchForm } from "./batch-form";
import { TITLE_DESCRIPTIVE, ROW_LIST} from "@/lib/ui";

export const metadata = { title: `${he.batch.title} — ${he.app.name}` };

/**
 * מסך ההזנה המרוכזת מדוח בדק בית (מסך 5).
 *
 * בחירת האתר זהה למסך היצירה: מנהל עבודה משויך לאתר אחד; מנהל מערכת ובעלים
 * בוחרים במפורש, כדי שעשרות פניות לא ישויכו לאתר הלא נכון בבת אחת.
 */
export default async function BatchPage(props: PageProps<"/tickets/batch">) {
  const user = await requireUser();
  const { site: requestedSiteId } = await props.searchParams;

  const sites = user.siteId
    ? await db.site.findMany({ where: { id: user.siteId } })
    : await db.site.findMany({ orderBy: { name: "asc" } });

  if (sites.length === 0) {
    return <p className="p-6 text-muted">{he.ticket.noSite}</p>;
  }

  const site = sites.length === 1 ? sites[0] : sites.find((s) => s.id === requestedSiteId);

  if (!site) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <h1 className={TITLE_DESCRIPTIVE}>{he.batch.title}</h1>
        <p className="text-muted">{he.ticket.chooseSite}</p>
        <ul className={ROW_LIST}>
          {sites.map((option) => (
            <li key={option.id}>
              <Link
                href={`/tickets/batch?site=${option.id}`}
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
    <BatchForm
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
