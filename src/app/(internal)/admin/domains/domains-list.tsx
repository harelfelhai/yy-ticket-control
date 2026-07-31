"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/he";
import { useHydrated } from "@/lib/use-hydrated";
import { renameDomainAction } from "../actions";

interface DomainRow {
  id: string;
  name: string;
}

/**
 * רשימת התחומים עם שינוי שם בשורה.
 *
 * שינוי שם קיים כדי לתקן שגיאת הקלדה שיצרה תחום כמעט-כפול. איחוד תחומים
 * אינו בתחולה, ולכן שינוי לשם שכבר קיים נדחה — וזה מוצג למשתמש.
 */
export function DomainsList({ domains }: { domains: DomainRow[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {domains.map((domain) => (
        <DomainItem key={domain.id} domain={domain} />
      ))}
    </ul>
  );
}

function DomainItem({ domain }: { domain: DomainRow }) {
  const [name, setName] = useState(domain.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();

  const dirty = name.trim() !== domain.name && name.trim().length > 0;

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await renameDomainAction(domain.id, name);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <li className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={domain.name}
          size="compact"
          className="flex-1"
        />
        <Button
          variant="secondary"
          size="compact"
          onClick={save}
          disabled={pending || !hydrated || !dirty}
        >
          {he.admin.renameDomain}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}
