"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { he } from "@/lib/he";
import { useAction } from "@/lib/use-action";
import { deleteProfessionalAction, mergeProfessionalsAction, updateProfessionalAction } from "../actions";
import { DeleteButton } from "@/components/delete-button";
import { TITLE_DESCRIPTIVE } from "@/lib/ui";
import { cardClasses } from "@/components/ui/card";
import { Banner, FormError } from "@/components/ui/message";

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
  const { busy, error, run } = useAction();

  const [keepId, setKeepId] = useState("");
  const [dropId, setDropId] = useState("");

  const byId = (id: string) => professionals.find((p) => p.id === id);

  function merge() {
    setNotice(null);
    const keep = byId(keepId);
    const drop = byId(dropId);
    if (!keep || !drop) return;
    if (!window.confirm(he.admin.mergeConfirm(drop.name, keep.name))) return;

    run(
      () => mergeProfessionalsAction(keepId, dropId),
      (moved) => {
        setNotice(he.admin.merged(moved));
        setKeepId("");
        setDropId("");
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* איחוד כפילויות */}
      <section className={cardClasses("flex flex-col gap-2")}>
        <h2 className={TITLE_DESCRIPTIVE}>{he.admin.mergeHeading}</h2>
        <p className="text-xs text-muted">{he.admin.mergeHint}</p>

        {/*
         * שני הבוררים מושבתים עד ההידרציה, כמו כל פקד קלט במערכת. בלי זה
         * בחירה מוקדמת מעדכנת את ה-`<select>` אך לא את מצב React: המשתמש
         * רואה שני ערכים נבחרים וכפתור "אחד" שנשאר מושבת בלי שום הסבר —
         * בדיוק הכפתור המת שדווח מהשטח במקום אחר. פקד מושבת שנדלק הוא
         * מצב שאפשר להבין; פקד שעונה ואינו קולט אינו.
         */}
        <div className="grid grid-cols-2 gap-2">
          <Field label={he.admin.mergeKeep}>
            <Select value={keepId} onChange={(e) => setKeepId(e.target.value)} disabled={busy}>
              <option value="">{he.common.choose}</option>
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={he.admin.mergeDrop}>
            <Select value={dropId} onChange={(e) => setDropId(e.target.value)} disabled={busy}>
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
          <Banner tone="success">{notice}</Banner>
        ) : null}
        {error ? (
          <FormError>
            {error}
          </FormError>
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
  const { busy, error, run } = useAction();

  function save() {
    run(
      () => updateProfessionalAction(professional.id, { name, phone, email }),
      () => setEditing(false),
    );
  }

  if (!editing) {
    return (
      <li className={cardClasses("flex items-center justify-between gap-3")}>
        <div className="flex flex-col gap-1">
          <span className="font-medium">{professional.name}</span>
          <span className="text-sm text-muted" dir="ltr">
            {professional.phone ?? professional.email ?? ""}
          </span>
          <span className="text-xs text-muted">
            {he.admin.activeTickets(professional.activeAssignments)}
          </span>
        </div>
        {/* מחיקה נחסמת ברגע שיש שיוך אחד — גם `REMOVED` — ולכן היא מנקה
            רשומה שנוצרה בטעות הקלדה בלבד. איש מקצוע שכבר עבד מוצא מהרשימה
            באיחוד (`mergeProfessionals`), לא במחיקה. */}
        <div className="flex shrink-0 items-start gap-2">
          <Button
            variant="secondary"
            size="compact"
            onClick={() => setEditing(true)}
            disabled={disabled}
          >
            {he.admin.editProfessional}
          </Button>
          <DeleteButton
            name={professional.name}
            action={deleteProfessionalAction.bind(null, professional.id)}
            disabled={disabled}
          />
        </div>
      </li>
    );
  }

  return (
    <li className={cardClasses("flex flex-col gap-2")}>
      <Input value={name} onChange={(e) => setName(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" inputMode="tel" />
        <Input value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" inputMode="email" />
      </div>
      {error ? (
        <FormError>
          {error}
        </FormError>
      ) : null}
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy} className="flex-1">
          {he.admin.saveProfessional}
        </Button>
        <Button variant="secondary" size="compact" onClick={() => setEditing(false)}>
          {he.common.cancel}
        </Button>
      </div>
    </li>
  );
}
