import { Suspense } from "react";
import { TicketCard } from "@/components/ticket-card";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import { CONTENT_WIDTH, TITLE_DESCRIPTIVE } from "@/lib/ui";
import { type SearchFilters, searchTickets } from "@/lib/services/search";
import type { DerivedTicketStatus } from "@/lib/ticket-status";
import { SearchForm } from "./search-form";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: `${he.search.title} — ${he.app.name}` };

/** הסטטוסים שהגיוני לחפש לפיהם. טיוטה נמצאת בלוח ולא נחפשת. */
const STATUS_OPTIONS: DerivedTicketStatus[] = [
  "NEW",
  "VIEWED",
  "PARTIAL",
  "AWAITING_OPENER_APPROVAL",
  "CLOSED",
];

/**
 * מסך החיפוש (מסך 9 באפיון).
 *
 * הכול נשמר בכתובת ולא ב-state מקומי: מנהל שמצא פנייה, נכנס אליה וחזר,
 * מוצא את התוצאות במקומן; אפשר לשלוח קישור לחיפוש; וכפתור "אחורה" עובד.
 * אותה הכרעה בדיוק כמו במסנני הלוח.
 *
 * החיפוש **אינו רץ על מסך ריק**: בלי מונח ובלי מסננים אין מה להציג, ורשימה
 * של כל הפניות היא הלוח — שכבר קיים ומקובץ טוב יותר.
 */
export default async function SearchPage(props: PageProps<"/search">) {
  const user = await requireUser();
  const params = await props.searchParams;

  const single = (value: string | string[] | undefined) =>
    typeof value === "string" && value ? value : undefined;

  const selectedBuilding = single(params.building);

  const filters: SearchFilters = {
    query: single(params.q),
    direction:
      single(params.direction) === "opened"
        ? "opened"
        : single(params.direction) === "received"
          ? "received"
          : undefined,
    // סינון אתר מכובד רק למי שאינו מקובע לאתר (מנהל מערכת/בעלים).
    siteId: user.siteId ? undefined : single(params.site),
    buildingId: selectedBuilding,
    apartmentId: single(params.apartment),
    domainId: single(params.domain),
    recipientId: single(params.recipient),
    tagId: single(params.tag),
    status: STATUS_OPTIONS.find((option) => option === single(params.status)),
    from: parseDate(single(params.from)),
    to: parseDate(single(params.to)),
  };

  const hasCriteria = Object.values(filters).some(Boolean);

  const [result, sites, buildings, apartments, domains, recipients, tags] = await Promise.all([
    hasCriteria ? searchTickets(user, filters) : null,
    // בורר האתרים ריק למנהל עבודה (מקובע לאתרו), מלא למנהל מערכת/בעלים.
    user.siteId
      ? Promise.resolve([] as { id: string; name: string }[])
      : db.site.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.building.findMany({
      where: user.siteId ? { siteId: user.siteId } : {},
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // דירות רק לבניין שנבחר — אחרת הרשימה חוצה בניינים וחסרת משמעות.
    selectedBuilding
      ? db.apartment.findMany({
          where: { buildingId: selectedBuilding },
          orderBy: { number: "asc" },
          select: { id: true, number: true },
        })
      : Promise.resolve([] as { id: string; number: string }[]),
    db.domain.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.professional.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div className={`flex flex-col gap-4 p-4 ${CONTENT_WIDTH}`}>
      <h1 className={TITLE_DESCRIPTIVE}>{he.search.title}</h1>

      <Suspense>
        <SearchForm
          sites={sites}
          buildings={buildings}
          apartments={apartments.map((a) => ({ id: a.id, name: a.number }))}
          domains={domains}
          recipients={recipients}
          tags={tags}
          statuses={STATUS_OPTIONS.map((id) => ({ id, name: he.ticketStatus[id] }))}
        />
      </Suspense>

      {!result ? (
        <p className="py-12 text-center text-muted">{he.search.startTyping}</p>
      ) : result.cards.length === 0 ? (
        <EmptyState>{he.search.empty}</EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{he.search.results(result.cards.length)}</p>
          {result.cards.map((card) => (
            <TicketCard key={card.id} card={card} />
          ))}
          {result.truncated ? (
            <p className="py-2 text-center text-sm text-muted">{he.search.truncated}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** תאריך שאינו תקין מתעלמים ממנו, במקום להפיל את המסך על פרמטר בכתובת */
function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
