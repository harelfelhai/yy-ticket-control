import Link from "next/link";
import { Suspense } from "react";
import { TicketCard } from "@/components/ticket-card";
import { requireUser } from "@/lib/auth";
import { type BoardCard, groupForTour } from "@/lib/board-view";
import { he } from "@/lib/he";
import { type BoardFilters as Filters, getBoard } from "@/lib/services/board";
import type { BoardSection } from "@/lib/ticket-status";
import { CONTENT_WIDTH, TITLE_DESCRIPTIVE } from "@/lib/ui";
import { BoardFilters } from "./board-filters";

export const metadata = { title: `${he.board.title} — ${he.app.name}` };

/**
 * הלוח הראשי (מסך 1 באפיון) — המסך שמנהל העבודה פותח בבוקר.
 *
 * **רשימה אחת עם כותרות קיבוץ, לא טאבים.** ההחלטה הזו מהאפיון ומנומקת שם:
 * כותרת שגוללים דרכה מלמדת את המבנה, בעוד שטאב מסתיר תוכן ודורש מהמשתמש
 * לדעת שיש שם משהו — וטאב ריק נקרא כאובדן נתונים.
 *
 * הארכיון מקופל כברירת מחדל (`<details>`), כדי שפניות סגורות לא ידחפו את
 * מה שדורש טיפול אל מחוץ למסך.
 */
export default async function BoardPage(props: PageProps<"/board">) {
  const user = await requireUser();
  const params = await props.searchParams;

  const single = (value: string | string[] | undefined) =>
    typeof value === "string" && value ? value : undefined;

  const filters: Filters = {
    direction: single(params.direction) === "opened"
      ? "opened"
      : single(params.direction) === "received"
        ? "received"
        : undefined,
    siteId: single(params.site),
    buildingId: single(params.building),
    domainId: single(params.domain),
    recipientId: single(params.recipient),
    tagId: single(params.tag),
  };

  const board = await getBoard(user, filters, new Date());
  const tour = single(params.tour) === "1";

  // צלילה ממוקדת-מדד מתצוגת הבעלים (אפיון מסך 10): "ממתינות למנהל" מציג רק
  // את "דורש ממך", ו"ללא תנועה" רק את המוסלמות. מתעלמים מ-focus במצב סיור.
  const focusParam = single(params.focus);
  const focus =
    !tour && focusParam === "awaiting"
      ? "awaiting"
      : !tour && focusParam === "stale"
        ? "stale"
        : null;
  const focusCards =
    focus === "awaiting"
      ? board.sections.ACTION_REQUIRED
      : focus === "stale"
        ? board.sections.ACTION_REQUIRED.filter((card) => card.escalated)
        : null;
  const clearFocusHref = filters.siteId ? `/board?site=${filters.siteId}` : "/board";

  const total =
    board.sections.ACTION_REQUIRED.length +
    board.sections.WITH_RECIPIENTS.length +
    board.sections.ARCHIVE.length;

  return (
    <div className={`flex flex-col gap-4 p-4 pb-24 ${CONTENT_WIDTH}`}>
      <Suspense>
        <BoardFilters
          sites={board.sites}
          buildings={board.buildings}
          domains={board.domains}
          recipients={board.recipients}
          tags={board.tags}
        />
      </Suspense>

      {focus && focusCards ? (
        <>
          <div className="flex items-center justify-between gap-2 rounded-xl border border-brand/30 bg-brand/5 px-3 py-2 text-sm">
            <span className="font-medium">
              {focus === "awaiting" ? he.board.focusAwaiting : he.board.focusStale}
            </span>
            <Link href={clearFocusHref} className="font-medium text-brand">
              {he.board.showAll}
            </Link>
          </div>
          {focusCards.length === 0 ? (
            <p className="py-12 text-center text-muted">{he.board.empty}</p>
          ) : (
            focusCards.map((card) => <TicketCard key={card.id} card={card} />)
          )}
        </>
      ) : total === 0 ? (
        <p className="py-12 text-center text-muted">{he.board.empty}</p>
      ) : tour ? (
        <TourView cards={[...board.sections.ACTION_REQUIRED, ...board.sections.WITH_RECIPIENTS]} />
      ) : (
        <>
          <Section id="ACTION_REQUIRED" cards={board.sections.ACTION_REQUIRED} />
          <Section id="WITH_RECIPIENTS" cards={board.sections.WITH_RECIPIENTS} />
          <ArchiveSection cards={board.sections.ARCHIVE} />
        </>
      )}

      {/* כפתור צף: יצירת פנייה היא הפעולה השכיחה ביותר בשטח, והיא חייבת
          להיות בהישג אגודל בלי גלילה. */}
      <Link
        href="/tickets/new"
        className="fixed bottom-4 left-4 flex min-h-14 items-center rounded-full bg-brand px-6 text-base font-semibold text-brand-fg shadow-lg"
      >
        {he.ticket.newTicket}
      </Link>
    </div>
  );
}

/**
 * כותרת קיבוץ בלוח.
 *
 * `text-xl` (20px) ולא `text-sm` (14px). הכותרת הייתה **קטנה מכותרות
 * הכרטיסים שהיא מקבצת** — היררכיה הפוכה שגורמת למבנה הלוח להיקרא כרשימה
 * שטוחה. הסקאלה ב-`docs/DESIGN.md` מגדירה 20px כרמת כותרת סקציה.
 *
 * המונה ב-`text-muted`: הוא מידע משני, ובמשקל מלא הוא התחרה בשם הקבוצה.
 */
function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <>
      {label} <span className="font-normal text-muted">· {count}</span>
    </>
  );
}

function Section({ id, cards }: { id: Exclude<BoardSection, "ARCHIVE">; cards: BoardCard[] }) {
  return (
    <section className="flex flex-col gap-2">
      {/* כותרת דביקה: בגלילה ארוכה המשתמש תמיד יודע באיזו קבוצה הוא נמצא. */}
      <h2 className={`sticky top-14 z-[1] -mx-4 bg-bg px-4 py-2 ${TITLE_DESCRIPTIVE}`}>
        <SectionHeading label={he.boardSection[id]} count={cards.length} />
      </h2>
      {cards.length === 0 ? (
        <p className="px-1 text-sm text-muted">{he.board.emptySection}</p>
      ) : (
        cards.map((card) => <TicketCard key={card.id} card={card} />)
      )}
    </section>
  );
}

function ArchiveSection({ cards }: { cards: BoardCard[] }) {
  if (cards.length === 0) return null;

  return (
    <details className="flex flex-col gap-2">
      <summary className={`cursor-pointer py-2 ${TITLE_DESCRIPTIVE}`}>
        <SectionHeading label={he.boardSection.ARCHIVE} count={cards.length} />
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {cards.map((card) => (
          <TicketCard key={card.id} card={card} />
        ))}
      </div>
    </details>
  );
}

function TourView({ cards }: { cards: BoardCard[] }) {
  const { drafts, groups } = groupForTour(cards);

  return (
    <div className="flex flex-col gap-4">
      {drafts.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className={TITLE_DESCRIPTIVE}>
            <SectionHeading label={he.board.tourDrafts} count={drafts.length} />
          </h2>
          {drafts.map((card) => (
            <TicketCard key={card.id} card={card} />
          ))}
        </section>
      ) : null}

      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-2">
          <h2 className={`sticky top-14 z-[1] -mx-4 bg-bg px-4 py-2 ${TITLE_DESCRIPTIVE}`}>
            <SectionHeading label={group.label} count={group.cards.length} />
          </h2>
          {group.cards.map((card) => (
            <TicketCard key={card.id} card={card} />
          ))}
        </section>
      ))}
    </div>
  );
}
