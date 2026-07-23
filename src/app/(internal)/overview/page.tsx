import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { getOwnerOverview } from "@/lib/services/overview";

export const metadata = { title: `${he.overview.title} — ${he.app.name}` };

/**
 * תצוגת הבעלים (מסך 10).
 *
 * תמונת מצב חוצת-אתרים לבעלים ולמנהל המערכת. מנהל עבודה מקובע לאתר אחד
 * ואין לו למה לצלול — הוא מופנה ללוח שלו. מכל מספר צוללים ללוח מסונן לאתר,
 * שם הקיבוץ לסקשנים ("דורש ממך" / "אצל הנמענים") כבר מפריד בין המצבים.
 */
export default async function OverviewPage() {
  const user = await requireUser();
  // מנהל עבודה רואה ממילא את כל האתר שלו בלוח; אין לו תצוגה חוצת-אתרים.
  if (user.role === "SITE_MANAGER") redirect("/board");

  const sites = await getOwnerOverview();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-bold">{he.overview.title}</h1>
        <p className="text-sm text-muted">{he.overview.subtitle}</p>
      </div>

      {sites.length === 0 ? (
        <p className="py-8 text-center text-muted">{he.overview.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {sites.map((site) => (
            <li
              key={site.siteId}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4"
            >
              <h2 className="font-semibold">{site.siteName}</h2>
              <div className="grid grid-cols-3 gap-2">
                <Metric siteId={site.siteId} label={he.overview.open} value={site.open} />
                <Metric
                  siteId={site.siteId}
                  label={he.overview.awaitingManager}
                  value={site.awaitingManager}
                  tone={site.awaitingManager > 0 ? "warning" : "muted"}
                />
                <Metric
                  siteId={site.siteId}
                  label={he.overview.stale}
                  value={site.stale}
                  tone={site.stale > 0 ? "danger" : "muted"}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** מספר יחיד שצוללים ממנו ללוח המסונן לאתר */
function Metric({
  siteId,
  label,
  value,
  tone = "muted",
}: {
  siteId: string;
  label: string;
  value: number;
  tone?: "muted" | "warning" | "danger";
}) {
  const toneClass =
    tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-fg";

  return (
    <Link
      href={`/board?site=${siteId}`}
      className="flex flex-col items-center gap-1 rounded-xl bg-bg p-3 text-center"
    >
      <span className={`text-2xl font-bold ${toneClass}`}>{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </Link>
  );
}
