import type { DraftFieldName, Room } from "@/generated/prisma/enums";

/**
 * מודל השדות של טיוטה ממייל — מה שמנוע המיזוג (`merge.ts`) עובד עליו.
 *
 * **טהור לחלוטין:** בלי DB, בלי שעון ובלי מזהים שנוצרים כאן. שכבת השירות
 * טוענת את הפנייה ואת שורות `DraftField` לתוך `DraftState`, מריצה עליו את
 * המנוע, וכותבת בחזרה את מה שהשתנה. כך כל שורה בטבלת §5.ה4 באפיון היא מקרה
 * בבדיקת טבלה, בלי בסיס נתונים.
 *
 * **שני חלקים לכל טיוטה, ובכוונה נפרדים:**
 * - `values` — הערכים עצמם, כפי שהם יושבים על `Ticket` ובנמעני הטיוטה. אלה
 *   הערכים של כל טיוטה, גם כזו שלא נפתחה במייל.
 * - `meta` — מה שהמייל מוסיף לשאלה: מי קבע כל ערך, מתי נערך במערכת, והאם
 *   יש סתירה עם המייל האחרון. זו השורה ב-`DraftField`.
 */

export type { DraftFieldName };

/** סדר השדות — גם סדר ההצגה במייל החוזר ובחלון הסתירות */
export const DRAFT_FIELDS = [
  "SITE",
  "BUILDING",
  "APARTMENT",
  "ROOM",
  "DOMAIN",
  "DESCRIPTION",
  "RECIPIENTS",
] as const satisfies readonly DraftFieldName[];

/** שדות החובה לשיגור (§3.2). חדר אינו חובה. */
export const REQUIRED_FIELDS = [
  "SITE",
  "BUILDING",
  "APARTMENT",
  "DOMAIN",
  "DESCRIPTION",
  "RECIPIENTS",
] as const satisfies readonly DraftFieldName[];

/**
 * שדות שמתאפסים כשהשדה שהם תלויים בו משתנה (§5.ה4, "האתר או הבניין
 * השתנו"; מסך 4). **הנמענים אינם כאן** — החלפת אתר אינה מסירה נמענים
 * (אפיון 1.3.1, §7 שורה 70).
 */
export const DEPENDENTS: Readonly<Partial<Record<DraftFieldName, readonly DraftFieldName[]>>> = {
  SITE: ["BUILDING", "APARTMENT"],
  BUILDING: ["APARTMENT"],
};

export type RecipientKind = "professional" | "user";

export interface RecipientRef {
  kind: RecipientKind;
  id: string;
}

/**
 * מי קבע את נוכחותו של נמען בטיוטה.
 *
 * - `EMAIL` — נוסף מתוך מייל ואיש לא ערך את רשימת הנמענים במערכת מאז.
 *   הסרה שלו בתשובה במייל אינה סתירה.
 * - `SYSTEM` — היה ברשימה כשנערכה במערכת (או הוכרע במסך 7א). הסרה שלו
 *   בתשובה מאוחרת היא סתירה (§5.ה4).
 */
export type RecipientOrigin = "EMAIL" | "SYSTEM";

/**
 * נמען בטיוטה, כפי שהוא נשמר ב-`Ticket.draftRecipients`.
 *
 * **`removedBySystemAt` הוא מצבה, לא נמען פעיל.** נמען שהוסר במערכת נשאר
 * ברשימה עם חותמת ההסרה, כדי שתשובה מאוחרת שמוסיפה אותו תזוהה כסתירה
 * (§5.ה4: "תשובה במייל מוסיפה נמען שהוסר במערכת"). כל קורא שמבקש את
 * הנמענים בפועל משתמש ב-`activeRecipients`.
 *
 * ערכים שנשמרו לפני 1.3 הם `{kind, id}` בלבד, ונקראים כ-`SYSTEM` — ראה
 * `parseDraftRecipients`.
 */
export interface DraftRecipient extends RecipientRef {
  origin: RecipientOrigin;
  /** ISO. מתי הוסר במערכת; null/חסר — פעיל */
  removedBySystemAt?: string | null;
}

export interface DraftValues {
  /** null בטיוטה ממייל שלא זוהה בה אתר */
  siteId: string | null;
  buildingId: string | null;
  apartmentId: string | null;
  room: Room | null;
  domainId: string | null;
  description: string;
  /** כולל מצבות — ראה `DraftRecipient` */
  recipients: DraftRecipient[];
}

/** הצעת המייל לנמענים, ברמת פריט — מה שנשמר ב-`emailValue` של RECIPIENTS */
export interface RecipientsProposal {
  add: RecipientRef[];
  remove: RecipientRef[];
}

/** הצעת המייל לתיאור */
export interface DescriptionProposal {
  op: "set" | "append" | "replace";
  text: string;
}

/**
 * הערך מהמייל שנשמר בסתירה (`DraftField.emailValue`), לפי שדה.
 *
 * לשדות סקלריים זה הערך עצמו; לתיאור — הטקסט המוצע כולו (append אינו סתירה
 * ולכן לעולם אינו כאן); לנמענים — הפריטים שבסתירה בלבד.
 */
export type EmailValue =
  | { field: "SITE"; siteId: string }
  | { field: "BUILDING"; buildingId: string }
  | { field: "APARTMENT"; apartmentId: string }
  | { field: "ROOM"; room: Room }
  | { field: "DOMAIN"; domainId: string }
  | { field: "DESCRIPTION"; text: string }
  | { field: "RECIPIENTS"; add: RecipientRef[]; remove: RecipientRef[] };

export interface FieldMeta {
  /** תג "מהמייל" */
  fromEmail: boolean;
  /** מתי נערך במערכת לאחרונה (כולל הכרעה במסך 7א) */
  systemEditedAt: Date | null;
  conflict: boolean;
  emailValue: EmailValue | null;
  /** `MailboxMessage.id` של המייל שהציע את `emailValue` */
  emailMessageId: string | null;
}

export type DraftMeta = Record<DraftFieldName, FieldMeta>;

export interface DraftState {
  values: DraftValues;
  meta: DraftMeta;
}

export function emptyMeta(): FieldMeta {
  return { fromEmail: false, systemEditedAt: null, conflict: false, emailValue: null, emailMessageId: null };
}

export function emptyDraftMeta(): DraftMeta {
  return Object.fromEntries(DRAFT_FIELDS.map((field) => [field, emptyMeta()])) as DraftMeta;
}

export function emptyDraftValues(): DraftValues {
  return {
    siteId: null,
    buildingId: null,
    apartmentId: null,
    room: null,
    domainId: null,
    description: "",
    recipients: [],
  };
}

/** הנמענים בפועל — בלי מצבות */
export function activeRecipients(recipients: readonly DraftRecipient[]): DraftRecipient[] {
  return recipients.filter((r) => !r.removedBySystemAt);
}

export function sameRecipient(a: RecipientRef, b: RecipientRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/**
 * מסיר כפילויות ברשימת נמענים, לפי הופעה ראשונה. **המקור היחיד** לכלל:
 * גם השיוך במערכת (`services/tickets.ts`) וגם מנוע המיזוג עוברים כאן.
 *
 * מנהל שבוחר את אותו קבלן פעמיים (למשל אחרי חיפוש חוזר) היה מייצר שני
 * שיוכים לאותו אדם — ואז "2 מתוך 3 סיימו" סופר אותו פעמיים.
 */
export function dedupeRecipients<T extends RecipientRef>(recipients: readonly T[]): T[] {
  const seen = new Set<string>();
  return recipients.filter((r) => {
    const key = `${r.kind}:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * קורא את `Ticket.draftRecipients` כפי שנשמר — כולל הצורה שלפני 1.3.
 *
 * JSON מהמסד אינו מבטיח צורה, ולכן כל פריט שאינו נמען תקין נזרק בשקט ולא
 * מפיל את מסך הטיוטה: טיוטה שנפתחת בלי נמען אחד עדיפה על טיוטה שאינה
 * נפתחת כלל.
 */
export function parseDraftRecipients(raw: unknown): DraftRecipient[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): DraftRecipient[] => {
    if (!item || typeof item !== "object") return [];
    const { kind, id, origin, removedBySystemAt } = item as Record<string, unknown>;
    if ((kind !== "professional" && kind !== "user") || typeof id !== "string" || !id) return [];
    return [
      {
        kind,
        id,
        origin: origin === "EMAIL" ? "EMAIL" : "SYSTEM",
        removedBySystemAt: typeof removedBySystemAt === "string" ? removedBySystemAt : null,
      },
    ];
  });
}

/** ערך השדה כפי שהוא ב-`values`, לצורך השוואה והצגה */
export function fieldValue(values: DraftValues, field: DraftFieldName): unknown {
  switch (field) {
    case "SITE":
      return values.siteId;
    case "BUILDING":
      return values.buildingId;
    case "APARTMENT":
      return values.apartmentId;
    case "ROOM":
      return values.room;
    case "DOMAIN":
      return values.domainId;
    case "DESCRIPTION":
      return values.description;
    case "RECIPIENTS":
      return activeRecipients(values.recipients).map(({ kind, id }) => ({ kind, id }));
  }
}

/** האם שדה חובה ריק. חדר אינו חובה ולכן לעולם אינו "חסר". */
export function isMissing(values: DraftValues, field: DraftFieldName): boolean {
  switch (field) {
    case "SITE":
      return !values.siteId;
    case "BUILDING":
      return !values.buildingId;
    case "APARTMENT":
      return !values.apartmentId;
    case "ROOM":
      return false;
    case "DOMAIN":
      return !values.domainId;
    case "DESCRIPTION":
      return values.description.trim().length === 0;
    case "RECIPIENTS":
      return activeRecipients(values.recipients).length === 0;
  }
}

export function missingFields(values: DraftValues): DraftFieldName[] {
  return REQUIRED_FIELDS.filter((field) => isMissing(values, field));
}

export function conflictFields(meta: DraftMeta): DraftFieldName[] {
  return DRAFT_FIELDS.filter((field) => meta[field].conflict);
}
