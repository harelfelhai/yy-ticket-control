import Link from "next/link";
import { cardClasses } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { canManageAdmin } from "@/lib/permissions";
import { getOwnerOverview } from "@/lib/services/overview";
import { toViewer } from "@/lib/session";
import {
  CARD_LIST,
  FULL_WIDTH,
  METRIC_VALUE,
  PAGE_X,
  TITLE_DESCRIPTIVE,
} from "@/lib/ui";

export const metadata = { title: `${he.overview.title} — ${he.app.name}` };

/**
 * מסך אחד לשתי שכבות: **סקירת האתרים** בראשו, ו**כפתורי הניהול** מתחתיה.
 *
 * לפני האיחוד היו כאן שני מסכים ושני טאבים — "סקירה" ו"ניהול" — ולשניהם
 * אותה תשובה לשאלה "מה מצב המערכת". האיחוד מוריד טאב מהסרגל, ומעמיד את
 * המספרים לפני הכפתורים: מנהל שנכנס לנהל רואה קודם למה הוא נכנס.
 *
 * **שתי השכבות אינן חולקות קהל, וזה כל העניין.** הבעלים רואה את הסקירה
 * ואינו רואה את הכפתורים; מנהל העבודה אינו מגיע לכאן כלל (השער ב-`layout`).
 * חלוקת ההרשאות מפורשת כאן ואינה נשענת על השער בלבד — `getOwnerOverview`
 * עצמו חסר בדיקת הרשאה, ולכן מי שקורא לו חייב לדעת למי הוא מציג.
 */
export default async function AdminHubPage() {
  const user = await requireUser();
  const sites = await getOwnerOverview();
  const canManage = canManageAdmin(toViewer(user));

  const cards: { href: string; label: string }[] = [
    { href: "/admin/sites", label: he.admin.sites },
    { href: "/admin/users", label: he.admin.users },
    { href: "/admin/professionals", label: he.admin.professionals },
    { href: "/admin/domains", label: he.admin.domains },
    // התגיות מנוהלות במסך הקיים (`/tags`) ולכן זהו קישור החוצה ולא מסך
    // נוסף — מקור אמת אחד. מאז שהקישור ירד מסרגל הניווט, זו גם הדרך
    // היחידה להגיע לרשימת התגיות בלי לעבור דרך פנייה מתויגת.
    { href: "/tags", label: he.admin.manageTags },
  ];

  return (
    <div className={`flex flex-col gap-3 py-3 ${PAGE_X} ${FULL_WIDTH}`}>
      <div>
        <h1 className={TITLE_DESCRIPTIVE}>{he.overview.title}</h1>
        <p className="text-sm text-muted">{he.overview.subtitle}</p>
      </div>

      {sites.length === 0 ? (
        <EmptyState>{he.overview.empty}</EmptyState>
      ) : (
        // גריד ולא עמודה: על מסך מלא ארבעה אתרים נכנסים לשורה אחת, ובמקום
        // גלילה מקבלים השוואה — שהיא כל מה שהמסך הזה נועד לאפשר.
        <ul className={`${CARD_LIST} sm:grid sm:grid-cols-2 xl:grid-cols-3`}>
          {sites.map((site) => (
            <li key={site.siteId} className={cardClasses("flex flex-col gap-2")}>
              <h2 className={TITLE_DESCRIPTIVE}>{site.siteName}</h2>
              <div className="grid grid-cols-3 gap-1">
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

      {canManage ? (
        <>
          <h2 className={TITLE_DESCRIPTIVE}>{he.admin.title}</h2>
          <ul className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {cards.map((card) => (
              <li key={card.href}>
                <Link
                  href={card.href}
                  className={cardClasses(
                    "flex min-h-8 items-center font-semibold touch:min-h-11",
                    { padding: "compact" },
                  )}
                >
                  {card.label}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
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
      className="flex flex-col items-center gap-1 rounded-sm bg-bg p-2 text-center"
    >
      <span className={`${METRIC_VALUE} ${toneClass}`}>{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </Link>
  );
}
