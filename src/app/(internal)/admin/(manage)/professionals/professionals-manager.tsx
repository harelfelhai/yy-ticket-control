"use client";

import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { DeleteButton } from "@/components/delete-button";
import { Button } from "@/components/ui/button";
import { chipClasses } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/field";
import { Banner, FormError } from "@/components/ui/message";
import { he } from "@/lib/he";
import {
  DIALOG_SCROLL_BODY,
  RECORD_CARD_GRID,
  RECORD_NAME,
  TITLE_DESCRIPTIVE,
} from "@/lib/ui";
import { useAction } from "@/lib/use-action";
import { RecordCard } from "../../record-card";
import {
  createProfessionalAction,
  deleteProfessionalAction,
  mergeProfessionalsAction,
  setProfessionalActiveAction,
  updateProfessionalAction,
} from "../../actions";

interface ProfessionalRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  activeAssignments: number;
}

/**
 * ניהול אנשי מקצוע (מסך 13), בתבנית 0.7.
 *
 * **שני שינויים מהותיים כאן, ולא רק סידור מחדש:**
 *
 * ‏1. **הוספת איש מקצוע — יכולת חדשה.** עד 0.7 המסך הזה ידע לערוך,
 *    להשבית, למחוק ולאחד, אבל **לא להקים**: איש מקצוע נוצר רק תוך כדי
 *    פתיחת פנייה. זה עבד כל עוד הזרימה היחידה הייתה "צריך לשלוח למישהו
 *    חדש עכשיו", ונשבר ברגע שרוצים להזין ספקים מראש.
 * ‏2. **טופס האיחוד ירד מהפאנל הקבוע לדיאלוג.** הנימוק כבר היה כתוב כאן
 *    לפני השינוי: האיחוד הוא הפעולה **הנדירה ביותר** במסך, והוא זה
 *    שתפס פאנל קבוע לצד הרשימה. הוא נשאר במרחק לחיצה אחת, ומקבל את כל
 *    רוחב הדיאלוג לשני הבוררים שבו — שהם שמות של אנשים ואסור להם
 *    להיחתך (זה היה כתוב כאן כאילוץ על חצי פאנל).
 */
export function ProfessionalsManager({ professionals }: { professionals: ProfessionalRow[] }) {
  const [creating, setCreating] = useState(false);
  const [merging, setMerging] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // נגזר ולא נשמר — ראו `sites-manager.tsx`.
  const open = professionals.find((professional) => professional.id === openId) ?? null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className={TITLE_DESCRIPTIVE}>{he.admin.professionals}</h1>
        {/* ‏`aria-label` זהה לטקסט הגלוי — ראו הנימוק ב-`sites-manager.tsx`. */}
        <Button
          size="compact"
          onClick={() => setCreating(true)}
          aria-label={he.admin.newProfessionalButton}
        >
          <Plus className="me-1 size-3" aria-hidden="true" />
          {he.admin.newProfessionalButton}
        </Button>
        {/*
         * ‏`secondary` ולא `primary`: זו הפעולה החלופית של המסך, וההוספה
         * היא הראשית. שני כפתורים מלאים זה לצד זה היו נקראים כשווי משקל
         * (§ שקט: `secondary` היא הפעולה החלופית).
         */}
        <Button variant="secondary" size="compact" onClick={() => setMerging(true)}>
          {he.admin.mergeButtonOpen}
        </Button>
      </div>

      {professionals.length === 0 ? <EmptyState>{he.common.noResults}</EmptyState> : null}

      <ul className={RECORD_CARD_GRID}>
        {professionals.map((professional) => (
          <RecordCard
            key={professional.id}
            label={professional.name}
            onOpen={() => setOpenId(professional.id)}
          >
            <span className={RECORD_NAME}>
              {professional.name}
              {!professional.active ? (
                <span className={chipClasses("danger", "soft", "default", "ms-2")}>
                  {he.admin.inactiveBadge}
                </span>
              ) : null}
            </span>
            <span className="text-sm text-muted">
              {professional.active
                ? he.admin.activeTickets(professional.activeAssignments)
                : he.admin.inactiveProfessionalHint}
            </span>
          </RecordCard>
        ))}
      </ul>

      {creating ? <ProfessionalCreateDialog onClose={() => setCreating(false)} /> : null}

      {merging ? (
        <MergeDialog professionals={professionals} onClose={() => setMerging(false)} />
      ) : null}

      {/*
       * ‏`key` על מזהה הרשומה — הדיאלוג מחזיק מצב טופס פנימי (מה נבחר,
       * מה מוקלד), וללא `key` מעבר מרשומה לרשומה **באותה עמדה** ב-DOM
       * היה משאיר את המצב של הקודמת. היום זה אינו קורה בפועל, מפני
       * שהכיסוי חוסם את הכרטיסים שמאחוריו — כלומר ההגנה היא על הנחה
       * שנכונה במקרה, וזה בדיוק סוג התלות שנשברת בשקט.
       */}
      {open ? (
        <ProfessionalDetailsDialog
          key={open.id}
          professional={open}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </>
  );
}

function ProfessionalCreateDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const { busy, error, run } = useAction();

  return (
    <Dialog title={he.admin.newProfessional} onClose={onClose}>
      <div className={`flex flex-col gap-3 ${DIALOG_SCROLL_BODY}`}>
        <Field label={he.admin.userName}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            size="compact"
            disabled={busy}
          />
        </Field>

        {/*
         * **"חובה טלפון או מייל" נאכף בשרת ולא כאן** (`prepareProfessional`):
         * זהו אילוץ עסקי — בלי אחד מהם אי אפשר לשגר אליו פנייה כלל
         * (אפיון §5.ו) — ולא ולידציית קלט. שכפולו בלקוח היה מייצר שתי
         * הגדרות לאותו כלל, ואת אחת מהן מישהו היה מעדכן לבד. ה-`hint`
         * הוא מה שאומר זאת למשתמש **לפני** הלחיצה.
         */}
        <div className="grid grid-cols-2 gap-2">
          <Field label={he.admin.userPhone}>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
              inputMode="tel"
              size="compact"
              disabled={busy}
            />
          </Field>
          <Field label={he.admin.userEmail}>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              dir="ltr"
              inputMode="email"
              size="compact"
              disabled={busy}
            />
          </Field>
        </div>
        <p className="text-xs text-muted">{he.notices.cannotSendNoContact}</p>

        {error ? <FormError>{error}</FormError> : null}

        <div className="flex gap-2">
          <Button
            size="compact"
            disabled={busy || name.trim().length === 0}
            onClick={() =>
              run(
                () =>
                  createProfessionalAction({
                    name,
                    phone: phone || undefined,
                    email: email || undefined,
                  }),
                onClose,
              )
            }
          >
            {he.admin.addProfessional}
          </Button>
          <Button variant="secondary" size="compact" onClick={onClose} disabled={busy}>
            {he.common.cancel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * איחוד כפילויות — הפעולה הרגישה של המסך.
 *
 * היא מוחקת איש מקצוע ומעבירה את כל ההיסטוריה שלו לאחר, ולכן היא דורשת
 * אישור מפורש שמזכיר את **שני** השמות: לחיצה בטעות מאבדת זהות שלמה.
 */
function MergeDialog({
  professionals,
  onClose,
}: {
  professionals: ProfessionalRow[];
  onClose: () => void;
}) {
  const [keepId, setKeepId] = useState("");
  const [dropId, setDropId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run } = useAction();

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
    <Dialog title={he.admin.mergeHeading} onClose={onClose}>
      <div className={`flex flex-col gap-3 ${DIALOG_SCROLL_BODY}`}>
        <p className="text-xs text-muted">{he.admin.mergeHint}</p>

        {/*
         * **שני הבוררים מושבתים עד ההידרציה**, כמו כל פקד קלט במערכת.
         * בלי זה בחירה מוקדמת מעדכנת את ה-`<select>` אך לא את מצב React:
         * המשתמש רואה שני ערכים נבחרים וכפתור "אחד" שנשאר מושבת בלי שום
         * הסבר — בדיוק הכפתור המת שדווח מהשטח במקום אחר.
         *
         * **בטור ולא בשתי עמודות:** התוכן הוא שם של אדם, ופעולה שמוחקת
         * זהות שלמה אינה יכולה להישען על שם מקוצר.
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

        {notice ? <Banner tone="success">{notice}</Banner> : null}
        {error ? <FormError>{error}</FormError> : null}

        <div className="flex gap-2">
          <Button size="compact" onClick={merge} disabled={busy || !keepId || !dropId}>
            {he.admin.mergeButton}
          </Button>
          <Button variant="secondary" size="compact" onClick={onClose} disabled={busy}>
            {he.common.cancel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function ProfessionalDetailsDialog({
  professional,
  onClose,
}: {
  professional: ProfessionalRow;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(professional.name);
  const [phone, setPhone] = useState(professional.phone ?? "");
  const [email, setEmail] = useState(professional.email ?? "");
  const { busy, error, run } = useAction();

  function cancel() {
    setName(professional.name);
    setPhone(professional.phone ?? "");
    setEmail(professional.email ?? "");
    setEditing(false);
  }

  return (
    <Dialog title={he.admin.professionalDetails} onClose={onClose}>
      <div className={`flex flex-col gap-3 ${DIALOG_SCROLL_BODY}`}>
        {editing ? (
          <>
            {/*
             * **שלושת השדות מקבלים `Field` עם תווית, וזה תיקון.** עד 0.7
             * הם היו שלושה `Input` עירומים — הפרה של § Field ("תווית תמיד
             * גלויה, לעולם לא placeholder בלבד") שחמקה מהאוכף ב-
             * `spacing.test.ts`, שמחפש `<label>` שנכתב ביד ולא היעדר
             * תווית לגמרי.
             */}
            <Field label={he.admin.userName}>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                size="compact"
                disabled={busy}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={he.admin.userPhone}>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  dir="ltr"
                  inputMode="tel"
                  size="compact"
                  disabled={busy}
                />
              </Field>
              <Field label={he.admin.userEmail}>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  dir="ltr"
                  inputMode="email"
                  size="compact"
                  disabled={busy}
                />
              </Field>
            </div>
            {error ? <FormError>{error}</FormError> : null}
            <div className="flex gap-2">
              <Button
                size="compact"
                disabled={busy}
                onClick={() =>
                  run(
                    () => updateProfessionalAction(professional.id, { name, phone, email }),
                    () => setEditing(false),
                  )
                }
              >
                {he.admin.saveProfessional}
              </Button>
              <Button variant="secondary" size="compact" onClick={cancel} disabled={busy}>
                {he.common.cancel}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className={RECORD_NAME}>{professional.name}</span>
              {!professional.active ? (
                <span className={chipClasses("danger", "soft")}>{he.admin.inactiveBadge}</span>
              ) : null}
              <Button
                variant="quiet"
                size="compact"
                onClick={() => setEditing(true)}
                aria-label={he.admin.editProfessional}
              >
                <Pencil className="size-3" aria-hidden="true" />
              </Button>
            </div>

            <dl className="flex flex-col gap-1 text-sm">
              <DetailRow label={he.admin.userPhone} value={professional.phone ?? "—"} ltr />
              <DetailRow label={he.admin.userEmail} value={professional.email ?? "—"} ltr />
            </dl>

            <p className="text-sm text-muted">
              {professional.active
                ? he.admin.activeTickets(professional.activeAssignments)
                : he.admin.inactiveProfessionalHint}
            </p>

            {error ? <FormError>{error}</FormError> : null}

            {/*
             * **מחיקה מול השבתה, ושתיהן קיימות בכוונה.** המחיקה נחסמת
             * ברגע שיש שיוך אחד — גם `REMOVED` — ולכן היא מנקה רשומה
             * שנוצרה בטעות הקלדה בלבד. מי שכבר עבד יוצא מהרשימה
             * ב**השבתה** (0.4), והאיחוד נשאר למה שהוא מתאר: שתי רשומות
             * לאותו אדם.
             */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button
                variant="secondary"
                size="compact"
                disabled={busy}
                onClick={() =>
                  run(() => setProfessionalActiveAction(professional.id, !professional.active))
                }
              >
                {professional.active ? he.admin.deactivate : he.admin.activate}
              </Button>
              <DeleteButton
                name={professional.name}
                action={deleteProfessionalAction.bind(null, professional.id)}
                disabled={busy}
              />
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

/** ראו את התאום ב-`users-manager.tsx`: ערך שאינו נערך אינו שדה מושבת. */
function DetailRow({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="font-medium">{label}</dt>
      <dd className="min-w-0 truncate text-muted" dir={ltr ? "ltr" : undefined}>
        {value}
      </dd>
    </div>
  );
}
