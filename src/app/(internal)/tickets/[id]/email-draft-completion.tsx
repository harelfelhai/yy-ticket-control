"use client";

import { useRouter } from "next/navigation";
import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useRef, useState } from "react";
import type { DraftFieldName, Room } from "@/generated/prisma/enums";
import { LearnedSelect, type LearnedOption } from "@/components/learned-select";
import { RecipientPicker, type RecipientOption } from "@/components/recipient-picker";
import { Button } from "@/components/ui/button";
import { cardClasses } from "@/components/ui/card";
import { chipClasses } from "@/components/ui/chip";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Banner, FormError } from "@/components/ui/message";
import { unwrapOrThrow } from "@/lib/action-result";
import type { DraftDisplay, DraftFieldDisplay } from "@/lib/draft/display";
import { he } from "@/lib/he";
import { normalizeText } from "@/lib/normalize";
import { ROOMS } from "@/lib/rooms";
import { useAction } from "@/lib/use-action";
import {
  createApartmentAction,
  createBuildingAction,
  createDomainAction,
  createProfessionalAction,
} from "../new/actions";
import { deleteDraftAction, submitDraftAction, updateTicketFieldsAction } from "./actions";
import { ConflictDialog } from "./conflict-dialog";
import type { BuildingWithApartments } from "./draft-completion";

/**
 * השלמת טיוטה **ממייל** (מסך 7 באפיון, עדכון 1.3).
 *
 * רכיב נפרד מ-`DraftCompletion` של הטיוטה הידנית, ובכוונה (DESIGN.md § לא כל
 * כפילות היא רכיב): מה שמשותף — הבוררים, הפרימיטיבים, הפעולות — חולץ
 * לאטומים, ומה שנשאר שונה הוא **מבנה**:
 *
 * - **כל השדות מוצגים, לא רק החסרים** (EM-S7-03). ערך שחולץ אוטומטית צריך
 *   בדיקה בדיוק כמו ערך חסר; תג "מהמייל" (EM-M03) אומר אילו ערכים אף אדם לא
 *   בדק עדיין, ותג "חסר" אומר מה עוד נדרש לשיגור.
 * - **שמירה מיידית, בלי IndexedDB.** הטיוטה היא מצב משותף עם השולח: תשובה
 *   במייל נמדדת מול חותמת העריכה **בשרת** (§5.ה4), ומה שהוקלד ולא נשמר
 *   אינו קיים מבחינת המיזוג. בוררים נשמרים בבחירה; התיאור והחדר — ביציאה
 *   מהשדה, כי בהם כל הקשה (או חץ במקלדת) הייתה הופכת לשמירה.
 * - **כל שמירה נושאת את טביעת השדה כפי שהוצג** (`fieldVersion`). השרת דוחה
 *   שמירה על שדה שהשתנה מאז — תשובה במייל שפתחה בו סתירה או הוסיפה נמען —
 *   והמסך מתרענן (§7 שורה 86). אחרת העריכה הייתה סוגרת בשקט סתירה שאיש
 *   לא ראה, בדיוק מה שהסימון בטופס נועד למנוע.
 * - **בורר אתר** לבעלים ולמנהל המערכת (טיוטה בלי אתר, §5.ז); למנהל עבודה
 *   האתר נגזר ממנו ומוצג כטקסט.
 * - **סתירה חוסמת שיגור** (EM-S7-04): הודעה עם "השווה ובחר", וכל שדה
 *   בסתירה מסומן גם בטופס.
 *
 * הערכים מגיעים מהשרת בכל רינדור (אחרי כל פעולה העמוד מתרענן), והמצב
 * המקומי מיושר אליהם — ראה `useSyncedState`. רשימות הבחירה (בניינים,
 * תחומים, נמענים) נגזרות מהאתר ומתאפסות כשהוא מתחלף — ראה `useResetOn`.
 */

export interface EmailDraftValues {
  buildingId: string | null;
  apartmentId: string | null;
  room: Room | null;
  domainId: string | null;
  description: string;
  recipients: RecipientOption[];
}

interface EmailDraftCompletionProps {
  ticketId: string;
  /** נוסח הבאנר כפי שהשרת חישב — "חסרים פרטים" רק כשבאמת חסרים (EM-S7-06) */
  banner: string;
  display: DraftDisplay;
  site: LearnedOption | null;
  /** רשימת האתרים לבחירה; `null` — הצופה אינו רשאי להחליף אתר (מנהל עבודה) */
  sites: LearnedOption[] | null;
  buildings: BuildingWithApartments[];
  domains: LearnedOption[];
  recipientOptions: RecipientOption[];
  values: EmailDraftValues;
  /** האם הצופה רשאי לבחור בחלון הסתירות את האתר שהמייל הציע */
  emailSiteAllowed: boolean;
}

type FieldsInput = Parameters<typeof updateTicketFieldsAction>[1];

/**
 * מצב מקומי שמתיישר לערך מהשרת בכל פעם שהוא משתנה — הדפוס של React
 * ל"התאמת state בזמן רינדור", בלי effect. הערך המקומי חי רק בין הלחיצה
 * לבין חזרת הפעולה, כדי שהפקד לא יקפוץ חזרה בזמן ההמתנה.
 */
function useSyncedState<T>(server: T): [T, (next: T) => void] {
  const [synced, setSynced] = useState(server);
  const [value, setValue] = useState(server);
  if (synced !== server) {
    setSynced(server);
    setValue(server);
  }
  return [value, setValue];
}

/**
 * מצב מקומי שמתאפס לערך מהשרת כש-`key` משתנה, ורק אז. הרשימות מתארכות ב"צור
 * חדש" עוד לפני שהשרת מתרענן, ורענון רגיל אינו צריך לדרוס אותן — אבל אתר
 * אחר הוא רשימה אחרת.
 *
 * **לא `key` על הרכיב.** טעינה מחדש של כל הטופס בהחלפת אתר (כך היה עד
 * 1.3) איבדה את המיקוד אחרי הכרעת סתירה באתר, ואת הודעת השגיאה של שמירה
 * שעוד הייתה בדרך.
 */
function useResetOn<T>(server: T, key: unknown): [T, Dispatch<SetStateAction<T>>] {
  const [seen, setSeen] = useState(key);
  const [value, setValue] = useState(server);
  if (seen !== key) {
    setSeen(key);
    setValue(server);
  }
  return [value, setValue];
}

export function EmailDraftCompletion({
  ticketId,
  banner,
  display,
  site,
  sites,
  buildings: initialBuildings,
  domains: initialDomains,
  recipientOptions,
  values,
  emailSiteAllowed,
}: EmailDraftCompletionProps) {
  const router = useRouter();
  // רשימות שמתארכות בעקבות "צור חדש" מקומי, ומתאפסות כשהאתר מתחלף
  const [buildings, setBuildings] = useResetOn(initialBuildings, site?.id);
  const [domains, setDomains] = useResetOn(initialDomains, site?.id);
  const [availableRecipients, setAvailableRecipients] = useResetOn(recipientOptions, site?.id);

  const [siteId, setSiteId] = useSyncedState(site?.id ?? null);
  const [buildingId, setBuildingId] = useSyncedState(values.buildingId);
  const [apartmentId, setApartmentId] = useSyncedState(values.apartmentId);
  const [room, setRoom] = useSyncedState(values.room);
  const [domainId, setDomainId] = useSyncedState(values.domainId);
  const [description, setDescription] = useSyncedState(values.description);
  const [recipients, setRecipients] = useSyncedState(values.recipients);

  const { busy, error, run } = useAction();
  /*
   * **שמירה ביציאה מהשדה עוברת בפעולה נפרדת.** לחיצה על "שגר" מוציאה את
   * המיקוד מהתיאור לפני שהיא נרשמת; אילו שמירת התיאור הייתה נועלת את כל
   * הטופס (`busy`), "שגר" היה מושבת ברגע הלחיצה והלחיצה הייתה נבלעת.
   *
   * **ו"שגר" ממתין לה** (`blurring`). פעולות השרת רצות בזו אחר זו, אבל
   * השיגור אינו תלוי בתוצאת השמירה שלפניו: תיאור שנדחה (§7 שורה 86) היה
   * מתחלף בערך מהשרת — למשל תיאור מתשובה במייל שאיש לא ראה — והטיוטה הייתה
   * משוגרת איתו, בלי דרך חזרה. לכן שמירה שנדחתה עוצרת את השיגור שאחריה,
   * וההודעה שלה נשארת על המסך.
   */
  const blurSave = useAction();
  const blurring = useRef<Promise<boolean> | null>(null);

  const byField = Object.fromEntries(display.fields.map((field) => [field.field, field])) as Record<
    DraftFieldName,
    DraftFieldDisplay
  >;
  const blocked = display.conflictCount > 0;
  const selectedBuilding = buildings.find((b) => b.id === buildingId) ?? null;

  /** מחזיר את הפקדים לערכי השרת — אחרי שמירה שנדחתה, ערך שלא נשמר אינו נשאר על המסך */
  function resetToServer() {
    setSiteId(site?.id ?? null);
    setBuildingId(values.buildingId);
    setApartmentId(values.apartmentId);
    setRoom(values.room);
    setDomainId(values.domainId);
    setDescription(values.description);
    setRecipients(values.recipients);
  }

  /**
   * שמירה מיידית של שדה אחד (או של שדה ומה שתלוי בו), עם טביעת השדות כפי
   * שהוצגו — ראה ההערה בראש הקובץ.
   */
  function save(
    fields: FieldsInput,
    keys: DraftFieldName[],
    runner: typeof run = run,
    settled?: (ok: boolean) => void,
  ) {
    const expected = Object.fromEntries(keys.map((key) => [key, byField[key].version]));
    runner(async () => {
      let ok = false;
      try {
        const result = await updateTicketFieldsAction(ticketId, fields, expected);
        ok = result.ok;
        if (!result.ok) resetToServer();
        return result;
      } finally {
        settled?.(ok);
      }
    });
  }

  /** שמירה ביציאה מהשדה (תיאור, חדר) — "שגר" ממתין לה, ראה `blurring` */
  function saveOnBlur(fields: FieldsInput, keys: DraftFieldName[]) {
    let settle: (ok: boolean) => void = () => {};
    blurring.current = new Promise<boolean>((resolve) => (settle = resolve));
    save(fields, keys, blurSave.run, settle);
  }

  function submit() {
    // שמירה שנדחתה עוצרת את הלחיצה **הזו** בלבד: היא נצרכת כאן, ולחיצה נוספת
    // — אחרי שההודעה והערך העדכני על המסך — משגרת
    const pending = blurring.current;
    blurring.current = null;
    run(async () => {
      if (pending && !(await pending)) return;
      // בלי רשימת נמענים: השירות משגר את הנמענים השמורים בטיוטה, תחת נעילה
      return submitDraftAction(ticketId);
    });
  }

  function remove() {
    if (!window.confirm(he.ticket.confirmDeleteDraft)) return;
    // מצליח: deleteDraftAction מנווט ללוח ואינו מחזיר דבר; חוזר רק בשגיאה
    run(() => deleteDraftAction(ticketId));
  }

  /*
   * **מסך פתוח אינו נשאר ישן.** תשובה במייל יכולה להיקלט בזמן שהמסך פתוח
   * בלשונית אחרת; כשחוזרים אליה העמוד מתרענן. זה משלים את הגנת השרת ולא
   * מחליף אותה: השרת דוחה ממילא שמירה על שדה שהשתנה.
   */
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") router.refresh();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  /*
   * **המיקוד אחרי שהסתירה הוכרעה.** הדיאלוג מחזיר את המיקוד לכפתור שפתח
   * אותו — אבל הכפתור יושב בהודעת הסתירה, שנעלמת עם ההכרעה, והמיקוד היה
   * נופל ל-`<body>`: משתמש מקלדת או קורא מסך היה חוזר לראש העמוד מיד אחרי
   * הפעולה העיקרית של המסך. לכן הוא עובר לטופס — רק אם לא עבר כבר למקום אחר.
   */
  const sectionRef = useRef<HTMLElement>(null);
  const wasBlocked = useRef(blocked);
  useEffect(() => {
    if (wasBlocked.current && !blocked) {
      const active = document.activeElement;
      if (!active || active === document.body) sectionRef.current?.focus();
    }
    wasBlocked.current = blocked;
  }, [blocked]);

  return (
    <section ref={sectionRef} tabIndex={-1} className={cardClasses("flex flex-col gap-3", { tone: "danger" })}>
      <p className="text-sm font-semibold text-danger">{banner}</p>

      {blocked ? (
        <Banner tone="danger" className="flex flex-wrap items-center gap-2">
          <span>{he.emailDraft.conflictBanner(display.conflictCount)}</span>
          <ConflictDialog
            ticketId={ticketId}
            fields={display.fields}
            version={display.version}
            emailSiteAllowed={emailSiteAllowed}
            disabled={busy}
          />
        </Banner>
      ) : null}

      <FieldBlock display={byField.SITE}>
        {sites ? (
          // `LearnedSelect` ולא `<select>` נייטיב: הנייטיב מחליף ערך בכל חץ
          // במקלדת, וכאן החלפה היא שמירה שמאפסת בניין ודירה (כמו במסך 4)
          <LearnedSelect
            label={he.ticket.site}
            options={sites}
            value={siteId}
            disabled={busy}
            onChange={(id) => {
              if (!id || id === siteId) return;
              setSiteId(id);
              setBuildingId(null);
              setApartmentId(null);
              // השרת מאפס בניין ודירה בעצמו, ובלי לסמן אותם כנערכים (§7 שורה 85)
              save({ siteId: id }, ["SITE"]);
            }}
          />
        ) : (
          // ערך שאינו ניתן לשינוי אינו שדה מושבת (DESIGN.md § Field): תווית וטקסט
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{he.ticket.site}</span>
            <span className="text-base">{site?.label ?? he.emailIntake.empty}</span>
          </div>
        )}
      </FieldBlock>

      <FieldBlock display={byField.BUILDING}>
        <LearnedSelect
          label={he.directory.building}
          options={buildings}
          value={buildingId}
          onChange={(id) => {
            // בחירה חוזרת באותו בניין אינה שינוי, ואסור שתמחק את הדירה
            if (id === buildingId) return;
            setBuildingId(id);
            setApartmentId(null);
            // **רק הבניין נשלח.** השרת מאפס את הדירה בעצמו, בלי לסמן אותה
            // כנערכה (§7 שורה 85): דירה שנשלחה כ-null מפורש הייתה נרשמת
            // כעריכה, ותשובה במייל עם דירה הייתה פותחת סתירה מול ערך ריק
            save({ buildingId: id }, ["BUILDING"]);
          }}
          disabled={busy || !site}
          placeholder={site ? undefined : he.ticket.chooseSiteFirst}
          onCreate={
            site
              ? async (name) => {
                  const created = unwrapOrThrow(await createBuildingAction(site.id, name));
                  setBuildings((prev) => [...prev, { ...created, apartments: [] }]);
                  return created;
                }
              : undefined
          }
        />
      </FieldBlock>

      <FieldBlock display={byField.APARTMENT}>
        <LearnedSelect
          label={he.directory.apartment}
          options={selectedBuilding?.apartments ?? []}
          value={apartmentId}
          onChange={(id) => {
            if (id === apartmentId) return;
            setApartmentId(id);
            save({ apartmentId: id }, ["APARTMENT"]);
          }}
          disabled={busy || !selectedBuilding}
          placeholder={selectedBuilding ? undefined : he.ticket.chooseBuildingFirst}
          onCreate={
            site && selectedBuilding
              ? async (number) => {
                  const created = unwrapOrThrow(
                    await createApartmentAction(site.id, selectedBuilding.id, number),
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
      </FieldBlock>

      <FieldBlock display={byField.ROOM}>
        {/* "לא חובה" בתווית, כמו בטופס היצירה — לא כערך ריק שנקרא כאילו נבחר */}
        <Field label={`${he.ticket.room} (${he.common.optional})`}>
          <Select
            value={room ?? ""}
            disabled={busy || blurSave.busy}
            onChange={(event) => setRoom((event.target.value || null) as Room | null)}
            // נשמר ביציאה מהפקד: בבורר נייטיב כל חץ במקלדת מחליף ערך
            onBlur={() => {
              if (room !== values.room) saveOnBlur({ room }, ["ROOM"]);
            }}
          >
            <option value="">{he.common.choose}</option>
            {ROOMS.map((value) => (
              <option key={value} value={value}>
                {he.room[value]}
              </option>
            ))}
          </Select>
        </Field>
      </FieldBlock>

      <FieldBlock display={byField.DOMAIN}>
        <LearnedSelect
          label={he.directory.domain}
          options={domains}
          value={domainId}
          onChange={(id) => {
            if (id === domainId) return;
            setDomainId(id);
            save({ domainId: id }, ["DOMAIN"]);
          }}
          disabled={busy}
          onCreate={async (name) => {
            // תחום חדש נוצר דרך פעולת האתר; בלי אתר אומרים את זה בשורת היצירה
            if (!site) throw new Error(he.ticket.chooseSiteFirst);
            const created = unwrapOrThrow(await createDomainAction(site.id, name));
            setDomains((prev) => [...prev, created]);
            return created;
          }}
        />
      </FieldBlock>

      <FieldBlock display={byField.DESCRIPTION}>
        <Field label={he.ticket.description}>
          <Textarea
            value={description}
            rows={4}
            disabled={busy || blurSave.busy}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => {
              // אותו נרמול שהשרת עושה: שינוי ברווחים בלבד אינו עריכה, ושמירתו
              // הייתה מורידה את תג "מהמייל" וסוגרת סתירה על טקסט שלא השתנה
              if (normalizeText(description) === normalizeText(values.description)) {
                if (description !== values.description) setDescription(values.description);
                return;
              }
              saveOnBlur({ description }, ["DESCRIPTION"]);
            }}
          />
        </Field>
      </FieldBlock>

      <FieldBlock display={byField.RECIPIENTS}>
        <RecipientPicker
          options={availableRecipients}
          value={recipients}
          disabled={busy}
          onChange={(next) => {
            setRecipients(next);
            save({ recipients: next.map((r) => ({ kind: r.kind, id: r.id })) }, ["RECIPIENTS"]);
          }}
          // יצירת איש מקצוע עוברת דרך פעולת האתר; בלי אתר אין לו בית, ולכן
          // אין כפתור — ולא טופס שנכשל רק אחרי שמולא
          onCreateProfessional={
            site
              ? async (input) => {
                  const created = unwrapOrThrow(await createProfessionalAction(site.id, input));
                  const option: RecipientOption = { ...created, kind: "professional" };
                  setAvailableRecipients((prev) => [...prev, option]);
                  return option;
                }
              : undefined
          }
        />
      </FieldBlock>

      {error ? <FormError>{error}</FormError> : null}
      {blurSave.error ? <FormError>{blurSave.error}</FormError> : null}

      <div className="flex gap-2">
        {/* מושבת בסתירה — וההסבר הוא הודעת הסתירה שמעל; השרת חוסם ממילא */}
        <Button onClick={submit} disabled={busy || blocked} className="flex-1">
          {he.ticket.submitDraftButton}
        </Button>
        <Button variant="dangerOutline" onClick={remove} disabled={busy}>
          {he.ticket.deleteDraft}
        </Button>
      </div>
    </section>
  );
}

/**
 * עוטף שדה עם התגים שלו — מתחת לפקד ולא בתוך התווית, כי התווית היא השם
 * הנגיש של הפקד (DESIGN.md § תגי שדה). שדה בסתירה מקבל גם קו בצד ההתחלה
 * וגם תג: צבע אינו נשא מידע יחיד. `data-field` הוא עוגן לבדיקות, שבודקות
 * שהתג יושב ליד השדה הנכון ולא רק שקיים תג כזה במסך.
 */
function FieldBlock({ display, children }: { display: DraftFieldDisplay; children: ReactNode }) {
  const tags = display.fromEmail || display.conflict || display.missing;
  return (
    <div
      data-field={display.field}
      className={display.conflict ? "flex flex-col gap-1 border-s-2 border-s-danger ps-2" : "flex flex-col gap-1"}
    >
      {children}
      {tags ? (
        <p className="flex flex-wrap gap-1">
          {display.missing ? <span className={chipClasses("danger")}>{he.emailDraft.missingTag}</span> : null}
          {display.conflict ? <span className={chipClasses("danger")}>{he.emailDraft.conflictTag}</span> : null}
          {display.fromEmail ? <span className={chipClasses("info")}>{he.emailDraft.fromEmailTag}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
