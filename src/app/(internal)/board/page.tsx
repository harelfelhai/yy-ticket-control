import Link from "next/link";
import { Suspense } from "react";
import { TicketCard } from "@/components/ticket-card";
import { ButtonLink } from "@/components/ui/button";
import { TicketTable } from "@/components/ticket-table";
import { requireUser } from "@/lib/auth";
import {
  type BoardCard,
  SECTION_MORE_PARAM,
  SECTION_PAGE_SIZE,
  type SortDirection,
  type SortKey,
  boardHref,
  isSortKey,
  nextSort,
  sectionLimit,
  singleParam,
  visibleCards,
} from "@/lib/board-view";
import { he } from "@/lib/he";
import { type BoardFilters as Filters, getBoard } from "@/lib/services/board";
import type { BoardSection, DerivedTicketStatus } from "@/lib/ticket-status";
import {
  FULL_WIDTH,
  PAGE_BLEED,
  PAGE_X,
  STICKY_UNDER_HEADER,
  TICKET_CARD_GRID,
  TITLE_DESCRIPTIVE,
} from "@/lib/ui";
import { BoardFilters } from "./board-filters";
import { EmptyState } from "@/components/ui/empty-state";
import { Banner } from "@/components/ui/message";

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
/**
 * מצב מהכתובת, מאומת מול הרשימה הסגורה.
 *
 * ‏`?status=NONSENSE` צריך להיקרא כ"בלי סינון סטטוס" ולא להפיל את המסך —
 * אותו כלל בדיוק שכבר חל על `?sort=` (`isSortKey`).
 */
const STATUSES: DerivedTicketStatus[] = [
  "NEW",
  "VIEWED",
  "PARTIAL",
  "AWAITING_OPENER_APPROVAL",
  "CLOSED",
  "DRAFT",
];

function asStatus(value: string | undefined): DerivedTicketStatus | undefined {
  return STATUSES.find((status) => status === value);
}

/**
 * ‏`yyyy-mm-dd` מ-`<input type="date">`. תאריך לא-תקין נקרא כ"בלי סינון",
 * מאותו נימוק — הכתובת היא קלט חיצוני.
 */
function asDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export default async function BoardPage(props: PageProps<"/board">) {
  const user = await requireUser();
  const params = await props.searchParams;

  // ערך יחיד מהכתובת — ההגדרה עברה ל-`board-view.ts` כשגם `boardHref` נזקק לה.
  const single = singleParam;

  const filters: Filters = {
    query: single(params.q),
    direction: single(params.direction) === "opened"
      ? "opened"
      : single(params.direction) === "received"
        ? "received"
        : undefined,
    siteId: single(params.site),
    buildingId: single(params.building),
    apartmentId: single(params.apartment),
    domainId: single(params.domain),
    recipientId: single(params.recipient),
    tagId: single(params.tag),
    status: asStatus(single(params.status)),
    from: asDate(single(params.from)),
    to: asDate(single(params.to)),
  };

  const board = await getBoard(user, filters, new Date());

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
   * נבנית מהכתובת הנוכחית ולא מאפס (דרך `boardHref`), כדי שהמיון לא ימחק
   * מסננים או את `view=table` עצמו. המצב השלישי **מסיר** את שני הפרמטרים,
   * וזו החזרה לסדר המערכת.
   */
  const sortHref = (key: SortKey): string => {
    const target = nextSort(sort, key);
    return boardHref(params, {
      sort: target ? target.key : null,
      dir: target ? target.direction : null,
    });
  };

  /**
   * תקרת התצוגה של כל קבוצה (ספק #38): 20 כברירת מחדל, ו"טען עוד" מעלה
   * אותה דרך הכתובת — כמו כל שאר מצב הלוח. הסינון והמיון חלים על הרשימה
   * המלאה; רק הרינדור נחתך, והמונה בכותרת נשאר מלא.
   */
  const limits: Record<BoardSection, number> = {
    ACTION_REQUIRED: sectionLimit(single(params[SECTION_MORE_PARAM.ACTION_REQUIRED])),
    WITH_RECIPIENTS: sectionLimit(single(params[SECTION_MORE_PARAM.WITH_RECIPIENTS])),
    ARCHIVE: sectionLimit(single(params[SECTION_MORE_PARAM.ARCHIVE])),
  };
  const moreHref = (section: BoardSection): string =>
    boardHref(params, {
      [SECTION_MORE_PARAM[section]]: String(limits[section] + SECTION_PAGE_SIZE),
    });

  // צלילה ממוקדת-מדד מתצוגת הבעלים (אפיון מסך 10): "ממתינות למנהל" מציג רק
  // את "דורש ממך", ו"ללא תנועה" רק את המוסלמות.
  const focusParam = single(params.focus);
  const focus = focusParam === "awaiting" ? "awaiting" : focusParam === "stale" ? "stale" : null;
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
    <div className={`flex flex-col gap-3 py-3 pb-24 ${PAGE_X} ${FULL_WIDTH}`}>
      {/*
       * תוכן הלוח יושב **בתוך** `BoardFilters` (כ-children, כלומר נשאר
       * רינדור-שרת): כך חיווי ה-pending של הרצועה יכול לעמעם אותו בזמן
       * סבב הסינון (ספק #39). הכפתור הצף נשאר בחוץ — המעטפת המעומעמת
       * יוצרת containing block שהיה כולא את ה-`fixed` שלו.
       */}
      <Suspense>
        <BoardFilters
          sites={board.sites}
          buildings={board.buildings}
          apartments={board.apartments}
          domains={board.domains}
          recipients={board.recipients}
          tags={board.tags}
        >
          {board.search ? (
            <SearchResults cards={board.search.cards} truncated={board.search.truncated} table={table} sort={sort} sortHref={sortHref} />
          ) : focus && focusCards ? (
            <div className="flex flex-col gap-3">
              {/*
               * פערים 33 ו-34: הבאנר נכתב ביד עם `bg-brand/5` — ערך שקיפות שאינו
               * קיים בתקן — ובלי `role`, כלומר אילם לקורא מסך. השורש היה **וריאנט
               * חסר**, ולכן נוסף `brand` ל-`Banner` במקום לחזור על המחלקות.
               * ‏"הצג הכול" נצמד לטקסט ואינו נדחף לקצה הנגדי (§ Layout).
               */}
              <Banner tone="info" className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{focus === "awaiting" ? he.board.focusAwaiting : he.board.focusStale}</span>
                <Link href={clearFocusHref} className="underline">
                  {he.board.showAll}
                </Link>
              </Banner>
              {focusCards.length === 0 ? (
                <EmptyState>{he.board.empty}</EmptyState>
              ) : (
                <CardList cards={focusCards} table={table} sort={sort} sortHref={sortHref} />
              )}
            </div>
          ) : total === 0 ? (
            <EmptyState>{he.board.empty}</EmptyState>
          ) : (
            <div className="flex flex-col gap-3">
              <Section
                id="ACTION_REQUIRED"
                cards={board.sections.ACTION_REQUIRED}
                table={table}
                sort={sort}
                sortHref={sortHref}
                limit={limits.ACTION_REQUIRED}
                moreHref={moreHref("ACTION_REQUIRED")}
              />
              <Section
                id="WITH_RECIPIENTS"
                cards={board.sections.WITH_RECIPIENTS}
                table={table}
                sort={sort}
                sortHref={sortHref}
                limit={limits.WITH_RECIPIENTS}
                moreHref={moreHref("WITH_RECIPIENTS")}
              />
              <ArchiveSection
                cards={board.sections.ARCHIVE}
                truncated={board.archiveTruncated}
                table={table}
                sort={sort}
                sortHref={sortHref}
                limit={limits.ARCHIVE}
                moreHref={moreHref("ARCHIVE")}
              />
            </div>
          )}
        </BoardFilters>
      </Suspense>

      {/*
        כפתור צף: יצירת פנייה היא הפעולה השכיחה ביותר בשטח, והיא חייבת
        להיות בהישג אגודל בלי גלילה.

        **עובר דרך `ButtonLink` ולא נבנה ביד.** קודם הוא היה עותק ידני של
        הכפתור הראשי (`bg-brand`, `text-brand-fg`, `px-6`), ולכן החמיץ כל
        שינוי בפרימיטיב — כולל את הפלטה החדשה ואת הצפיפות. `shadow-lg`
        וההצמדה נשארים כאן: הם תפקידו כאלמנט צף, לא צורתו ככפתור.
      */}
      <ButtonLink href="/tickets/new" className="fixed bottom-3 end-3 shadow-lg">
        {he.ticket.newTicket}
      </ButtonLink>
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
 * תוצאות חיפוש — רשימה שטוחה שמחליפה את הלוח כל עוד יש מונח חיפוש.
 *
 * **בלי הקיבוץ לשלוש קבוצות, ובכוונה.** הקיבוץ עונה על "אצל מי הכדור",
 * ובחיפוש השאלה היא "איפה ראיתי את זה". פנייה סגורה שתואמת הייתה נוחתת
 * בארכיון המקופל — כלומר המשתמש מחפש, יש התאמה, והוא רואה מסך ריק.
 *
 * הקטיעה נאמרת במפורש: רשימה חתוכה שנראית מלאה היא הטעיה.
 */
function SearchResults({
  cards,
  truncated,
  table,
  sort,
  sortHref,
}: { cards: BoardCard[]; truncated: boolean; table: boolean } & SortProps) {
  if (cards.length === 0) return <EmptyState>{he.search.empty}</EmptyState>;

  return (
    <>
      <p className="text-sm text-muted">{he.search.results(cards.length)}</p>
      {truncated ? <Banner tone="warning">{he.search.truncated}</Banner> : null}
      <CardList cards={cards} table={table} sort={sort} sortHref={sortHref} />
    </>
  );
}

/**
 * רשימת הפניות בקבוצה אחת, בתצוגה שנבחרה.
 *
 * נקודת ההחלפה **היחידה** בין שתי התצוגות. כותרות הקיבוץ והארכיון המקופל
 * עוברים דרכה ולכן אינם יודעים על קיומה של הטבלה כלל.
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
  limit,
}: { cards: BoardCard[]; table: boolean; limit?: number } & SortProps) {
  /*
   * המיון חל על **שתי** התצוגות ולא על הטבלה בלבד.
   *
   * הפקד קיים רק בטבלה, אבל `?sort=` נגיש מקישור שנשמר — ובנייד הטבלה
   * מוחלפת בכרטיסים. אילו הכרטיסים היו מתעלמים מהמיון, אותה כתובת הייתה
   * מציגה שני סדרים שונים בלי לומר זאת. זו רשימה אחת, וסדר אחד.
   *
   * התקרה (ספק #38) נחתכת **אחרי** המיון — "20 הראשונים" הם לפי הסדר
   * שהמשתמש רואה — ובנקודה אחת עבור שתי התצוגות, כך שהטבלה והכרטיסים
   * לעולם אינם מציגים חלונות שונים של אותה רשימה.
   */
  const ordered = visibleCards(cards, sort, limit);
  const asCards = (
    /**
     * **הריסון של הרוחב יושב כאן, ולא על העמוד.**
     *
     * זו התשובה לנימוק שבגללו הייתה תקרה על `<main>`: כרטיס פנייה מחזיק שתי
     * שורות טקסט, וברוחב 1600px התיאור והמצב מתרחקים עד שהעין אינה קושרת
     * ביניהם. ‏`auto-fill` פותר את זה בלי לוותר על המסך — עמודה חסומה
     * ב-360px, וכל מה שנשאר הופך לעמודה נוספת. מסך רחב קונה **עוד כרטיסים
     * בשורה**, לא כרטיס מתוח אחד.
     *
     * **המחרוזת עברה ל-`src/lib/ui.ts` ב-0.8.** מסכי הניהול אימצו את אותה
     * תשובה בשני רוחבים נוספים, ושלושה ליטרלים כמעט-זהים בשלושה קבצים הם
     * בדיוק הצורה שפער 22 חזר בה פעמיים. הערך והתנהגותו לא השתנו.
     */
    <div className={TICKET_CARD_GRID}>
      {ordered.map((card) => (
        <TicketCard key={card.id} card={card} />
      ))}
    </div>
  );
  if (!table) return asCards;

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
      <div className="md:hidden">{asCards}</div>
    </>
  );
}

function Section({
  id,
  cards,
  table,
  sort,
  sortHref,
  limit,
  moreHref,
}: {
  id: Exclude<BoardSection, "ARCHIVE">;
  cards: BoardCard[];
  table: boolean;
  limit: number;
  moreHref: string;
} & SortProps) {
  return (
    <section className="flex flex-col gap-3">
      {/* כותרת דביקה: בגלילה ארוכה המשתמש תמיד יודע באיזו קבוצה הוא נמצא. */}
      <h2
        className={`sticky ${STICKY_UNDER_HEADER} z-[1] ${PAGE_BLEED} bg-bg ${PAGE_X} py-1 ${TITLE_DESCRIPTIVE}`}
      >
        <SectionHeading label={he.boardSection[id]} count={cards.length} />
      </h2>
      {cards.length === 0 ? (
        <p className="px-1 text-sm text-muted">{he.board.emptySection}</p>
      ) : (
        <>
          <CardList cards={cards} table={table} sort={sort} sortHref={sortHref} limit={limit} />
          {cards.length > limit ? (
            <LoadMore remaining={cards.length - limit} href={moreHref} />
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * "טען עוד · N" (ספק #38) — קישור RSC טהור: התקרה חיה בכתובת ולא ב-state,
 * ולכן חזרה מפנייה משמרת את ההרחבה, בדיוק כמו מסנן או מיון.
 *
 * ‏`prefetch={false}`: הקישור יושב בתחתית רשימה, וכניסתו ל-viewport בגלילה
 * הייתה מריצה רינדור לוח מלא ספקולטיבי — בדיוק העומס שהתקרה באה לחסוך.
 */
function LoadMore({ remaining, href }: { remaining: number; href: string }) {
  return (
    <ButtonLink
      variant="quiet"
      size="compact"
      prefetch={false}
      href={href}
      className="self-start"
    >
      {he.board.loadMore(remaining)}
    </ButtonLink>
  );
}

function ArchiveSection({
  cards,
  truncated,
  table,
  sort,
  sortHref,
  limit,
  moreHref,
}: {
  cards: BoardCard[];
  truncated: boolean;
  table: boolean;
  limit: number;
  moreHref: string;
} & SortProps) {
  if (cards.length === 0) return null;

  return (
    <details className="flex flex-col gap-2">
      <summary className={`cursor-pointer py-2 ${TITLE_DESCRIPTIVE}`}>
        <SectionHeading label={he.boardSection.ARCHIVE} count={cards.length} />
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {/*
          הקטיעה נאמרת בתוך הקבוצה שנקטעה, לפני הרשימה — ולא בתחתית: מי
          שפותח את הארכיון ולא מוצא פנייה ישנה מפסיק לגלול הרבה לפני הסוף.
        */}
        {truncated && <p className="text-sm text-muted">{he.board.archiveTruncated}</p>}
        <CardList cards={cards} table={table} sort={sort} sortHref={sortHref} limit={limit} />
        {cards.length > limit ? (
          <LoadMore remaining={cards.length - limit} href={moreHref} />
        ) : null}
      </div>
    </details>
  );
}
