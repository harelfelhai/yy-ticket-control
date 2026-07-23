"use client";

import { useState } from "react";
import { LearnedSelect } from "@/components/learned-select";
import { he } from "@/lib/he";
import type { SelectOption } from "@/lib/options";
import { addTicketTagAction, removeTicketTagAction } from "./actions";

interface TicketTagsProps {
  ticketId: string;
  initial: SelectOption[];
  all: SelectOption[];
  canEdit: boolean;
}

/**
 * תגיות הפנייה במסך הפנייה (אפיון §3.2 שדה 12: "הפותח או כל מנהל, בכל עת").
 *
 * התגית נלמדת, ולכן הבורר מאפשר גם בחירה בקיימת וגם יצירה של חדשה — שני
 * המסלולים מובילים לאותה פעולת שרת (`addTicketTagAction`), שממילא עושה
 * find-or-create לפי שם. כפילות נמנעת בכך שהוספה של תגית שכבר מחוברת
 * מדולגת בצד הלקוח.
 *
 * למי שאינו רשאי לערוך התגיות מוצגות לקריאה בלבד — הן חלק מזהות הפנייה,
 * לא רק כלי של מי שיצר אותה.
 */
export function TicketTags({ ticketId, initial, all, canEdit }: TicketTagsProps) {
  const [tags, setTags] = useState<SelectOption[]>(initial);
  const [error, setError] = useState<string | null>(null);

  const attached = new Set(tags.map((t) => t.id));
  const available = all.filter((t) => !attached.has(t.id));

  /** מוסיף תגית לפי שם — הן ליצירה חדשה והן לבחירה בקיימת */
  async function attach(name: string): Promise<SelectOption> {
    setError(null);
    const result = await addTicketTagAction(ticketId, name);
    if (!result.ok) {
      setError(result.error);
      throw new Error(result.error);
    }
    // מוסיפים רק אם אינה כבר ברשימה: LearnedSelect קורא ל-onChange מיד אחרי
    // onCreate עם אותה תגית, ובלי הבדיקה היא הייתה מופיעה פעמיים.
    setTags((current) =>
      current.some((t) => t.id === result.data.id) ? current : [...current, result.data],
    );
    return result.data;
  }

  function selectExisting(id: string | null) {
    if (!id || attached.has(id)) return;
    const option = all.find((t) => t.id === id);
    if (option) void attach(option.label);
  }

  async function remove(tagId: string) {
    setError(null);
    setTags((current) => current.filter((t) => t.id !== tagId));
    const result = await removeTicketTagAction(ticketId, tagId);
    if (!result.ok) setError(result.error);
  }

  if (!canEdit && tags.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold">{he.tag.label}</h2>

      {tags.length > 0 ? (
        <ul aria-label={he.tag.label} className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li key={tag.id}>
              <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-3 py-1.5 text-sm text-brand">
                {tag.label}
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => remove(tag.id)}
                    aria-label={`${he.tag.remove} ${tag.label}`}
                    className="px-1 text-base leading-none"
                  >
                    ×
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{he.tag.none}</p>
      )}

      {canEdit ? (
        <LearnedSelect
          label={he.tag.add}
          options={available}
          value={null}
          onChange={selectExisting}
          onCreate={attach}
          placeholder={he.tag.add}
        />
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
