import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { CONTENT_WIDTH, TITLE_DESCRIPTIVE } from "@/lib/ui";
import { getOwnerOverview } from "@/lib/services/overview";
import { cardClasses } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

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
    <div className={`flex flex-col gap-4 p-4 ${CONTENT_WIDTH}`}>
      <div>
        <h1 className={TITLE_DESCRIPTIVE}>{he.overview.title}</h1>
        <p className="text-sm text-muted">{he.overview.subtitle}</p>
      </div>

      {sites.length === 0 ? (
        <EmptyState>{he.overview.empty}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {sites.map((site) => (
            <li
              key={site.siteId}
              className={cardClasses("flex flex-col gap-3")}
            >
              <h2 className={TITLE_DESCRIPTIVE}>{site.siteName}</h2>
              <div className="grid grid-cols-3 gap-2">
                <Metric siteId={site.siteId} label={he.overview.open} value={site.open} />
                <Metric
                  siteId={site.siteId}
                  label={he.overview.awaitingManager}
                  value={site.awaitingManager}
                  tone={site.awaitingManager > 0 ? "warning" : "muted"}
                  focus="awaiting"
                />
                <Metric
                  siteId={site.siteId}
                  label={he.overview.stale}
                  value={site.stale}
                  tone={site.stale > 0 ? "danger" : "muted"}
                  focus="stale"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** מספר יחיד שצוללים ממנו ללוח המסונן לאתר, ולמדד הספציפי (focus) */
function Metric({
  siteId,
  label,
  value,
  tone = "muted",
  focus,
}: {
  siteId: string;
  label: string;
  value: number;
  tone?: "muted" | "warning" | "danger";
  /** מדד ספציפי: הלוח יציג רק אותו. חסר = כל הפניות הפתוחות של האתר. */
  focus?: "awaiting" | "stale";
}) {
  const toneClass =
    tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-fg";
  const href = `/board?site=${siteId}${focus ? `&focus=${focus}` : ""}`;

  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-1 rounded-xl bg-bg p-3 text-center"
    >
      <span className={`text-2xl font-bold ${toneClass}`}>{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </Link>
  );
}
