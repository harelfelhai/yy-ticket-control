"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/field";
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
  const hasFilters = ["direction", "site", "building", "domain", "recipient", "tag"].some((k) =>
    params.get(k),
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* בורר האתר מוצג רק למי שרואה יותר מאחד (בעלים, מנהל מערכת). מנהל
          עבודה מקובע לאתרו, ואין לו מה לסנן. */}
      {sites.length > 1 ? (
        <Select
          key={`site-${syncKey}`}
          aria-label={he.ticket.site}
          defaultValue={params.get("site") ?? ""}
          onChange={(e) => update("site", e.target.value)}
        size="compact"
        >
          <option value="">{he.board.allSites}</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      ) : null}

      <Select
        key={`direction-${syncKey}`}
        aria-label={he.board.opened}
        defaultValue={params.get("direction") ?? ""}
        onChange={(e) => update("direction", e.target.value)}
        size="compact"
      >
        <option value="">{he.board.allDirections}</option>
        <option value="opened">{he.board.opened}</option>
        <option value="received">{he.board.received}</option>
      </Select>

      <Select
        key={`building-${syncKey}`}
        aria-label={he.directory.building}
        defaultValue={params.get("building") ?? ""}
        onChange={(e) => update("building", e.target.value)}
        size="compact"
      >
        <option value="">{he.board.allBuildings}</option>
        {buildings.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>

      <Select
        key={`domain-${syncKey}`}
        aria-label={he.directory.domain}
        defaultValue={params.get("domain") ?? ""}
        onChange={(e) => update("domain", e.target.value)}
        size="compact"
      >
        <option value="">{he.board.allDomains}</option>
        {domains.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </Select>

      <Select
        key={`recipient-${syncKey}`}
        aria-label={he.directory.professional}
        defaultValue={params.get("recipient") ?? ""}
        onChange={(e) => update("recipient", e.target.value)}
        size="compact"
      >
        <option value="">{he.board.allRecipients}</option>
        {recipients.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>

      {/* מסנן התגית מוצג רק כשיש תגיות: מסך ריק של בורר בלי אפשרויות הוא
          רעש למי שעדיין לא התחיל לתייג. */}
      {tags.length > 0 ? (
        <Select
          key={`tag-${syncKey}`}
          aria-label={he.tag.label}
          defaultValue={params.get("tag") ?? ""}
          onChange={(e) => update("tag", e.target.value)}
        size="compact"
        >
          <option value="">{he.board.allTags}</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      ) : null}

      <label className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm">
        <input
          key={`tour-${syncKey}`}
          type="checkbox"
          defaultChecked={tour}
          onChange={(e) => update("tour", e.target.checked ? "1" : "")}
          className="size-5"
        />
        {he.board.tourMode}
      </label>

      {hasFilters ? (
        <button
          type="button"
          onClick={() => router.replace(pathname)}
          className="min-h-11 px-3 text-sm font-medium text-brand"
        >
          {he.board.clearFilters}
        </button>
      ) : null}
    </div>
  );
}
