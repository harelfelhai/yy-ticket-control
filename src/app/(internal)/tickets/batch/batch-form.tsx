"use client";

import { useRef, useState } from "react";
import { LearnedSelect, type LearnedOption } from "@/components/learned-select";
import { type AttachedFile, MediaPicker } from "@/components/media-picker";
import { RecipientPicker, type RecipientOption } from "@/components/recipient-picker";
import { SourcePreview } from "@/components/source-preview";
import type { Room } from "@/generated/prisma/enums";
import { unwrapOrThrow } from "@/lib/action-result";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { he } from "@/lib/he";
import { ROOMS } from "@/lib/rooms";
import { useAction } from "@/lib/use-action";
import type { BatchResult } from "@/lib/services/batch";
import {
  createApartmentAction,
  createBuildingAction,
  createDomainAction,
  createProfessionalAction,
} from "../new/actions";
import { createBatchAction } from "./actions";
import {
  FULL_WIDTH,
  PAGE_X,
  PANEL_WIDTH,
  STICKY_UNDER_HEADER,
  TITLE_DESCRIPTIVE,
} from "@/lib/ui";
import { cardClasses } from "@/components/ui/card";
import { FormError } from "@/components/ui/message";

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
  const { busy, error, setError, run } = useAction();

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
    run(
      () =>
        createBatchAction({
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
        }),
      setSummary,
    );
  }

  if (summary) {
    return <Summary summary={summary} onReset={reset} />;
  }

  return (
    /*
     * **זה המסך שהכי רוצה רוחב, ולכן `FULL_WIDTH`.** מזינים בו עשרות ליקויים
     * מדוח בדק בית: ההקשר המשותף בצד, השורות בטור שלצדו, ושתי העמודות זו לצד
     * זו הן כל היתרון של המסך הזה על פני פתיחת פנייה אחר פנייה. הריפוד מגיע
     * מ-`PAGE_X` ולא מ-`p-4` כתוב ביד, כמו בכל שאר המסכים.
     */
    <div className={`flex flex-col gap-3 py-3 ${PAGE_X} ${FULL_WIDTH}`}>
      <div>
        <h1 className={TITLE_DESCRIPTIVE}>{he.batch.title}</h1>
        <p className="text-sm text-muted">
          {he.ticket.site}: {siteName} · {he.batch.desktopHint}
        </p>
      </div>

      {/*
       * שתי העמודות, ו**התקרה יושבת על הרכיב ולא על העמוד** (ראו `FULL_WIDTH`
       * ב-`src/lib/ui.ts`). ‏`1fr` בלי תקרה היה נכון כל עוד ה-`<main>` הגביל
       * ל-1024px; מרגע שהוא חדל, טור ההזנה קיבל את כל מה שנשאר — שדה "תיאור"
       * בן 1500px לשורת ליקוי אחת, כלומר בדיוק מה ש-`CONTENT_WIDTH` קיים כדי
       * למנוע. ‏`minmax(0,64rem)` נותן לו עד 1024px ומשאיר את העודף ריק.
       *
       * ‏`minmax(0,…)` ולא `64rem` יבש: רצועת ברירת המחדל היא `minmax(auto,…)`,
       * ו-`auto` פירושו שהעמודה אינה מצטמצמת מתחת לרוחב המינימלי של תוכנה —
       * כלומר בורר נמענים ארוך היה מרחיב את הגריד ומייצר גלילה אופקית.
       *
       * ‏320px לצד `rem` ולא מתוך רשלנות: זהו אותו רוחב של `FORM_PANEL_WIDTH`
       * — הרוחב שבו טופס נשאר טופס לצד התוכן שהוא מוסיף אליו.
       */}
      <div className="grid gap-3 lg:grid-cols-[320px_minmax(0,64rem)]">
        {/*
         * אזור המקור וההקשר המשותף — נשאר גלוי בגלילה בדסקטופ.
         *
         * ההיסט מגיע מ-`STICKY_UNDER_HEADER` ולא מ-`lg:top-16` כתוב ביד: הוא
         * חייב להיות בדיוק גובה סרגל הניווט, וכשהסרגל ירד ל-44px בסבב הצפיפות
         * הפאנל נשאר תלוי 20px מתחת למקומו.
         *
         * הקבוע נכתב **בלי תחילית `lg:`** אף שהדביקות עצמה מותנית בה, ובכוונה:
         * ‏Tailwind סורק את הקוד כטקסט, ו-`lg:${...}` לא היה מייצר מחלקה כלל —
         * המחרוזת `lg:top-11` אינה מופיעה בשום קובץ. ‏`top` על אלמנט `static`
         * הוא ממילא חסר משמעות, ולכן במסך צר הוא פשוט אינו עושה דבר.
         */}
        <aside className={`flex flex-col gap-3 ${STICKY_UNDER_HEADER} lg:sticky lg:self-start`}>
          <section className={cardClasses("flex flex-col gap-3")}>
            <h2 className={TITLE_DESCRIPTIVE}>{he.batch.contextHeading}</h2>

            <LearnedSelect
              label={he.directory.building}
              options={buildings}
              value={buildingId}
              onChange={(id) => {
                setBuildingId(id);
                setApartmentId(null);
              }}
              onCreate={async (name) => {
                const created = unwrapOrThrow(await createBuildingAction(siteId, name));
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
                      const created = unwrapOrThrow(
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

            <Field label={he.batch.sharedTag}>
              <Input
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                placeholder={he.batch.sharedTagPlaceholder}
                size="compact"
              />
            </Field>
          </section>

          <section className={cardClasses("flex flex-col gap-2")}>
            <h2 className={TITLE_DESCRIPTIVE}>{he.batch.sourceHeading}</h2>
            <p className="text-xs text-muted">{he.batch.sourceHint}</p>
            <MediaPicker files={files} onChange={setFiles} disabled={busy} />
            {/*
             * **מה שהופך את הפאנל הזה ל"הקשר קבוע" ולא לרשימת קבצים.**
             * ‏`MediaPicker` מציג צ׳יפ עם שם הקובץ; האפיון (שורה 271) דורש
             * שהקובץ עצמו יהיה על המסך בזמן ההזנה.
             */}
            <SourcePreview files={files} />
          </section>
        </aside>

        {/* טור ההזנה — שורה לכל ליקוי */}
        <div className="flex flex-col gap-3">
          {/* הפעולה צמודה לכותרת שהיא פועלת עליה — DESIGN.md § Layout */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className={TITLE_DESCRIPTIVE}>
              {he.batch.rowsHeading} · {rows.length}
            </h2>
            {/* היה `min-h-10` (40px) — מתחת לסף המגע. */}
            <Button variant="secondary" size="compact" onClick={addRow}>
              {he.batch.addRow}
            </Button>
          </div>

          {rows.map((row, index) => (
            <div
              key={row.key}
              role="group"
              aria-label={he.batch.rowNumber(index + 1)}
              className={cardClasses("flex flex-col gap-2", { padding: "compact" })}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-xs font-medium text-muted">
                  {he.batch.rowNumber(index + 1)}
                </span>
                {/* היה `min-h-8` (32px) — הרחק מתחת לסף המגע של 44px. */}
                {rows.length > 1 ? (
                  <Button
                    variant="dangerQuiet"
                    size="compact"
                    onClick={() => removeRow(row.key)}
                    aria-label={`${he.batch.removeRow} ${index + 1}`}
                    className="px-2"
                  >
                    {he.batch.removeRow}
                  </Button>
                ) : null}
              </div>

              <Field label={he.batch.rowDescription}>
                <Input
                  value={row.description}
                  onChange={(e) => updateRow(row.key, { description: e.target.value })}
                  size="compact"
                />
              </Field>

              <div className="grid gap-2 sm:grid-cols-2">
                <LearnedSelect
                  label={he.batch.rowDomain}
                  options={domains}
                  value={row.domainId}
                  onChange={(id) => updateRow(row.key, { domainId: id })}
                  onCreate={async (name) => {
                    const created = unwrapOrThrow(await createDomainAction(siteId, name));
                    setDomains((prev) => [...prev, created]);
                    return created;
                  }}
                />

                <Field label={`${he.batch.rowRoom} (${he.common.optional})`}>
                  <Select
                    value={row.room ?? ""}
                    onChange={(e) => updateRow(row.key, { room: e.target.value || null })}
                  >
                    <option value="">{he.common.choose}</option>
                    {ROOMS.map((value) => (
                      <option key={value} value={value}>
                        {he.room[value]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="flex flex-col gap-1">
                <RecipientPicker
                  options={availableRecipients}
                  value={row.recipient ? [row.recipient] : []}
                  // בורר יחיד: לוקחים את האחרון שנבחר, כך שבחירה נוספת מחליפה.
                  onChange={(list) =>
                    updateRow(row.key, { recipient: list.length ? list[list.length - 1] : null })
                  }
                  onCreateProfessional={async (input) => {
                    const created = unwrapOrThrow(await createProfessionalAction(siteId, input));
                    const option: RecipientOption = { ...created, kind: "professional" };
                    setAvailableRecipients((prev) => [...prev, option]);
                    return option;
                  }}
                />
              </div>
            </div>
          ))}

          {error ? (
            <FormError>
              {error}
            </FormError>
          ) : null}

          {/*
           * רצועת הפעולות — דביקה, אך **בלי בליטה**, בשונה מהקומפוזר במסך
           * הפנייה ומרצועת "שלח" במסך היצירה.
           *
           * שם הרצועה נמתחת לקצה המסך ב-`PAGE_BLEED` מפני שהיא באמת יושבת
           * ברוחב העמוד. כאן היא ילדה של טור ההזנה בתוך גריד: `-mx-3` היה
           * מוציא אותה אל תוך המרווח שבין הטורים, ובמסך רחב גם אל מתחת
           * לפאנל ההקשר. קו ההפרדה שנעצר בגבול הטור הוא הקריאה הנכונה —
           * הפעולות שייכות לטור, לא לעמוד.
           */}
          <div className="sticky bottom-0 flex gap-2 border-t border-border bg-bg py-3">
            <Button onClick={() => submit(true)} disabled={busy} className="flex-1">
              {he.batch.dispatch}
            </Button>
            <Button variant="secondary" onClick={() => submit(false)} disabled={busy}>
              {he.batch.saveDraft}
            </Button>
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
    // מסך הסיכום הוא פאנל יחיד ממורכז ולא המשך של מסך ההזנה הרחב, ולכן
    // ‏`PANEL_WIDTH`. הריפוד מגיע מ-`PAGE_X` כמו בכל עמוד אחר.
    <div className={`flex flex-col gap-3 py-3 ${PAGE_X} ${PANEL_WIDTH}`}>
      <h1 className={TITLE_DESCRIPTIVE}>{he.batch.title}</h1>
      <div className={cardClasses("flex flex-col gap-2", { tone: "success" })}>
        {lines.map((line) => (
          <p key={line} className="font-medium text-success">
            {line}
          </p>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {/* היה `leading-[3rem]` כדי למרכז אנכית — הפרימיטיב עושה זאת ב-flex,
            בלי לקשור את גובה השורה לגובה הכפתור. */}
        <ButtonLink href={`/tags/${summary.tagId}`}>{he.batch.goToTag}</ButtonLink>
        <Button variant="secondary" onClick={onReset}>
          {he.batch.navLink}
        </Button>
      </div>
    </div>
  );
}
