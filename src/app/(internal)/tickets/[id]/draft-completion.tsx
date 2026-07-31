"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { LearnedSelect, type LearnedOption } from "@/components/learned-select";
import { RecipientPicker, type RecipientOption } from "@/components/recipient-picker";
import type { ActionResult } from "@/lib/action-result";
import {
  type DraftCompletionSnapshot,
  clearCompletion,
  isEmptyCompletion,
  loadCompletion,
  saveCompletion,
} from "@/lib/draft-completion-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
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
import { cardClasses } from "@/components/ui/card";

/**
 * השלמת טיוטה ושיגורה (מסך 7 באפיון).
 *
 * מוצג בראש מסך הפנייה כשהיא טיוטה, מסומן באדום, ומציג **רק את השדות
 * החסרים** — כדי שמנהל העבודה יראה בדיוק מה נותר להשלים ולא ימלא מחדש מה
 * שכבר קיים. השיגור הוא שני שלבים: קודם שומרים את השדות שמולאו
 * (`updateTicketFieldsAction`), ואז משגרים (`submitDraftAction`) — כך אם
 * חסר עדיין משהו, מה שהוקלד לא הולך לאיבוד.
 *
 * מה שהוקלד ועדיין לא שוגר נשמר ל-IndexedDB (`draft-completion-store`)
 * ומשוחזר בעלייה — כך שרענון דף, קריסה או ניווט בטעות אינם מאבדים את
 * ההשלמה שבאמצע, בדיוק כמו טופס היצירה (`offline-draft`).
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

/**
 * ממיר מזהי נמענים שמורים לאובייקטי האפשרות המלאים, מול הרשימה הזמינה עכשיו.
 * נמען שנוצר תוך כדי כבר בשרת ולכן חוזר ב-`options`; מי שכבר שויך או הוסר נושר.
 */
function toRecipients(
  ids: DraftCompletionSnapshot["recipientIds"],
  options: RecipientOption[],
): RecipientOption[] {
  return ids
    .map((ref) => options.find((o) => o.id === ref.id && o.kind === ref.kind))
    .filter((o): o is RecipientOption => o !== undefined);
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
  /** האם עדיין קוראים snapshot שמור מ-IndexedDB — עד אז אין לכתוב עליו */
  const [restoring, setRestoring] = useState(true);
  /**
   * שוגר או נמחק — עוצר את השמירה השוטפת. ‏ref ולא state: השמירה מושהית,
   * והשיגור עשוי לחזור בתוך חלון ההשהיה; עדכון state אסינכרוני היה מאפשר
   * לטיימר ממתין לירות **אחרי** הניקוי ולכתוב את ה-snapshot בחזרה.
   */
  const submittedRef = useRef(false);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const busy = pending || !hydrated;

  /** צילום המצב הנוכחי, בצורה שנשמרת בדפדפן */
  const snapshot = useCallback(
    (): DraftCompletionSnapshot => ({
      ticketId,
      buildingId,
      apartmentId,
      domainId,
      description,
      recipientIds: recipients.map((r) => ({ kind: r.kind, id: r.id })),
      savedAt: Date.now(),
    }),
    [ticketId, buildingId, apartmentId, domainId, description, recipients],
  );

  /**
   * משחזר מצב שהוקלד קודם ולא שוגר (רענון/קריסה/ניווט). פעם אחת בעלייה:
   * שחזור חוזר תוך כדי render היה דורס את מה שהמשתמש מקליד עכשיו.
   */
  useEffect(() => {
    let cancelled = false;

    void loadCompletion(ticketId).then((saved) => {
      if (cancelled || !saved) {
        setRestoring(false);
        return;
      }

      // ‏`?? initial`: ה-snapshot נכתב מהמצב שאותחל מ-initial, ולכן הוא עדכני
      // לפחות כמותו. השיגור ממילא כותב רק שדות שעדיין חסרים, כך ששחזור ערך
      // לשדה שכבר קיים בשרת אינו יכול לדרוס אותו.
      setBuildingId(saved.buildingId ?? initial.buildingId);
      setApartmentId(saved.apartmentId ?? initial.apartmentId);
      setDomainId(saved.domainId ?? initial.domainId);
      setDescription(saved.description);
      const restored = toRecipients(saved.recipientIds, recipientOptions);
      if (restored.length > 0) setRecipients(restored);

      setRestoring(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- פעם אחת בעלייה בלבד; ראה ההערה מעל
  }, [ticketId]);

  /**
   * שמירה מקומית שוטפת, מושהית ב-400ms. לא כותבים לפני שסיימנו לשחזר, לא
   * אחרי שיגור/מחיקה, ולא מצב ריק שאין בו מה לשמור.
   */
  useEffect(() => {
    if (restoring || submittedRef.current) return;

    const snap = snapshot();
    if (isEmptyCompletion(snap)) return;

    const timer = setTimeout(() => {
      if (submittedRef.current) return;
      void saveCompletion(snap);
    }, 400);

    return () => clearTimeout(timer);
  }, [snapshot, restoring]);

  const selectedBuilding = buildings.find((b) => b.id === buildingId) ?? null;
  // אם צריך לבחור בניין, ממילא צריך גם דירה תחתיו — הן זוג.
  const showBuilding = missing.building;
  const showApartment = missing.apartment || missing.building;

  function submit() {
    setError(null);
    // עוצר את השמירה השוטפת מרגע הלחיצה: מכאן והלאה הטיימר לא יכתוב snapshot
    // ישן בחזרה אחרי שהטיוטה כבר שוגרה.
    submittedRef.current = true;
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
          // שגיאה עסקית — המשתמש יתקן וינסה שוב; השמירה השוטפת חוזרת לפעול.
          submittedRef.current = false;
          setError(saved.error);
          return;
        }
      }

      // שלב 2: שיגור. אם עדיין חסר משהו, השירות יחזיר בדיוק מה — וללא אובדן.
      const sent = await submitDraftAction(
        ticketId,
        recipients.map((r) => ({ kind: r.kind, id: r.id })),
      );
      if (!sent.ok) {
        submittedRef.current = false;
        setError(sent.error);
        return;
      }

      // שוגר בהצלחה — הטיוטה הפכה לפנייה אמיתית, אין עוד מה לשחזר.
      void clearCompletion(ticketId);
    });
  }

  function remove() {
    if (!window.confirm(he.ticket.confirmDeleteDraft)) return;
    setError(null);
    submittedRef.current = true;
    // הטיוטה נמחקת — נקה גם את ה-snapshot המקומי כדי שלא יישאר יתום.
    void clearCompletion(ticketId);
    startTransition(async () => {
      // מצליח → deleteDraftAction מנווט ללוח; חוזר רק במקרה שגיאה.
      const result = await deleteDraftAction(ticketId);
      if (result?.error) {
        submittedRef.current = false;
        setError(result.error);
      }
    });
  }

  return (
    <section className={cardClasses("flex flex-col gap-3", { tone: "danger" })}>
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
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </label>
      ) : null}

      {missing.recipients ? (
        <div className="flex flex-col gap-1">
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
        <Button onClick={submit} disabled={busy} className="flex-1">
          {he.ticket.submitDraftButton}
        </Button>
        <Button variant="dangerOutline" onClick={remove} disabled={busy}>
          {he.ticket.deleteDraft}
        </Button>
      </div>
    </section>
  );
}
