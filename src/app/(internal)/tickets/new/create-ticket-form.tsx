"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { LearnedSelect, type LearnedOption } from "@/components/learned-select";
import { type AttachedFile, MediaPicker } from "@/components/media-picker";
import { RecipientPicker, type RecipientOption } from "@/components/recipient-picker";
import type { Room } from "@/generated/prisma/enums";
import { he } from "@/lib/he";
import { ROOMS } from "@/lib/rooms";
import {
  type OfflineDraft,
  clearDraft,
  isEmptyDraft,
  isNetworkFailure,
  loadDraft,
  saveDraft,
} from "@/lib/offline-draft";
import { useHydrated } from "@/lib/use-hydrated";
import type { ActionResult } from "@/lib/action-result";
import type { SelectOption } from "@/lib/options";
import {
  createApartmentAction,
  createBuildingAction,
  createDomainAction,
  createProfessionalAction,
  createTagAction,
  createTicketAction,
} from "./actions";

/**
 * הופך תוצאת פעולה לערך או לחריגה.
 *
 * ה-Server Actions מחזירות שגיאות כערך (כי Next מצנזר הודעות של חריגות
 * בפרודקשן), בעוד שהבוררים מצפים לחריגה כדי להציג את ההודעה במקום.
 * ההמרה מרוכזת כאן ולא משוכפלת בכל קריאה.
 */
function unwrap(result: ActionResult<SelectOption>): SelectOption {
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
  tags: LearnedOption[];
}

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
  tags: initialTags,
}: CreateTicketFormProps) {
  const [buildings, setBuildings] = useState(initialBuildings);
  const [domains, setDomains] = useState(initialDomains);
  const [availableRecipients, setAvailableRecipients] = useState(recipientOptions);
  const [availableTags, setAvailableTags] = useState(initialTags);

  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [apartmentId, setApartmentId] = useState<string | null>(null);
  const [domainId, setDomainId] = useState<string | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [recipients, setRecipients] = useState<RecipientOption[]>([]);
  const [tags, setTags] = useState<LearnedOption[]>([]);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** האם המסך עדיין קורא טיוטה שמורה — עד אז אין לכתוב עליה */
  const [restoring, setRestoring] = useState(true);
  const [restored, setRestored] = useState<"restored" | "pending" | null>(null);
  /**
   * נשלח בהצלחה — עוצר את השמירה השוטפת.
   *
   * ‏ref ולא state, וזו הנקודה הקריטית: השמירה מושהית ב-400 מילישניות,
   * והשיגור עשוי לחזור בתוכן. עדכון state הוא אסינכרוני, ולכן הטיימר היה
   * מספיק לירות **אחרי** הניקוי ולכתוב את הטיוטה בחזרה. התוצאה בשטח: פנייה
   * חדשה שנפתחת מלאה בפרטים של הקודמת. ‏ref משתנה מיד, בלי לחכות לרינדור.
   */
  const submittedRef = useRef(false);
  /** הכתיבה האחרונה לבסיס המקומי — ממתינים לה לפני שמנקים */
  const lastSaveRef = useRef<Promise<void>>(Promise.resolve());
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  // מושבת עד ל-hydration: לחיצה על "שלח" לפני שהמטפלים חוברו נבלעת בשקט,
  // והמנהל בשטח מניח שהפנייה נשלחה.
  const busy = pending || !hydrated;

  const selectedBuilding = buildings.find((b) => b.id === buildingId) ?? null;

  const roomOptions = useMemo(
    () => ROOMS.map((value) => ({ id: value, label: he.room[value] })),
    [],
  );

  /** צילום המצב הנוכחי, בצורה שנשמרת בדפדפן */
  const snapshot = useCallback(
    (pendingRetry: boolean): OfflineDraft => ({
      siteId,
      buildingId,
      apartmentId,
      domainId,
      room,
      description,
      recipientIds: recipients.map((r) => ({ kind: r.kind, id: r.id })),
      mediaIds: files.map((f) => f.mediaId),
      tagIds: tags.map((t) => t.id),
      savedAt: Date.now(),
      pending: pendingRetry,
    }),
    [siteId, buildingId, apartmentId, domainId, room, description, recipients, tags, files],
  );

  /**
   * שמירה מקומית שוטפת, מושהית.
   *
   * ‏400 מילישניות אחרי ההקלדה האחרונה: כתיבה על כל תו הייתה מיותרת, והמתנה
   * ארוכה יותר פותחת חלון שבו סגירת הדפדפן מאבדת משפט שלם.
   */
  useEffect(() => {
    if (restoring) return;

    const draft = snapshot(false);
    if (isEmptyDraft(draft)) return;

    const timer = setTimeout(() => {
      // הבדיקה בתוך הטיימר ולא רק לפניו: השיגור עשוי להסתיים בזמן ההשהיה.
      if (submittedRef.current) return;
      lastSaveRef.current = saveDraft(draft);
    }, 400);

    return () => clearTimeout(timer);
  }, [snapshot, restoring]);

  /** משחזר טיוטה שנשארה מכניסה קודמת */
  useEffect(() => {
    let cancelled = false;

    void loadDraft().then((draft) => {
      if (cancelled || !draft || draft.siteId !== siteId) {
        setRestoring(false);
        return;
      }

      setBuildingId(draft.buildingId);
      setApartmentId(draft.apartmentId);
      setDomainId(draft.domainId);
      setRoom(draft.room);
      setDescription(draft.description);
      setRecipients(
        draft.recipientIds
          .map((ref) =>
            recipientOptions.find((o) => o.id === ref.id && o.kind === ref.kind),
          )
          .filter((option): option is RecipientOption => option !== undefined),
      );
      setTags(
        (draft.tagIds ?? [])
          .map((id) => initialTags.find((t) => t.id === id))
          .filter((option): option is LearnedOption => option !== undefined),
      );
      setRestored(draft.pending ? "pending" : "restored");
      setRestoring(false);
    });

    return () => {
      cancelled = true;
    };
    // פעם אחת בטעינת המסך בלבד: שחזור חוזר היה דורס מה שהמשתמש מקליד עכשיו.
  }, [siteId, recipientOptions, initialTags]);

  /**
   * שיגור. כשל תקשורת אינו מאבד את מה שהוקלד.
   *
   * ‏Server Action שנכשלת ברמת הרשת **זורקת** ואינה מחזירה `ActionResult`:
   * ה-guard בשרת לא רץ כלל, כי הבקשה לא הגיעה. לכן ה-try/catch כאן אינו
   * כפילות של טיפול השגיאות בשרת אלא מטפל במקרה אחר לגמרי.
   */
  const submit = useCallback(
    async (saveAsDraft: boolean) => {
      setError(null);
      // עוצרים את השמירה השוטפת כבר עכשיו: מרגע הלחיצה ועד לתשובה עוברת
      // שהות שבה טיימר ממתין עלול לירות ולכתוב טיוטה שכבר אינה רלוונטית.
      submittedRef.current = true;

      try {
        const result = await createTicketAction({
          siteId,
          buildingId,
          apartmentId,
          domainId,
          room: (room as Room | null) ?? null,
          description,
          recipients: recipients.map((r) => ({ kind: r.kind, id: r.id })),
          mediaIds: files.map((f) => f.mediaId),
          tagIds: tags.map((t) => t.id),
          saveAsDraft,
        });

        if (result?.error) {
          // שגיאה עסקית — משהו שרק המשתמש יכול לתקן. ניסיון חוזר עליה הוא
          // לולאה אינסופית שקטה, ולכן הטיוטה נשארת אך אינה מסומנת כממתינה.
          // השמירה השוטפת חוזרת לפעול: הוא עומד לתקן ולנסות שוב.
          submittedRef.current = false;
          setError(result.error);
          setRestored(null);
          return;
        }

        // אין שגיאה — הפנייה נשמרה, והשרת מנווט למסך שלה. מכאן והלאה אין
        // מה לשחזר, והשארת הטיוטה הייתה גורמת לפנייה הבאה להיפתח מלאה
        // בפרטים של הקודמת.
        //
        // ההמתנה לכתיבה שאולי בדרך היא מה שסוגר את החלון האחרון: בלעדיה
        // כתיבה שהתחילה לפני הלחיצה עלולה לנחות **אחרי** הניקוי ולהחיות
        // את הטיוטה.
        await lastSaveRef.current;
        await clearDraft();
      } catch (failure) {
        if (!isNetworkFailure(failure)) {
          submittedRef.current = false;
          throw failure;
        }

        await saveDraft(snapshot(true));
        setRestored("pending");
        // הטיוטה סומנה כממתינה; מכאן והלאה עריכה נוספת תישמר עליה.
        submittedRef.current = false;
      }
    },
    [
      siteId,
      buildingId,
      apartmentId,
      domainId,
      room,
      description,
      recipients,
      tags,
      files,
      snapshot,
    ],
  );

  function run(saveAsDraft: boolean) {
    startTransition(() => submit(saveAsDraft));
  }

  /**
   * ניסיון חוזר אוטומטי כשהחיבור חוזר.
   *
   * זה מה שהופך את "נשמר מקומית" להבטחה ולא לנחמה: המנהל כבר עבר לדירה
   * הבאה, והפנייה יוצאת בלי שיצטרך לזכור לחזור למסך.
   */
  useEffect(() => {
    if (restored !== "pending") return;

    const retry = () => startTransition(() => submit(false));
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [restored, submit]);

  return (
    // pb-28: רצועת הפעולות דביקה בתחתית (sticky), והריפוד נותן לתוכן — למשל
    // טופס יצירת איש מקצוע כשהוא פתוח — מקום להיגלל מעליה במקום להיחסם מאחוריה.
    <div className="flex flex-col gap-4 p-4 pb-28">
      <div>
        <h1 className="text-xl font-bold">{he.ticket.createTitle}</h1>
        <p className="text-sm text-muted">
          {he.ticket.site}: {siteName}
        </p>
      </div>

      {/* המדיה היא הפעולה הראשונה (אפיון מסך 4): בשטח מצלמים לפני שמקלידים.
          בלי ticketId — הפנייה עדיין אינה קיימת; הקלטה ממלאת את התיאור אם ריק. */}
      <MediaPicker variant="prominent" files={files} onChange={setFiles} disabled={busy} />

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

      {/* תגיות — אופציונלי (אפיון מסך 4). קיבוץ פניות תחת נושא משותף. */}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">
          {he.tag.label} ({he.common.optional})
        </span>
        {tags.length > 0 ? (
          <ul aria-label={he.tag.label} className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <li key={tag.id}>
                <span className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-sm text-brand-fg">
                  {tag.label}
                  <button
                    type="button"
                    onClick={() => setTags((prev) => prev.filter((t) => t.id !== tag.id))}
                    aria-label={`${he.tag.remove} ${tag.label}`}
                    className="px-1 text-base leading-none"
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <LearnedSelect
          label={he.tag.add}
          options={availableTags.filter((t) => !tags.some((s) => s.id === t.id))}
          value={null}
          onChange={(id) => {
            const option = availableTags.find((t) => t.id === id);
            if (option) setTags((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, option]));
          }}
          onCreate={async (name) => {
            const created = unwrap(await createTagAction(name));
            setAvailableTags((prev) => [...prev, created]);
            setTags((prev) => (prev.some((t) => t.id === created.id) ? prev : [...prev, created]));
            return created;
          }}
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}

      {/* הבאנר אינו קישוט: הוא ההבטחה שמה שהוקלד לא אבד. בלעדיו המנהל
          רואה מסך שלא הגיב, מניח שהפנייה נשלחה או שנעלמה, ומקליד הכול שוב. */}
      {restored ? (
        <p
          role="status"
          className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm font-medium text-warning"
        >
          {restored === "pending" ? he.notices.savedLocally : he.ticket.draftRestored}
          {restored === "pending" && pending ? ` · ${he.ticket.pendingRetry}` : ""}
        </p>
      ) : null}

      <div className="sticky bottom-0 flex gap-2 border-t border-border bg-bg py-3">
        <button
          type="button"
          onClick={() => run(false)}
          disabled={busy}
          className="min-h-12 flex-1 rounded-xl bg-brand px-4 text-base font-semibold text-brand-fg disabled:opacity-60"
        >
          {he.ticket.submit}
        </button>
        <button
          type="button"
          onClick={() => run(true)}
          disabled={busy}
          className="min-h-12 rounded-xl border border-border bg-surface px-4 text-base font-medium disabled:opacity-60"
        >
          {he.ticket.saveDraft}
        </button>
      </div>
    </div>
  );
}
