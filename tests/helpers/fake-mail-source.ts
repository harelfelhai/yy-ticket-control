import { MailSourceError, type MailErrorKind, type MailSource } from "@/lib/email-intake/source";
import type { MailEnvelope } from "@/lib/email-intake/types";
import { MAILBOX, type MailFixture } from "./mail-fixtures";

/**
 * תיבת דואר בזיכרון שמממשת את `MailSource` — לכל בדיקה של הצינור (S6).
 *
 * **אין כאן רשת, ואי אפשר להוסיף אותה בלי לשנות את הקובץ.** המודול מייבא
 * טיפוסים ומעטפות בלבד: אין `fetch`, אין `http`, אין לקוח, ואין מסלול שדרכו
 * ערך מבחוץ הופך לבקשה. זה אינו הידור: התיבה האמיתית משותפת עם מערכת אחרת,
 * אין במכונת פיתוח טוקן קריאה, ובדיקה ש"נגעה בטעות" ברשת הייתה נכשלת (או
 * גרוע מכך — עוברת) מסיבות שאינן בקוד הנבדק.
 *
 * **הוא גם אינו מציע פעולה שמשנה** — לא סימון כנקרא, לא העברה ולא מחיקה —
 * מאותו נימוק שבגללו `MailSource` עצמו אינו מציע אחת (EM-20, §5.ה3 כלל 3).
 * מה שמשתנה כאן הוא **מצב הבדיקה**: `deliver` מדמה דואר שהגיע בין סבבים,
 * ו-`remove` מדמה הודעה שנמחקה מהתיבה בידי אדם או מערכת אחרת.
 *
 * **כל קריאה נרשמת** (`calls`). זה מה שמאפשר לבדוק את מה שאין לו תוצאה
 * גלויה: שהשאילתה נבנתה נכון, שהעמוד השני נדרש, ושהודעה שכבר נראתה לא
 * נקראה שוב.
 */

// ─────────────────────────────── תיעוד הקריאות ───────────────────────────────

export type MailSourceMethod = "getProfile" | "listIds" | "getMessage" | "getAttachment";

/** קריאה אחת כפי שהתקבלה. השדות הרלוונטיים לכל שיטה בלבד. */
export interface MailSourceCall {
  method: MailSourceMethod;
  query?: string;
  pageToken?: string;
  messageId?: string;
  attachmentId?: string;
}

// ─────────────────────────────── כשלים מתוכננים ───────────────────────────────

/**
 * כשל שיוזרק לקריאה הבאה שתואמת.
 *
 * **הסיווג (`kind`) הוא כל העניין**, ולא הודעת השגיאה: הצינור מחליט לפיו אם
 * לנסות שוב, לעצור ברעש או לרשום הכרעה סופית, ובדיקה שאינה יכולה לייצר
 * `auth` מול `transient` אינה יכולה לבדוק את ההחלטה הזו כלל.
 */
export interface FakeFailure {
  method: MailSourceMethod;
  kind: MailErrorKind;
  /** רק לקריאה על ההודעה הזו (`getMessage`, `getAttachment`) */
  messageId?: string;
  /** רק לשאילתה שמכילה את הטקסט הזה (`listIds`) */
  queryIncludes?: string;
  /** כמה קריאות תואמות להפיל. ברירת המחדל 1; `Infinity` = כולן. */
  times?: number;
  status?: number;
  message?: string;
}

// ─────────────────────────────── ההתאמה לשאילתה ───────────────────────────────

const FROM_GROUP = /from:\(([^)]*)\)/;
const AFTER_SECONDS = /(?:^|\s)after:(\d+)/;

/**
 * האם ההודעה חוזרת מהשאילתה הזו — קריאה **מכוונת-תמימות** של שני התנאים
 * שהצינור בונה (`buildPollQueries`): קבוצת ה-`from:` והרצפה `after:`.
 *
 * היא אינה מחקה את מנוע החיפוש של Gmail ואינה מתיימרת: `in:anywhere`,
 * `-in:spam` ו-`-from:me` אינם נבדקים כאן, כי אין להם ייצוג בזיכרון. מה
 * שנבדק מול המחרוזת עצמה נקרא מ-`calls`.
 *
 * זו ברירת המחדל דווקא משום שהיא מחמירה: תיבה שמחזירה הכול לכל שאילתה היא
 * ירוק שקרי — בדיקת מצב פיילוט (`emailIntakePilotAddresses`) הייתה עוברת גם
 * אילו הסינון לא היה קיים. כאן היא נכשלת ברעש. `match: () => true` מכבה זאת
 * למי שבודק משהו אחר.
 */
export function matchesQuery(envelope: MailEnvelope, query: string): boolean {
  const group = FROM_GROUP.exec(query);
  if (group) {
    const senders = group[1]
      .split(/\s+OR\s+/)
      .map((sender) => sender.trim().toLowerCase())
      .filter(Boolean);
    if (!senders.includes(envelope.from?.address.toLowerCase() ?? "")) return false;
  }

  const after = AFTER_SECONDS.exec(query);
  // `after:` של Gmail הוא שניות מהאפוק, והוא כולל את הגבול עצמו
  if (after && envelope.receivedAt.getTime() < Number(after[1]) * 1000) return false;

  return true;
}

// ─────────────────────────────── התיבה ───────────────────────────────

export interface FakeMailSourceOptions {
  /** ההודעות שבתיבה. מעטפה או `MailFixture` — מהשנייה נאספים גם הבתים להורדה. */
  messages?: readonly (MailEnvelope | MailFixture)[];
  /** הכתובת שהטוקן פותח (`getProfile`). ברירת המחדל היא התיבה של ה-fixtures. */
  profile?: string;
  /** בתים נוספים לפי `attachmentId`, למי שאינו בונה `MailFixture` */
  attachments?: Record<string, Buffer>;
  /** כמה מזהים בעמוד. ברירת המחדל: הכול בעמוד אחד, בלי `nextPageToken`. */
  pageSize?: number;
  /** אילו הודעות שאילתה מחזירה. ברירת המחדל: `matchesQuery`. */
  match?: (envelope: MailEnvelope, query: string) => boolean;
  failures?: readonly FakeFailure[];
}

export interface FakeMailSource extends MailSource {
  /** כל הקריאות לפי סדרן */
  readonly calls: readonly MailSourceCall[];
  callsTo(method: MailSourceMethod): MailSourceCall[];
  /** דואר שהגיע בין סבבים */
  deliver(...messages: (MailEnvelope | MailFixture)[]): void;
  /** הודעה שאיננה עוד בתיבה: `getMessage` יחזיר עליה `null` (הכרעה `GONE`) */
  remove(messageId: string): void;
  /** כשל שיוזרק לקריאה הבאה שתואמת */
  failNext(failure: FakeFailure): void;
  /** מאפס את תיעוד הקריאות — לבדיקה שמריצה כמה סבבים ובוחנת כל אחד לחוד */
  clearCalls(): void;
}

/** האם זה `MailFixture` (מעטפה + בתים) או מעטפה בלבד */
function isFixture(message: MailEnvelope | MailFixture): message is MailFixture {
  return "envelope" in message;
}

const PAGE_TOKEN = /^offset-(\d+)$/;

export function fakeMailSource(options: FakeMailSourceOptions = {}): FakeMailSource {
  const profile = options.profile ?? MAILBOX;
  const match = options.match ?? matchesQuery;
  const pageSize = options.pageSize;

  /** סדר ההוספה, ולא לפי זמן: בדיקה צריכה סדר שאפשר לכתוב עליו ציפייה */
  const envelopes: MailEnvelope[] = [];
  /** הבתים, לפי `<sourceId>|<attachmentId>` ולפי `<attachmentId>` בלבד */
  const attachments = new Map<string, Buffer>();
  const calls: MailSourceCall[] = [];
  const failures: FakeFailure[] = [...(options.failures ?? [])].map((failure) => ({ ...failure }));

  function add(message: MailEnvelope | MailFixture): void {
    if (!isFixture(message)) {
      envelopes.push(message);
      return;
    }
    envelopes.push(message.envelope);
    for (const [attachmentId, bytes] of Object.entries(message.attachments)) {
      attachments.set(`${message.envelope.sourceId}|${attachmentId}`, bytes);
      attachments.set(attachmentId, bytes);
    }
  }

  for (const message of options.messages ?? []) add(message);
  for (const [attachmentId, bytes] of Object.entries(options.attachments ?? {})) attachments.set(attachmentId, bytes);

  /**
   * רושם את הקריאה ומפיל אותה אם תוכנן לה כשל.
   *
   * הרישום נעשה **לפני** הזריקה: קריאה שנכשלה היא קריאה שקרתה, ובדיקה
   * שסופרת ניסיונות חוזרים (חילוץ, גיבוי של סבב) צריכה לראות את כולם.
   */
  function record(call: MailSourceCall): void {
    calls.push(call);

    const index = failures.findIndex(
      (failure) =>
        failure.method === call.method &&
        (failure.times ?? 1) > 0 &&
        (failure.messageId === undefined || failure.messageId === call.messageId) &&
        (failure.queryIncludes === undefined || (call.query ?? "").includes(failure.queryIncludes)),
    );
    if (index === -1) return;

    const failure = failures[index];
    failure.times = (failure.times ?? 1) - 1;
    if (failure.times <= 0) failures.splice(index, 1);

    throw new MailSourceError(
      failure.message ?? `כשל מתוכנן ב-${call.method} (${failure.kind})`,
      failure.kind,
      failure.status === undefined ? {} : { status: failure.status },
    );
  }

  return {
    name: "fake",

    async getProfile() {
      record({ method: "getProfile" });
      return { emailAddress: profile };
    },

    async listIds(query, opts) {
      record({ method: "listIds", query, ...(opts?.pageToken ? { pageToken: opts.pageToken } : {}) });

      const matching = envelopes.filter((envelope) => match(envelope, query)).map((envelope) => envelope.sourceId);
      if (pageSize === undefined) return { ids: matching };

      const token = opts?.pageToken;
      const parsed = token ? PAGE_TOKEN.exec(token) : null;
      // אסימון שאינו שלנו הוא בקשה שבנינו לא נכון, וזו הכרעה `permanent` —
      // בדיוק כמו 400 של Gmail. בלי הזריקה הוא היה נקרא כ-0 ומחזיר לנצח
      // את העמוד הראשון, כלומר לולאת עימוד שקטה.
      if (token && !parsed) throw new MailSourceError(`אסימון עמוד לא תקין: ${token}`, "permanent", { status: 400 });

      const offset = parsed ? Number(parsed[1]) : 0;
      const ids = matching.slice(offset, offset + pageSize);
      const next = offset + pageSize;
      return { ids, ...(next < matching.length ? { nextPageToken: `offset-${next}` } : {}) };
    },

    async getMessage(id) {
      record({ method: "getMessage", messageId: id });
      // `null` ולא זריקה: כך מתנהג המתאם האמיתי על 404, וזו ההודעה שנמחקה
      // מהתיבה בין הרשימה לקריאה.
      return envelopes.find((envelope) => envelope.sourceId === id) ?? null;
    },

    async getAttachment(messageId, attachmentId) {
      record({ method: "getAttachment", messageId, attachmentId });

      const bytes = attachments.get(`${messageId}|${attachmentId}`) ?? attachments.get(attachmentId);
      if (!bytes) {
        throw new MailSourceError(`אין בתים ל-${attachmentId} בהודעה ${messageId}`, "not_found", { status: 404 });
      }
      return bytes;
    },

    get calls() {
      return calls;
    },

    callsTo(method) {
      return calls.filter((call) => call.method === method);
    },

    deliver(...messages) {
      for (const message of messages) add(message);
    },

    remove(messageId) {
      const index = envelopes.findIndex((envelope) => envelope.sourceId === messageId);
      if (index !== -1) envelopes.splice(index, 1);
    },

    failNext(failure) {
      failures.push({ ...failure });
    },

    clearCalls() {
      calls.length = 0;
    },
  };
}
