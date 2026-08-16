"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LearnedSelect, type LearnedOption } from "@/components/learned-select";
import { type AttachedFile, MediaPicker } from "@/components/media-picker";
import { RecipientPicker, type RecipientOption } from "@/components/recipient-picker";
import type { Room } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { he } from "@/lib/he";
import { ROOMS } from "@/lib/rooms";
import {
  type OfflineDraft,
  clearDraft,
  isEmptyDraft,
  isNetworkFailure,
  loadDraft,
  resolveDraftSite,
  saveDraft,
} from "@/lib/offline-draft";
import { useAction } from "@/lib/use-action";
import { unwrapOrThrow } from "@/lib/action-result";
import { CONTENT_WIDTH, TITLE_DESCRIPTIVE } from "@/lib/ui";
import { chipClasses } from "@/components/ui/chip";
import {
  createApartmentAction,
  createBuildingAction,
  createDomainAction,
  createProfessionalAction,
  createTagAction,
  createTicketAction,
} from "./actions";
import { Banner, FormError } from "@/components/ui/message";

/**
 * הופך תוצאת פעולה לערך או לחריגה.
 *
 * ה-Server Actions מחזירות שגיאות כערך (כי Next מצנזר הודעות של חריגות
 * בפרודקשן), בעוד שהבוררים מצפים לחריגה כדי להציג את ההודעה במקום.
 * ההמרה מרוכזת כאן ולא משוכפלת בכל קריאה.
 */

export interface BuildingWithApartments extends LearnedOption {
  apartments: LearnedOption[];
}

/**
 * נמען פנימי, עם האתר שאליו הוא משויך.
 *
 * ‏`siteId: null` הוא מנהל מערכת או בעלים — הם אינם קשורים לאתר וזמינים
 * בכולם. השדה נשלח ללקוח כדי שהחלפת אתר תסנן מיד, בלי סבב רשת: **נמען
 * פנימי מאתר אחר יקבל את הפנייה אך לא יוכל לראות אותה** (`canViewTicket`
 * משווה `siteId`), כלומר שיוך שנשבר בשקט.
 */
export interface InternalRecipientOption extends RecipientOption {
  kind: "user";
  siteId: string | null;
}

interface CreateTicketFormProps {
  sites: LearnedOption[];
  /** האתר שנבחר מראש: היחיד שיש למשתמש, או `?site=`. `null` = טרם נבחר */
  initialSiteId: string | null;
  buildingsBySite: Record<string, BuildingWithApartments[]>;
  domains: LearnedOption[];
  professionals: RecipientOption[];
  internalUsers: InternalRecipientOption[];
  tags: LearnedOption[];
}

/**
 * מסך יצירת פנייה מהירה (מסך 4 באפיון).
 *
 * מסך אחד ולא אשף רב-שלבי, במכוון: מנהל עבודה עומד מול הדירה ומזין ביד
 * אחת. כל מעבר מסך הוא הזדמנות לאבד את מה שהוקלד. מאותה סיבה גם **האתר
 * הוא שדה כאן ולא מסך שקודם לטופס**: מסך ביניים שאין ממנו חזרה הכריח לנחש
 * כתובת כדי להחליף אתר.
 *
 * הרשימות שנוצרות תוך כדי (בניין חדש, תחום חדש) נוספות למצב המקומי מיד,
 * כדי שהבחירה תמשיך בלי רענון של כל המסך.
 */
export function CreateTicketForm({
  sites,
  initialSiteId,
  buildingsBySite: initialBuildingsBySite,
  domains: initialDomains,
  professionals: initialProfessionals,
  internalUsers,
  tags: initialTags,
}: CreateTicketFormProps) {
  const [siteId, setSiteId] = useState<string | null>(initialSiteId);
  const [buildingsBySite, setBuildingsBySite] = useState(initialBuildingsBySite);
  const [domains, setDomains] = useState(initialDomains);
  const [professionals, setProfessionals] = useState(initialProfessionals);
  const [availableTags, setAvailableTags] = useState(initialTags);

  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [apartmentId, setApartmentId] = useState<string | null>(null);
  const [domainId, setDomainId] = useState<string | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [recipients, setRecipients] = useState<RecipientOption[]>([]);
  const [tags, setTags] = useState<LearnedOption[]>([]);
  const [files, setFiles] = useState<AttachedFile[]>([]);
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
  /** שחזור הטיוטה נעשה פעם אחת בלבד — ראה ההערה על ה-effect */
  const restoreStartedRef = useRef(false);
  /**
   * ‏`start` ולא `run`: השיגור כאן עטוף ב-try/catch על **כשל רשת** — מקרה
   * שאינו `ActionResult` כלל, כי הבקשה לא הגיעה לשרת ו-`guard` לא רץ. הוא
   * נופל חזרה לטיוטה מקומית, מסמן אותה כממתינה, ומנסה שוב באירוע `online`.
   *
   * ‏`busy` מגיע מה-hook ומכיל את תנאי ה-hydration: לחיצה על "שלח" לפני
   * שהמטפלים חוברו נבלעת בשקט, והמנהל בשטח מניח שהפנייה נשלחה.
   */
  const { busy, pending, error, setError, start } = useAction();

  const buildings = siteId ? (buildingsBySite[siteId] ?? []) : [];
  const selectedBuilding = buildings.find((b) => b.id === buildingId) ?? null;

  /**
   * הנמענים הזמינים לאתר הנבחר.
   *
   * אנשי מקצוע גלובליים; משתמשים פנימיים מסוננים לפי האתר, בדיוק כפי
   * שהשרת סינן אותם קודם. בלי הסינון הזה מנהל מערכת יכול לשייך פנייה של
   * אתר א׳ למנהל של אתר ב׳ — הוא יקבל אותה ולא יוכל לפתוח אותה.
   */
  const availableRecipients = useMemo<RecipientOption[]>(
    () => [
      ...professionals,
      ...internalUsers.filter((u) => u.siteId === null || u.siteId === siteId),
    ],
    [professionals, internalUsers, siteId],
  );

  const roomOptions = useMemo(
    () => ROOMS.map((value) => ({ id: value, label: he.room[value] })),
    [],
  );

  /**
   * החלפת אתר.
   *
   * מאפסת בניין ודירה (הם שייכים לאתר), ומשליכה נמענים פנימיים שאינם
   * זמינים באתר החדש. השארתם הייתה משגרת פנייה לנמען שאינו רשאי לראותה —
   * כישלון שקט, שהוא בדיוק מה שהמערכת נועדה למנוע.
   */
  function changeSite(next: string | null) {
    setSiteId(next);
    setBuildingId(null);
    setApartmentId(null);
    setRecipients((prev) =>
      prev.filter((r) => {
        if (r.kind === "professional") return true;
        const user = internalUsers.find((u) => u.id === r.id);
        return user ? user.siteId === null || user.siteId === next : false;
      }),
    );
  }

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

  /**
   * משחזר טיוטה שנשארה מכניסה קודמת.
   *
   * **האתר מגיע מהטיוטה ולא מהמסך.** קודם לכן טיוטה שהאתר שלה לא תאם
   * נזרקה בשקט — התנהגות שהייתה סבירה כשהאתר נבחר במסך שקדם לטופס, ושהיא
   * אובדן נתונים עכשיו: המשתמש חוזר למסך, נפתח לו אתר אחר כברירת מחדל,
   * ומה שהקליד נעלם. התנאי היחיד שנשאר הוא שהאתר עדיין מוצע לו — טיוטה
   * שנשמרה לפני שהרשאתו השתנתה לא תשחזר אתר שאינו שלו.
   */
  useEffect(() => {
    // ‏ref ולא מערך תלויות ריק: הפרופס מגיעים מרכיב שרת ומקבלים זהות חדשה
    // בכל רינדור שלו, כך שהתלות בהם הייתה מריצה את השחזור שוב — ודורסת את
    // מה שהמשתמש מקליד באותו רגע. ההערה למטה תמיד תיארה "פעם אחת"; זה מה
    // שמממש אותה בפועל.
    if (restoreStartedRef.current) return;
    restoreStartedRef.current = true;

    let cancelled = false;

    void loadDraft().then((draft) => {
      if (cancelled || !draft) {
        setRestoring(false);
        return;
      }

      const draftSite = resolveDraftSite(
        draft.siteId,
        sites.map((s) => s.id),
      );
      if (draftSite === null) {
        setRestoring(false);
        return;
      }
      if (draftSite !== undefined) setSiteId(draftSite);

      setBuildingId(draft.buildingId);
      setApartmentId(draft.apartmentId);
      setDomainId(draft.domainId);
      setRoom(draft.room);
      setDescription(draft.description);
      setRecipients(
        draft.recipientIds
          .map((ref) =>
            [...initialProfessionals, ...internalUsers].find(
              (o) => o.id === ref.id && o.kind === ref.kind,
            ),
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
  }, [sites, initialProfessionals, internalUsers, initialTags]);

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

      // אתר הוא שדה חובה גם לטיוטה: הפנייה שייכת לאתר כבר ברמת הסכימה
      // (`Ticket.siteId` אינו nullable), ולכן אין מה לשלוח בלעדיו. הבדיקה
      // כאן ולא בהשבתת הכפתור — כפתור מושבת בלי הסבר הוא בדיוק התקלה
      // שדווחה בשעתו על "יש לי שאלה" בפורטל (הכפתור הוסר ב-0.4; הלקח נשאר).
      if (!siteId) {
        setError(he.ticket.siteRequired);
        return;
      }

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

        if (result && !result.ok) {
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
      // יציבים לכל אורך חיי הרכיב (setter של useState, ו-startTransition),
      // ולכן אינם משנים את זהות `submit` — נרשמים כדי שהכלל יישאר נאכף.
      setError,
    ],
  );

  function send(saveAsDraft: boolean) {
    start(() => submit(saveAsDraft));
  }

  /**
   * ניסיון חוזר אוטומטי כשהחיבור חוזר.
   *
   * זה מה שהופך את "נשמר מקומית" להבטחה ולא לנחמה: המנהל כבר עבר לדירה
   * הבאה, והפנייה יוצאת בלי שיצטרך לזכור לחזור למסך.
   */
  useEffect(() => {
    if (restored !== "pending") return;

    const retry = () => start(() => submit(false));
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [restored, submit, start]);

  return (
    // pb-28: רצועת הפעולות דביקה בתחתית (sticky), והריפוד נותן לתוכן — למשל
    // טופס יצירת איש מקצוע כשהוא פתוח — מקום להיגלל מעליה במקום להיחסם מאחוריה.
    <div className={`flex flex-col gap-4 p-4 pb-28 ${CONTENT_WIDTH}`}>
      <h1 className={TITLE_DESCRIPTIVE}>{he.ticket.createTitle}</h1>

      {/* המדיה היא הפעולה הראשונה (אפיון מסך 4): בשטח מצלמים לפני שמקלידים.
          בלי ticketId — הפנייה עדיין אינה קיימת; הקלטה ממלאת את התיאור אם ריק. */}
      <MediaPicker variant="prominent" files={files} onChange={setFiles} disabled={busy} />

      {/*
        האתר הוא שדה בטופס ולא מסך שקודם לו.

        **כשיש אתר אחד זו אינה בחירה, ולכן זה אינו בורר.** הגרסה הראשונה
        רינדרה `LearnedSelect` מושבת, וסבב הצילומים חשף למה זה שגוי:
        ‏`disabled:opacity-60` צבע את שם האתר באותו אפור בדיוק כמו
        ה-placeholder "בחר בניין תחילה" שמתחתיו — שני שדות עמומים, ואי
        אפשר לדעת מהסריקה מי מהם מחזיק ערך ומי ממתין. על מסך בשמש זה ההבדל
        בין קריאה לניחוש. בורר שלעולם אינו נפתח הוא גם הבטחה שקרית:
        ‏`aria-haspopup="listbox"` על כפתור שאין לו מה להציע.
      */}
      {sites.length === 1 ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{he.ticket.site}</span>
          <span>{sites[0].label}</span>
        </div>
      ) : (
        <LearnedSelect
          label={he.ticket.site}
          options={sites}
          value={siteId}
          onChange={changeSite}
        />
      )}

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
        disabled={!siteId}
        placeholder={siteId ? undefined : he.ticket.chooseSiteFirst}
        onCreate={
          siteId
            ? async (name) => {
                const created = unwrapOrThrow(await createBuildingAction(siteId, name));
                setBuildingsBySite((prev) => ({
                  ...prev,
                  [siteId]: [...(prev[siteId] ?? []), { ...created, apartments: [] }],
                }));
                return created;
              }
            : undefined
        }
      />

      <LearnedSelect
        label={he.directory.apartment}
        options={selectedBuilding?.apartments ?? []}
        value={apartmentId}
        onChange={setApartmentId}
        disabled={!selectedBuilding}
        placeholder={selectedBuilding ? undefined : he.ticket.chooseBuildingFirst}
        onCreate={
          siteId && selectedBuilding
            ? async (number) => {
                const created = unwrapOrThrow(
                  await createApartmentAction(siteId, selectedBuilding.id, number),
                );
                setBuildingsBySite((prev) => ({
                  ...prev,
                  [siteId]: (prev[siteId] ?? []).map((b) =>
                    b.id === selectedBuilding.id
                      ? { ...b, apartments: [...b.apartments, created] }
                      : b,
                  ),
                }));
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
        disabled={!siteId}
        placeholder={siteId ? undefined : he.ticket.chooseSiteFirst}
        onCreate={
          siteId
            ? async (name) => {
                const created = unwrapOrThrow(await createDomainAction(siteId, name));
                setDomains((prev) => [...prev, created]);
                return created;
              }
            : undefined
        }
      />

      {/* רשימה קבועה שאינה נלמדת (אפיון §3.3) — ולכן בלי onCreate */}
      <LearnedSelect
        label={`${he.ticket.room} (${he.common.optional})`}
        options={roomOptions}
        value={room}
        onChange={setRoom}
      />

      <Field label={he.ticket.description}>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
        />
      </Field>

      <div className="flex flex-col gap-1">
        <RecipientPicker
          options={availableRecipients}
          value={recipients}
          onChange={setRecipients}
          onCreateProfessional={async (input) => {
            if (!siteId) throw new Error(he.ticket.siteRequired);
            const created = unwrapOrThrow(await createProfessionalAction(siteId, input));
            const option: RecipientOption = { ...created, kind: "professional" };
            setProfessionals((prev) => [...prev, option]);
            return option;
          }}
        />
      </div>

      {/* תגיות — אופציונלי (אפיון מסך 4). קיבוץ פניות תחת נושא משותף.
          לא `Field`: אין כאן פקד יחיד לעטוף, ו-`<label>` סביב רשימת צ׳יפים
          אינו קישור אמיתי. `gap-1` הוא בכוונה אותו מרווח כותרת→תוכן. */}
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">
          {he.tag.label} ({he.common.optional})
        </span>
        {tags.length > 0 ? (
          <ul aria-label={he.tag.label} className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <li key={tag.id}>
                <span className={chipClasses("brand", "solid", "large")}>
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
            const created = unwrapOrThrow(await createTagAction(name));
            setAvailableTags((prev) => [...prev, created]);
            setTags((prev) => (prev.some((t) => t.id === created.id) ? prev : [...prev, created]));
            return created;
          }}
        />
      </div>

      {error ? (
        <FormError>
          {error}
        </FormError>
      ) : null}

      {/* הבאנר אינו קישוט: הוא ההבטחה שמה שהוקלד לא אבד. בלעדיו המנהל
          רואה מסך שלא הגיב, מניח שהפנייה נשלחה או שנעלמה, ומקליד הכול שוב. */}
      {restored ? (
        <Banner tone="warning">
          {restored === "pending" ? he.notices.savedLocally : he.ticket.draftRestored}
          {restored === "pending" && pending ? ` · ${he.ticket.pendingRetry}` : ""}
        </Banner>
      ) : null}

      <div className="sticky bottom-0 flex gap-2 border-t border-border bg-bg py-3">
        <Button onClick={() => send(false)} disabled={busy} className="flex-1">
          {he.ticket.submit}
        </Button>
        <Button variant="secondary" onClick={() => send(true)} disabled={busy}>
          {he.ticket.saveDraft}
        </Button>
      </div>
    </div>
  );
}
