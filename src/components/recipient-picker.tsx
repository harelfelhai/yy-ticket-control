"use client";

import { useState } from "react";
import { he } from "@/lib/he";
import { LearnedSelect, type LearnedOption } from "./learned-select";

export interface RecipientOption extends LearnedOption {
  kind: "professional" | "user";
}

interface RecipientPickerProps {
  options: RecipientOption[];
  value: RecipientOption[];
  onChange: (recipients: RecipientOption[]) => void;
  onCreateProfessional: (input: {
    name: string;
    phone: string;
    email: string;
  }) => Promise<RecipientOption>;
}

/**
 * בורר הנמענים (מסך 3 באפיון), בשימוש גם ביצירת פנייה וגם בעריכת נמענים.
 *
 * שיוך מרובה הוא ליבת המערכת: אותה תקלה עשויה לדרוש חשמלאי ואינסטלטור,
 * ולכל אחד מהם סטטוס משלו. לכן הנמענים מוצגים כרשימת צ׳יפים הניתנת להסרה
 * ולא כשדה יחיד.
 *
 * יצירת איש מקצוע חדש היא טופס נפרד ולא שורת "צור חדש" בתוך הרשימה, כי
 * איש מקצוע דורש גם טלפון או מייל — בלעדיהם אי אפשר לשגר אליו כלל.
 */
export function RecipientPicker({
  options,
  value,
  onChange,
  onCreateProfessional,
}: RecipientPickerProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedIds = new Set(value.map((r) => `${r.kind}:${r.id}`));
  const available = options.filter((o) => !selectedIds.has(`${o.kind}:${o.id}`));

  function add(id: string | null) {
    const option = options.find((o) => o.id === id);
    if (option) onChange([...value, option]);
  }

  function remove(recipient: RecipientOption) {
    onChange(value.filter((r) => !(r.id === recipient.id && r.kind === recipient.kind)));
  }

  async function submitNewProfessional() {
    setBusy(true);
    setError(null);
    try {
      const created = await onCreateProfessional({ name, phone, email });
      onChange([...value, created]);
      setName("");
      setPhone("");
      setEmail("");
      setShowCreate(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : he.common.genericError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 ? (
        <ul aria-label={he.ticket.recipients} className="flex flex-wrap gap-2">
          {value.map((recipient) => (
            <li key={`${recipient.kind}:${recipient.id}`}>
              <span className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-sm text-brand-fg">
                {recipient.label}
                <button
                  type="button"
                  onClick={() => remove(recipient)}
                  aria-label={`${he.ticket.removeRecipient} ${recipient.label}`}
                  className="px-1 text-base leading-none"
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <LearnedSelect
        label={he.ticket.recipients}
        options={available}
        value={null}
        onChange={add}
        placeholder={he.ticket.addRecipient}
      />

      {showCreate ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {he.directory.professionalName}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-h-11 rounded-lg border border-border px-3 text-base font-normal"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {he.directory.phone}
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                dir="ltr"
                inputMode="tel"
                className="min-h-11 rounded-lg border border-border px-3 text-base font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {he.directory.email}
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                dir="ltr"
                inputMode="email"
                className="min-h-11 rounded-lg border border-border px-3 text-base font-normal"
              />
            </label>
          </div>

          {/* הכלל מוצג מראש ולא רק ככשל, כי בלי אחד מהשניים אי אפשר לשגר כלל */}
          <p className="text-xs text-muted">{he.directory.contactRequiredHint}</p>

          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitNewProfessional}
              disabled={busy}
              className="min-h-11 flex-1 rounded-xl bg-brand px-4 font-medium text-brand-fg disabled:opacity-60"
            >
              {he.directory.saveProfessional}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="min-h-11 rounded-xl border border-border px-4"
            >
              {he.common.cancel}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="min-h-11 self-start px-1 text-start font-medium text-brand"
        >
          {he.directory.newProfessional}
        </button>
      )}
    </div>
  );
}
