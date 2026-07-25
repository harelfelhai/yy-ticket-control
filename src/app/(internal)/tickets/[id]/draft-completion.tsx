"use client";

import { useState, useTransition } from "react";
import { LearnedSelect, type LearnedOption } from "@/components/learned-select";
import { RecipientPicker, type RecipientOption } from "@/components/recipient-picker";
import type { ActionResult } from "@/lib/action-result";
import { he } from "@/lib/he";
import type { SelectOption } from "@/lib/options";
import { useHydrated } from "@/lib/use-hydrated";
import {
  createApartmentAction,
  createBuildingAction,
  createDomainAction,
  createProfessionalAction,
} from "../new/actions";
import { deleteDraftAction, submitDraftAction, updateTicketFieldsAction } from "./actions";

/**
 * השלמת טיוטה ושיגורה (מסך 7 באפיון).
 *
 * מוצג בראש מסך הפנייה כשהיא טיוטה, מסומן באדום, ומציג **רק את השדות
 * החסרים** — כדי שמנהל העבודה יראה בדיוק מה נותר להשלים ולא ימלא מחדש מה
 * שכבר קיים. השיגור הוא שני שלבים: קודם שומרים את השדות שמולאו
 * (`updateTicketFieldsAction`), ואז משגרים (`submitDraftAction`) — כך אם
 * חסר עדיין משהו, מה שהוקלד לא הולך לאיבוד.
 */

export interface BuildingWithApartments extends LearnedOption {
  apartments: LearnedOption[];
}

export interface DraftMissing {
  building: boolean;
  apartment: boolean;
  domain: boolean;
  description: boolean;
  recipients: boolean;
}

interface DraftCompletionProps {
  ticketId: string;
  siteId: string;
  buildings: BuildingWithApartments[];
  domains: LearnedOption[];
  recipientOptions: RecipientOption[];
  /** ערכים קיימים בטיוטה, לטעינה מראש */
  initial: {
    buildingId: string | null;
    apartmentId: string | null;
    domainId: string | null;
    recipients: RecipientOption[];
  };
  missing: DraftMissing;
}

function unwrap(result: ActionResult<SelectOption>): SelectOption {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export function DraftCompletion({
  ticketId,
  siteId,
  buildings: initialBuildings,
  domains: initialDomains,
  recipientOptions,
  initial,
  missing,
}: DraftCompletionProps) {
  const [buildings, setBuildings] = useState(initialBuildings);
  const [domains, setDomains] = useState(initialDomains);
  const [availableRecipients, setAvailableRecipients] = useState(recipientOptions);

  const [buildingId, setBuildingId] = useState(initial.buildingId);
  const [apartmentId, setApartmentId] = useState(initial.apartmentId);
  const [domainId, setDomainId] = useState(initial.domainId);
  const [description, setDescription] = useState("");
  const [recipients, setRecipients] = useState<RecipientOption[]>(initial.recipients);

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const busy = pending || !hydrated;

  const selectedBuilding = buildings.find((b) => b.id === buildingId) ?? null;
  // אם צריך לבחור בניין, ממילא צריך גם דירה תחתיו — הן זוג.
  const showBuilding = missing.building;
  const showApartment = missing.apartment || missing.building;

  function submit() {
    setError(null);
    startTransition(async () => {
      // שלב 1: שמירת השדות שמולאו. רק שדות שהמסך הציג ושבאמת נבחרו.
      const fields: {
        buildingId?: string;
        apartmentId?: string;
        domainId?: string;
        description?: string;
      } = {};
      if (showBuilding && buildingId) fields.buildingId = buildingId;
      if (showApartment && apartmentId) fields.apartmentId = apartmentId;
      if (missing.domain && domainId) fields.domainId = domainId;
      if (missing.description && description.trim()) fields.description = description;

      if (Object.keys(fields).length > 0) {
        const saved = await updateTicketFieldsAction(ticketId, fields);
        if (!saved.ok) {
          setError(saved.error);
          return;
        }
      }

      // שלב 2: שיגור. אם עדיין חסר משהו, השירות יחזיר בדיוק מה — וללא אובדן.
      const sent = await submitDraftAction(
        ticketId,
        recipients.map((r) => ({ kind: r.kind, id: r.id })),
      );
      if (!sent.ok) setError(sent.error);
    });
  }

  function remove() {
    if (!window.confirm(he.ticket.confirmDeleteDraft)) return;
    setError(null);
    startTransition(async () => {
      // מצליח → deleteDraftAction מנווט ללוח; חוזר רק במקרה שגיאה.
      const result = await deleteDraftAction(ticketId);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-danger bg-danger/5 p-4">
      <p className="text-sm font-semibold text-danger">{he.notices.draftBanner}</p>

      {showBuilding ? (
        <LearnedSelect
          label={he.directory.building}
          options={buildings}
          value={buildingId}
          onChange={(id) => {
            setBuildingId(id);
            setApartmentId(null);
          }}
          disabled={busy}
          onCreate={async (name) => {
            const created = unwrap(await createBuildingAction(siteId, name));
            setBuildings((prev) => [...prev, { ...created, apartments: [] }]);
            return created;
          }}
        />
      ) : null}

      {showApartment ? (
        <LearnedSelect
          label={he.directory.apartment}
          options={selectedBuilding?.apartments ?? []}
          value={apartmentId}
          onChange={setApartmentId}
          disabled={busy || !selectedBuilding}
          placeholder={selectedBuilding ? undefined : he.ticket.chooseBuildingFirst}
          onCreate={
            selectedBuilding
              ? async (number) => {
                  const created = unwrap(
                    await createApartmentAction(siteId, selectedBuilding.id, number),
                  );
                  setBuildings((prev) =>
                    prev.map((b) =>
                      b.id === selectedBuilding.id
                        ? { ...b, apartments: [...b.apartments, created] }
                        : b,
                    ),
                  );
                  return created;
                }
              : undefined
          }
        />
      ) : null}

      {missing.domain ? (
        <LearnedSelect
          label={he.directory.domain}
          options={domains}
          value={domainId}
          onChange={setDomainId}
          disabled={busy}
          onCreate={async (name) => {
            const created = unwrap(await createDomainAction(siteId, name));
            setDomains((prev) => [...prev, created]);
            return created;
          }}
        />
      ) : null}

      {missing.description ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{he.ticket.description}</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="rounded-xl border border-border bg-surface p-3 text-base"
          />
        </label>
      ) : null}

      {missing.recipients ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{he.ticket.recipients}</span>
          <RecipientPicker
            options={availableRecipients}
            value={recipients}
            onChange={setRecipients}
            onCreateProfessional={async (input) => {
              const created = unwrap(await createProfessionalAction(siteId, input));
              const option: RecipientOption = { ...created, kind: "professional" };
              setAvailableRecipients((prev) => [...prev, option]);
              return option;
            }}
          />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="min-h-12 flex-1 rounded-xl bg-brand px-4 text-base font-semibold text-brand-fg disabled:opacity-60"
        >
          {he.ticket.submitDraftButton}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="min-h-12 rounded-xl border border-danger px-4 text-base font-medium text-danger disabled:opacity-60"
        >
          {he.ticket.deleteDraft}
        </button>
      </div>
    </section>
  );
}
