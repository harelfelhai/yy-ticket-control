"use client";

import { useState } from "react";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/he";
import { useAction } from "@/lib/use-action";
import { renameDomainAction } from "../actions";
import { cardClasses } from "@/components/ui/card";
import { FormError } from "@/components/ui/message";

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
  const { busy, error, run } = useAction();

  const dirty = name.trim() !== domain.name && name.trim().length > 0;

  function save() {
    run(() => renameDomainAction(domain.id, name));
  }

  return (
    <li className={cardClasses("flex flex-col gap-1", { padding: "compact" })}>
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
          disabled={busy || !dirty}
        >
          {he.admin.renameDomain}
        </Button>
      </div>
      {error ? (
        <FormError>
          {error}
        </FormError>
      ) : null}
    </li>
  );
}
