import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  DRAFT_FIELDS,
  type ChannelValue,
  type DraftFieldName,
  type DraftValues,
  type RecipientRef,
  activeRecipients,
  missingFields,
  sameRecipient,
} from "@/lib/draft/fields";
import { draftValuesOf, parseChannelValue } from "@/lib/draft/state";
import type { ConflictLine, DraftSummary, IntakeReplyInput } from "@/lib/intake/reply-model";
import type { AmbiguousItem, IntakeReport, NotFoundItem, UpdatedItem } from "@/lib/intake/types";
import { env } from "@/lib/env";
import { he } from "@/lib/he";
import { normalizeName } from "@/lib/normalize";
import { logWarn } from "@/lib/observability/log";
import { type RecordLabels, addRecipientId, emptyRecordIds, loadRecordLabels } from "./intake-draft";

/**
 * מה שהמענה לשולח מתאר על הטיוטה — נקרא **בזמן השליחה** ולא בזמן ההכרעה,
 * בכל ערוץ (§2.6 שלב 4).
 *
 * בין הרגע שההודעה נקלטה לרגע שהמענה יוצא אדם יכול לפתוח את הטיוטה ולערוך
 * אותה, ומענה שהורכב מוקדם היה מתאר לשולח מצב שכבר אינו נכון — בדיוק ההפך
 * מהמטרה של "מה יש בטיוטה עכשיו". מאותה סיבה `IntakeReport` שומר רק מה שאי
 * אפשר לשחזר (מה **ההודעה הזו** שינתה ומה נכתב בה ולא נמצא), והשאר נקרא כאן.
 *
 * הניסוח עצמו אינו כאן אלא ב-`intake/reply-model.ts`, שהוא טהור ומקבל
 * תוויות ולא מזהים. מה שהקובץ הזה מוסיף הוא בדיוק מה שדורש בסיס נתונים:
 * תרגום מזהים לשמות.
 */

export const REPLY_TICKET_SELECT = {
  id: true,
  seq: true,
  isDraft: true,
  description: true,
  siteId: true,
  buildingId: true,
  apartmentId: true,
  room: true,
  domainId: true,
  draftRecipients: true,
  createdBy: { select: { name: true } },
  site: { select: { name: true } },
  building: { select: { name: true } },
  apartment: { select: { number: true } },
  domain: { select: { name: true } },
  draftFields: { select: { field: true, conflict: true, channelValue: true } },
} as const;

export type ReplyTicket = Prisma.TicketGetPayload<{ select: typeof REPLY_TICKET_SELECT }>;

export function ticketUrl(ticketId: string): string {
  return `${env.appBaseUrl().replace(/\/+$/, "")}/tickets/${ticketId}`;
}

/**
 * החלקים של המענה הכללי (EM-L01/EM-L04) שמתארים את הטיוטה עצמה: מה יש בה,
 * מה חסר, מה בסתירה, והקישור אליה.
 */
export async function draftReplyContent(
  ticket: ReplyTicket,
): Promise<Required<Pick<IntakeReplyInput, "summary" | "missing" | "siteOptions" | "conflicts" | "draftLink">>> {
  const values = draftValuesOf(ticket);
  const missing = missingFields(values);
  const labels = await loadLabels(ticket, values);
  return {
    summary: summaryOf(ticket, values, labels),
    missing,
    // רשימת האתרים רק כשהאתר חסר (EM-A03), ורק אז היא נטענת: בטיוטה עם
    // אתר היא שאילתה שאיש לא יקרא.
    siteOptions: missing.includes("SITE") ? await siteNames() : [],
    conflicts: conflictLines(ticket, values, labels),
    draftLink: ticketUrl(ticket.id),
  };
}

async function siteNames(): Promise<string[]> {
  const sites = await db.site.findMany({ select: { name: true }, orderBy: { name: "asc" } });
  return sites.map((site) => site.name);
}

// ─────────────────────────── תוויות במקום מזהים ───────────────────────────

/**
 * השמות של כל מה שהמענה מזכיר ואינו יושב על הפנייה עצמה: הנמענים, והערכים
 * שההודעה הציעה בשדות שבסתירה.
 */
async function loadLabels(ticket: ReplyTicket, values: DraftValues): Promise<RecordLabels> {
  const ids = emptyRecordIds();
  for (const recipient of activeRecipients(values.recipients)) addRecipientId(ids, recipient);

  for (const row of ticket.draftFields) {
    if (!row.conflict) continue;
    const value = parseChannelValue(row.field, row.channelValue);
    if (!value) continue;
    switch (value.field) {
      case "SITE":
        ids.site.add(value.siteId);
        break;
      case "BUILDING":
        ids.building.add(value.buildingId);
        break;
      case "APARTMENT":
        ids.apartment.add(value.apartmentId);
        break;
      case "DOMAIN":
        ids.domain.add(value.domainId);
        break;
      case "RECIPIENTS":
        for (const ref of [...value.add, ...value.remove]) addRecipientId(ids, ref);
        break;
      case "ROOM":
      case "DESCRIPTION":
        break;
    }
  }

  return loadRecordLabels(db, ids);
}

/** "מה יש בטיוטה עכשיו" — תוויות בלבד; ערך ריק הוא null ומוצג "—" (EM-A02) */
function summaryOf(ticket: ReplyTicket, values: DraftValues, labels: RecordLabels): DraftSummary {
  return {
    site: ticket.site?.name ?? null,
    building: ticket.building?.name ?? null,
    apartment: ticket.apartment?.number ?? null,
    room: ticket.room ? he.room[ticket.room] : null,
    domain: ticket.domain?.name ?? null,
    description: ticket.description || null,
    recipients: activeRecipients(values.recipients).map((ref) => recipientName(ref, labels)),
  };
}

/**
 * "סותר את מה שנקבע במערכת" — שורה לכל שדה בסתירה (§5.ה4, EM-L01).
 *
 * **שדה בסתירה מקבל שורה גם כשהערך מההודעה אינו קריא.** ערך פגום מוצג "—",
 * ובלבד שהסתירה תופיע: המענה הוא מה שאומר לשולח שההכרעה תיעשה במערכת, וגם
 * הוא מה שמונע מהנוסח להפוך ל"כל הפרטים זוהו" (EM-L04) על טיוטה שהשיגור
 * שלה חסום.
 */
function conflictLines(ticket: ReplyTicket, values: DraftValues, labels: RecordLabels): ConflictLine[] {
  return ticket.draftFields
    .filter((row) => row.conflict)
    .map((row) => ({
      field: row.field,
      channelValue: channelLabel(parseChannelValue(row.field, row.channelValue), values, labels),
      systemValue: systemLabel(row.field, ticket, values, labels),
    }));
}

function systemLabel(field: DraftFieldName, ticket: ReplyTicket, values: DraftValues, labels: RecordLabels): string {
  switch (field) {
    case "SITE":
      return ticket.site?.name ?? "";
    case "BUILDING":
      return ticket.building?.name ?? "";
    case "APARTMENT":
      return ticket.apartment?.number ?? "";
    case "ROOM":
      return ticket.room ? he.room[ticket.room] : "";
    case "DOMAIN":
      return ticket.domain?.name ?? "";
    case "DESCRIPTION":
      return ticket.description;
    case "RECIPIENTS":
      return recipientList(activeRecipients(values.recipients), labels);
  }
}

/**
 * הערך שההודעה האחרונה הציעה, כתווית.
 *
 * הנמענים הם החריג: `channelValue` שלהם הוא **הפרש** (מה להוסיף ומה להסיר),
 * ואילו המענה מציג שני ערכים זה מול זה. לכן ההפרש מוחל על הרשימה הנוכחית
 * ומוצג כרשימה — "במייל א, ב · במערכת א" קריא, ו"במייל +ב" אינו.
 */
function channelLabel(value: ChannelValue | null, values: DraftValues, labels: RecordLabels): string {
  if (!value) return "";
  switch (value.field) {
    case "SITE":
      return labels.site.get(value.siteId) ?? "";
    case "BUILDING":
      return labels.building.get(value.buildingId) ?? "";
    case "APARTMENT":
      return labels.apartment.get(value.apartmentId) ?? "";
    case "ROOM":
      return he.room[value.room];
    case "DOMAIN":
      return labels.domain.get(value.domainId) ?? "";
    case "DESCRIPTION":
      return value.text;
    case "RECIPIENTS": {
      const kept = activeRecipients(values.recipients).filter(
        (current) => !value.remove.some((ref) => sameRecipient(ref, current)),
      );
      const added = value.add.filter((ref) => !kept.some((current) => sameRecipient(ref, current)));
      return recipientList([...kept, ...added], labels);
    }
  }
}

function recipientList(refs: readonly RecipientRef[], labels: RecordLabels): string {
  return refs
    .map((ref) => recipientName(ref, labels))
    .filter(Boolean)
    .join(he.emailIntake.listSeparator);
}

function recipientName(ref: RecipientRef, labels: RecordLabels): string {
  return (ref.kind === "professional" ? labels.professional : labels.user).get(ref.id) ?? "";
}

// ─────────────────────────────── הדיווח ───────────────────────────────

/**
 * קורא את הדיווח שנשמר על ההודעה הנכנסת — מה שההודעה הזו שינתה ומה נכתב
 * בה ולא נמצא (`IntakeReport`).
 *
 * JSON מהמסד אינו מבטיח צורה, ופריט פגום נזרק במקום להפיל את הניסוח:
 * מענה בלי שורת "לא נמצא ברשימה" חסר מידע, אבל מענה שלא יצא כלל שובר את
 * ההבטחה של §2.6 שלב 4. אותו שיקול בדיוק כמו ב-`parseDraftRecipients`.
 *
 * **"נזרק" אינו "נעלם".** הזריקה היא ויתור על מידע שהשולח היה אמור לקבל,
 * ולפריט "נמצאו כמה התאמות" יש גם סיבה שאינה פגם (ראה `toAmbiguous`) —
 * ולכן היא נרשמת ללוג. `mailboxMessageId` הוא של ההודעה **הנכנסת**, שעליה
 * הדיווח שמור.
 */
export function parseReport(raw: unknown, mailboxMessageId?: string): IntakeReport | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const items = {
    updated: list(value.updated),
    notFound: list(value.notFound),
    ambiguous: list(value.ambiguous),
  };
  const report: IntakeReport = {
    updated: items.updated.flatMap(toUpdated),
    notFound: items.notFound.flatMap(toNotFound),
    ambiguous: items.ambiguous.flatMap(toAmbiguous),
  };

  const dropped =
    items.updated.length -
    report.updated.length +
    (items.notFound.length - report.notFound.length) +
    (items.ambiguous.length - report.ambiguous.length);
  if (dropped > 0) {
    logWarn("email.reply.report.dropped", {
      mailboxMessageId: mailboxMessageId ?? null,
      dropped,
      ambiguous: items.ambiguous.length - report.ambiguous.length,
    });
  }

  return report;
}

function list(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

function field(raw: unknown): DraftFieldName | null {
  return (DRAFT_FIELDS as readonly string[]).includes(raw as string) ? (raw as DraftFieldName) : null;
}

function text(raw: unknown): string | null {
  return typeof raw === "string" ? raw : null;
}

function options(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter((item): item is string => typeof item === "string");
}

function toUpdated(item: Record<string, unknown>): UpdatedItem[] {
  const name = field(item.field);
  return name ? [{ field: name, before: text(item.before), after: text(item.after) }] : [];
}

function toNotFound(item: Record<string, unknown>): NotFoundItem[] {
  const name = field(item.field);
  const written = text(item.written);
  return name && written ? [{ field: name, written, options: options(item.options) }] : [];
}

/**
 * "נמצאו כמה התאמות" — פריט נשמר **רק כשיש בו שתי התאמות ממשיות**.
 *
 * זו הצורה היחידה בדיווח שמפילה את הניסוח: `ambiguousSection` זורק על פריט
 * שאין בו שתיים (`intake/reply-model.ts`), ובצדק — `כתבת "יוסי לוי" — יוסי
 * לוי.` אינו משפט. אלא שפריט כזה נוצר גם ממידע תקין לחלוטין: ההתאמות בדיווח
 * מיוחדות לפי **תווית**, וההתאמה עצמה סופרת **רשומות**, ולכן שני מועמדים
 * שונים באותו שם בדיוק — איש מקצוע ומשתמש-נמען, ש§5.ז מתיר במפורש, או שתי
 * רשומות באותה טבלה (אין אילוץ ייחודיות על שם) — מתכווצים לתווית אחת.
 *
 * הסינון עצמו הוא `normalizeName`, אותה פונקציה שהניסוח מפעיל על כל התאמה
 * (`oneLine` שם), כדי ששני הצדדים יספרו בדיוק אותו דבר.
 */
function toAmbiguous(item: Record<string, unknown>): AmbiguousItem[] {
  const name = field(item.field);
  const written = text(item.written);
  const matches = (options(item.matches) ?? []).filter((match) => normalizeName(match) !== "");
  return name && written && matches.length >= 2 ? [{ field: name, written, matches }] : [];
}
