import { createHash } from "node:crypto";
import type { Role, Room } from "@/generated/prisma/enums";
import { enqueue } from "@/jobs/queue";
import { JOB_TYPES } from "@/jobs/types";
import { db } from "@/lib/db";
import type {
  DraftFieldName,
  DraftRecipient,
  DraftValues,
  RecipientRef,
  RecipientsProposal,
} from "@/lib/draft/fields";
import type { ChannelProposal, FieldChange } from "@/lib/draft/merge";
import type { ExtractionAttachment, Gazetteer } from "@/lib/intake/extraction";
import {
  type Candidate,
  type MatchResult,
  matchApartment,
  matchBuilding,
  matchName,
  mentionedIn,
} from "@/lib/intake/matching";
import { isOfficeDocument, extensionForType } from "@/lib/email-intake/mime";
import {
  type AmbiguousItem,
  type FieldExtraction,
  type IntakeReport,
  type Mention,
  type NotFoundItem,
  type UpdatedItem,
  emptyReport,
} from "@/lib/intake/types";
import { he } from "@/lib/he";
import { normalizeText } from "@/lib/normalize";
import { logWarn } from "@/lib/observability/log";
import { type Viewer, canCreateTicketInSite, canEditTicketFields } from "@/lib/permissions";
import type { MediaStorage, StoragePurpose } from "@/lib/storage";
import { isAllowedMimeType, isCorrespondenceDocumentType } from "@/lib/storage";
import type { DraftTicket } from "./draft-fields";
import { aiJobFor } from "./media";
import type { Tx } from "./ticket-activity";

/**
 * ליבת הטיוטה של הקליטה — מה שכל ערוץ (מייל, אפיון §2.6; וואטסאפ, §2.7)
 * עושה באותו אופן מהרגע שיש בידו חילוץ, שולח וקבצים.
 *
 * **הקובץ אינו יודע מאיזה ערוץ הגיעה ההודעה.** הוא מקבל טקסט (`haystack` —
 * מה שנקרא בפועל, שמולו נבדקת הזיה), משתמש שזוהה כשולח וקבצים שכבר סווגו.
 * הסולם של כל ערוץ, היומן שלו והמענה שלו נשארים אצלו
 * (`email-intake.ts`, ובהמשך `wa-intake.ts`); כאן רק מה שהיה מועתק ביניהם.
 */

// ─────────────────────────────── השולח ───────────────────────────────

/** המשתמש שמאחורי השולח — הוא גם השחקן של הטיוטה (§2.6 שלב 3) */
export interface SenderUser {
  id: string;
  name: string;
  role: Role;
  siteId: string | null;
}

/** השחקן שמאחורי ההודעה, כפי שהרשאות המערכת רואות אותו (§5.ז) */
export function viewerOf(sender: SenderUser): Viewer {
  return { kind: "user", id: sender.id, role: sender.role, siteId: sender.siteId };
}

/**
 * האתר שנגזר **מהשולח** (§2.6 שלב 3), ולא מההודעה.
 *
 * מקור אחד לשתי הכניסות — המסלול המלא ומסלול EM-11 — כי זה בדיוק מה
 * שנשמט: כלל "מנהל עבודה — האתר נגזר ממנו" אינו מותנה בחילוץ, וטיוטה בלי
 * אתר שמורה למנהל מערכת ולבעלים (EM-10). טיוטה בלי אתר שנוצרת למנהל
 * עבודה אינה גלויה לשולח שלה עצמו — לא במסך הפנייה, לא בלוח ולא במסנן
 * "פתחתי" — והמענה מפנה אותו לקישור שיחזיר 404.
 */
export function siteOfSender(sender: SenderUser): string | null {
  return sender.role === "SITE_MANAGER" ? sender.siteId : null;
}

// ─────────────────────────────── תשובה לטיוטה ───────────────────────────────

/**
 * מי משלושת המצבים חל על תשובה שמגיעה **עכשיו** לטיוטה, או שיש למזג
 * (§2.6 שלבים 5–6, §5.ה3 כלל 9, §7 שורה 76).
 *
 * הערכים הם שמות ההכרעות בשני היומנים (`MailOutcome`, ובוואטסאפ אותם שמות),
 * כדי שכל ערוץ יכתוב את ההכרעה כמו שהיא.
 *
 * **סדר הבדיקות הוא הכלל, לא מקרה.** הרשאת העריכה נבדקת **לפני** מצב
 * השיגור: תשובה ממשתמש מורשה שאינו רשאי לערוך מקבלת "אין לך הרשאה" **גם
 * כשהפנייה כבר שוגרה** — לא "כבר נשלחה" (§7 שורה 76, EM-A07). המענה "כבר
 * נשלחה" נושא מספר פנייה וקישור אליה, ואלה אינם שייכים למי שאין לו הרשאה
 * עליה. מחיקה נבדקת ראשונה מטעם מבני ולא לפי סדר עדיפות: בלי טיוטה אין
 * `siteId`/`createdById` לבדוק מולם הרשאה כלל.
 *
 * **מקרה 3 של כלל 9 (זר) אינו כאן.** "שולח שאינו משתמש מורשה" כבר הוכרע
 * בסולם של הערוץ **לפני** שהגענו לכאן: הפונקציה נקראת אך ורק כשיש `sender`,
 * וזה בדיוק ה"מורשה" של כלל 9. שולח שהושבת או שההרשאה שלו בוטלה נכשל באותה
 * בדיקה, כי היא נעשית מול הנתונים **החיים** ולא מול מה שהיה נכון כשהטיוטה
 * נוצרה — ולכן הוא "זר" באותה מידה בדיוק, גם אם הוא השולח המקורי.
 */
export type ReplyVerdict = "merge" | "REPLY_AFTER_DELETION" | "REPLY_NOT_PERMITTED" | "REPLY_AFTER_DISPATCH";

export function decideReplyVerdict(ticket: DraftTicket | null, sender: SenderUser): ReplyVerdict {
  if (!ticket) return "REPLY_AFTER_DELETION";
  if (!canEditTicketFields(viewerOf(sender), ticket)) return "REPLY_NOT_PERMITTED";
  if (!ticket.isDraft) return "REPLY_AFTER_DISPATCH";
  return "merge";
}

// ─────────────────────────────── הקשר לחילוץ ───────────────────────────────

/**
 * הרשומות הקיימות כטקסט, להקשר זיהוי בלבד (`Gazetteer`).
 *
 * **הרשימה תחומה בהרשאה של השולח**: מנהל עבודה רואה את האתר שלו בלבד,
 * ולכן גם המחלץ מקבל רק אותו — אחרת המודל היה "מזהה" אתר שהשולח אינו
 * רשאי לפתוח בו פנייה, וההתאמה הייתה נכשלת אחר כך בלי הסבר. מנהל מערכת
 * ובעלים פותחים בכל אתר, ולכן מקבלים את הכול.
 */
export async function loadGazetteer(sender: SenderUser): Promise<Gazetteer> {
  const siteFilter = sender.role === "SITE_MANAGER" && sender.siteId ? { id: sender.siteId } : {};

  const [sites, buildings, apartments, domains, professionals, users] = await Promise.all([
    db.site.findMany({ where: siteFilter, select: { name: true } }),
    db.building.findMany({ where: { site: siteFilter }, select: { name: true } }),
    db.apartment.findMany({ where: { building: { site: siteFilter } }, select: { number: true } }),
    db.domain.findMany({ select: { name: true } }),
    // מושבת אינו מועמד להתאמה (§2.6 שלב 3), ולכן גם אינו בהקשר: שם
    // שהמודל יקרא ולא יימצא אחר כך היה מדווח "לא נמצא ברשימה" על אדם קיים.
    db.professional.findMany({ where: { active: true }, select: { name: true } }),
    db.user.findMany({ where: { active: true }, select: { name: true } }),
  ]);

  return {
    sites: sites.map((site) => site.name),
    buildings: buildings.map((building) => building.name),
    apartments: apartments.map((apartment) => apartment.number),
    domains: domains.map((domain) => domain.name),
    professionals: professionals.map((professional) => professional.name),
    users: users.map((user) => user.name),
  };
}

// ─────────────────────────────── מהחילוץ לטיוטה ───────────────────────────────

export interface DraftValuesPlan {
  siteId: string | null;
  buildingId: string | null;
  apartmentId: string | null;
  room: Room | null;
  domainId: string | null;
  description: string;
  recipients: DraftRecipient[];
}

export interface DraftPlan {
  values: DraftValuesPlan;
  filled: DraftFieldName[];
  report: IntakeReport;
}

function emptyValues(): DraftValuesPlan {
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

/**
 * המסלול של EM-11: תוכן ההודעה הוא התיאור, ושאר השדות ריקים.
 *
 * "שאר השדות ריקים" מדבר על מה שנקרא מההודעה. האתר של מנהל עבודה אינו
 * נקרא מההודעה אלא נגזר מהמשתמש, ולכן הוא כאן — ובלי שורת `DraftField`,
 * בדיוק כמו במסלול המלא.
 */
export function unprocessedValues(body: string, sender: SenderUser): DraftValuesPlan {
  return { ...emptyValues(), siteId: siteOfSender(sender), description: normalizeText(body) };
}

/**
 * מתרגם חילוץ אחד לערכי הטיוטה ולדוח לשולח.
 *
 * `haystack` הוא הטקסט שנקרא בפועל (במייל: הכותרת והגוף), ומולו נבדק כל
 * ערך שהמחלץ סימן כמופיע בטקסט — ראה `quotedText`.
 *
 * **הסדר הוא חלק מהכלל:** בניין מותאם מול האתר שנקבע, ודירה מול הבניין.
 * בלי זה "דירה 12" הייתה מתאימה לדירה 12 של כל בניין בחברה, והקבלן היה
 * נשלח לכתובת אחרת (§2.5).
 *
 * **בטיוטה בלי אתר אין התאמת בניין ודירה כלל** (§7 שורה 66): אין מול מה
 * להתאים, והם מדווחים כחסרים ולא כ"לא נמצאו ברשימה" — השולח אכן כתב
 * אותם, ומה שחסר הוא האתר.
 */
export async function planDraft(
  extraction: FieldExtraction,
  sender: SenderUser,
  haystack: string,
): Promise<DraftPlan> {
  const values = emptyValues();
  const filled: DraftFieldName[] = [];
  const report = emptyReport();

  const written = (mention: Mention, field: DraftFieldName): string | null =>
    quotedText(mention, field, haystack);

  // ── אתר ──
  if (sender.role === "SITE_MANAGER") {
    // "השולח מנהל עבודה: האתר נגזר ממנו, כמו בפתיחה במערכת" (§2.6 שלב 3).
    // לכן אין כאן התאמה ואין דיווח: מה שכתב על אתר אינו יכול לשנות דבר.
    values.siteId = siteOfSender(sender);
  } else {
    const siteText = written(extraction.site, "SITE");
    if (siteText) {
      const sites = await candidates(db.site.findMany({ select: { id: true, name: true } }));
      values.siteId = resolve("SITE", siteText, matchName(siteText, sites), report, sites);
      if (values.siteId) filled.push("SITE");
    }
  }

  // ── בניין ודירה, בתוך האתר בלבד ──
  if (values.siteId) {
    const buildingText = written(extraction.building, "BUILDING");
    if (buildingText) {
      const buildings = await candidates(
        db.building.findMany({ where: { siteId: values.siteId }, select: { id: true, name: true } }),
      );
      values.buildingId = resolve("BUILDING", buildingText, matchBuilding(buildingText, buildings), report, buildings);
      if (values.buildingId) filled.push("BUILDING");
    }

    if (values.buildingId) {
      const apartmentText = written(extraction.apartment, "APARTMENT");
      if (apartmentText) {
        const rows = await db.apartment.findMany({
          where: { buildingId: values.buildingId },
          select: { id: true, number: true },
        });
        const apartments = rows.map((row) => ({ id: row.id, label: row.number }));
        values.apartmentId = resolve(
          "APARTMENT",
          apartmentText,
          matchApartment(apartmentText, apartments),
          report,
          // רשימת הדירות אינה נשלחת לשולח (EM-L02) — כ-50 באתר
          null,
        );
        if (values.apartmentId) filled.push("APARTMENT");
      }
    }
  }

  // ── חדר ──
  // החדר חוזר מהמחלץ כערך של הספירה (`Room`) ולא כטקסט, ולכן אין כאן
  // התאמה (`matchRoom` משרת את מי שקורא טקסט חופשי). הוא גם אינו שדה חובה
  // ואינו מדווח כ"לא נמצא": ערך שאינו ברשימה הסגורה פשוט לא נכתב.
  if (extraction.room.value && extraction.room.source !== "none") {
    values.room = extraction.room.value;
    filled.push("ROOM");
  }

  // ── תחום ──
  const domainText = written(extraction.domain, "DOMAIN");
  if (domainText) {
    const domains = await candidates(db.domain.findMany({ select: { id: true, name: true } }));
    values.domainId = resolve("DOMAIN", domainText, matchName(domainText, domains), report, domains);
    if (values.domainId) filled.push("DOMAIN");
  }

  // ── תיאור ──
  // `set` בלבד: הודעה ראשונה פותחת תיאור, ו-`append`/`replace` הם של תשובה.
  if (extraction.description.op === "set") {
    const description = normalizeText(extraction.description.text);
    if (description) {
      values.description = description;
      filled.push("DESCRIPTION");
    }
  }

  // ── נמענים ──
  const recipients = await resolveRecipients(extraction, report, haystack);
  if (recipients.length > 0) {
    values.recipients = recipients;
    filled.push("RECIPIENTS");
  }

  return { values, filled, report };
}

/**
 * בונה `ChannelProposal` מחילוץ של **תשובה** — המקבילה של `planDraft` למסלול
 * הזה. ההבדל המהותי: אין כאן טיוטה חדשה שנוצרת, יש טיוטה **קיימת** שכבר
 * יש לה אתר/בניין אפשריים. התאמת בניין ודירה חייבת להתבצע מול **האתר
 * שההודעה הזו מדברת עליו** — האתר שההודעה הציעה, ורק אם היא לא הציעה דבר,
 * האתר שכבר בטיוטה (ראה ההערה הארוכה מעל `mergeChannelIntoDraft` ב-
 * `draft/merge.ts` על "תלויים מאותו מייל כשהאתר או הבניין לא נכנסו").
 *
 * רץ תחת הנעילה (`tx`) ולא לפניה: "האתר שכבר בטיוטה" חייב להיות **הערך
 * הנעול**, לא זה שנקרא לפני שהמתנו לקבצים ולמחלץ.
 */
export async function buildReplyProposal(
  tx: Tx,
  extraction: FieldExtraction,
  sender: SenderUser,
  haystack: string,
  current: DraftValues,
): Promise<{ proposal: ChannelProposal; report: IntakeReport }> {
  const report = emptyReport();
  const written = (mention: Mention, field: DraftFieldName): string | null => quotedText(mention, field, haystack);
  const proposal: ChannelProposal = {};

  // ── אתר ── מנהל עבודה: בלי התאמה כלל, בדיוק כמו `planDraft` — האתר נגזר
  // מהשולח ותשובה אינה יכולה לשנות אותו. מנהל מערכת/בעלים: כמו בהודעה ראשונה.
  if (sender.role !== "SITE_MANAGER") {
    const siteText = written(extraction.site, "SITE");
    if (siteText) {
      const sites = await candidates(tx.site.findMany({ select: { id: true, name: true } }));
      const resolved = resolve("SITE", siteText, matchName(siteText, sites), report, sites);
      // "בתשובה, שינוי אתר חל רק אם הכותב רשאי לפתוח פנייה באתר החדש"
      // (הכרעת מימוש, לא אפיון מפורש). כיום תמיד true למנהל מערכת/בעלים —
      // הבדיקה נשארת כרשת ביטחון לתפקיד עתידי; אתר שאין הרשאה לפתוח בו
      // נזרק בשקט (לא מדווח כ"לא נמצא" — הוא נמצא, רק אין הרשאה עליו).
      if (resolved && canCreateTicketInSite(viewerOf(sender), resolved)) proposal.site = resolved;
    }
  }

  const effectiveSiteId = proposal.site ?? current.siteId;
  // האתר משתנה מההודעה הזו — גם כשהוא זהה למה שכבר בטיוטה `proposal.site`
  // עדיין "undefined" כלומר לא הוצע, ולכן ההשוואה ל-`current.siteId` נכונה
  const siteChanging = proposal.site !== undefined && proposal.site !== current.siteId;

  if (effectiveSiteId) {
    const buildingText = written(extraction.building, "BUILDING");
    if (buildingText) {
      const buildings = await candidates(
        tx.building.findMany({ where: { siteId: effectiveSiteId }, select: { id: true, name: true } }),
      );
      const resolved = resolve("BUILDING", buildingText, matchBuilding(buildingText, buildings), report, buildings);
      if (resolved) proposal.building = resolved;
    }

    // הבניין להתאמת דירה: מה שההודעה הזו נתנה, ואם לא — הבניין שכבר בטיוטה,
    // **רק אם האתר לא השתנה מההודעה הזו**. אם האתר השתנה וההודעה לא נתנה
    // בניין, אין בניין בהקשר הנכון להתאים דירה מולו.
    const effectiveBuildingId = proposal.building ?? (siteChanging ? null : current.buildingId);
    if (effectiveBuildingId) {
      const apartmentText = written(extraction.apartment, "APARTMENT");
      if (apartmentText) {
        const rows = await tx.apartment.findMany({
          where: { buildingId: effectiveBuildingId },
          select: { id: true, number: true },
        });
        const apartments = rows.map((row) => ({ id: row.id, label: row.number }));
        const resolved = resolve("APARTMENT", apartmentText, matchApartment(apartmentText, apartments), report, null);
        if (resolved) proposal.apartment = resolved;
      }
    }
  }

  // ── חדר ── כמו בהודעה ראשונה: ערך של הספירה, לא טקסט — אין כאן התאמה
  if (extraction.room.value && extraction.room.source !== "none") proposal.room = extraction.room.value;

  // ── תחום ──
  const domainText = written(extraction.domain, "DOMAIN");
  if (domainText) {
    const domains = await candidates(tx.domain.findMany({ select: { id: true, name: true } }));
    const resolved = resolve("DOMAIN", domainText, matchName(domainText, domains), report, domains);
    if (resolved) proposal.domain = resolved;
  }

  // ── תיאור ── `append`/`replace`/`set` כולם עוברים למנוע המיזוג כמו שהם;
  // רק המנוע יודע אם זו תוספת (EM-C07) או שדה שיוכרע מול עריכה במערכת.
  if (extraction.description.op !== "none") {
    const text = normalizeText(extraction.description.text);
    if (text) proposal.description = { op: extraction.description.op, text };
  }

  // ── נמענים ── הוספה **והסרה** (§5.ה4) — בשונה מהודעה ראשונה
  const recipients = await resolveRecipientsProposal(extraction, report, haystack, tx);
  if (recipients) proposal.recipients = recipients;

  return { proposal, report };
}

/**
 * הערך כפי שנכתב, או null כשאין לקחת אותו.
 *
 * **שומר מפני הזיה** (S0 ממצא 3): ערך שסומן `source: "text"` ואינו מופיע
 * מילה במילה בטקסט שנקרא נזרק. ערך מקובץ מצורף אינו נבדק — אין לו טקסט
 * להשוות אליו.
 */
function quotedText(mention: Mention, field: DraftFieldName, haystack: string): string | null {
  if (mention.source === "none" || mention.text.trim() === "") return null;
  if (mention.source === "text" && !mentionedIn(mention.text, haystack)) {
    logWarn("email.extraction.dropped_unquoted", { field, chars: mention.text.length });
    return null;
  }
  return mention.text;
}

async function candidates(query: Promise<{ id: string; name: string }[]>): Promise<Candidate[]> {
  return (await query).map((row) => ({ id: row.id, label: row.name }));
}

/**
 * מזהה אחד, או null + שורה בדוח.
 *
 * "לא נמצא" ו"כמה התאמות" אינם כשל אלא **מידע לשולח** (EM-07, EM-08):
 * המערכת אינה יוצרת רשומה ואינה מנחשת, והמענה אומר מה נכתב ומה קיים.
 * `options` נמסר רק לשדות שרשימתם קצרה מספיק למענה (EM-L02).
 */
function resolve(
  field: DraftFieldName,
  writtenText: string,
  result: MatchResult<Candidate>,
  report: IntakeReport,
  options: readonly Candidate[] | null,
): string | null {
  if (result.kind === "match") return result.candidate.id;

  if (result.kind === "ambiguous") {
    const item: AmbiguousItem = {
      field,
      written: writtenText,
      // תוויות ייחודיות: איש מקצוע ומשתמש יכולים לשאת אותו שם, ושורה
      // שאומרת לשולח `כתבת "יוסי" — יוסי לוי, יוסי לוי` אינה עוזרת לו
      // לבחור. העמימות עצמה נשארת — אף רשומה לא נבחרה
      matches: [...new Set(result.candidates.map((candidate) => candidate.label))],
    };
    report.ambiguous.push(item);
    return null;
  }

  const item: NotFoundItem = {
    field,
    written: writtenText,
    options: options ? options.map((candidate) => candidate.label) : null,
  };
  report.notFound.push(item);
  return null;
}

/**
 * מאגר המועמדים לנמענים — אנשי מקצוע ומשתמשים **ברשימה אחת**: השולח כתב
 * שם, ולא "קבלן" או "משתמש". שם שמתאים לשניהם הוא עמימות אמיתית (EM-08)
 * ולא ברירה שרירותית לפי סוג הרשומה.
 *
 * מקור אחד להודעה ראשונה (`resolveRecipients`) ולתשובה (`resolveRecipientsProposal`)
 * — שתיהן צריכות בדיוק אותו מאגר, ובנייתו פעמיים הייתה מסתכנת בהבדל
 * שקט (למשל שכחת `active: true`) בין שני המסלולים.
 */
async function recipientPool(client: Tx | typeof db = db): Promise<(Candidate & { ref: RecipientRef })[]> {
  const [professionals, users] = await Promise.all([
    client.professional.findMany({ where: { active: true }, select: { id: true, name: true } }),
    client.user.findMany({ where: { active: true }, select: { id: true, name: true } }),
  ]);

  return [
    ...professionals.map((row) => ({
      id: `professional:${row.id}`,
      label: row.name,
      ref: { kind: "professional" as const, id: row.id },
    })),
    ...users.map((row) => ({
      id: `user:${row.id}`,
      label: row.name,
      ref: { kind: "user" as const, id: row.id },
    })),
  ];
}

/**
 * מתאים רשימת אזכורים (מה שהמחלץ החזיר ב-`recipients.add` או ב-`recipients.remove`)
 * לנמענים קיימים במאגר. הליבה המשותפת של הוספה והסרה — ראה `recipientPool`.
 */
function matchRecipientRefs(
  mentions: readonly Mention[],
  pool: readonly (Candidate & { ref: RecipientRef })[],
  report: IntakeReport,
  haystack: string,
): RecipientRef[] {
  const wanted = mentions
    .map((mention) => quotedText(mention, "RECIPIENTS", haystack))
    .filter((text): text is string => text !== null);

  const chosen: RecipientRef[] = [];
  for (const writtenText of wanted) {
    const result = matchName(writtenText, pool);
    if (result.kind === "match") {
      const { ref } = result.candidate;
      // שם שנכתב פעמיים הוא הדגשה, לא שני נמענים
      if (!chosen.some((item) => item.kind === ref.kind && item.id === ref.id)) chosen.push(ref);
      continue;
    }
    resolve("RECIPIENTS", writtenText, result, report, null);
  }
  return chosen;
}

/**
 * הנמענים שההודעה ביקשה להוסיף (הודעה ראשונה).
 *
 * `remove` אינו מטופל כאן — אין ממה להסיר בהודעה שפותחת טיוטה. ההסרה שייכת
 * לתשובה (§5.ה4, `resolveRecipientsProposal`).
 */
async function resolveRecipients(
  extraction: FieldExtraction,
  report: IntakeReport,
  haystack: string,
): Promise<DraftRecipient[]> {
  if (extraction.recipients.add.length === 0) return [];
  const pool = await recipientPool();
  const refs = matchRecipientRefs(extraction.recipients.add, pool, report, haystack);
  return refs.map((ref) => ({ ...ref, origin: "CHANNEL" as const, removedBySystemAt: null }));
}

/**
 * הצעת הנמענים של תשובה — הוספה **והסרה** (§5.ה4), כ-`RecipientsProposal`
 * שמנוע המיזוג (`merge.ts`) מכריע לפיו לכל נמען בנפרד. `undefined` כשההודעה
 * לא הזכירה אף נמען — כדי ש-`mergeChannelIntoDraft` לא יראה בכך "הרשימה ריקה".
 */
async function resolveRecipientsProposal(
  extraction: FieldExtraction,
  report: IntakeReport,
  haystack: string,
  client: Tx | typeof db = db,
): Promise<RecipientsProposal | undefined> {
  if (extraction.recipients.add.length === 0 && extraction.recipients.remove.length === 0) return undefined;
  const pool = await recipientPool(client);
  const add = matchRecipientRefs(extraction.recipients.add, pool, report, haystack);
  const remove = matchRecipientRefs(extraction.recipients.remove, pool, report, haystack);
  if (add.length === 0 && remove.length === 0) return undefined;
  return { add, remove };
}

// ─────────────────────────────── שמות במקום מזהים ───────────────────────────────

/** מזהי הרשומות שמענה מזכיר, לפי סוג — מה שצריך לתרגם לשמות */
export interface RecordIds {
  site: Set<string>;
  building: Set<string>;
  apartment: Set<string>;
  domain: Set<string>;
  professional: Set<string>;
  user: Set<string>;
}

export function emptyRecordIds(): RecordIds {
  return {
    site: new Set(),
    building: new Set(),
    apartment: new Set(),
    domain: new Set(),
    professional: new Set(),
    user: new Set(),
  };
}

export function addRecipientId(ids: RecordIds, ref: RecipientRef): void {
  (ref.kind === "professional" ? ids.professional : ids.user).add(ref.id);
}

/** השמות של הרשומות, לפי סוג. מזהה שאינו כאן — הרשומה נמחקה. */
export interface RecordLabels {
  site: Map<string, string>;
  building: Map<string, string>;
  apartment: Map<string, string>;
  domain: Map<string, string>;
  professional: Map<string, string>;
  user: Map<string, string>;
}

async function labelMap(
  ids: ReadonlySet<string>,
  load: (ids: string[]) => Promise<{ id: string; name: string }[]>,
): Promise<Map<string, string>> {
  if (ids.size === 0) return new Map();
  return new Map((await load([...ids])).map((row) => [row.id, row.name]));
}

/**
 * השמות של כל הרשומות שהמענה מזכיר — שאילתה אחת לכל טבלה ולא שאילתה
 * לשורה: מענה אחד יכול להזכיר כמה נמענים וכמה שדות בסתירה, וזו הדרך שבה
 * N+1 נכנס בשקט למסלול שרץ על כל הודעה נכנסת.
 *
 * מקור אחד ל"עודכן מהתשובה שלך" (`toUpdatedItems`, תחת הנעילה) ולמענה עצמו
 * (`intake-reply.ts`, בזמן השליחה).
 */
export async function loadRecordLabels(client: Tx | typeof db, ids: RecordIds): Promise<RecordLabels> {
  const [site, building, apartment, domain, professional, user] = await Promise.all([
    labelMap(ids.site, (list) => client.site.findMany({ where: { id: { in: list } }, select: { id: true, name: true } })),
    labelMap(ids.building, (list) =>
      client.building.findMany({ where: { id: { in: list } }, select: { id: true, name: true } }),
    ),
    labelMap(ids.apartment, async (list) =>
      (await client.apartment.findMany({ where: { id: { in: list } }, select: { id: true, number: true } })).map(
        (row) => ({ id: row.id, name: row.number }),
      ),
    ),
    labelMap(ids.domain, (list) =>
      client.domain.findMany({ where: { id: { in: list } }, select: { id: true, name: true } }),
    ),
    labelMap(ids.professional, (list) =>
      client.professional.findMany({ where: { id: { in: list } }, select: { id: true, name: true } }),
    ),
    labelMap(ids.user, (list) => client.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } })),
  ]);
  return { site, building, apartment, domain, professional, user };
}

/**
 * ממיר את `MergeResult.changes` (מזהים גולמיים) ל-`UpdatedItem[]` — תוויות
 * להצגה, הבסיס ל"עודכן מהתשובה שלך" (EM-C03).
 */
export async function toUpdatedItems(tx: Tx, changes: readonly FieldChange[]): Promise<UpdatedItem[]> {
  if (changes.length === 0) return [];

  const ids = emptyRecordIds();
  for (const change of changes) {
    for (const value of [change.before, change.after]) {
      switch (change.field) {
        case "SITE":
          if (typeof value === "string") ids.site.add(value);
          break;
        case "BUILDING":
          if (typeof value === "string") ids.building.add(value);
          break;
        case "APARTMENT":
          if (typeof value === "string") ids.apartment.add(value);
          break;
        case "DOMAIN":
          if (typeof value === "string") ids.domain.add(value);
          break;
        case "RECIPIENTS":
          (value as RecipientRef[] | undefined)?.forEach((ref) => addRecipientId(ids, ref));
          break;
        case "ROOM":
        case "DESCRIPTION":
          break;
      }
    }
  }

  const labels = await loadRecordLabels(tx, ids);
  return changes.map((change) => ({
    field: change.field,
    before: replyDisplayValue(change.field, change.before, labels),
    after: replyDisplayValue(change.field, change.after, labels),
  }));
}

function replyDisplayValue(field: DraftFieldName, raw: unknown, labels: RecordLabels): string | null {
  switch (field) {
    case "SITE":
      return typeof raw === "string" ? (labels.site.get(raw) ?? null) : null;
    case "BUILDING":
      return typeof raw === "string" ? (labels.building.get(raw) ?? null) : null;
    case "APARTMENT":
      return typeof raw === "string" ? (labels.apartment.get(raw) ?? null) : null;
    case "DOMAIN":
      return typeof raw === "string" ? (labels.domain.get(raw) ?? null) : null;
    case "ROOM":
      return raw ? he.room[raw as Room] : null;
    case "DESCRIPTION":
      return typeof raw === "string" && raw !== "" ? raw : null;
    case "RECIPIENTS": {
      const refs = (raw as RecipientRef[] | undefined) ?? [];
      const names = refs
        .map((ref) => (ref.kind === "professional" ? labels.professional : labels.user).get(ref.id) ?? "")
        .filter(Boolean);
      return names.length > 0 ? names.join(he.emailIntake.listSeparator) : null;
    }
  }
}

// ─────────────────────────────── קבצים ───────────────────────────────

/**
 * מה שכל ערוץ יודע לומר על קובץ שהגיע: מיקום יציב בתוך ההודעה, שם וגודל.
 * במייל זה `MailPart`; בוואטסאפ — המדיה של ההודעה.
 */
export interface PartRef {
  /** מיקום יציב בתוך ההודעה — גם המפתח באחסון וגם המפתח ל-`MediaFile` */
  index: number;
  filename: string | null;
  sizeBytes: number;
}

/** חלק אחד אחרי הורדה וסיווג — מה שהטרנזאקציה תכתוב ממנו */
export interface PreparedPart<P extends PartRef = PartRef> {
  part: P;
  /** הסוג **שנפתר** (`classifyAttachment`), ולא מה שהוצהר */
  mimeType: string;
  isMedia: boolean;
  bytes: Buffer | null;
  sha256: string | null;
  storageKey: string | null;
  /**
   * האם הבתים נשמרים, ובאיזו רשימת היתר: `media` — נכנס לטיוטה כקובץ;
   * `correspondence` — מסמך Word/Excel שנשמר בהתכתבות בלבד (§7 שורה 64);
   * `null` — רק השם והסיבה נרשמים.
   */
  storeAs: StoragePurpose | null;
  /** למה הקובץ אינו נכנס לטיוטה. null — הוא כן נכנס. */
  skippedReason: string | null;
}

export function skippedPart<P extends PartRef>(
  part: P,
  mimeType: string,
  isMedia: boolean,
  reason: string,
): PreparedPart<P> {
  return { part, mimeType, isMedia, bytes: null, sha256: null, storageKey: null, storeAs: null, skippedReason: reason };
}

/**
 * מה נעשה בחלק שהבתים שלו בידינו.
 *
 * מדיה = תמונה, וידאו, אודיו או PDF (§3.1). **גם מדיה אינה נכנסת אם היא
 * מחוץ לרשימת ההיתר של האחסון** — למשל SVG, שהוא מסמך XML שיכול להריץ
 * סקריפט כשהוא מוגש מהדומיין שלנו.
 */
export function classifyBytes<P extends PartRef>(
  part: P,
  resolved: { mimeType: string; isMedia: boolean; isTnef: boolean },
  bytes: Buffer,
): PreparedPart<P> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const base: PreparedPart<P> = {
    part,
    mimeType: resolved.mimeType,
    isMedia: resolved.isMedia,
    bytes,
    sha256,
    storageKey: null,
    storeAs: "media",
    skippedReason: null,
  };
  const notStored = { bytes: null, storeAs: null } as const;

  if (resolved.isTnef) return { ...base, ...notStored, skippedReason: "tnef" };
  if (!resolved.isMedia) {
    // מסמך Word/Excel אמיתי נשמר בהתכתבות — ועדיין "לא נכנס לטיוטה": הסיבה
    // נשארת, וזה מה שמונע ממנו להפוך לקובץ בטיוטה (`writeMedia`)
    if (bytes.byteLength > 0 && isOfficeDocument(resolved.mimeType, bytes.subarray(0, 8))) {
      return { ...base, storeAs: "correspondence", skippedReason: "not-media" };
    }
    return { ...base, ...notStored, skippedReason: "not-media" };
  }
  if (!isAllowedMimeType(resolved.mimeType)) {
    return { ...base, ...notStored, skippedReason: "unsupported-type" };
  }
  // בתים ריקים נדחים באחסון ממילא (`assertWritableObject`), ורשומת מדיה
  // שמצביעה על כלום גרועה מהיעדרה
  if (bytes.byteLength === 0) return { ...base, ...notStored, skippedReason: "empty" };

  return base;
}

/** הקבצים שנכנסים לקריאת החילוץ — רק מה שהבתים שלו בידינו */
export function extractionAttachments(parts: readonly PreparedPart[]): ExtractionAttachment[] {
  return parts.flatMap((part) =>
    part.bytes && part.isMedia
      ? [{ filename: part.part.filename, mimeType: part.mimeType, bytes: part.bytes }]
      : [],
  );
}

/**
 * כותב את הבתים לאחסון — **לפני** הטרנזאקציה.
 *
 * העלאה לאחסון בתוך טרנזאקציה מחזיקה אותה פתוחה לאורך כל ההעברה, על בריכה
 * של עשרה חיבורים שמשרתת גם את המסכים. מפתח שנכתב ואיש אינו מפנה אליו הוא
 * בזבוז שקט; טרנזאקציה שננעלה על העלאה היא מסך תלוי.
 *
 * המפתח דטרמיניסטי (`keyOf`, לפי ההודעה ומספר החלק) ולא אקראי כמו ב-
 * `buildStorageKey`: ריצה חוזרת אחרי קריסה כותבת לאותו מקום במקום להשאיר
 * עותק יתום נוסף.
 */
export async function storePreparedParts<P extends PartRef>(
  parts: readonly PreparedPart<P>[],
  keyOf: (prepared: PreparedPart<P>) => string,
  storage: MediaStorage,
): Promise<PreparedPart<P>[]> {
  const written: PreparedPart<P>[] = [];

  for (const prepared of parts) {
    if (!prepared.bytes || !prepared.storeAs) {
      written.push(prepared);
      continue;
    }
    const key = keyOf(prepared);
    await storage.write(key, prepared.bytes, prepared.mimeType, prepared.storeAs);
    written.push({ ...prepared, storageKey: key });
  }

  return written;
}

/**
 * הסיומת של מפתח באחסון, מהסוג שנפתר. מסמך מההתכתבות מקבל את הסיומת
 * האמיתית שלו (`.docx`, ולא `vndopenxmlformats…` שנגזר מתת-הסוג); למדיה
 * המפתחות נשארים כפי שהיו, כדי שריצה חוזרת תכתוב לאותו מפתח.
 */
export function storageExtension(mimeType: string): string {
  if (isCorrespondenceDocumentType(mimeType)) return extensionForType(mimeType) ?? "bin";
  const subtype = mimeType.split("/")[1]?.split(";")[0]?.replace(/[^a-z0-9]/gi, "").toLowerCase() ?? "";
  return subtype || "bin";
}

/**
 * הודעת המדיה בשרשור, ורשומת `MediaFile` לכל קובץ שנכנס לטיוטה.
 *
 * הודעה אחת לכל הקבצים ולא הודעה לקובץ, כמו ב-`attachInitialMedia`:
 * השולח תיאר אירוע אחד. `uploaded: true` כי הבתים כבר באחסון — כאן אין
 * דפדפן שעלול להיקטע באמצע.
 */
export async function writeMedia(
  tx: Tx,
  ticketId: string,
  authorUserId: string,
  parts: readonly PreparedPart[],
  /**
   * תמלול שכבר נעשה, לפי מיקום החלק (`PartRef.index`). בוואטסאפ הקלטה מתומללת
   * **לפני** ההכרעה, כדי לבדוק אם נאמרה בה המילה (§7 שורה 95) — והתמלול הזה הוא
   * התמלול של הקובץ: אותו מנוע, אותה הנחיה. ג׳וב `TRANSCRIBE` שני היה משלם פעמיים
   * על אותה הקלטה, ובזמן הריצה שלו הקובץ היה מוצג "מתמלל…" על תמלול שכבר קיים.
   */
  transcripts: ReadonlyMap<number, string> = new Map(),
): Promise<Map<number, string>> {
  const created = new Map<number, string>();
  // רק מה שנשמר **כמדיה**: מסמך Word שנשמר בהתכתבות יש לו מפתח, ואסור
  // שיהפוך לקובץ בטיוטה — ואיתו לנמענים ולג׳וב AI
  const media = parts.filter((part) => part.storageKey !== null && part.storeAs === "media");
  if (media.length === 0) return created;

  const message = await tx.message.create({
    data: { ticketId, kind: "MEDIA", authorUserId },
    select: { id: true },
  });

  for (const part of media) {
    const jobType = aiJobFor(part.mimeType);
    const transcript = jobType === JOB_TYPES.transcribe ? transcripts.get(part.part.index) : undefined;
    const file = await tx.mediaFile.create({
      data: {
        messageId: message.id,
        storageKey: part.storageKey as string,
        mimeType: part.mimeType,
        sizeBytes: part.bytes?.byteLength ?? part.part.sizeBytes,
        originalName: part.part.filename,
        uploaderUserId: authorUserId,
        uploaded: true,
        // תמלול ריק הוא "לא נאמר דבר" — אותו ערך ש-`runTranscription` כותב
        ...(transcript === undefined ? {} : { transcription: transcript || null, aiStatus: "DONE" as const }),
      },
      select: { id: true },
    });
    created.set(part.part.index, file.id);

    if (transcript !== undefined) continue;
    if (jobType) await enqueue(tx, jobType, { mediaId: file.id });
    // בלי סוג מתאים (וידאו) הרשומה מסומנת מיד כמדולגת ולא נשארת "ממתינה"
    // לנצח — הממשק היה מציג עליה "קורא את הטקסט…" שלא ייגמר.
    else await tx.mediaFile.update({ where: { id: file.id }, data: { aiStatus: "SKIPPED" } });
  }

  return created;
}
