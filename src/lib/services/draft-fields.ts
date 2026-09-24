import { Prisma } from "@/generated/prisma/client";
import type { Room } from "@/generated/prisma/enums";
import { UserFacingError } from "@/lib/action-result";
import { db } from "@/lib/db";
import {
  type DraftFieldName,
  type DraftState,
  type RecipientRef,
  activeRecipients,
  conflictFields,
  dedupeRecipients,
} from "@/lib/draft/fields";
import {
  type Choice,
  type SystemEdit,
  applySystemEdit,
  resolveChoices,
} from "@/lib/draft/merge";
import { DRAFT_FIELD_LABEL } from "@/lib/draft/labels";
import { conflictsVersion, diffDraftState, fieldVersion, toDraftState } from "@/lib/draft/state";
import { he } from "@/lib/he";
import { normalizeText } from "@/lib/normalize";
import { type Viewer, canCreateTicketInSite, canEditTicketFields } from "@/lib/permissions";
import { assertLocationInSite, assertProfessionalsActive, assertUsersAssignable } from "./directory";
import { type Tx, actorName, recordEvent, touchData } from "./ticket-activity";

/**
 * צד המערכת של טיוטה — עריכת שדות, הכרעת סתירות והסרת מדיה (מסכים 7 ו-7א).
 *
 * **כל עריכה של טיוטה עוברת במנוע המיזוג** (`draft/merge.ts`), גם בטיוטה
 * שלא נפתחה במייל. כך כלל האיפוס ("שינוי אתר מאפס בניין ודירה", §5.ה4) וכלל
 * הנמענים מוגדרים במקום אחד בלבד, והמנוע הוא גם מה שקובע מה נחשב "נערך
 * במערכת" — הקביעה שהמייל יימדד מולה אחר כך.
 *
 * **הכול תחת נעילת השורה** (`SELECT … FOR UPDATE`): טיוטה ממייל נערכת בשני
 * ערוצים שאינם מתואמים, ומיזוג של תשובה שנכנס בין הקריאה לכתיבה היה נדרס
 * בשקט — ואיתו הסתירה שהוא פתח.
 */

/** שגיאות עריכת טיוטה — נועדו להיראות על ידי המשתמש */
export class DraftError extends UserFacingError {}

/** שדות הטיוטה שניתן לערוך במסך 7. אתר ונמענים — בטיוטה בלבד. */
export interface DraftFieldsInput {
  siteId?: string;
  buildingId?: string | null;
  apartmentId?: string | null;
  domainId?: string | null;
  room?: Room | null;
  description?: string;
  recipients?: RecipientRef[];
}

/**
 * מיוצא: זהו הבחירה היחידה של שדות הפנייה לצורכי טיוטה — גם לנעילה וטעינה
 * כאן, וגם לבדיקת "מה קורה לתשובה שמגיעה עכשיו" ב-`email-intake.ts` (S7),
 * שצריכה בדיוק את אותם שדות (`TicketAccessView` ועוד `isDraft`) כדי להכריע
 * בין מיזוג, "נשלחה" ו"אין הרשאה" מול אותה טיוטה בדיוק. בחירה כפולה הייתה
 * שני מקורות אמת לצורת הפנייה.
 */
export const DRAFT_TICKET_SELECT = {
  id: true,
  isDraft: true,
  channel: true,
  // שני אלה נדרשים לבדיקת ההרשאה (`TicketAccessView`) ולא לעריכה עצמה
  createdById: true,
  closedAt: true,
  siteId: true,
  buildingId: true,
  apartmentId: true,
  room: true,
  domainId: true,
  description: true,
  draftRecipients: true,
} as const;

export type DraftTicket = Prisma.TicketGetPayload<{ select: typeof DRAFT_TICKET_SELECT }>;

/** טיוטה שנפתחה במייל — היחידה שמחזיקה מטא של שדות ושיכולה להיות בסתירה */
export function isEmailDraft(ticket: { isDraft: boolean; channel: string }): boolean {
  return ticket.isDraft && ticket.channel === "EMAIL";
}

/**
 * נועל את שורת הפנייה עד סוף הטרנזאקציה.
 *
 * שאילתה גולמית כי Prisma אינו חושף `FOR UPDATE`. מחזירה כלום אם הפנייה
 * נמחקה בין לבין, והקורא מטפל בזה כמו בכל פנייה שאינה קיימת.
 */
export async function lockTicket(tx: Tx, ticketId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${ticketId} FOR UPDATE`;
}

/**
 * נועלת את הפנייה וטוענת אותה מחדש — `null` כשהיא נמחקה בין הקריאה
 * שקבעה איזו פנייה לנעול לבין הנעילה עצמה.
 *
 * **מיוצאת, ואינה זורקת על "לא נמצאה".** קוראים אחרים בקובץ הזה (עריכת
 * שדות, הכרעת סתירות, הסרת מדיה) רואים "לא נמצאה" כבאג של בקשה — מישהו
 * מנסה לערוך פנייה שאינה קיימת — וזורקים `DraftError` בעצמם, מיד אחרי
 * הקריאה. אבל תשובה במייל (`email-intake.ts`, S7) רואה באותו מצב בדיוק
 * הכרעה לגיטימית ("הטיוטה נמחקה", §2.6 שלב 6) ולא שגיאה — ולכן ההחלטה
 * מה "לא נמצאה" אומרת שייכת לקורא, לא לפונקציה הזו.
 */
export async function lockAndLoadDraft(
  tx: Tx,
  ticketId: string,
): Promise<{ ticket: DraftTicket; state: DraftState } | null> {
  await lockTicket(tx, ticketId);
  const ticket = await tx.ticket.findUnique({ where: { id: ticketId }, select: DRAFT_TICKET_SELECT });
  if (!ticket) return null;
  const rows = await tx.draftField.findMany({ where: { ticketId } });
  return { ticket, state: toDraftState(ticket, rows) };
}

/**
 * מיוצאת: כותבת את ההפרש בין שני מצבים ומחזירה את השדות שערכם השתנה.
 *
 * זו הפונקציה היחידה בפרויקט שכותבת `DraftField`/עמודות הטיוטה מ-`DraftState`
 * — גם לעריכה במערכת (כאן) וגם למיזוג תשובה במייל (`email-intake.ts`, S7).
 * שני מימושים עצמאיים של אותה כתיבה כבר יצרו באג אחד בפרויקט הזה (ראה
 * `services/media.ts` מול `email-intake.ts` ב-`aiJobFor` — לא כאן, אבל אותו
 * לקח בדיוק): שני מקומות שאמורים לעשות את אותו דבר מתפצלים בשקט.
 *
 * `withMeta` מוגבל לטיוטת מייל: בטיוטה ידנית אין מקור אחר, ושורות `DraftField`
 * היו רק מקום נוסף להחזיק בו "נערך במערכת" בלי שמישהו ישאל.
 */
export async function writeDraftState(
  tx: Tx,
  ticketId: string,
  before: DraftState,
  after: DraftState,
  withMeta: boolean,
): Promise<DraftFieldName[]> {
  const write = diffDraftState(before, after, withMeta);
  const { draftRecipients, ...columns } = write.ticket;

  if (Object.keys(columns).length > 0 || draftRecipients !== undefined) {
    await tx.ticket.update({
      where: { id: ticketId },
      data: {
        ...columns,
        ...(draftRecipients === undefined
          ? {}
          : { draftRecipients: draftRecipients as unknown as Prisma.InputJsonValue }),
        // תנועה רק כשערך באמת השתנה: שמירה שלא שינתה דבר אינה פעילות בפנייה
        ...(write.changedValues.length > 0 ? touchData() : {}),
      },
    });
  }

  for (const { field, meta } of write.fields) {
    const data = {
      fromEmail: meta.fromEmail,
      systemEditedAt: meta.systemEditedAt,
      conflict: meta.conflict,
      emailValue: (meta.emailValue ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
      emailMessageId: meta.emailMessageId,
    };
    await tx.draftField.upsert({
      where: { ticketId_field: { ticketId, field } },
      create: { ticketId, field, ...data },
      update: data,
    });
  }

  return write.changedValues;
}

/** אירוע השרשור של עריכת שדות — אותו אירוע כמו בפנייה משוגרת */
async function recordFieldsEdited(tx: Tx, ticketId: string, viewer: Viewer, changed: DraftFieldName[]): Promise<void> {
  if (changed.length === 0) return;
  await recordEvent(tx, ticketId, "FIELDS_EDITED", {
    userName: await actorName(tx, viewer),
    fields: changed.map((field) => DRAFT_FIELD_LABEL[field]).join(", "),
  });
}

/** הופך את הקלט לרשימת עריכות מערכת, בסדר השדות — האתר לפני הבניין לפני הדירה */
function toSystemEdits(fields: DraftFieldsInput): SystemEdit[] {
  const edits: SystemEdit[] = [];
  if (fields.siteId !== undefined) edits.push({ field: "SITE", siteId: fields.siteId });
  if (fields.buildingId !== undefined) edits.push({ field: "BUILDING", buildingId: fields.buildingId });
  if (fields.apartmentId !== undefined) edits.push({ field: "APARTMENT", apartmentId: fields.apartmentId });
  if (fields.room !== undefined) edits.push({ field: "ROOM", room: fields.room });
  if (fields.domainId !== undefined) edits.push({ field: "DOMAIN", domainId: fields.domainId });
  if (fields.description !== undefined) {
    edits.push({ field: "DESCRIPTION", text: normalizeText(fields.description) });
  }
  if (fields.recipients !== undefined) {
    edits.push({ field: "RECIPIENTS", recipients: dedupeRecipients(fields.recipients) });
  }
  return edits;
}

/**
 * עורך שדות של טיוטה (מסך 7).
 *
 * **שדה שנשלח נחשב ערוך גם כשערכו לא השתנה** (§5.ה4, EM-C09): שמירה
 * מפורשת היא בדיקה של אדם, ולכן תג "מהמייל" יורד וסתירה פתוחה נסגרת — ותשובה
 * מאוחרת שונה תפתח סתירה חדשה במקום לדרוס ערך שאושר.
 *
 * `expected` — טביעת השדה (`fieldVersion`) כפי שהמסך הציג אותו, לכל שדה
 * שנשלח. היא נבדקת **תחת הנעילה**, ושדה שהשתנה מאז (תשובה במייל שפתחה בו
 * סתירה, הוסיפה נמען או מילאה אותו) דוחה את כל השמירה (§7 שורה 86): אחרת
 * העריכה הייתה סוגרת בשקט סתירה שאיש לא ראה. בלי `expected` — אין בדיקה,
 * כמו בטיוטה ידנית, שאין לה ערוץ שני שמשנה אותה.
 */
export async function updateDraftFields(
  viewer: Viewer,
  ticketId: string,
  fields: DraftFieldsInput,
  clock?: Date,
  expected?: Partial<Record<DraftFieldName, string>>,
): Promise<void> {
  const edits = toSystemEdits(fields);
  if (edits.length === 0) return;

  await db.$transaction(async (tx) => {
    const locked = await lockAndLoadDraft(tx, ticketId);
    if (!locked) throw new DraftError(he.ticket.notFound);
    const { ticket, state } = locked;
    // **השעון נלקח אחרי הנעילה, לא לפני ההמתנה לה.** החותמת הזו היא מה
    // שמייל מאוחר יימדד מולו (§5.ה4), וחותמת שנלקחה לפני המתנה של שניות
    // הייתה מציגה את העריכה כמוקדמת ממייל שהגיע בינתיים — ואז הוא היה
    // נכנס בשקט במקום לפתוח סתירה.
    const now = clock ?? new Date();
    denyUnless(canEditTicketFields(viewer, ticket));
    // שוגרה בין הטעינה לכתיבה: ההמשך היה כותב שדות לפנייה חיה בלי אירוע ובלי
    // התראה לנמענים
    if (!ticket.isDraft) throw new DraftError(he.common.notAllowed);

    if (fields.siteId !== undefined && fields.siteId !== ticket.siteId) {
      // אתר חדש = פתיחת פנייה בו. מנהל עבודה אינו יכול להוציא טיוטה מהאתר שלו
      denyUnless(canCreateTicketInSite(viewer, fields.siteId));
    }

    if (expected) {
      for (const edit of edits) {
        const shown = expected[edit.field];
        if (shown !== undefined && shown !== fieldVersion(state, edit.field)) {
          throw new DraftError(he.emailDraft.fieldChanged);
        }
      }
    }

    let next = state;
    for (const edit of edits) next = applySystemEdit(next, edit, now);

    await assertDraftValues(tx, next, state);
    const changed = await writeDraftState(tx, ticketId, state, next, isEmailDraft(ticket));
    await recordFieldsEdited(tx, ticketId, viewer, changed);
  });
}

/**
 * החלת הבחירות בחלון הסתירות (מסך 7א).
 *
 * `version` היא הטביעה של מה שהחלון הציג (`conflictsVersion`). היא נבדקת
 * **בתוך הנעילה**, אחרי שהמצב נטען מחדש: תשובה חדשה שהגיעה בין הפתיחה
 * לאישור מחליפה את הערך מהמייל, והכרעה על ערך שאיש לא ראה היא בדיוק מה
 * שהחלון נועד למנוע (§7 שורה 84).
 */
export async function resolveDraftConflicts(
  viewer: Viewer,
  ticketId: string,
  choices: Partial<Record<DraftFieldName, Choice>>,
  version: string,
  clock?: Date,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const locked = await lockAndLoadDraft(tx, ticketId);
    if (!locked) throw new DraftError(he.ticket.notFound);
    const { ticket, state } = locked;
    // ראה ההערה ב-`updateDraftFields`: השעון אחרי הנעילה
    const now = clock ?? new Date();
    denyUnless(canEditTicketFields(viewer, ticket));
    denyUnless(isEmailDraft(ticket));
    if (conflictsVersion(state) !== version) throw new DraftError(he.emailDraft.conflictsChanged);

    const open = conflictFields(state.meta);
    if (open.length === 0) return;
    // שדה בסתירה בלי בחירה היה נשאר פתוח, ו"החל את הבחירה" היה מסיים בלי
    // לומר שדבר לא קרה. הממשק אינו מאפשר זאת, והשרת אינו סומך עליו
    denyUnless(open.every((field) => choices[field] === "email" || choices[field] === "system"));

    const next = resolveChoices(state, choices, now);
    if (next.values.siteId !== state.values.siteId && next.values.siteId !== null) {
      denyUnless(canCreateTicketInSite(viewer, next.values.siteId));
    }

    await assertDraftValues(tx, next, state);
    const changed = await writeDraftState(tx, ticketId, state, next, true);
    await recordFieldsEdited(tx, ticketId, viewer, changed);
  });
}

/**
 * מסיר קובץ מדיה מטיוטה ממייל (מסך 7, EM-S7-05).
 *
 * **ההסרה חלה על הטיוטה בלבד:** הקובץ נשאר בהתכתבות — היא התיעוד של מה
 * שנשלח למערכת — ורשומת ה-`MediaFile` נמחקת, כך שהטקסט שחולץ ממנו יוצא
 * מהחיפוש יחד איתו. האובייקט באחסון נשאר, כמו בכל מחיקה במערכת (Gate G5).
 *
 * הצורך המיידי הוא לוגו בחתימת המייל, שנכנס כתמונה משובצת ובלי הסרה היה
 * מוצג לנמענים אחרי השיגור.
 *
 * **רק קובץ שהגיע במייל** (§7 שורה 87). בשרשור של טיוטה אפשר לצרף קבצים גם
 * מתוך המערכת; הם אינם בהתכתבות, והסרה שלהם הייתה מחיקה בלי תיעוד — ולכן
 * הם נשארים בכלל "הוספה בלבד" (§3.2).
 */
export async function removeDraftMedia(viewer: Viewer, mediaFileId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    // הקריאה הראשונה היא רק כדי לדעת איזו פנייה לנעול; המצב עצמו נקרא שוב
    // **אחרי** הנעילה, אחרת הסרה מקבילה הייתה מפילה כאן שגיאת Prisma גולמית
    const ticketId = (
      await tx.mediaFile.findUnique({
        where: { id: mediaFileId },
        select: { message: { select: { ticketId: true } } },
      })
    )?.message?.ticketId;
    if (!ticketId) throw new DraftError(he.media.notFound);

    const locked = await lockAndLoadDraft(tx, ticketId);
    if (!locked) throw new DraftError(he.ticket.notFound);
    const { ticket } = locked;
    const media = await tx.mediaFile.findUnique({
      where: { id: mediaFileId },
      select: {
        id: true,
        messageId: true,
        message: { select: { id: true, ticketId: true, kind: true, text: true } },
        mailboxAttachment: { select: { id: true } },
      },
    });
    if (!media) throw new DraftError(he.media.notFound);
    denyUnless(canEditTicketFields(viewer, ticket));
    // אחרי השיגור המדיה חוזרת לכלל "הוספה בלבד" (§3.2), וטיוטה ידנית לא
    // צריכה הסרה — מי שצירף קובץ בעצמו לא קיבל לוגו של חתימה
    denyUnless(isEmailDraft(ticket));
    // וגם בטיוטה ממייל — רק מה שהגיע במייל ונשאר בהתכתבות (§7 שורה 87)
    denyUnless(media.mailboxAttachment !== null);

    await tx.mailboxAttachment.updateMany({
      where: { mediaFileId: media.id },
      data: { removedFromDraftAt: new Date(), mediaFileId: null },
    });
    await tx.mediaFile.deleteMany({ where: { id: media.id } });

    // הודעת MEDIA שהתרוקנה לגמרי היא בועה ריקה בשרשור
    const message = media.message;
    if (message && message.kind === "MEDIA" && !message.text?.trim()) {
      const left = await tx.mediaFile.count({ where: { messageId: message.id } });
      if (left === 0) await tx.message.delete({ where: { id: message.id } });
    }

    await tx.ticket.update({ where: { id: ticketId }, data: touchData() });
  });
}

/**
 * מזהי הקבצים בפנייה שהגיעו במייל — הקבצים היחידים ש"הסר קובץ" חל עליהם
 * (§7 שורה 87, ראה `removeDraftMedia`). נקרא ברינדור מסך 7, ולכן בלי נעילה:
 * ההסרה עצמה בודקת שוב.
 */
export async function emailMediaIds(ticketId: string, client: Tx | typeof db = db): Promise<Set<string>> {
  const rows = await client.mailboxAttachment.findMany({
    where: { mediaFile: { message: { ticketId } } },
    select: { mediaFileId: true },
  });
  return new Set(rows.flatMap((row) => (row.mediaFileId ? [row.mediaFileId] : [])));
}

/** מספר השדות שבסתירה — לחסימת השיגור ולשורת הסיבה */
export async function countDraftConflicts(client: Tx | typeof db, ticketId: string): Promise<number> {
  return client.draftField.count({ where: { ticketId, conflict: true } });
}

/**
 * הגרסה שחלון הסתירות מקבל, ומה שהוא צריך להציג. נקראת מחוץ לטרנזאקציה
 * (רינדור המסך), ולכן בלי נעילה: ההכרעה עצמה בודקת את הגרסה שוב.
 */
export async function loadDraftState(ticketId: string): Promise<DraftState> {
  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, select: DRAFT_TICKET_SELECT });
  if (!ticket) throw new DraftError(he.ticket.notFound);
  const rows = await db.draftField.findMany({ where: { ticketId } });
  return toDraftState(ticket, rows);
}

/**
 * אימות הערכים שהעריכה מייצרת, מול אותם כללים שחלים על פתיחת פנייה: המיקום
 * שייך לאתר, ואיש מקצוע או משתמש שנוסף עדיין ניתן לשיוך.
 *
 * הנמענים נבדקים רק כשנוספו: נמען שמושבת אחרי שנכנס לטיוטה אינו חוסם עריכה
 * של שדה אחר — הוא ייחסם בשיגור, וכך מנהל יכול לתקן את הטיוטה ולא להיתקע.
 */
async function assertDraftValues(tx: Tx, next: DraftState, before: DraftState): Promise<void> {
  await assertLocationInSite(
    {
      siteId: next.values.siteId,
      buildingId: next.values.buildingId,
      apartmentId: next.values.apartmentId,
    },
    tx,
  );

  const had = new Set(activeRecipients(before.values.recipients).map((r) => `${r.kind}:${r.id}`));
  const added = activeRecipients(next.values.recipients).filter((r) => !had.has(`${r.kind}:${r.id}`));
  await assertProfessionalsActive(added.filter((r) => r.kind === "professional").map((r) => r.id), tx);
  await assertUsersAssignable(added.filter((r) => r.kind === "user").map((r) => r.id), tx);
}

function denyUnless(allowed: boolean): void {
  if (!allowed) throw new DraftError(he.common.notAllowed);
}
