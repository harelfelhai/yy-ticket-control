import Link from "next/link";
import { Suspense } from "react";
import { TicketCard } from "@/components/ticket-card";
import { TicketTable } from "@/components/ticket-table";
import { requireUser } from "@/lib/auth";
import {
  type BoardCard,
  type SortDirection,
  type SortKey,
  groupForTour,
  isSortKey,
  nextSort,
  sortCards,
} from "@/lib/board-view";
import { he } from "@/lib/he";
import { type BoardFilters as Filters, getBoard } from "@/lib/services/board";
import type { BoardSection } from "@/lib/ticket-status";
import { CONTENT_WIDTH, TITLE_DESCRIPTIVE } from "@/lib/ui";
import { BoardFilters } from "./board-filters";
import { EmptyState } from "@/components/ui/empty-state";

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

  /**
   * תצוגת טבלה (אפיון מסך 1, הכרעת 0.3 §7 שורה 28).
   *
   * ברירת המחדל היא כרטיסים, ולכן `?view=table` בלבד מפעיל אותה — כל
   * הקישורים והבדיקות הקיימות ממשיכים לפגוע בתצוגה שהם מכירים.
   *
   * **שלוש כותרות הקיבוץ אינן מושפעות.** מה שמשתנה הוא רינדור השורה בלבד,
   * וזה מה ששומר על "רשימה אחת עם כותרות קיבוץ, לא טאבים" (§מסך 1).
   */
  const table = single(params.view) === "table";

  /**
   * מיון לפי עמודה (הכרעת 0.4, §7 שורה 30).
   *
   * ‏`isSortKey` ולא השמה ישירה: הערך מגיע מהכתובת, ומפתח לא מוכר צריך
   * להיקרא כ"בלי מיון" ולא להפיל את המסך. וכיוון שאינו `desc` נקרא כ-`asc`,
   * כי `?sort=domain` לבדו הוא קישור סביר שמישהו יכתוב ביד.
   */
  const sortKeyParam = single(params.sort);
  const sort: { key: SortKey; direction: SortDirection } | null = isSortKey(sortKeyParam)
    ? { key: sortKeyParam, direction: single(params.dir) === "desc" ? "desc" : "asc" }
    : null;

  /**
   * הכתובת שאליה מובילה לחיצה על כותרת — המצב הבא במחזור.
   *
   * נבנית מהכתובת הנוכחית ולא מאפס, כדי שהמיון לא ימחק מסננים, מצב סיור
   * או `view=table` עצמו. המצב השלישי **מסיר** את שני הפרמטרים, וזו החזרה
   * לסדר המערכת.
   */
  const sortHref = (key: SortKey): string => {
    const next = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
      const one = single(value);
      if (one && name !== "sort" && name !== "dir") next.set(name, one);
    }

    const target = nextSort(sort, key);
    if (target) {
      next.set("sort", target.key);
      next.set("dir", target.direction);
    }

    const query = next.toString();
    return query ? `/board?${query}` : "/board";
  };

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
            <EmptyState>{he.board.empty}</EmptyState>
          ) : (
            <CardList cards={focusCards} table={table} sort={sort} sortHref={sortHref} />
          )}
        </>
      ) : total === 0 ? (
        <EmptyState>{he.board.empty}</EmptyState>
      ) : tour ? (
        <TourView
          cards={[...board.sections.ACTION_REQUIRED, ...board.sections.WITH_RECIPIENTS]}
          table={table}
          sort={sort}
          sortHref={sortHref}
        />
      ) : (
        <>
          <Section
            id="ACTION_REQUIRED"
            cards={board.sections.ACTION_REQUIRED}
            table={table}
            sort={sort}
            sortHref={sortHref}
          />
          <Section
            id="WITH_RECIPIENTS"
            cards={board.sections.WITH_RECIPIENTS}
            table={table}
            sort={sort}
            sortHref={sortHref}
          />
          <ArchiveSection
            cards={board.sections.ARCHIVE}
            table={table}
            sort={sort}
            sortHref={sortHref}
          />
        </>
      )}

      {/* כפתור צף: יצירת פנייה היא הפעולה השכיחה ביותר בשטח, והיא חייבת
          להיות בהישג אגודל בלי גלילה. */}
      <Link
        href="/tickets/new"
        className="fixed bottom-4 end-4 flex min-h-14 items-center rounded-full bg-brand px-6 text-base font-semibold text-brand-fg shadow-lg"
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

/**
 * רשימת הפניות בקבוצה אחת, בתצוגה שנבחרה.
 *
 * נקודת ההחלפה **היחידה** בין שתי התצוגות. כותרות הקיבוץ, הארכיון המקופל
 * ומצב הסיור עוברים דרכה ולכן אינם יודעים על קיומה של הטבלה כלל.
 */
interface SortProps {
  sort: { key: SortKey; direction: SortDirection } | null;
  sortHref: (key: SortKey) => string;
}

function CardList({
  cards,
  table,
  sort,
  sortHref,
}: { cards: BoardCard[]; table: boolean } & SortProps) {
  /*
   * המיון חל על **שתי** התצוגות ולא על הטבלה בלבד.
   *
   * הפקד קיים רק בטבלה, אבל `?sort=` נגיש מקישור שנשמר — ובנייד הטבלה
   * מוחלפת בכרטיסים. אילו הכרטיסים היו מתעלמים מהמיון, אותה כתובת הייתה
   * מציגה שני סדרים שונים בלי לומר זאת. זו רשימה אחת, וסדר אחד.
   */
  const ordered = sortCards(cards, sort);
  const asCards = ordered.map((card) => <TicketCard key={card.id} card={card} />);
  if (!table) return <>{asCards}</>;

  /*
   * **בנייד כרטיסים תמיד, גם כש-`?view=table` מבוקש במפורש.**
   *
   * הסתרת המתג מתחת ל-`md` אינה מספיקה: הכתובת נגישה מקישור שנשמר ומחזרה
   * בהיסטוריה. סבב הצילום הראה מה קורה שם — ב-390px כותרות העמודות נדבקות
   * זו לזו ("מיקוםתחוםסיבהנמענים") והתאים נחתכים ל-"ב.". זה **לא** נתפס
   * באוכף הגלישה, כי הרשת מצטמצמת ואינה גולשת; היא פשוט בלתי קריאה.
   *
   * ההחלפה ב-CSS ולא בשרת, כי הרינדור בשרת אינו יודע את רוחב החלון.
   * העלות היא DOM כפול — ורק כשהטבלה התבקשה במפורש.
   */
  return (
    <>
      <div className="hidden md:block">
        <TicketTable cards={ordered} sort={sort} sortHref={sortHref} />
      </div>
      <div className="flex flex-col gap-3 md:hidden">{asCards}</div>
    </>
  );
}

function Section({
  id,
  cards,
  table,
  sort,
  sortHref,
}: {
  id: Exclude<BoardSection, "ARCHIVE">;
  cards: BoardCard[];
  table: boolean;
} & SortProps) {
  return (
    <section className="flex flex-col gap-3">
      {/* כותרת דביקה: בגלילה ארוכה המשתמש תמיד יודע באיזו קבוצה הוא נמצא. */}
      <h2 className={`sticky top-14 z-[1] -mx-4 bg-bg px-4 py-2 ${TITLE_DESCRIPTIVE}`}>
        <SectionHeading label={he.boardSection[id]} count={cards.length} />
      </h2>
      {cards.length === 0 ? (
        <p className="px-1 text-sm text-muted">{he.board.emptySection}</p>
      ) : (
        <CardList cards={cards} table={table} sort={sort} sortHref={sortHref} />
      )}
    </section>
  );
}

function ArchiveSection({
  cards,
  table,
  sort,
  sortHref,
}: { cards: BoardCard[]; table: boolean } & SortProps) {
  if (cards.length === 0) return null;

  return (
    <details className="flex flex-col gap-2">
      <summary className={`cursor-pointer py-2 ${TITLE_DESCRIPTIVE}`}>
        <SectionHeading label={he.boardSection.ARCHIVE} count={cards.length} />
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <CardList cards={cards} table={table} sort={sort} sortHref={sortHref} />
      </div>
    </details>
  );
}

function TourView({
  cards,
  table,
  sort,
  sortHref,
}: { cards: BoardCard[]; table: boolean } & SortProps) {
  const { drafts, groups } = groupForTour(cards);

  return (
    <div className="flex flex-col gap-4">
      {drafts.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className={TITLE_DESCRIPTIVE}>
            <SectionHeading label={he.board.tourDrafts} count={drafts.length} />
          </h2>
          <CardList cards={drafts} table={table} sort={sort} sortHref={sortHref} />
        </section>
      ) : null}

      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-2">
          <h2 className={`sticky top-14 z-[1] -mx-4 bg-bg px-4 py-2 ${TITLE_DESCRIPTIVE}`}>
            <SectionHeading label={group.label} count={group.cards.length} />
          </h2>
          <CardList cards={group.cards} table={table} sort={sort} sortHref={sortHref} />
        </section>
      ))}
    </div>
  );
}
