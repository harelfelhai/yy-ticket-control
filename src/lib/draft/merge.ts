import type { Room } from "@/generated/prisma/enums";
import { normalizeText } from "../normalize";
import {
  DEPENDENTS,
  DRAFT_FIELDS,
  type DescriptionProposal,
  type DraftFieldName,
  type DraftRecipient,
  type DraftState,
  type DraftValues,
  type EmailValue,
  type FieldMeta,
  type RecipientRef,
  type RecipientsProposal,
  dedupeRecipients,
  emptyMeta,
  fieldValue,
  sameRecipient,
} from "./fields";

/**
 * מנוע המיזוג של טיוטה ממייל — §5.ה4 ("תשובה במייל מול עריכה במערכת") ו-§3.5
 * ("סתירה פתוחה").
 *
 * טיוטה ממייל נערכת בשני ערוצים שאינם מתואמים: השולח עונה במייל, ומישהו
 * (לא בהכרח השולח) עורך במערכת. הקובץ הזה הוא המקום היחיד שמכריע מה קורה
 * כשהם נפגשים, ולכן הוא טהור לחלוטין — בלי DB, בלי שעון ובלי מזהים שנוצרים
 * כאן. "מתי הגיע המייל" ו"עכשיו" הם פרמטרים, כך שכל שורה בטבלת §5.ה4 היא
 * בדיקה ישירה.
 *
 * **T הוא זמן ההגעה של המייל, לא זמן העיבוד.** המייל נקלט בסקירה תקופתית,
 * ובין ההגעה לעיבוד מישהו יכול לערוך את השדה במערכת. מי שערך אחרי שהמייל
 * הגיע — גם אם לפני שעובד — לא ראה את הערך מהמייל כסתירה, אבל עריכתו מאוחרת
 * ממנו, ו"עריכה מאוחרת במערכת מכריעה".
 *
 * **הנחת סדר:** מיילים של אותה טיוטה ממוזגים לפי סדר ההגעה. `FieldMeta` אינו
 * שומר מתי הגיע המייל שהציע את `emailValue`, ולכן מייל ישן שמעובד אחרי מייל
 * חדש יחליף את הערך הממתין שלו. שכבת השירות אחראית לסדר.
 */

// ──────────────────────────────── ממשק ────────────────────────────────

/**
 * מה שהמייל מציע, **אחרי ההתאמה לרשומות** (`matching.ts`): מזהים ולא טקסט.
 * שדה שאינו כאן (או מזהה ריק) — המייל לא אמר עליו דבר. אין דרך לרוקן שדה
 * במייל, כי האפיון אינו מגדיר כזו.
 */
export interface EmailProposal {
  site?: string;
  building?: string;
  apartment?: string;
  room?: Room;
  domain?: string;
  description?: DescriptionProposal;
  recipients?: RecipientsProposal;
}

/**
 * ההכרעה לשדה סקלרי אחד מול מייל אחד.
 *
 * - `apply` — השדה לא נערך במערכת: הערך נכנס בשקט עם תג "מהמייל" (EM-C03)
 * - `conflict` — השדה נערך במערכת לפני המייל, והמייל אומר אחרת (EM-C04)
 * - `close` — יש סתירה, והמייל נתן את הערך שבמערכת (EM-C02)
 * - `noop` — המייל אומר את מה שכבר יש
 * - `ignore` — השדה נערך במערכת אחרי שהמייל הגיע: המערכת מכריעה (EM-C05)
 */
export type ScalarDecision = "apply" | "conflict" | "close" | "noop" | "ignore";

export interface FieldChange {
  field: DraftFieldName;
  before: unknown;
  after: unknown;
  /** `reset` — שדה תלוי שהתאפס כי האתר או הבניין השתנו מהמייל (EM-C10) */
  cause: "email" | "reset";
}

export interface MergeResult {
  /** אובייקט חדש; הקלט לעולם אינו משתנה */
  state: DraftState;
  /**
   * מה שהמייל שינה בערכים, בסדר השדות — הבסיס ל"עודכן מהתשובה שלך".
   *
   * **רשומה אחת לכל שדה.** שדה שהתאפס בגלל שינוי אתר ואז קיבל ערך מאותו
   * מייל הוא שינוי אחד (`בניין (א ← ב)`), לא שניים (`א ← —` ואז `— ← ב`):
   * השולח כתב בניין חדש, והמעבר דרך "ריק" הוא פרט מימוש.
   */
  changes: FieldChange[];
  /**
   * שדות שהמייל הזה הוא כעת הצד "מהמייל" בסתירה שלהם — סתירה חדשה, או סתירה
   * קיימת שהערך הממתין בה הוחלף (EM-C06). בנמענים: המייל הוסיף או החליף
   * לפחות פריט ממתין אחד.
   */
  conflictsOpened: DraftFieldName[];
  /** שדות שהיו בסתירה לפני המייל ואינם בסתירה אחריו */
  conflictsClosed: DraftFieldName[];
  /** שדות שבהם עריכה במערכת מאוחרת מהמייל, ולכן הערך מהמייל נזנח */
  ignored: DraftFieldName[];
  /**
   * בניין או דירה מהמייל שלא מוזגו, כי השדה שהם תלויים בו הופיע באותו מייל
   * ולא נכנס (סתירה או עריכה מאוחרת במערכת). ראה `mergeEmailIntoDraft`.
   */
  skippedDependents: DraftFieldName[];
}

export type SystemEdit =
  | { field: "SITE"; siteId: string | null }
  | { field: "BUILDING"; buildingId: string | null }
  | { field: "APARTMENT"; apartmentId: string | null }
  | { field: "ROOM"; room: Room | null }
  | { field: "DOMAIN"; domainId: string | null }
  | { field: "DESCRIPTION"; text: string }
  | { field: "RECIPIENTS"; recipients: RecipientRef[] };

/** הצד שנבחר במסך 7א */
export type Choice = "system" | "email";

// ──────────────────────────── ההכרעה הסקלרית ────────────────────────────

/**
 * הכלל לשדה סקלרי אחד (אתר, בניין, דירה, חדר, תחום, ותיאור ב-set/replace).
 *
 * סדר הבדיקות הוא חלק מהכלל: עריכה מאוחרת במערכת נבדקת **ראשונה**, גם לפני
 * השוויון. מי שערך אחרי שהמייל הגיע כבר הכריע, והמייל אינו יכול לא לפתוח
 * סתירה ולא לסגור אותה.
 *
 * `current` ו-`proposed` מושווים כערכים פשוטים (מזהה, חדר, טקסט). את התיאור
 * הקורא מנרמל לפני ההשוואה, כדי שהבדל ברווחים לא ייחשב ערך אחר.
 */
export function decideScalar(meta: FieldMeta, current: unknown, proposed: unknown, receivedAt: Date): ScalarDecision {
  const editedAt = meta.systemEditedAt;
  if (editedAt && editedAt.getTime() > receivedAt.getTime()) return "ignore";
  if (Object.is(current, proposed)) return meta.conflict ? "close" : "noop";
  // שדה שלא נערך במערכת — ריק, או שערכו חולץ ממייל קודם — אינו החלטה של
  // אדם, ולכן המייל האחרון פשוט מחליף אותו
  if (!editedAt) return "apply";
  // נערך במערכת לפני המייל (או באותו רגע): אף צד אינו דורס את השני. גם
  // סתירה פתוחה מגיעה לכאן — הערך מהמייל האחרון מחליף את הממתין (EM-C06)
  return "conflict";
}

// ───────────────────────────── מיזוג מייל ─────────────────────────────

/**
 * ממזג מייל אחד (הראשון או תשובה) לתוך הטיוטה.
 *
 * השדות מעובדים בסדר `DRAFT_FIELDS` — אתר לפני בניין לפני דירה — כי שינוי
 * בשדה מוקדם מאפס את התלויים בו, ורק אחרי האיפוס אפשר להחליט על הערך שאותו
 * מייל נתן להם.
 *
 * **"האיפוס נזקף לערוץ שביצע את השינוי" (§5.ה4, EM-C10)** ממומש כך: כשהמייל
 * שינה אתר או בניין, האיפוס נרשם ב-`changes` של המייל — כדי שהשולח יראה
 * במייל החוזר שהבניין שכתב קודם ירד — והשדה התלוי נשאר **ריק ולא-ערוך**
 * (meta ריק). עריכה במערכת שנעשתה בו לפני כן שייכת לאתר הקודם ואינה
 * רלוונטית עוד, ולכן מייל מאוחר ממלא אותו בשקט (שורה 1 בטבלה: "ריק").
 *
 * **תלויים מאותו מייל כשהאתר או הבניין לא נכנסו.** ההתאמה של בניין נעשית
 * מול האתר שהמייל מדבר עליו, ושל דירה מול הבניין שלו. כשהמייל נותן אתר
 * **שונה** מזה שבטיוטה והוא נכנס לסתירה או נזנח מול עריכה מאוחרת, הבניין
 * מאותו מייל שייך לאתר שאינו אתר הטיוטה — ומיזוג שלו היה יוצר טיוטה עם בניין מאתר אחר, שנשלחת אחרי הכרעה
 * לצד המערכת לכתובת הלא נכונה. האפיון שותק על המקרה; הבחירה השמרנית היא לא
 * למזג את התלויים ולדווח עליהם ב-`skippedDependents`. השולח רואה במייל החוזר
 * את הסתירה באתר, ויכתוב את הבניין שוב אחרי ההכרעה.
 */
export function mergeEmailIntoDraft(input: {
  state: DraftState;
  proposal: EmailProposal;
  receivedAt: Date;
  messageId: string;
}): MergeResult {
  const { proposal, receivedAt, messageId } = input;
  assertValidDate(receivedAt, "receivedAt");

  const draft = cloneState(input.state);
  const changes: FieldChange[] = [];
  const conflictsOpened: DraftFieldName[] = [];
  const ignored: DraftFieldName[] = [];
  const skippedDependents: DraftFieldName[] = [];
  const blocked = new Set<DraftFieldName>();

  const blockDependents = (field: DraftFieldName) => {
    for (const dependent of DEPENDENTS[field] ?? []) blocked.add(dependent);
  };

  for (const field of DRAFT_FIELDS) {
    if (field === "RECIPIENTS") {
      if (proposal.recipients) {
        mergeRecipients(draft, proposal.recipients, receivedAt, messageId, {
          changes,
          conflictsOpened,
          ignored,
        });
      }
      continue;
    }

    if (field === "DESCRIPTION" && proposal.description?.op === "append") {
      appendDescription(draft, proposal.description.text, changes);
      continue;
    }

    const proposed = proposedScalar(proposal, field);
    if (!proposed) continue;

    if (blocked.has(field)) {
      skippedDependents.push(field);
      blockDependents(field);
      continue;
    }

    const meta = draft.meta[field];
    const current = field === "DESCRIPTION" ? normalizeText(draft.values.description) : fieldValue(draft.values, field);
    const decision = decideScalar(meta, current, proposed.value, receivedAt);

    switch (decision) {
      case "apply":
        writeScalar(draft.values, proposed);
        draft.meta[field] = { ...emptyMeta(), fromEmail: true, systemEditedAt: meta.systemEditedAt };
        recordChange(changes, { field, before: current, after: proposed.value, cause: "email" });
        resetDependents(draft, field, (dependent, before) =>
          recordChange(changes, { field: dependent, before, after: null, cause: "reset" }),
        );
        break;
      case "conflict":
        draft.meta[field] = {
          ...meta,
          conflict: true,
          emailValue: toEmailValue(proposed),
          emailMessageId: messageId,
        };
        conflictsOpened.push(field);
        blockDependents(field);
        break;
      case "close":
        draft.meta[field] = { ...meta, conflict: false, emailValue: null, emailMessageId: null };
        break;
      case "ignore":
        ignored.push(field);
        // `ignore` נבדק לפני השוויון, ולכן מגיע גם כשהמייל נותן את הערך שכבר
        // בטיוטה. אז התלויים מאותו מייל הותאמו מול אתר (או בניין) הטיוטה עצמו,
        // ואין סיבה לזרוק אותם — החסימה נועדה רק לתלויים של ערך אחר
        if (!Object.is(current, proposed.value)) blockDependents(field);
        break;
      case "noop":
        break;
    }
  }

  return {
    state: draft,
    changes,
    conflictsOpened,
    conflictsClosed: DRAFT_FIELDS.filter((field) => input.state.meta[field].conflict && !draft.meta[field].conflict),
    ignored,
    skippedDependents,
  };
}

/**
 * תוספת לתיאור (EM-C07): לעולם אינה סתירה ולעולם אינה נזנחת, כי היא אינה
 * סותרת דבר — היא מוסיפה מידע על אותה תקלה ("וגם יש רטיבות בתקרה"). סתירה
 * פתוחה בתיאור נשארת פתוחה: התוספת אינה מכריעה בין החלפה לבין הקיים.
 */
function appendDescription(draft: DraftState, text: string, changes: FieldChange[]): void {
  const addition = normalizeText(text);
  if (!addition) return;

  const before = normalizeText(draft.values.description);
  const after = before ? `${before}\n\n${addition}` : addition;
  draft.values.description = after;
  draft.meta.DESCRIPTION = { ...draft.meta.DESCRIPTION, fromEmail: true };
  recordChange(changes, { field: "DESCRIPTION", before, after, cause: "email" });
}

/**
 * נמענים — ההכרעה נעשית **לכל נמען בנפרד** (EM-C08), כי הרשימה היא כמה
 * החלטות עצמאיות: הוספת קבלן אחד אינה סותרת את ההחלטה במערכת על קבלן אחר.
 *
 * הפריטים הממתינים נשמרים ב-`emailValue` של השדה. פריט שמוזכר שוב במייל
 * מאוחר מחליף את הממתין שלו (EM-C06, ברמת פריט) — כולל מייל שחוזר למצב
 * שבמערכת וסוגר אותו — ופריטים שלא הוזכרו נשארים ממתינים.
 *
 * `S` (עריכת הרשימה במערכת) מכריע רק בהסרה. בהוספה של נמען שהוסר במערכת
 * המועד הרלוונטי הוא מועד ההסרה שלו, שנשמר במצבה — עריכה מאוחרת של הרשימה
 * שלא נגעה בו אינה החלטה עליו.
 */
function mergeRecipients(
  draft: DraftState,
  proposal: RecipientsProposal,
  receivedAt: Date,
  messageId: string,
  out: Pick<MergeResult, "changes" | "conflictsOpened" | "ignored">,
): void {
  const meta = draft.meta.RECIPIENTS;
  const editedAt = meta.systemEditedAt;
  const before = fieldValue(draft.values, "RECIPIENTS") as RecipientRef[];

  // מייל שמבקש גם להוסיף וגם להסיר את אותו נמען סותר את עצמו. ניחוש איזו
  // הוראה התכוון לתת היה עלול לשלוח את הפנייה למי שלא נועדה לו
  const adds = uniqueRefs(proposal.add);
  const removes = uniqueRefs(proposal.remove);
  const contradictory = (ref: RecipientRef) =>
    adds.some((r) => sameRecipient(r, ref)) && removes.some((r) => sameRecipient(r, ref));

  const pending = pendingRecipients(meta.emailValue);
  const recipients = draft.values.recipients;
  let changedSilently = false;
  let replacedPending = false;
  let ignoredAny = false;

  const setPending = (ref: RecipientRef, side: "add" | "remove" | null) => {
    pending.add = pending.add.filter((r) => !sameRecipient(r, ref));
    pending.remove = pending.remove.filter((r) => !sameRecipient(r, ref));
    if (side) {
      pending[side].push(toRef(ref));
      replacedPending = true;
    }
  };

  for (const ref of adds) {
    if (contradictory(ref)) continue;
    const active = recipients.find((r) => sameRecipient(r, ref) && !r.removedBySystemAt);
    if (active) {
      setPending(ref, null);
      continue;
    }
    const tombstone = recipients.find((r) => sameRecipient(r, ref) && r.removedBySystemAt);
    if (tombstone) {
      // חותמת שאינה ניתנת לקריאה נחשבת הסרה קודמת: סתירה מביאה את ההחלטה
      // לאדם, התעלמות הייתה מעלימה את בקשת השולח בשקט
      const removedAt = Date.parse(tombstone.removedBySystemAt ?? "");
      if (removedAt > receivedAt.getTime()) {
        ignoredAny = true;
        continue;
      }
      setPending(ref, "add");
      continue;
    }
    setPending(ref, null);
    recipients.push({ ...toRef(ref), origin: "EMAIL", removedBySystemAt: null });
    changedSilently = true;
  }

  for (const ref of removes) {
    if (contradictory(ref)) continue;
    const index = recipients.findIndex((r) => sameRecipient(r, ref) && !r.removedBySystemAt);
    if (index === -1) {
      setPending(ref, null);
      continue;
    }
    // נמען שנוסף ממייל ואיש לא אישר אותו במערכת — הסרתו במייל היא תיקון של
    // השולח לעצמו, לא היפוך של החלטה. הוא יורד לגמרי ולא כמצבה, כי מצבה
    // מסמנת החלטה של המערכת
    if (recipients[index].origin === "EMAIL") {
      recipients.splice(index, 1);
      setPending(ref, null);
      changedSilently = true;
      continue;
    }
    if (editedAt && editedAt.getTime() > receivedAt.getTime()) {
      ignoredAny = true;
      continue;
    }
    setPending(ref, "remove");
  }

  const conflict = pending.add.length + pending.remove.length > 0;
  draft.meta.RECIPIENTS = {
    ...meta,
    fromEmail: meta.fromEmail || changedSilently,
    conflict,
    emailValue: conflict ? { field: "RECIPIENTS", add: pending.add, remove: pending.remove } : null,
    // מזהה אחד לשדה: המייל האחרון שהציע פריט ממתין. פריטים ממתינים ממייל
    // קודם נשארים עם המזהה החדש — הסכימה אינה שומרת מזהה לכל פריט
    emailMessageId: !conflict ? null : replacedPending ? messageId : meta.emailMessageId,
  };

  if (replacedPending && conflict) out.conflictsOpened.push("RECIPIENTS");
  if (ignoredAny) out.ignored.push("RECIPIENTS");

  const after = fieldValue(draft.values, "RECIPIENTS") as RecipientRef[];
  if (!sameRefList(before, after)) {
    recordChange(out.changes, { field: "RECIPIENTS", before, after, cause: "email" });
  }
}

// ──────────────────────────── עריכה במערכת ────────────────────────────

/**
 * עריכה של אדם במערכת (מסך 7), כולל הכרעה במסך 7א (EM-C05, EM-C09).
 *
 * **השדה נחשב ערוך גם כשהערך לא השתנה.** שמירה מפורשת היא בדיקה של אדם: תג
 * "מהמייל" יורד, סתירה פתוחה נסגרת, ותשובה מאוחרת שונה תפתח סתירה חדשה
 * במקום לדרוס בשקט ערך שמישהו אישר זה עתה.
 *
 * שינוי אתר או בניין מאפס את התלויים בו (כמו במסך 4). **האיפוס אינו נרשם
 * כעריכה שלהם**: השדות נשארים ריקים ולא-ערוכים, כי מי שבחר אתר לא החליט
 * דבר על הבניין — ולכן מייל מאוחר ממלא אותם בשקט.
 */
export function applySystemEdit(state: DraftState, edit: SystemEdit, now: Date): DraftState {
  assertValidDate(now, "now");
  const draft = cloneState(state);
  applySystemEditInPlace(draft, edit, now);
  return draft;
}

function applySystemEditInPlace(draft: DraftState, edit: SystemEdit, now: Date): void {
  if (edit.field === "RECIPIENTS") {
    draft.values.recipients = systemRecipients(draft.values.recipients, edit.recipients, now);
  } else {
    const write = scalarOfEdit(edit);
    const before = fieldValue(draft.values, edit.field);
    writeScalar(draft.values, write);
    if (!Object.is(before, write.value)) resetDependents(draft, edit.field, () => {});
  }
  draft.meta[edit.field] = { ...emptyMeta(), systemEditedAt: now };
}

/**
 * הרשימה אחרי עריכה במערכת: מי שברשימה החדשה פעיל ו-`SYSTEM` (כולל מי שחזר
 * ממצבה), ומי שהיה פעיל וירד הופך למצבה עם מועד ההסרה.
 *
 * המצבה היא מה שמאפשר לזהות אחר כך "תשובה במייל מוסיפה נמען שהוסר במערכת"
 * (§5.ה4). בלעדיה נמען שהוסר נראה כמו נמען שמעולם לא היה, והוספתו במייל
 * הייתה נכנסת בשקט והופכת החלטה של המערכת. מצבות קודמות נשארות מאותה סיבה.
 *
 * הפעילים מופיעים בסדר שנקבע בעריכה, והמצבות אחריהם.
 */
function systemRecipients(current: readonly DraftRecipient[], wanted: readonly RecipientRef[], now: Date): DraftRecipient[] {
  const next: DraftRecipient[] = uniqueRefs(wanted).map((ref) => ({
    ...toRef(ref),
    origin: "SYSTEM",
    removedBySystemAt: null,
  }));
  const removedAt = now.toISOString();
  for (const item of current) {
    if (next.some((r) => sameRecipient(r, item))) continue;
    next.push({ ...item, removedBySystemAt: item.removedBySystemAt || removedAt });
  }
  return next;
}

// ───────────────────────────── מסך 7א ─────────────────────────────

/**
 * החלת הבחירות בחלון הסתירות (מסך 7א, EM-C09).
 *
 * **הכרעה היא עריכה במערכת, לאיזה צד שלא נבחר.** גם "המערכת" נכתבת כעריכה
 * ב-`now`: אדם השווה את שני הערכים ואישר אחד מהם, ומייל מאוחר שנותן ערך
 * שונה צריך לפתוח סתירה חדשה ולא להיכנס בשקט.
 *
 * השדות מוכרעים בסדר `DRAFT_FIELDS`, כך שהכרעת אתר לצד המייל מאפסת את
 * הבניין והדירה — וסוגרת את הסתירות שלהם — לפני שמגיעים אליהם. בחירה בשדה
 * שכבר אינו בסתירה אינה חלה: הערך הממתין בו שייך לאתר שכבר אינו אתר הטיוטה.
 */
export function resolveChoices(
  state: DraftState,
  choices: Partial<Record<DraftFieldName, Choice>>,
  now: Date,
): DraftState {
  assertValidDate(now, "now");
  const draft = cloneState(state);

  for (const field of DRAFT_FIELDS) {
    const choice = choices[field];
    if (!draft.meta[field].conflict || (choice !== "email" && choice !== "system")) continue;

    const edit = choice === "email" ? editFromEmailValue(draft, field) : editFromCurrent(draft.values, field);
    // סתירה בלי ערך מהמייל היא מצב פגום. המנוע אינו ממציא ערך, והסתירה
    // נשארת — עריכה ישירה של השדה בטופס עדיין סוגרת אותה
    if (!edit) continue;
    applySystemEditInPlace(draft, edit, now);
  }

  return draft;
}

function editFromEmailValue(draft: DraftState, field: DraftFieldName): SystemEdit | null {
  const value = draft.meta[field].emailValue;
  if (!value || value.field !== field) return null;
  switch (value.field) {
    case "SITE":
      return { field: "SITE", siteId: value.siteId };
    case "BUILDING":
      return { field: "BUILDING", buildingId: value.buildingId };
    case "APARTMENT":
      return { field: "APARTMENT", apartmentId: value.apartmentId };
    case "ROOM":
      return { field: "ROOM", room: value.room };
    case "DOMAIN":
      return { field: "DOMAIN", domainId: value.domainId };
    case "DESCRIPTION":
      return { field: "DESCRIPTION", text: value.text };
    case "RECIPIENTS": {
      // צד המייל בנמענים = הרשימה הפעילה עם הפריטים הממתינים. דרך העריכה
      // במערכת, מי שהמייל הסיר הופך למצבה ומי שהוסיף חוזר כ-SYSTEM
      const active = fieldValue(draft.values, "RECIPIENTS") as RecipientRef[];
      const kept = active.filter((r) => !value.remove.some((x) => sameRecipient(x, r)));
      return { field: "RECIPIENTS", recipients: uniqueRefs([...kept, ...value.add]) };
    }
  }
}

function editFromCurrent(values: DraftValues, field: DraftFieldName): SystemEdit {
  switch (field) {
    case "SITE":
      return { field, siteId: values.siteId };
    case "BUILDING":
      return { field, buildingId: values.buildingId };
    case "APARTMENT":
      return { field, apartmentId: values.apartmentId };
    case "ROOM":
      return { field, room: values.room };
    case "DOMAIN":
      return { field, domainId: values.domainId };
    case "DESCRIPTION":
      return { field, text: values.description };
    case "RECIPIENTS":
      return { field, recipients: fieldValue(values, "RECIPIENTS") as RecipientRef[] };
  }
}

// ──────────────────────────── ערכים סקלריים ────────────────────────────

type IdField = "SITE" | "BUILDING" | "APARTMENT" | "DOMAIN";

/** כתיבה לשדה סקלרי. ריק מותר — איפוס תלויים, ועריכה במערכת שמרוקנת שדה */
type ScalarWrite =
  | { field: IdField; value: string | null }
  | { field: "ROOM"; value: Room | null }
  | { field: "DESCRIPTION"; value: string };

/** ערך שהמייל הציע — לעולם אינו ריק */
type ProposedScalar =
  | { field: IdField; value: string }
  | { field: "ROOM"; value: Room }
  | { field: "DESCRIPTION"; value: string };

function proposedScalar(proposal: EmailProposal, field: Exclude<DraftFieldName, "RECIPIENTS">): ProposedScalar | null {
  switch (field) {
    case "SITE":
      return proposedId(field, proposal.site);
    case "BUILDING":
      return proposedId(field, proposal.building);
    case "APARTMENT":
      return proposedId(field, proposal.apartment);
    case "DOMAIN":
      return proposedId(field, proposal.domain);
    case "ROOM":
      return proposal.room ? { field, value: proposal.room } : null;
    case "DESCRIPTION": {
      const text = proposal.description ? normalizeText(proposal.description.text) : "";
      return text ? { field, value: text } : null;
    }
  }
}

function proposedId(field: IdField, value: string | undefined): ProposedScalar | null {
  return typeof value === "string" && value.trim() ? { field, value } : null;
}

function writeScalar(values: DraftValues, write: ScalarWrite): void {
  switch (write.field) {
    case "SITE":
      values.siteId = write.value;
      return;
    case "BUILDING":
      values.buildingId = write.value;
      return;
    case "APARTMENT":
      values.apartmentId = write.value;
      return;
    case "DOMAIN":
      values.domainId = write.value;
      return;
    case "ROOM":
      values.room = write.value;
      return;
    case "DESCRIPTION":
      values.description = write.value;
      return;
  }
}

function scalarOfEdit(edit: Exclude<SystemEdit, { field: "RECIPIENTS" }>): ScalarWrite {
  switch (edit.field) {
    case "SITE":
      return { field: edit.field, value: edit.siteId };
    case "BUILDING":
      return { field: edit.field, value: edit.buildingId };
    case "APARTMENT":
      return { field: edit.field, value: edit.apartmentId };
    case "DOMAIN":
      return { field: edit.field, value: edit.domainId };
    case "ROOM":
      return { field: edit.field, value: edit.room };
    case "DESCRIPTION":
      return { field: edit.field, value: normalizeText(edit.text) };
  }
}

function toEmailValue(proposed: ProposedScalar): EmailValue {
  switch (proposed.field) {
    case "SITE":
      return { field: "SITE", siteId: proposed.value };
    case "BUILDING":
      return { field: "BUILDING", buildingId: proposed.value };
    case "APARTMENT":
      return { field: "APARTMENT", apartmentId: proposed.value };
    case "DOMAIN":
      return { field: "DOMAIN", domainId: proposed.value };
    case "ROOM":
      return { field: "ROOM", room: proposed.value };
    case "DESCRIPTION":
      return { field: "DESCRIPTION", text: proposed.value };
  }
}

/**
 * מאפס את השדות שתלויים בשדה שהשתנה (`DEPENDENTS`), לערך ריק ו-meta ריק.
 *
 * גם תלוי שערכו כבר ריק מאופס כשיש לו meta: סתירה פתוחה בדירה ריקה מחזיקה
 * דירה של הבניין הקודם כ"ערך מהמייל", והכרעה לצדה הייתה כותבת לטיוטה דירה
 * מבניין אחר. `onReset` נקרא רק כשהיה ערך — איפוס של ריק אינו שינוי שמדווחים.
 */
function resetDependents(
  draft: DraftState,
  field: DraftFieldName,
  onReset: (dependent: DraftFieldName, before: unknown) => void,
): void {
  for (const dependent of DEPENDENTS[field] ?? []) {
    const before = fieldValue(draft.values, dependent);
    const meta = draft.meta[dependent];
    const touched =
      meta.fromEmail || meta.systemEditedAt !== null || meta.conflict || meta.emailValue !== null || meta.emailMessageId !== null;
    if (before === null && !touched) continue;

    writeScalar(draft.values, clearWrite(dependent));
    draft.meta[dependent] = emptyMeta();
    if (before !== null) onReset(dependent, before);
  }
}

function clearWrite(field: DraftFieldName): ScalarWrite {
  switch (field) {
    case "SITE":
    case "BUILDING":
    case "APARTMENT":
    case "DOMAIN":
      return { field, value: null };
    case "ROOM":
      return { field, value: null };
    case "DESCRIPTION":
    case "RECIPIENTS":
      // DEPENDENTS מכיל רק שדות שמזהה ריק הוא ערך חוקי שלהם
      throw new Error(`השדה ${field} אינו יכול להיות תלוי שמתאפס`);
  }
}

// ─────────────────────────────── עזרים ───────────────────────────────

/** מוסיף שינוי, או ממזג אותו עם שינוי קודם באותו שדה — ראה `MergeResult.changes` */
function recordChange(changes: FieldChange[], change: FieldChange): void {
  const index = changes.findIndex((c) => c.field === change.field);
  if (index === -1) {
    changes.push(change);
    return;
  }
  const merged: FieldChange = { ...change, before: changes[index].before };
  if (Object.is(merged.before, merged.after)) changes.splice(index, 1);
  else changes[index] = merged;
}

function pendingRecipients(value: EmailValue | null): { add: RecipientRef[]; remove: RecipientRef[] } {
  if (value?.field !== "RECIPIENTS") return { add: [], remove: [] };
  return { add: value.add.map(toRef), remove: value.remove.map(toRef) };
}

/** רק `kind` ו-`id` — כדי ששדות נוספים שהקורא העביר לא ייכנסו לטיוטה השמורה */
function toRef(ref: RecipientRef): RecipientRef {
  return { kind: ref.kind, id: ref.id };
}

function uniqueRefs(refs: readonly RecipientRef[]): RecipientRef[] {
  return dedupeRecipients(refs).map(toRef);
}

function sameRefList(a: readonly RecipientRef[], b: readonly RecipientRef[]): boolean {
  return a.length === b.length && a.every((ref, i) => sameRecipient(ref, b[i]));
}

/**
 * העתק עמוק של הטיוטה. המנוע כותב רק להעתק, כך שהקורא יכול להשוות את
 * הקלט לפלט כדי לדעת מה לכתוב ל-DB. אובייקטי `Date` משותפים — המנוע לעולם
 * אינו משנה אותם.
 */
function cloneState(state: DraftState): DraftState {
  const meta = {} as DraftState["meta"];
  for (const field of DRAFT_FIELDS) {
    const source = state.meta[field];
    meta[field] = { ...source, emailValue: cloneEmailValue(source.emailValue) };
  }
  return {
    values: { ...state.values, recipients: state.values.recipients.map((r) => ({ ...r })) },
    meta,
  };
}

function cloneEmailValue(value: EmailValue | null): EmailValue | null {
  if (!value) return null;
  if (value.field === "RECIPIENTS") {
    return { field: "RECIPIENTS", add: value.add.map(toRef), remove: value.remove.map(toRef) };
  }
  return { ...value };
}

/**
 * זמן בלתי תקין הוא באג אצל הקורא, לא קלט להכרעה: כל השוואה מול `NaN` היא
 * false, ולכן "עריכה מאוחרת במערכת" לא הייתה מזוהה לעולם.
 */
function assertValidDate(value: Date, name: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`מנוע המיזוג: ${name} אינו תאריך תקין`);
  }
}
