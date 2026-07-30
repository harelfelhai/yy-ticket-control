"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { he } from "@/lib/he";
import { useHydrated } from "@/lib/use-hydrated";
import { mergeProfessionalsAction, updateProfessionalAction } from "../actions";

interface ProfessionalRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  activeAssignments: number;
}

/**
 * ניהול אנשי מקצוע (מסך 13): עריכת פרטים ואיחוד כפילויות.
 *
 * האיחוד הוא הפעולה הרגישה: הוא מוחק איש מקצוע ומעביר את כל ההיסטוריה שלו
 * לאחר. לכן היא דורשת אישור מפורש שמזכיר את שני השמות — לחיצה בטעות מאבדת
 * זהות שלמה.
 */
export function ProfessionalsManager({ professionals }: { professionals: ProfessionalRow[] }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const busy = pending || !hydrated;

  const [keepId, setKeepId] = useState("");
  const [dropId, setDropId] = useState("");

  const byId = (id: string) => professionals.find((p) => p.id === id);

  function merge() {
    setNotice(null);
    setError(null);
    const keep = byId(keepId);
    const drop = byId(dropId);
    if (!keep || !drop) return;
    if (!window.confirm(he.admin.mergeConfirm(drop.name, keep.name))) return;

    startTransition(async () => {
      const result = await mergeProfessionalsAction(keepId, dropId);
      if (result.ok) {
        setNotice(he.admin.merged(result.data));
        setKeepId("");
        setDropId("");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* איחוד כפילויות */}
      <section className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold">{he.admin.mergeHeading}</h2>
        <p className="text-xs text-muted">{he.admin.mergeHint}</p>

        <div className="grid grid-cols-2 gap-2">
          <Field label={he.admin.mergeKeep}>
            <Select value={keepId} onChange={(e) => setKeepId(e.target.value)}>
              <option value="">{he.common.choose}</option>
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={he.admin.mergeDrop}>
            <Select value={dropId} onChange={(e) => setDropId(e.target.value)}>
              <option value="">{he.common.choose}</option>
              {professionals
                .filter((p) => p.id !== keepId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>

        <Button onClick={merge} disabled={busy || !keepId || !dropId} className="self-start">
          {he.admin.mergeButton}
        </Button>

        {notice ? (
          <p className="rounded-xl bg-success/10 p-3 text-sm font-medium text-success">{notice}</p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
      </section>

      <ul className="flex flex-col gap-2">
        {professionals.map((professional) => (
          <ProfessionalItem key={professional.id} professional={professional} disabled={busy} />
        ))}
      </ul>
    </div>
  );
}

function ProfessionalItem({
  professional,
  disabled,
}: {
  professional: ProfessionalRow;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(professional.name);
  const [phone, setPhone] = useState(professional.phone ?? "");
  const [email, setEmail] = useState(professional.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateProfessionalAction(professional.id, { name, phone, email });
      if (result.ok) setEditing(false);
      else setError(result.error);
    });
  }

  if (!editing) {
    return (
      <li className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{professional.name}</span>
          <span className="text-sm text-muted" dir="ltr">
            {professional.phone ?? professional.email ?? ""}
          </span>
          <span className="text-xs text-muted">
            {he.admin.activeTickets(professional.activeAssignments)}
          </span>
        </div>
        <Button
          variant="secondary"
          size="compact"
          onClick={() => setEditing(true)}
          disabled={disabled}
          className="shrink-0"
        >
          {he.admin.editProfessional}
        </Button>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
      <Input value={name} onChange={(e) => setName(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" inputMode="tel" />
        <Input value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" inputMode="email" />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button onClick={save} disabled={pending} className="flex-1">
          {he.admin.saveProfessional}
        </Button>
        <Button variant="secondary" size="compact" onClick={() => setEditing(false)}>
          {he.common.cancel}
        </Button>
      </div>
    </li>
  );
}
