"use client";

import { useState } from "react";
import { LearnedSelect } from "@/components/learned-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { he } from "@/lib/he";
import type { SelectOption } from "@/lib/options";
import { useAction } from "@/lib/use-action";
import { TITLE_DESCRIPTIVE, ROW_LIST} from "@/lib/ui";
import { cardClasses } from "@/components/ui/card";
import { chipClasses } from "@/components/ui/chip";
import {
  getTagContractorLinkAction,
  grantTagAccessAction,
  revokeTagAccessAction,
} from "../actions";
import { Banner, FormError } from "@/components/ui/message";

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
  // ‏`busy` ולא `running`: המסך הזה **ויתר עד היום על בדיקת ה-hydration** —
  // הוא נעל את הכפתורים על `pending` בלבד, כלומר לחיצה לפני חיבור המטפלים
  // נבלעה בשקט. זו בדיוק הנפרדות ש-`useAction` נוצר כדי לסגור.
  const { busy, error, run } = useAction();

  const pendingIds = new Set(pending.map((p) => p.id));
  const available = candidates.filter((c) => !pendingIds.has(c.id));

  function stage(id: string | null) {
    const option = candidates.find((c) => c.id === id);
    if (option && !pendingIds.has(option.id)) setPending((current) => [...current, option]);
  }

  function grant() {
    if (pending.length === 0) return;
    setNotice(null);
    const ids = pending.map((p) => p.id);
    run(
      () => grantTagAccessAction(tagId, ids),
      (opened) => {
        setNotice(he.tag.openedNotice(opened));
        setPending([]);
      },
    );
  }

  function revoke(professionalId: string) {
    setNotice(null);
    run(() => revokeTagAccessAction(tagId, professionalId));
  }

  function showLink(professionalId: string) {
    run(
      () => getTagContractorLinkAction(tagId, professionalId),
      (url) => setLinks((current) => ({ ...current, [professionalId]: url })),
    );
  }

  return (
    <section className={cardClasses("flex flex-col gap-2")}>
      <h2 className={TITLE_DESCRIPTIVE}>{he.tag.accessHeading}</h2>

      {granted.length === 0 ? (
        <p className="text-sm text-muted">{he.tag.accessNobody}</p>
      ) : (
        <ul className={ROW_LIST}>
          {granted.map((contractor) => (
            <li key={contractor.id} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={chipClasses("brand", "soft", "large")}>
                  {contractor.label}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => revoke(contractor.id)}
                    aria-label={`${he.tag.revoke} ${contractor.label}`}
                    // ‏`opacity-60` ולא 50: זו רצפת ה-`disabled` של `Button`
                    // ‏(`BASE` ב-button.tsx), וכאן היא נכתבה מהזיכרון וסטתה.
                    className="px-1 text-base leading-none disabled:opacity-60"
                  >
                    ×
                  </button>
                </span>
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={busy}
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

      <div className="flex flex-col gap-2 border-t border-border pt-2">
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
          <Button disabled={busy} onClick={grant} className="self-start">
            {he.tag.grant}
          </Button>
        ) : null}

        {notice ? (
          <Banner tone="success">{notice}</Banner>
        ) : null}
        {error ? (
          <FormError>
            {error}
          </FormError>
        ) : null}
      </div>
    </section>
  );
}
