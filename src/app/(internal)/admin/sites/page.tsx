import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { listSites } from "@/lib/services/admin";
import { AdminAddForm } from "../admin-add-form";
import { createSiteAction } from "../actions";
import { TITLE_DESCRIPTIVE } from "@/lib/ui";
import { cardClasses } from "@/components/ui/card";

export const metadata = { title: `${he.admin.sites} — ${he.app.name}` };

/**
 * ניהול אתרים (מסך 11). בניינים ודירות נלמדים תוך כדי עבודה ולכן אינם
 * מנוהלים כאן — רק האתרים עצמם ומנהלי העבודה המשויכים להם (השיוך נעשה
 * בהקמת המשתמש).
 */
export default async function AdminSitesPage() {
  const actor = await requireUser();
  const sites = await listSites(actor);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <div>
        <Link href="/admin" className="text-sm text-brand">
          ← {he.admin.title}
        </Link>
        <h1 className={TITLE_DESCRIPTIVE}>{he.admin.sites}</h1>
      </div>

      <AdminAddForm label={he.admin.siteName} buttonLabel={he.admin.addSite} action={createSiteAction} />

      <ul className="flex flex-col gap-2">
        {sites.map((site) => (
          <li
            key={site.id}
            className={cardClasses("flex flex-col gap-1")}
          >
            <span className="font-semibold">{site.name}</span>
            <span className="text-sm text-muted">
              {he.admin.siteManagers}:{" "}
              {site.users.length === 0
                ? he.admin.noManagers
                : site.users.map((u) => u.name).join(", ")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
