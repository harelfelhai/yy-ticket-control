"use client";

import { useState, useTransition } from "react";
import { LearnedSelect } from "@/components/learned-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { he } from "@/lib/he";
import type { SelectOption } from "@/lib/options";
import { TITLE_DESCRIPTIVE } from "@/lib/ui";
import { cardClasses } from "@/components/ui/card";
import { chipClasses } from "@/components/ui/chip";
import {
  getTagContractorLinkAction,
  grantTagAccessAction,
  revokeTagAccessAction,
} from "../actions";

interface TagAccessControlProps {
  tagId: string;
  granted: SelectOption[];
  candidates: SelectOption[];
}

/**
 * "מי רואה את הצ׳אט" — פתיחת התגית לקבלנים וביטול הגישה (מסך 6).
 *
 * זו הפעולה שחושפת צ׳אט לגורם חיצוני, ולכן היא מכוונת ומפורשת: המנהל בונה
 * רשימת קבלנים ואז לוחץ "פתח", ואחריה מוצג נוסח האישור מהאפיון — המבהיר
 * שנחשף הצ׳אט בלבד ולא הפניות. האזהרה מופיעה גם *לפני* הבחירה.
 */
export function TagAccessControl({ tagId, granted, candidates }: TagAccessControlProps) {
  const [pending, setPending] = useState<SelectOption[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, startTransition] = useTransition();

  const pendingIds = new Set(pending.map((p) => p.id));
  const available = candidates.filter((c) => !pendingIds.has(c.id));

  function stage(id: string | null) {
    const option = candidates.find((c) => c.id === id);
    if (option && !pendingIds.has(option.id)) setPending((current) => [...current, option]);
  }

  function grant() {
    if (pending.length === 0) return;
    setError(null);
    setNotice(null);
    const ids = pending.map((p) => p.id);
    startTransition(async () => {
      const result = await grantTagAccessAction(tagId, ids);
      if (result.ok) {
        setNotice(he.tag.openedNotice(result.data));
        setPending([]);
      } else {
        setError(result.error);
      }
    });
  }

  function revoke(professionalId: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await revokeTagAccessAction(tagId, professionalId);
      if (!result.ok) setError(result.error);
    });
  }

  function showLink(professionalId: string) {
    setError(null);
    startTransition(async () => {
      const result = await getTagContractorLinkAction(tagId, professionalId);
      if (result.ok) setLinks((current) => ({ ...current, [professionalId]: result.data }));
      else setError(result.error);
    });
  }

  return (
    <section className={cardClasses("flex flex-col gap-3")}>
      <h2 className={TITLE_DESCRIPTIVE}>{he.tag.accessHeading}</h2>

      {granted.length === 0 ? (
        <p className="text-sm text-muted">{he.tag.accessNobody}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {granted.map((contractor) => (
            <li key={contractor.id} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={chipClasses("brand", "soft", "large")}>
                  {contractor.label}
                  <button
                    type="button"
                    disabled={running}
                    onClick={() => revoke(contractor.id)}
                    aria-label={`${he.tag.revoke} ${contractor.label}`}
                    className="px-1 text-base leading-none disabled:opacity-50"
                  >
                    ×
                  </button>
                </span>
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={running}
                  onClick={() => showLink(contractor.id)}
                  aria-label={`${he.ticket.showLink} ${contractor.label}`}
                >
                  {he.ticket.showLink}
                </Button>
              </div>
              {links[contractor.id] ? (
                <Input
                  readOnly
                  dir="ltr"
                  value={links[contractor.id]}
                  aria-label={he.tag.chatLinkFor(contractor.label)}
                  onFocus={(e) => e.currentTarget.select()}
                  size="compact"
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <p className="text-xs text-muted">{he.tag.openHint}</p>

        {pending.length > 0 ? (
          <ul aria-label={he.tag.openToContractors} className="flex flex-wrap gap-2">
            {pending.map((contractor) => (
              <li key={contractor.id}>
                <span className={chipClasses("brand", "solid", "large")}>
                  {contractor.label}
                  <button
                    type="button"
                    onClick={() =>
                      setPending((current) => current.filter((p) => p.id !== contractor.id))
                    }
                    aria-label={`${he.ticket.removeRecipient} ${contractor.label}`}
                    className="px-1 text-base leading-none"
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {available.length > 0 ? (
          <LearnedSelect
            label={he.tag.openToContractors}
            options={available}
            value={null}
            onChange={stage}
          />
        ) : null}

        {pending.length > 0 ? (
          <Button disabled={running} onClick={grant} className="self-start">
            {he.tag.grant}
          </Button>
        ) : null}

        {notice ? (
          <p className="rounded-xl bg-success/10 p-3 text-sm font-medium text-success">{notice}</p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
