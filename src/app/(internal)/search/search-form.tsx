"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { FilterBar, FilterSelect } from "@/components/ui/filter-bar";
import { he } from "@/lib/he";

interface Option {
  id: string;
  name: string;
}

/** הפרמטרים שנחשבים סינון — הכול חוץ ממונח החיפוש עצמו (`q`). */
const FILTER_PARAMS = [
  "direction",
  "site",
  "building",
  "apartment",
  "domain",
  "recipient",
  "tag",
  "status",
  "from",
  "to",
];

interface SearchFormProps {
  sites: Option[];
  buildings: Option[];
  apartments: Option[];
  domains: Option[];
  recipients: Option[];
  tags: Option[];
  statuses: Option[];
}

/**
 * שדה החיפוש והמסננים.
 *
 * שדה הטקסט הוא **טופס עם שליחה מפורשת** ולא חיפוש-תוך-כדי-הקלדה: כל
 * הקלדה הייתה מפעילה שאילתה שחוצה ארבע טבלאות, וברשת סלולרית באתר בנייה
 * זה מייצר תור של בקשות שהמסך מתקשה להדביק. המסננים, לעומת זאת, פועלים
 * מיד — בחירה מרשימה היא פעולה מכוונת ובודדת.
 */
export function SearchForm({
  sites,
  buildings,
  apartments,
  domains,
  recipients,
  tags,
  statuses,
}: SearchFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");

  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.replace(`${pathname}?${next.toString()}`);
  }

  // ‏key שנגזר מהכתובת מסנכרן את הפקדים אחרי ניווט, בלי להפוך אותם למבוקרים
  // — פקד מבוקר היה נשאר במצב הישן עד שהשרת מחזיר תשובה.
  const syncKey = params.toString();

  // `q` הוא מונח החיפוש ולא מסנן — שדה החיפוש גלוי תמיד, ואין טעם לספור אותו
  // כדבר שמוסתר מאחורי המתג.
  const activeCount = FILTER_PARAMS.filter((key) => params.get(key)).length;

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          update({ q: query.trim() });
        }}
        className="flex gap-2"
      >
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={he.search.title}
          placeholder={he.search.placeholder}
          className="flex-1"
        />
        <Button type="submit">
          {he.search.submit}
        </Button>
      </form>

      <p className="text-xs text-muted">{he.search.scopeHint}</p>

      <FilterBar
        activeCount={activeCount}
        trailing={
          // התנאי הוא `syncKey` ולא `activeCount`: הכפתור מנקה גם את מונח
          // החיפוש, ולכן הוא נחוץ גם כשמסונן רק לפי `q`.
          syncKey ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                router.replace(pathname);
              }}
              className="min-h-11 px-3 text-sm font-medium text-brand"
            >
              {he.board.clearFilters}
            </button>
          ) : null
        }
      >
        <FilterSelect
          key={`direction-${syncKey}`}
          aria-label={he.board.opened}
          defaultValue={params.get("direction") ?? ""}
          onChange={(event) => update({ direction: event.target.value })}
        >
          <option value="">{he.board.allDirections}</option>
          <option value="opened">{he.board.opened}</option>
          <option value="received">{he.board.received}</option>
        </FilterSelect>

        {/* בורר אתר — רק למי שרואה יותר מאחד (מנהל מערכת/בעלים) */}
        {sites.length > 0 ? (
          <FilterSelect
            key={`site-${syncKey}`}
            aria-label={he.ticket.site}
            defaultValue={params.get("site") ?? ""}
            onChange={(event) => update({ site: event.target.value })}
          >
            <option value="">{he.board.allSites}</option>
            {sites.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </FilterSelect>
        ) : null}

        <FilterSelect
          key={`building-${syncKey}`}
          aria-label={he.directory.building}
          defaultValue={params.get("building") ?? ""}
          // שינוי בניין מנקה את הדירה: דירה שייכת לבניין, ובחירה ישנה תחת
          // בניין חדש היא סינון חסר-משמעות.
          onChange={(event) => update({ building: event.target.value, apartment: "" })}
        >
          <option value="">{he.board.allBuildings}</option>
          {buildings.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </FilterSelect>

        {/* דירה — פעילה רק אחרי בחירת בניין (הרשימה תלוית-בניין) */}
        <FilterSelect
          key={`apartment-${syncKey}`}
          aria-label={he.directory.apartment}
          defaultValue={params.get("apartment") ?? ""}
          disabled={apartments.length === 0}
          onChange={(event) => update({ apartment: event.target.value })}
        >
          <option value="">{he.search.allApartments}</option>
          {apartments.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect
          key={`domain-${syncKey}`}
          aria-label={he.directory.domain}
          defaultValue={params.get("domain") ?? ""}
          onChange={(event) => update({ domain: event.target.value })}
        >
          <option value="">{he.board.allDomains}</option>
          {domains.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect
          key={`recipient-${syncKey}`}
          aria-label={he.directory.professional}
          defaultValue={params.get("recipient") ?? ""}
          onChange={(event) => update({ recipient: event.target.value })}
        >
          <option value="">{he.board.allRecipients}</option>
          {recipients.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect
          key={`tag-${syncKey}`}
          aria-label={he.tag.label}
          defaultValue={params.get("tag") ?? ""}
          onChange={(event) => update({ tag: event.target.value })}
        >
          <option value="">{he.board.allTags}</option>
          {tags.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect
          key={`status-${syncKey}`}
          aria-label={he.search.allStatuses}
          defaultValue={params.get("status") ?? ""}
          onChange={(event) => update({ status: event.target.value })}
        >
          <option value="">{he.search.allStatuses}</option>
          {statuses.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </FilterSelect>

        {/* ‏`w-auto` על שדות התאריך: כמו הבוררים, גם הם ברצועה ולא בטופס. */}
        <label className="flex items-center gap-1 text-sm">
          {he.search.from}
          <Input
            key={`from-${syncKey}`}
            type="date"
            defaultValue={params.get("from") ?? ""}
            onChange={(event) => update({ from: event.target.value })}
            size="compact"
            className="w-auto"
          />
        </label>

        <label className="flex items-center gap-1 text-sm">
          {he.search.to}
          <Input
            key={`to-${syncKey}`}
            type="date"
            defaultValue={params.get("to") ?? ""}
            onChange={(event) => update({ to: event.target.value })}
            size="compact"
            className="w-auto"
          />
        </label>
      </FilterBar>
    </div>
  );
}
