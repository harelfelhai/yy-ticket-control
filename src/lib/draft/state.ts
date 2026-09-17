import type { Room } from "@/generated/prisma/enums";
import {
  DRAFT_FIELDS,
  type DraftFieldName,
  type DraftMeta,
  type DraftRecipient,
  type DraftState,
  type DraftValues,
  type EmailValue,
  type FieldMeta,
  type RecipientRef,
  activeRecipients,
  conflictFields,
  emptyDraftMeta,
  fieldValue,
  missingFields,
  parseDraftRecipients,
} from "./fields";

/**
 * המעבר בין שורות המסד לבין `DraftState` שמנוע המיזוג עובד עליו — בשני
 * הכיוונים, טהור.
 *
 * שכבת השירות טוענת את הפנייה ואת שורות `DraftField`, בונה מהן מצב, מריצה
 * עליו את המנוע, ושואלת את `diffDraftState` **מה לכתוב**. כך הכתיבה נגזרת
 * מהשוואה ולא מרשימת שדות שכל קורא מתחזק בעצמו, ושדה שהמנוע לא נגע בו לא
 * נכתב — ולא דורס ערך שמייל אחר כתב בין הטעינה לכתיבה.
 */

/** מה שנדרש מהפנייה כדי לבנות את ערכי הטיוטה */
export interface DraftTicketRow {
  siteId: string | null;
  buildingId: string | null;
  apartmentId: string | null;
  room: Room | null;
  domainId: string | null;
  description: string;
  /** JSON כפי שנשמר — כולל הצורה שלפני 1.3 */
  draftRecipients: unknown;
}

/** שורת `DraftField` כפי שהיא חוזרת מהמסד */
export interface DraftFieldRow {
  field: DraftFieldName;
  fromEmail: boolean;
  systemEditedAt: Date | null;
  conflict: boolean;
  emailValue: unknown;
  emailMessageId: string | null;
}

export function draftValuesOf(ticket: DraftTicketRow): DraftValues {
  return {
    siteId: ticket.siteId,
    buildingId: ticket.buildingId,
    apartmentId: ticket.apartmentId,
    room: ticket.room,
    domainId: ticket.domainId,
    description: ticket.description,
    recipients: parseDraftRecipients(ticket.draftRecipients),
  };
}

export function toDraftState(ticket: DraftTicketRow, rows: readonly DraftFieldRow[]): DraftState {
  const meta: DraftMeta = emptyDraftMeta();
  for (const row of rows) {
    meta[row.field] = {
      fromEmail: row.fromEmail,
      systemEditedAt: row.systemEditedAt,
      conflict: row.conflict,
      emailValue: parseEmailValue(row.field, row.emailValue),
      emailMessageId: row.emailMessageId,
    };
  }
  return { values: draftValuesOf(ticket), meta };
}

/**
 * קורא את `DraftField.emailValue`. ‏JSON מהמסד אינו מבטיח צורה, וערך פגום
 * נקרא כ-null: סתירה בלי ערך מהמייל נשארת פתוחה (המנוע אינו ממציא ערך), ומי
 * שעורך את השדה בטופס עדיין סוגר אותה.
 */
export function parseEmailValue(field: DraftFieldName, raw: unknown): EmailValue | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.field !== field) return null;
  const text = (key: string) => (typeof value[key] === "string" && value[key] !== "" ? (value[key] as string) : null);

  switch (field) {
    case "SITE": {
      const siteId = text("siteId");
      return siteId ? { field, siteId } : null;
    }
    case "BUILDING": {
      const buildingId = text("buildingId");
      return buildingId ? { field, buildingId } : null;
    }
    case "APARTMENT": {
      const apartmentId = text("apartmentId");
      return apartmentId ? { field, apartmentId } : null;
    }
    case "ROOM": {
      const room = text("room");
      return room ? { field, room: room as Room } : null;
    }
    case "DOMAIN": {
      const domainId = text("domainId");
      return domainId ? { field, domainId } : null;
    }
    case "DESCRIPTION": {
      const description = typeof value.text === "string" ? value.text : null;
      return description === null ? null : { field, text: description };
    }
    case "RECIPIENTS":
      return { field, add: refsOf(value.add), remove: refsOf(value.remove) };
  }
}

function refsOf(raw: unknown): RecipientRef[] {
  return parseDraftRecipients(raw).map(({ kind, id }) => ({ kind, id }));
}

/** מה לכתוב למסד אחרי שהמנוע רץ */
export interface DraftStateWrite {
  /** עמודות הפנייה שהשתנו בלבד */
  ticket: Partial<{
    siteId: string | null;
    buildingId: string | null;
    apartmentId: string | null;
    room: Room | null;
    domainId: string | null;
    description: string;
    draftRecipients: DraftRecipient[];
  }>;
  /** שורות `DraftField` שהמטא שלהן השתנה */
  fields: { field: DraftFieldName; meta: FieldMeta }[];
  /** שדות שהערך שלהם השתנה — לשרשור ("עודכנו: …") ולסימון תנועה */
  changedValues: DraftFieldName[];
}

/**
 * @param withMeta — טיוטה ממייל בלבד. בטיוטה ידנית אין מקור אחר מלבד המערכת,
 *   ולכן גם מטא אינו נכתב וגם מצבות הנמענים אינן נשמרות: הן קיימות רק כדי
 *   לזהות תשובה במייל שמוסיפה נמען שהוסר, וטיוטה ידנית לא תקבל תשובה כזו.
 */
export function diffDraftState(before: DraftState, after: DraftState, withMeta: boolean): DraftStateWrite {
  const write: DraftStateWrite = { ticket: {}, fields: [], changedValues: [] };
  const b = before.values;
  const a = after.values;

  if (a.siteId !== b.siteId) write.ticket.siteId = a.siteId;
  if (a.buildingId !== b.buildingId) write.ticket.buildingId = a.buildingId;
  if (a.apartmentId !== b.apartmentId) write.ticket.apartmentId = a.apartmentId;
  if (a.room !== b.room) write.ticket.room = a.room;
  if (a.domainId !== b.domainId) write.ticket.domainId = a.domainId;
  if (a.description !== b.description) write.ticket.description = a.description;

  const recipients = withMeta ? a.recipients : activeRecipients(a.recipients);
  if (JSON.stringify(recipientsForStorage(recipients)) !== JSON.stringify(recipientsForStorage(b.recipients))) {
    write.ticket.draftRecipients = recipientsForStorage(recipients);
  }

  for (const field of DRAFT_FIELDS) {
    if (JSON.stringify(fieldValue(a, field)) !== JSON.stringify(fieldValue(b, field))) {
      write.changedValues.push(field);
    }
    if (withMeta && !sameMeta(before.meta[field], after.meta[field])) {
      write.fields.push({ field, meta: after.meta[field] });
    }
  }
  return write;
}

/** צורה קבועה לשמירה ולהשוואה — בלי שדות undefined ובסדר מפתחות אחד */
function recipientsForStorage(recipients: readonly DraftRecipient[]): DraftRecipient[] {
  return recipients.map((r) => ({
    kind: r.kind,
    id: r.id,
    origin: r.origin,
    removedBySystemAt: r.removedBySystemAt ?? null,
  }));
}

function sameMeta(x: FieldMeta, y: FieldMeta): boolean {
  return (
    x.fromEmail === y.fromEmail &&
    x.conflict === y.conflict &&
    x.emailMessageId === y.emailMessageId &&
    (x.systemEditedAt?.getTime() ?? null) === (y.systemEditedAt?.getTime() ?? null) &&
    JSON.stringify(x.emailValue) === JSON.stringify(y.emailValue)
  );
}

/**
 * טביעה של מה שחלון הסתירות (מסך 7א) מציג: לכל שדה בסתירה — הערך במערכת,
 * הערך מהמייל ומזהה המייל.
 *
 * החלון נפתח, ובינתיים יכולה להגיע תשובה במייל שמחליפה את הערך הממתין
 * (EM-C06) או מישהו אחר יכול לערוך את השדה. הכרעה על מה שכבר אינו מוצג הייתה
 * כותבת לטיוטה ערך שאיש לא ראה — בדיוק מה שהחלון נועד למנוע. לפנייה אין
 * `updatedAt`, ולכן הגרסה נגזרת מהתוכן עצמו ולא מחותמת זמן.
 */
export function conflictsVersion(state: DraftState): string {
  return JSON.stringify(
    conflictFields(state.meta).map((field) => [
      field,
      fieldValue(state.values, field),
      state.meta[field].emailValue,
      state.meta[field].emailMessageId,
    ]),
  );
}

/** הספירות של שורת הסיבה בלוח (EM-S1-02) ושל הודעת הסתירה במסך 7 */
export interface EmailDraftCounts {
  conflictCount: number;
  missingCount: number;
}

export function emailDraftCounts(values: DraftValues, conflictCount: number): EmailDraftCounts {
  return { conflictCount, missingCount: missingFields(values).length };
}
