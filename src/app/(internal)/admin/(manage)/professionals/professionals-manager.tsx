"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { he } from "@/lib/he";
import { useAction } from "@/lib/use-action";
import {
  deleteProfessionalAction,
  mergeProfessionalsAction,
  setProfessionalActiveAction,
  updateProfessionalAction,
} from "../../actions";
import { DeleteButton } from "@/components/delete-button";
import { TITLE_DESCRIPTIVE, CARD_LIST, FORM_PANEL_WIDTH, RECORD_NAME } from "@/lib/ui";
import { cardClasses } from "@/components/ui/card";
import { Banner, FormError } from "@/components/ui/message";
import { chipClasses } from "@/components/ui/chip";

interface ProfessionalRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
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
    /*
     * טופס האיחוד יורד לפאנל לצד הרשימה, באותה תבנית של "משתמש חדש"
     * ושל `AdminAddForm` — ארבעת מסכי הניהול נפתחים על הרשומות ולא על
     * טופס ההזנה שלהם. כאן זה חד במיוחד: האיחוד הוא הפעולה **הנדירה
     * ביותר** במסך, והוא זה שישב בראשו ברוחב מלא.
     */
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
      {/* איחוד כפילויות */}
      <section className={cardClasses(`flex flex-col gap-2 ${FORM_PANEL_WIDTH} lg:shrink-0`)}>
        <h2 className={TITLE_DESCRIPTIVE}>{he.admin.mergeHeading}</h2>
        <p className="text-xs text-muted">{he.admin.mergeHint}</p>

        {/*
         * שני הבוררים מושבתים עד ההידרציה, כמו כל פקד קלט במערכת. בלי זה
         * בחירה מוקדמת מעדכנת את ה-`<select>` אך לא את מצב React: המשתמש
         * רואה שני ערכים נבחרים וכפתור "אחד" שנשאר מושבת בלי שום הסבר —
         * בדיוק הכפתור המת שדווח מהשטח במקום אחר. פקד מושבת שנדלק הוא
         * מצב שאפשר להבין; פקד שעונה ואינו קולט אינו.
         *
         * **בטור ולא בשתי עמודות**, בניגוד לזוגות שב"משתמש חדש": בבורר
         * הזה התוכן הוא שם של אדם, ובחצי פאנל הוא נחתך באמצע. פעולה
         * שמוחקת זהות שלמה אינה יכולה להישען על שם מקוצר.
         */}
        <Field label={he.admin.mergeKeep}>
          <Select
            value={keepId}
            onChange={(e) => setKeepId(e.target.value)}
            disabled={busy}
            size="compact"
          >
            <option value="">{he.common.choose}</option>
            {professionals
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>

        <Field label={he.admin.mergeDrop}>
          <Select
            value={dropId}
            onChange={(e) => setDropId(e.target.value)}
            disabled={busy}
            size="compact"
          >
            <option value="">{he.common.choose}</option>
            {professionals
              .filter((p) => p.active && p.id !== keepId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>

        {/* בגובה הבוררים שמעליו — טופס אחד, מידה אחת. */}
        <Button
          size="compact"
          onClick={merge}
          disabled={busy || !keepId || !dropId}
          className="self-start"
        >
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

      <ul className={`${CARD_LIST} min-w-0 flex-1`}>
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
    // פער 33: הפעולות נצמדות לשם ואינן נדחפות לקצה הנגדי — § Layout מונה
    // גם "פעולה" בין מה שמתייחס לכותרת, ו-justify-between השאיר ברוחב
    // דסקטופ מאות פיקסלים ריקים באמצע השורה.
    return (
      <li className={cardClasses("flex flex-wrap items-center gap-x-3 gap-y-2")}>
        <div className="flex min-w-0 flex-col gap-1">
          <span className={RECORD_NAME}>
            {professional.name}
            {!professional.active ? (
              <span className={chipClasses("danger", "soft", "default", "ms-2")}>
                {he.admin.inactiveBadge}
              </span>
            ) : null}
          </span>
          <span className="text-sm text-muted" dir="ltr">
            {professional.phone ?? professional.email ?? ""}
          </span>
          <span className="text-xs text-muted">
            {professional.active
              ? he.admin.activeTickets(professional.activeAssignments)
              : he.admin.inactiveProfessionalHint}
          </span>
        </div>
        {/* מחיקה נחסמת ברגע שיש שיוך אחד — גם `REMOVED` — ולכן היא מנקה
            רשומה שנוצרה בטעות הקלדה בלבד. מי שכבר עבד יוצא מהרשימה
            ב**השבתה** (0.4); האיחוד נשאר למה שהוא באמת מתאר — שתי רשומות
            לאותו אדם — ולא למי שפשוט עזב. */}
        <div className="flex shrink-0 items-start gap-2">
          <Button
            variant="secondary"
            size="compact"
            onClick={() => setEditing(true)}
            disabled={disabled}
          >
            {he.admin.editProfessional}
          </Button>
          <Button
            variant="secondary"
            size="compact"
            onClick={() => run(() => setProfessionalActiveAction(professional.id, !professional.active))}
            disabled={disabled || busy}
          >
            {professional.active ? he.admin.deactivate : he.admin.activate}
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
      {/* ‏`compact` בשלושת השדות ובשני הכפתורים: עריכה בתוך שורת רשימה,
          לא הפעולה הראשית של המסך — ואותה מידה כמו בעריכת משתמש. */}
      <Input value={name} onChange={(e) => setName(e.target.value)} size="compact" />
      <div className="grid grid-cols-2 gap-2">
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          dir="ltr"
          inputMode="tel"
          size="compact"
        />
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          dir="ltr"
          inputMode="email"
          size="compact"
        />
      </div>
      {error ? (
        <FormError>
          {error}
        </FormError>
      ) : null}
      <div className="flex gap-2">
        <Button size="compact" onClick={save} disabled={busy} className="flex-1">
          {he.admin.saveProfessional}
        </Button>
        <Button variant="secondary" size="compact" onClick={() => setEditing(false)}>
          {he.common.cancel}
        </Button>
      </div>
    </li>
  );
}
