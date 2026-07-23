"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { LearnedSelect, type LearnedOption } from "@/components/learned-select";
import { type AttachedFile, MediaPicker } from "@/components/media-picker";
import { RecipientPicker, type RecipientOption } from "@/components/recipient-picker";
import type { Room } from "@/generated/prisma/enums";
import type { ActionResult } from "@/lib/action-result";
import { he } from "@/lib/he";
import type { SelectOption } from "@/lib/options";
import { ROOMS } from "@/lib/rooms";
import { useHydrated } from "@/lib/use-hydrated";
import type { BatchResult } from "@/lib/services/batch";
import {
  createApartmentAction,
  createBuildingAction,
  createDomainAction,
  createProfessionalAction,
} from "../new/actions";
import { createBatchAction } from "./actions";

interface BuildingWithApartments extends LearnedOption {
  apartments: LearnedOption[];
}

interface BatchFormProps {
  siteId: string;
  siteName: string;
  buildings: BuildingWithApartments[];
  domains: LearnedOption[];
  recipients: RecipientOption[];
}

interface RowState {
  key: number;
  description: string;
  domainId: string | null;
  room: string | null;
  recipient: RecipientOption | null;
}

function unwrap(result: ActionResult<SelectOption>): SelectOption {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

/**
 * מסך ההזנה המרוכזת (מסך 5).
 *
 * בניין, דירה ותגית נקבעים פעם אחת ומשותפים לכל השורות; כל שורה היא פנייה.
 * דוח המקור מוצג בצד כהקשר קבוע. אין כאן שמירה מקומית לדפדפן כמו במסך
 * היצירה — זהו מסך משרד בדסקטופ, לא הזנה ביד אחת בשטח.
 */
export function BatchForm({
  siteId,
  siteName,
  buildings: initialBuildings,
  domains: initialDomains,
  recipients: initialRecipients,
}: BatchFormProps) {
  const [buildings, setBuildings] = useState(initialBuildings);
  const [domains, setDomains] = useState(initialDomains);
  const [availableRecipients, setAvailableRecipients] = useState(initialRecipients);

  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [apartmentId, setApartmentId] = useState<string | null>(null);
  const [tagName, setTagName] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);

  const nextKey = useRef(3);
  const [rows, setRows] = useState<RowState[]>(() => [emptyRow(0), emptyRow(1), emptyRow(2)]);

  const [summary, setSummary] = useState<BatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const busy = pending || !hydrated;

  const selectedBuilding = buildings.find((b) => b.id === buildingId) ?? null;

  function emptyRow(key: number): RowState {
    return { key, description: "", domainId: null, room: null, recipient: null };
  }

  function addRow() {
    setRows((current) => [...current, emptyRow(nextKey.current++)]);
  }

  function removeRow(key: number) {
    setRows((current) => (current.length > 1 ? current.filter((r) => r.key !== key) : current));
  }

  function updateRow(key: number, patch: Partial<RowState>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function reset() {
    setSummary(null);
    setError(null);
    setTagName("");
    setFiles([]);
    setApartmentId(null);
    setRows([emptyRow(nextKey.current++), emptyRow(nextKey.current++), emptyRow(nextKey.current++)]);
  }

  function submit(dispatch: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await createBatchAction({
        siteId,
        buildingId: buildingId ?? "",
        apartmentId: apartmentId ?? "",
        tagName,
        sourceMediaIds: files.map((f) => f.mediaId),
        rows: rows.map((r) => ({
          description: r.description,
          domainId: r.domainId,
          room: (r.room as Room | null) ?? null,
          recipient: r.recipient ? { kind: r.recipient.kind, id: r.recipient.id } : null,
        })),
        dispatch,
      });

      if (result.ok) setSummary(result.data);
      else setError(result.error);
    });
  }

  if (summary) {
    return <Summary summary={summary} onReset={reset} />;
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-bold">{he.batch.title}</h1>
        <p className="text-sm text-muted">
          {he.ticket.site}: {siteName} · {he.batch.desktopHint}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* אזור המקור וההקשר המשותף — נשאר גלוי בגלילה בדסקטופ */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-16 lg:self-start">
          <section className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold">{he.batch.contextHeading}</h2>

            <LearnedSelect
              label={he.directory.building}
              options={buildings}
              value={buildingId}
              onChange={(id) => {
                setBuildingId(id);
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

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{he.batch.sharedTag}</span>
              <input
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                placeholder={he.batch.sharedTagPlaceholder}
                className="min-h-11 rounded-xl border border-border bg-surface px-3 text-base"
              />
            </label>
          </section>

          <section className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold">{he.batch.sourceHeading}</h2>
            <p className="text-xs text-muted">{he.batch.sourceHint}</p>
            <MediaPicker files={files} onChange={setFiles} disabled={busy} />
          </section>
        </aside>

        {/* טור ההזנה — שורה לכל ליקוי */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {he.batch.rowsHeading} · {rows.length}
            </h2>
            <button
              type="button"
              onClick={addRow}
              className="min-h-10 rounded-xl border border-border bg-surface px-4 text-sm font-medium"
            >
              {he.batch.addRow}
            </button>
          </div>

          {rows.map((row, index) => (
            <div
              key={row.key}
              role="group"
              aria-label={he.batch.rowNumber(index + 1)}
              className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted">
                  {he.batch.rowNumber(index + 1)}
                </span>
                {rows.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => removeRow(row.key)}
                    aria-label={`${he.batch.removeRow} ${index + 1}`}
                    className="min-h-8 px-2 text-sm text-danger"
                  >
                    {he.batch.removeRow}
                  </button>
                ) : null}
              </div>

              <label className="flex flex-col gap-1 text-sm font-medium">
                {he.batch.rowDescription}
                <input
                  value={row.description}
                  onChange={(e) => updateRow(row.key, { description: e.target.value })}
                  className="min-h-11 rounded-lg border border-border px-3 text-base font-normal"
                />
              </label>

              <div className="grid gap-2 sm:grid-cols-2">
                <LearnedSelect
                  label={he.batch.rowDomain}
                  options={domains}
                  value={row.domainId}
                  onChange={(id) => updateRow(row.key, { domainId: id })}
                  onCreate={async (name) => {
                    const created = unwrap(await createDomainAction(siteId, name));
                    setDomains((prev) => [...prev, created]);
                    return created;
                  }}
                />

                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">
                    {he.batch.rowRoom} ({he.common.optional})
                  </span>
                  <select
                    value={row.room ?? ""}
                    onChange={(e) => updateRow(row.key, { room: e.target.value || null })}
                    className="min-h-12 rounded-xl border border-border bg-surface px-3 text-base"
                  >
                    <option value="">{he.common.choose}</option>
                    {ROOMS.map((value) => (
                      <option key={value} value={value}>
                        {he.room[value]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{he.batch.rowRecipient}</span>
                <RecipientPicker
                  options={availableRecipients}
                  value={row.recipient ? [row.recipient] : []}
                  // בורר יחיד: לוקחים את האחרון שנבחר, כך שבחירה נוספת מחליפה.
                  onChange={(list) =>
                    updateRow(row.key, { recipient: list.length ? list[list.length - 1] : null })
                  }
                  onCreateProfessional={async (input) => {
                    const created = unwrap(await createProfessionalAction(siteId, input));
                    const option: RecipientOption = { ...created, kind: "professional" };
                    setAvailableRecipients((prev) => [...prev, option]);
                    return option;
                  }}
                />
              </div>
            </div>
          ))}

          {error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}

          <div className="sticky bottom-0 flex gap-2 border-t border-border bg-bg py-3">
            <button
              type="button"
              onClick={() => submit(true)}
              disabled={busy}
              className="min-h-12 flex-1 rounded-xl bg-brand px-4 text-base font-semibold text-brand-fg disabled:opacity-60"
            >
              {he.batch.dispatch}
            </button>
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={busy}
              className="min-h-12 rounded-xl border border-border bg-surface px-4 text-base font-medium disabled:opacity-60"
            >
              {he.batch.saveDraft}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** מסך הסיכום שאחרי השיגור, עם הנוסחים מהאפיון וקישור לתגית שנוצרה */
function Summary({ summary, onReset }: { summary: BatchResult; onReset: () => void }) {
  const lines: string[] = [];
  if (!summary.dispatched) {
    lines.push(he.batch.allDraft(summary.drafts));
  } else {
    if (summary.created > 0) lines.push(he.batch.created(summary.created, summary.professionals));
    if (summary.drafts > 0) lines.push(he.batch.draftsMissingRecipient(summary.drafts));
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-6">
      <h1 className="text-xl font-bold">{he.batch.title}</h1>
      <div className="flex flex-col gap-2 rounded-2xl border border-success/40 bg-success/10 p-4">
        {lines.map((line) => (
          <p key={line} className="font-medium text-success">
            {line}
          </p>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/tags/${summary.tagId}`}
          className="min-h-12 rounded-xl bg-brand px-6 text-base font-semibold leading-[3rem] text-brand-fg"
        >
          {he.batch.goToTag}
        </Link>
        <button
          type="button"
          onClick={onReset}
          className="min-h-12 rounded-xl border border-border bg-surface px-6 font-medium"
        >
          {he.batch.navLink}
        </button>
      </div>
    </div>
  );
}
