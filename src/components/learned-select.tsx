"use client";

import { useId, useMemo, useRef, useState } from "react";
import { he } from "@/lib/he";
import { normalizeName } from "@/lib/normalize";
import type { SelectOption } from "@/lib/options";
import { useHydrated } from "@/lib/use-hydrated";

export type LearnedOption = SelectOption;

interface LearnedSelectProps {
  label: string;
  options: LearnedOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** ללא הפרופ הזה הרשימה סגורה ואי אפשר להוסיף אליה ערכים */
  onCreate?: (name: string) => Promise<LearnedOption>;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * בורר לרשימה נלמדת: בחירה מתוך הקיים, ויצירת ערך חדש כפעולה נפרדת ומכוונת.
 *
 * זו ההגנה השלישית מול כפילויות (שתי הראשונות הן נרמול ו-upsert בשרת).
 * האפיון דורש במפורש "רשימת בחירה קצרה של הערכים הקיימים, לא שדה טקסט" —
 * כי בשדה טקסט חופשי כל שגיאת הקלדה יוצרת בניין חדש, וההפרדה בין "בניין א"
 * ל-"בניין א'" מפצלת דוחות ותגיות בלי שאיש שם לב.
 *
 * לכן: המסלול הקל הוא בחירה בקיים. יצירה דורשת לחיצה על שורה שכתוב בה
 * במפורש `צור חדש: "..."`.
 */
export function LearnedSelect({
  label,
  options,
  value,
  onChange,
  onCreate,
  placeholder,
  disabled,
}: LearnedSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydrated = useHydrated();
  const listId = useId();
  const labelId = `${listId}-label`;
  const valueId = `${listId}-value`;
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.id === value) ?? null;
  const trimmedQuery = normalizeName(query);

  const filtered = useMemo(() => {
    if (!trimmedQuery) return options;
    return options.filter((o) => o.label.includes(trimmedQuery));
  }, [options, trimmedQuery]);

  // מציעים יצירה רק כשאין התאמה מדויקת. הצעה לצד ערך זהה קיים היא בדיוק
  // הרגע שבו נוצרת הכפילות.
  const exactMatch = options.some((o) => normalizeName(o.label) === trimmedQuery);
  const canCreate = Boolean(onCreate) && trimmedQuery.length > 0 && !exactMatch;

  function close() {
    setOpen(false);
    setQuery("");
    setError(null);
  }

  async function handleCreate() {
    if (!onCreate || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await onCreate(trimmedQuery);
      onChange(created.id);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : he.common.genericError);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-sm font-medium">
        {label}
      </span>

      <button
        type="button"
        // מושבת עד ל-hydration: בלי זה לחיצה מוקדמת נבלעת בשקט.
        disabled={disabled || !hydrated}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        // השם הנגיש מורכב מהתווית ומהערך הנבחר. בלי זה הכפתור נקרא "בחר"
        // בלבד, וגם קורא מסך וגם בדיקה אוטומטית אינם יודעים איזה שדה זה.
        aria-labelledby={`${labelId} ${valueId}`}
        onClick={() => {
          setOpen((v) => !v);
          // מיקוד מושהה: הפאנל עדיין לא ב-DOM ברגע הלחיצה.
          setTimeout(() => searchRef.current?.focus(), 0);
        }}
        className="flex min-h-12 items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 text-start text-base disabled:opacity-50"
      >
        <span id={valueId} className={selected ? "" : "text-muted"}>
          {selected?.label ?? placeholder ?? he.common.choose}
        </span>
        <span aria-hidden className="text-muted">
          ▾
        </span>
      </button>

      {open ? (
        <div className="rounded-xl border border-border bg-surface p-2">
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={he.common.search}
            aria-label={`${he.common.search} ${label}`}
            className="mb-2 min-h-11 w-full rounded-lg border border-border px-3 text-base"
          />

          <ul id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto">
            {filtered.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.id === value}
                  onClick={() => {
                    onChange(option.id);
                    close();
                  }}
                  className={`flex min-h-11 w-full flex-col justify-center rounded-lg px-3 text-start ${
                    option.id === value ? "bg-brand text-brand-fg" : ""
                  }`}
                >
                  <span>{option.label}</span>
                  {option.hint ? (
                    <span
                      dir="ltr"
                      className={`text-xs ${option.id === value ? "opacity-80" : "text-muted"}`}
                    >
                      {option.hint}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}

            {filtered.length === 0 && !canCreate ? (
              <li className="px-3 py-2 text-sm text-muted">{he.common.noResults}</li>
            ) : null}
          </ul>

          {canCreate ? (
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="mt-1 min-h-11 w-full rounded-lg border border-dashed border-brand px-3 text-start font-medium text-brand disabled:opacity-60"
            >
              {he.directory.createNew(trimmedQuery)}
            </button>
          ) : null}

          {error ? (
            <p role="alert" className="mt-2 px-1 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
