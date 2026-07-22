"use client";

import { useMemo, useState, useTransition } from "react";
import { LearnedSelect, type LearnedOption } from "@/components/learned-select";
import { RecipientPicker, type RecipientOption } from "@/components/recipient-picker";
import type { Room } from "@/generated/prisma/enums";
import { he } from "@/lib/he";
import {
  type ActionResult,
  type DirectoryOption,
  createApartmentAction,
  createBuildingAction,
  createDomainAction,
  createProfessionalAction,
  createTicketAction,
} from "./actions";

/**
 * הופך תוצאת פעולה לערך או לחריגה.
 *
 * ה-Server Actions מחזירות שגיאות כערך (כי Next מצנזר הודעות של חריגות
 * בפרודקשן), בעוד שהבוררים מצפים לחריגה כדי להציג את ההודעה במקום.
 * ההמרה מרוכזת כאן ולא משוכפלת בכל קריאה.
 */
function unwrap(result: ActionResult<DirectoryOption>): DirectoryOption {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export interface BuildingWithApartments extends LearnedOption {
  apartments: LearnedOption[];
}

interface CreateTicketFormProps {
  siteId: string;
  siteName: string;
  buildings: BuildingWithApartments[];
  domains: LearnedOption[];
  recipients: RecipientOption[];
}

const ROOMS: Room[] = [
  "SALON",
  "KITCHEN",
  "BEDROOM",
  "BATHROOM",
  "WC",
  "BALCONY",
  "MAMAD",
  "STAIRWELL",
  "PARKING",
  "LOBBY",
  "COMMON",
];

/**
 * מסך יצירת פנייה מהירה (מסך 4 באפיון).
 *
 * מסך אחד ולא אשף רב-שלבי, במכוון: מנהל עבודה עומד מול הדירה ומזין ביד
 * אחת. כל מעבר מסך הוא הזדמנות לאבד את מה שהוקלד.
 *
 * הרשימות שנוצרות תוך כדי (בניין חדש, תחום חדש) נוספות למצב המקומי מיד,
 * כדי שהבחירה תמשיך בלי רענון של כל המסך.
 */
export function CreateTicketForm({
  siteId,
  siteName,
  buildings: initialBuildings,
  domains: initialDomains,
  recipients: recipientOptions,
}: CreateTicketFormProps) {
  const [buildings, setBuildings] = useState(initialBuildings);
  const [domains, setDomains] = useState(initialDomains);
  const [availableRecipients, setAvailableRecipients] = useState(recipientOptions);

  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [apartmentId, setApartmentId] = useState<string | null>(null);
  const [domainId, setDomainId] = useState<string | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [recipients, setRecipients] = useState<RecipientOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedBuilding = buildings.find((b) => b.id === buildingId) ?? null;

  const roomOptions = useMemo(
    () => ROOMS.map((value) => ({ id: value, label: he.room[value] })),
    [],
  );

  function submit(saveAsDraft: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await createTicketAction({
        siteId,
        buildingId,
        apartmentId,
        domainId,
        room: (room as Room | null) ?? null,
        description,
        recipients: recipients.map((r) => ({ kind: r.kind, id: r.id })),
        saveAsDraft,
      });
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-bold">{he.ticket.createTitle}</h1>
        <p className="text-sm text-muted">
          {he.ticket.site}: {siteName}
        </p>
      </div>

      <LearnedSelect
        label={he.directory.building}
        options={buildings}
        value={buildingId}
        onChange={(id) => {
          setBuildingId(id);
          // איפוס הדירה: דירה 7 בבניין א׳ אינה דירה 7 בבניין ב׳, והשארת
          // הבחירה הקודמת הייתה משייכת את הפנייה לדירה הלא נכונה בשקט.
          setApartmentId(null);
        }}
        onCreate={async (name) => {
          const created = unwrap(await createBuildingAction(siteId, name));
          setBuildings((prev) => [...prev, { ...created, apartments: [] }]);
          return created;
        }}
      />

      <LearnedSelect
        label={he.directory.apartment}
        options={selectedBuilding?.apartments ?? []}
        value={apartmentId}
        onChange={setApartmentId}
        disabled={!selectedBuilding}
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

      <LearnedSelect
        label={he.directory.domain}
        options={domains}
        value={domainId}
        onChange={setDomainId}
        onCreate={async (name) => {
          const created = unwrap(await createDomainAction(siteId, name));
          setDomains((prev) => [...prev, created]);
          return created;
        }}
      />

      {/* רשימה קבועה שאינה נלמדת (אפיון §3.3) — ולכן בלי onCreate */}
      <LearnedSelect
        label={`${he.ticket.room} (${he.common.optional})`}
        options={roomOptions}
        value={room}
        onChange={setRoom}
      />

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{he.ticket.description}</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className="rounded-xl border border-border bg-surface p-3 text-base"
        />
      </label>

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

      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}

      <div className="sticky bottom-0 flex gap-2 border-t border-border bg-bg py-3">
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={pending}
          className="min-h-12 flex-1 rounded-xl bg-brand px-4 text-base font-semibold text-brand-fg disabled:opacity-60"
        >
          {he.ticket.submit}
        </button>
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={pending}
          className="min-h-12 rounded-xl border border-border bg-surface px-4 text-base font-medium disabled:opacity-60"
        >
          {he.ticket.saveDraft}
        </button>
      </div>
    </div>
  );
}
