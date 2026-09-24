import type { DraftFieldName } from "@/generated/prisma/enums";
import { he } from "@/lib/he";
import {
  DRAFT_FIELDS,
  type DraftState,
  type EmailValue,
  type RecipientRef,
  activeRecipients,
  isMissing,
} from "./fields";
import { DRAFT_FIELD_LABEL } from "./labels";
import { conflictsVersion, fieldVersion } from "./state";

/**
 * טיוטה ממייל כפי שמסך 7 וחלון הסתירות (מסך 7א) מציגים אותה — **טהור**.
 *
 * `DraftState` מחזיק מזהים (בניין, דירה, נמענים); המסך מציג שמות. התרגום
 * נעשה כאן, על מפות שמות שהשירות (`services/draft-display.ts`) טוען מראש,
 * כך שהחלק שמחליט **מה** מוצג — איזה שדה בסתירה, מה הערך מהמייל, מה חסר —
 * נבדק בלי בסיס נתונים, ואותה שורה משרתת את שני המסכים: התג "מהמייל"
 * וסימון הסתירה בטופס (מסך 7), ושתי העמודות "במערכת" / "מהמייל" בחלון.
 *
 * הערך מהמייל מוצג **רק בסתירה**: `emailValue` נשמר בדיוק למקרה הזה
 * (§5.ה4 — "מחליף ממתין קודם"), ומחוץ לסתירה אין ערך מהמייל שאדם צריך
 * להכריע עליו.
 */

export interface DraftLabels {
  site: ReadonlyMap<string, string>;
  building: ReadonlyMap<string, string>;
  apartment: ReadonlyMap<string, string>;
  domain: ReadonlyMap<string, string>;
  professional: ReadonlyMap<string, string>;
  user: ReadonlyMap<string, string>;
}

export type DraftLabelKind = keyof DraftLabels;

export interface DraftFieldDisplay {
  field: DraftFieldName;
  /** שם השדה כפי שהמשתמש מכיר אותו — `DRAFT_FIELD_LABEL` */
  label: string;
  /** הערך במערכת כטקסט; ריק — `he.emailIntake.empty` ("—"), כמו במייל החוזר */
  systemText: string;
  /** הערך מהמייל האחרון, כטקסט, כשיש סתירה; אחרת null */
  emailText: string | null;
  conflict: boolean;
  /** תג "מהמייל" (EM-M03) */
  fromEmail: boolean;
  /** שדה חובה ריק */
  missing: boolean;
  /** `fieldVersion` — נשלח עם שמירת השדה, כדי שהשרת ידחה שמירה על ערך שהשתנה מאז */
  version: string;
}

export interface DraftDisplay {
  /** בסדר `DRAFT_FIELDS` — גם סדר המייל החוזר וגם סדר חלון הסתירות */
  fields: DraftFieldDisplay[];
  conflictCount: number;
  /** הטביעה שחלון הסתירות שולח בחזרה — `conflictsVersion` */
  version: string;
}

/** כל המזהים שצריך שם עבורם — מהערכים ומהערכים שממתינים בסתירה */
export function draftLabelIds(state: DraftState): Record<DraftLabelKind, Set<string>> {
  const ids: Record<DraftLabelKind, Set<string>> = {
    site: new Set(),
    building: new Set(),
    apartment: new Set(),
    domain: new Set(),
    professional: new Set(),
    user: new Set(),
  };
  const addRef = (ref: RecipientRef) => ids[ref.kind].add(ref.id);

  const values = state.values;
  if (values.siteId) ids.site.add(values.siteId);
  if (values.buildingId) ids.building.add(values.buildingId);
  if (values.apartmentId) ids.apartment.add(values.apartmentId);
  if (values.domainId) ids.domain.add(values.domainId);
  // גם מצבות: נמען שהוסר במערכת אינו מוצג, אבל הצעת מייל להחזירו מוצגת בשמו
  values.recipients.forEach(addRef);

  for (const field of DRAFT_FIELDS) {
    const email = state.meta[field].emailValue;
    if (!email) continue;
    switch (email.field) {
      case "SITE":
        ids.site.add(email.siteId);
        break;
      case "BUILDING":
        ids.building.add(email.buildingId);
        break;
      case "APARTMENT":
        ids.apartment.add(email.apartmentId);
        break;
      case "DOMAIN":
        ids.domain.add(email.domainId);
        break;
      case "RECIPIENTS":
        email.add.forEach(addRef);
        email.remove.forEach(addRef);
        break;
      case "ROOM":
      case "DESCRIPTION":
        break;
    }
  }
  return ids;
}

export function describeDraftFields(state: DraftState, labels: DraftLabels): DraftDisplay {
  const fields = DRAFT_FIELDS.map((field): DraftFieldDisplay => {
    const meta = state.meta[field];
    return {
      field,
      label: DRAFT_FIELD_LABEL[field],
      systemText: systemText(state, field, labels),
      emailText: meta.conflict && meta.emailValue ? emailText(meta.emailValue, labels) : null,
      conflict: meta.conflict,
      fromEmail: meta.fromEmail,
      missing: isMissing(state.values, field),
      version: fieldVersion(state, field),
    };
  });
  return {
    fields,
    conflictCount: fields.filter((f) => f.conflict).length,
    version: conflictsVersion(state),
  };
}

/**
 * מזהה שאין לו שם — בניין שנמחק אחרי שהמייל הציע אותו, למשל. מוצג במילים
 * ולא כמזהה גולמי: המזהה אינו אומר למשתמש דבר, ו"לא נמצא" אומר לו מה לעשות.
 */
function nameOf(map: ReadonlyMap<string, string>, id: string): string {
  return map.get(id) ?? he.emailDraft.unknownRecord;
}

function namesOf(refs: readonly RecipientRef[], labels: DraftLabels): string {
  return refs.map((ref) => nameOf(labels[ref.kind], ref.id)).join(he.emailIntake.listSeparator);
}

function systemText(state: DraftState, field: DraftFieldName, labels: DraftLabels): string {
  const empty = he.emailIntake.empty;
  const values = state.values;
  switch (field) {
    case "SITE":
      return values.siteId ? nameOf(labels.site, values.siteId) : empty;
    case "BUILDING":
      return values.buildingId ? nameOf(labels.building, values.buildingId) : empty;
    case "APARTMENT":
      return values.apartmentId ? nameOf(labels.apartment, values.apartmentId) : empty;
    case "ROOM":
      return values.room ? he.room[values.room] : empty;
    case "DOMAIN":
      return values.domainId ? nameOf(labels.domain, values.domainId) : empty;
    case "DESCRIPTION":
      return values.description.trim() || empty;
    case "RECIPIENTS": {
      const active = activeRecipients(values.recipients);
      return active.length > 0 ? namesOf(active, labels) : empty;
    }
  }
}

function emailText(value: EmailValue, labels: DraftLabels): string {
  switch (value.field) {
    case "SITE":
      return nameOf(labels.site, value.siteId);
    case "BUILDING":
      return nameOf(labels.building, value.buildingId);
    case "APARTMENT":
      return nameOf(labels.apartment, value.apartmentId);
    case "ROOM":
      return he.room[value.room];
    case "DOMAIN":
      return nameOf(labels.domain, value.domainId);
    case "DESCRIPTION":
      return value.text.trim() || he.emailIntake.empty;
    case "RECIPIENTS": {
      const parts: string[] = [];
      if (value.add.length > 0) parts.push(he.emailDraft.recipientsAdd(namesOf(value.add, labels)));
      if (value.remove.length > 0) {
        parts.push(he.emailDraft.recipientsRemove(namesOf(value.remove, labels)));
      }
      return parts.length > 0 ? parts.join(he.emailIntake.summarySeparator) : he.emailIntake.empty;
    }
  }
}
