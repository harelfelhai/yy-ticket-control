"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FilterBar, FilterSelect } from "@/components/ui/filter-bar";
import { he } from "@/lib/he";

interface Option {
  id: string;
  name: string;
}

interface BoardFiltersProps {
  sites: Option[];
  buildings: Option[];
  domains: Option[];
  recipients: Option[];
  tags: Option[];
}

/** הפרמטרים שנחשבים סינון. `tour` ו-`focus` הם מצב תצוגה ולא נספרים כאן. */
const FILTER_PARAMS = ["direction", "site", "building", "domain", "recipient", "tag"];

/**
 * רצועת המסננים ומתג "מצב סיור".
 *
 * המצב נשמר ב-URL ולא ב-state מקומי, משלוש סיבות מעשיות: כניסה חוזרת
 * למסך אחרי צפייה בפנייה משמרת את התצוגה, אפשר לשלוח קישור למסונן, וכפתור
 * "אחורה" בדפדפן עובד כמצופה. המחיר הוא סבב שרת לכל שינוי — זניח מול
 * המחיר של מנהל שמאבד את הסינון בכל לחיצה.
 */
export function BoardFilters({ sites, buildings, domains, recipients, tags }: BoardFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`);
  }

  /**
   * ‏defaultValue יחד עם key, ולא value מבוקר.
   *
   * הפקדים נשלטים על ידי ה-URL, והניווט אינו מיידי. פקד מבוקר היה נשאר
   * במצב הישן עד שהשרת מחזיר תשובה — המשתמש לוחץ על "מצב סיור" ורואה את
   * התיבה נשארת ריקה. עם defaultValue הדפדפן משנה את המצב מיד, וה-key
   * מאלץ סנכרון מחדש כשהכתובת באמת מתעדכנת (למשל בלחיצה על "נקה מסננים").
   */
  const syncKey = params.toString();

  const tour = params.get("tour") === "1";
  const table = params.get("view") === "table";
  const activeCount = FILTER_PARAMS.filter((key) => params.get(key)).length;

  return (
    <FilterBar
      activeCount={activeCount}
      trailing={
        <>
          {/*
           * מתג התצוגה (0.3). **מוסתר מתחת ל-`md`**: טבלה ברוחב 390px היא
           * גלישה אופקית או טקסט קטוע, ומשתמש נייד שלוחץ ולא רואה שינוי
           * לומד שהמערכת לא מגיבה.
           *
           * ‏`view` אינו מסנן ולכן הוא ב-`trailing` ואינו מתקפל לתוך
           * הרצועה — "מה שאינו מסנן אינו מתקפל" (§ FilterBar).
           */}
          <Button
            variant="secondary"
            size="compact"
            className="hidden md:inline-flex"
            onClick={() => update("view", table ? "" : "table")}
          >
            {table ? he.board.viewCards : he.board.viewTable}
          </Button>

          <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm">
            <input
              key={`tour-${syncKey}`}
              type="checkbox"
              defaultChecked={tour}
              onChange={(e) => update("tour", e.target.checked ? "1" : "")}
              className="size-5"
            />
            {he.board.tourMode}
          </label>

          {activeCount > 0 ? (
            <Button variant="quiet" size="compact" onClick={() => router.replace(pathname)}>
              {he.board.clearFilters}
            </Button>
          ) : null}
        </>
      }
    >
      {/* בורר האתר מוצג רק למי שרואה יותר מאחד (בעלים, מנהל מערכת). מנהל
          עבודה מקובע לאתרו, ואין לו מה לסנן. */}
      {sites.length > 1 ? (
        <FilterSelect
          key={`site-${syncKey}`}
          aria-label={he.ticket.site}
          defaultValue={params.get("site") ?? ""}
          onChange={(e) => update("site", e.target.value)}
        >
          <option value="">{he.board.allSites}</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </FilterSelect>
      ) : null}

      <FilterSelect
        key={`direction-${syncKey}`}
        aria-label={he.board.opened}
        defaultValue={params.get("direction") ?? ""}
        onChange={(e) => update("direction", e.target.value)}
      >
        <option value="">{he.board.allDirections}</option>
        <option value="opened">{he.board.opened}</option>
        <option value="received">{he.board.received}</option>
      </FilterSelect>

      <FilterSelect
        key={`building-${syncKey}`}
        aria-label={he.directory.building}
        defaultValue={params.get("building") ?? ""}
        onChange={(e) => update("building", e.target.value)}
      >
        <option value="">{he.board.allBuildings}</option>
        {buildings.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </FilterSelect>

      <FilterSelect
        key={`domain-${syncKey}`}
        aria-label={he.directory.domain}
        defaultValue={params.get("domain") ?? ""}
        onChange={(e) => update("domain", e.target.value)}
      >
        <option value="">{he.board.allDomains}</option>
        {domains.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </FilterSelect>

      <FilterSelect
        key={`recipient-${syncKey}`}
        aria-label={he.directory.professional}
        defaultValue={params.get("recipient") ?? ""}
        onChange={(e) => update("recipient", e.target.value)}
      >
        <option value="">{he.board.allRecipients}</option>
        {recipients.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </FilterSelect>

      {/* מסנן התגית מוצג רק כשיש תגיות: מסך ריק של בורר בלי אפשרויות הוא
          רעש למי שעדיין לא התחיל לתייג. */}
      {tags.length > 0 ? (
        <FilterSelect
          key={`tag-${syncKey}`}
          aria-label={he.tag.label}
          defaultValue={params.get("tag") ?? ""}
          onChange={(e) => update("tag", e.target.value)}
        >
          <option value="">{he.board.allTags}</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </FilterSelect>
      ) : null}
    </FilterBar>
  );
}
