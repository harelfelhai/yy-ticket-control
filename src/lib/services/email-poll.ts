import { enqueue, MAX_ATTEMPTS } from "@/jobs/queue";
import { JOB_TYPES, type EmailIntakeJobPayload } from "@/jobs/types";
import { db } from "@/lib/db";
import { selectMailSource } from "@/lib/email-intake";
import { buildPollQueries, isQueryableAddress, pollWindowStart } from "@/lib/email-intake/query";
import { MailSourceError, type MailSource } from "@/lib/email-intake/source";
import { env } from "@/lib/env";
import { normalizeEmail } from "@/lib/normalize";
import { captureError, logError, logInfo, logWarn } from "@/lib/observability/log";
import { HEARTBEAT, setHeartbeat } from "@/watchdog/heartbeat";

/**
 * סבב הגילוי: מה חדש בתיבה, ומי צריך להכריע עליו (אפיון §2.6, §5.ה3).
 *
 * **הסבב אינו מכריע דבר.** הוא רושם ביומן (`MailboxMessage`) כל מזהה שלא
 * ראה, ומכניס לתור ג׳וב `EMAIL_INTAKE` אחד לכל שורה כזו. ההפרדה אינה
 * קוסמטית: הגילוי הוא פעולה קצרה שרצה כל דקה מול כל התיבה, וההכרעה היא
 * פעולה ארוכה (קריאת ההודעה, חילוץ, פתיחת טיוטה) שנכשלת ונדחית לכל הודעה
 * בנפרד. סבב שהיה עושה את שניהם היה נתקע על הודעה אחת ומפסיק לגלות את כל
 * השאר — כלומר בדיוק "המייל שאיש לא ידע עליו".
 *
 * **מה שהופך את הסבב לאידמפוטנטי הוא האינדקס הייחודי על `gmailMessageId`**,
 * ולא זיכרון של הסבב הקודם. לכן סבב שנפל באמצע, שני instance־ים בזמן
 * פריסה, או חלון זמן שנפתח רחב מדי — כולם מסתיימים באותה תוצאה (§5.ה3 כלל
 * 4, EM-21).
 *
 * הסדר בפונקציה הוא סדר של סיכונים ולא של נוחות: קודם שומר התיבה, אחר כך
 * ההפעלה, ורק אז שאילתה. קריאה מהתיבה הלא נכונה גרועה מאי-קריאה בכלל.
 */

/** מפתח שורת מצב הערוץ. ערוץ אחד בגרסה 1.3; הוואטסאפ נשאר רדום (§6). */
export const EMAIL_CHANNEL = "EMAIL";

/**
 * תקרת העמודים לשאילתה אחת.
 *
 * 20 עמודים של Gmail הם כ-2,000 מזהים — הרבה מעבר לכל חלון סביר בתיבה
 * הזו. התקרה אינה אופטימיזציה אלא בלם: בלעדיה שאילתה שמחזירה אסימון עמוד
 * בלי סוף (תיבה מוצפת, או באג בבניית השאילתה) הייתה מחזיקה את הסבב שעות,
 * ואיתו את הלולאה. כשהיא נגמרת מדווחים — ראו `email.poll.saturated`.
 */
export const MAX_PAGES_PER_QUERY = 20;

/**
 * מתי שורה נכנסת שנשארה PENDING נחשבת נטושה.
 *
 * ההבטחה היא מייל חוזר תוך חמש דקות (§2.6 שלב 4); עשר דקות הן פי שתיים
 * מזה, כלומר סף שאי אפשר להגיע אליו בעיכוב תקין. מה שהוא כן תופס: ג׳וב
 * שנעלם בין התפיסה להשלמה — תהליך שקרס אחרי `claimNextJob` ולפני
 * `completeJob`, כשהשורה כבר PENDING ואין עוד מי שירים אותה.
 */
export const STUCK_AFTER_MS = 10 * 60_000;

/** כמה שורות תקועות נסרקות בסבב. מעבר לזה זו תקלה רחבה שהסריקה אינה פותרת. */
const STUCK_SCAN_LIMIT = 200;

/**
 * חלון ההשתקה ללכידות חוזרות ב-Sentry.
 *
 * הסבב רץ כל דקה, וכל אחד מהמצבים שנלכדים כאן (תיבה שגויה, רוויה, שורות
 * תקועות) נמשך עד שאדם מתקן אותו. לכידה בכל סבב הייתה 1,440 אירועים ביום
 * על תקלה אחת — כלומר שריפת מכסת ה-free-tier על מידע שהאירוע הראשון כבר
 * מסר. עשר דקות זהות לחלון של לולאת העובד (`worker.ts`).
 */
const CAPTURE_INTERVAL_MS = 10 * 60_000;

/** גג לטקסט שנשמר ב-`lastPollError` — הוא לאבחון, לא ליומן מלא */
const ERROR_TEXT_LIMIT = 500;

/** מה הסבב עשה. מוחזר לבדיקות ולטיימר; הוא גם מה שנכתב ליומן. */
export interface EmailPollResult {
  /**
   * `ok` — הסבב הושלם (גם כשלא היה מה לקרוא).
   * `halted` — נעצר ברעש ודורש אדם: תיבה שגויה, הרשאה שנשללה.
   * `deferred` — כשל חולף; הסבב הבא ינסה שוב, והחלון נשאר רחב.
   */
  status: "ok" | "halted" | "deferred";
  /** הסיבה, כפי שנשמרה ב-`lastPollError`. קיימת רק כשלא `ok`. */
  reason?: string;
  /** כמה כתובות נכנסו לשאילתות */
  senders: number;
  queries: number;
  pages: number;
  /** שורות יומן חדשות, וג׳וב `EMAIL_INTAKE` אחד לכל אחת */
  discovered: number;
  /** מזהים שכבר היו ביומן */
  skipped: number;
  /** מזהים שסבב אחר הקדים אותנו עליהם (הפרת ייחודיות) */
  raced: number;
  /** שאילתות שמיצו את תקרת העמודים */
  saturated: number;
  /** שורות תקועות שהוחזרו לתור */
  requeued: number;
  /**
   * שורות תקועות שלא הוחזרו כי הג׳וב שלהן **מיצה** את המכסה — כלומר תקלה
   * דטרמיניסטית שדורשת אדם. ראו `rescanStuck`.
   */
  exhausted: number;
}

export interface EmailPollDeps {
  /** התיבה. מוזרקת כדי שבדיקה תריץ את הסבב המלא בלי רשת. */
  source?: MailSource;
  /** "עכשיו" — פרמטר ולא `new Date()` בפנים, כמו בכל חישוב זמן בפרויקט */
  now?: Date;
}

// `selectMailSource` נבחרת פעם אחת, ב-`@/lib/email-intake` — ראו התיעוד
// שם. הייצוא כאן נשמר כדי שמסלול הייבוא הקיים (`@/lib/services/email-poll`)
// יישאר עובד, בדיוק כמו שהייצוא של `ALLOWED_MIME_TYPES` נשמר ב-`storage/index.ts`.
export { selectMailSource };

export async function runEmailPoll(deps: EmailPollDeps = {}): Promise<EmailPollResult> {
  const now = deps.now ?? new Date();
  const source = deps.source ?? selectMailSource();

  // ─── 1. שומר התיבה, לפני כל קריאה אחרת ───
  const guard = await guardMailbox(source);
  if (!guard.ok) {
    await recordPollFailure(now, guard.reason);
    return finishWithFailure(guard.halted, guard.reason, EMPTY_COUNTS);
  }

  // ─── 2. הפעלה: נוצרת פעם אחת ולעולם אינה זזה ───
  const state = await activateChannel(guard.mailbox, now);

  // ─── 3. השולחים המורשים ───
  const { senders, rejected, pilot } = await authorizedSenders(guard.mailbox);
  if (rejected.length > 0 && throttled("sender-rejected")) {
    // כתובת שנדחתה אינה נכנסת לשאילתה, ולכן המשתמש שלה פשוט אינו נקלט.
    // בלי השורה הזו זה היה קורה בשקט מוחלט (`isQueryableAddress`).
    logWarn("email.poll.sender_rejected", {
      count: rejected.length,
      addresses: rejected.slice(0, 5).join(", "),
    });
  }

  const counts = { ...EMPTY_COUNTS, senders: senders.length };

  // ─── 4+5+6. שאילתות, עימוד, ורישום כל מזהה חדש ───
  let failure: { halted: boolean; reason: string } | null = null;
  let queries: string[] = [];

  if (senders.length === 0) {
    // **בלי שולחים אין שאילתה** — שאילתה בלי `from:` הייתה מחזירה את כל
    // התיבה המשותפת. זה מצב חוקי: פיילוט שכתובתו עוד לא הוזנה, או מערכת
    // שבה איש אינו מורשה עדיין.
    logWarn("email.poll.no_senders", { pilot: pilot.length });
  } else {
    const since = pollWindowStart({
      activatedAt: state.activatedAt,
      lastPollOkAt: state.lastPollOkAt,
      now,
    });
    queries = buildPollQueries(senders, since);
    counts.queries = queries.length;

    try {
      for (const query of queries) {
        const outcome = await pollOneQuery(source, query, counts);
        counts.pages += outcome.pages;
        if (!outcome.saturated) continue;

        counts.saturated += 1;
        logWarn("email.poll.saturated", { pages: outcome.pages, senders: senders.length });
        captureThrottled(
          "email-poll-saturated",
          new Error(`שאילתת קליטה מיצתה ${MAX_PAGES_PER_QUERY} עמודים — החלון רחב מדי או שהתיבה מוצפת`),
          "saturation",
        );
      }
    } catch (error) {
      // שגיאה שאינה של התיבה היא באג אצלנו (בסיס נתונים, טיפוס) — היא
      // ממשיכה למעלה ונלכדת אצל הקורא. כאן מטופל רק כשל של הערוץ.
      if (!(error instanceof MailSourceError)) throw error;
      failure = {
        halted: error.kind === "auth" || error.kind === "scope",
        reason: `רשימת ההודעות נכשלה (${error.kind}): ${messageOf(error)}`,
      };
    }
  }

  // הרשאה שנשללה באמצע הסבב עוצרת מיד: כל שאילתה נוספת תיכשל באותו אופן,
  // וסריקת התקועים לא תשנה דבר עד שאדם יתקן.
  if (failure?.halted) {
    await recordPollFailure(now, failure.reason);
    return finishWithFailure(true, failure.reason, counts);
  }

  // ─── 7. רשת הביטחון: שורה שנשארה PENDING בלי ג׳וב חי ───
  // רצה גם כשהגילוי נכשל: היא אינה נוגעת בתיבה כלל, והשורות שכבר ביומן
  // ממתינות להכרעה בלי קשר לכך שהתיבה אינה נגישה כרגע.
  const stuck = await rescanStuck(now);
  counts.requeued = stuck.requeued;
  counts.exhausted = stuck.exhausted;

  if (failure) {
    await recordPollFailure(now, failure.reason);
    return finishWithFailure(false, failure.reason, counts);
  }

  // ─── 8. סגירת הסבב ───
  // `lastPollOkAt` ו-`setHeartbeat` נכתבים **רק כאן**, בסוף סבב שהושלם.
  // סבב שנכשל באמצע משאיר את שניהם כפי שהיו: החלון נשאר רחב (`query.ts`),
  // וה-watchdog רואה פעימה מתיישנת ומתריע אחרי רבע שעה.
  await db.mailChannelState.update({
    where: { channel: EMAIL_CHANNEL },
    data: { mailbox: guard.mailbox, lastPollAt: now, lastPollOkAt: now, lastPollError: null },
  });
  await setHeartbeat(HEARTBEAT.emailPoll, now);

  logInfo("email.poll", {
    queries: counts.queries,
    discovered: counts.discovered,
    skipped: counts.skipped,
    pages: counts.pages,
    raced: counts.raced,
    requeued: counts.requeued,
    exhausted: counts.exhausted,
    senders: counts.senders,
  });

  return { status: "ok", ...counts };
}

// ─────────────────────────────── 1. שומר התיבה ───────────────────────────────

type MailboxGuard = { ok: true; mailbox: string } | { ok: false; halted: boolean; reason: string };

/**
 * מאמת שהטוקן פותח את התיבה שהוגדרה, לפני שנקראת ממנה שורה אחת.
 *
 * **המצב שזה מונע הוא זה:** טוקן של חשבון אחר (העתקה בין סביבות, רענון
 * שהונפק מחשבון פרטי) קורא תיבה שאינה של המערכת. אין שם שום סימן לתקלה —
 * השאילתות תקינות, התשובות תקינות — ומה שיוצא ממנה הוא טיוטות ומיילים
 * חוזרים לאנשים שמעולם לא פנו. קריאה מהתיבה הלא נכונה גרועה מאי-קריאה.
 *
 * `transient` מופרד מכל השאר: הוא אינו אומר "התיבה שגויה" אלא "לא הצלחנו
 * לשאול". עצירה רועשת עליו הייתה מייצרת התראה בכל תקלת רשת חולפת.
 */
async function guardMailbox(source: MailSource): Promise<MailboxGuard> {
  const configured = normalizeEmail(env.gmailUser() ?? "");
  if (!configured) {
    return { ok: false, halted: true, reason: "GMAIL_USER אינו מוגדר — אין מול מה לאמת את התיבה" };
  }

  let profile: { emailAddress: string };
  try {
    profile = await source.getProfile();
  } catch (error) {
    const kind = error instanceof MailSourceError ? error.kind : "permanent";
    return {
      ok: false,
      halted: kind !== "transient",
      reason: `קריאת פרופיל התיבה נכשלה (${kind}): ${messageOf(error)}`,
    };
  }

  const actual = normalizeEmail(profile.emailAddress ?? "");
  if (actual !== configured) {
    return {
      ok: false,
      halted: true,
      reason: `התיבה שענתה (${actual || "ללא כתובת"}) אינה התיבה שהוגדרה (${configured})`,
    };
  }

  return { ok: true, mailbox: actual };
}

// ─────────────────────────────── 2. הפעלה ───────────────────────────────

/**
 * יוצר את שורת מצב הערוץ בסבב המוצלח הראשון — **יצירה בלבד**.
 *
 * `update: {}` הוא כל העניין: `activatedAt` הוא הרצפה של §5.ה3 כלל 5
 * (EM-22), וסבב שהיה דוחף אותו קדימה היה מזיז את הרצפה כל דקה — כלומר
 * מייל שהגיע לפני דקה ועדיין לא נקרא היה נופל מתחת לרצפה ונעלם. בכיוון
 * השני, כיבוי והדלקה של היכולת אינם מאפסים אותה, ולכן הפער שבינתיים מעובד.
 *
 * הכתובת מתעדכנת בסוף סבב מוצלח ולא כאן, כדי שהיצירה תישאר יצירה בלבד.
 */
async function activateChannel(mailbox: string, now: Date) {
  return db.mailChannelState.upsert({
    where: { channel: EMAIL_CHANNEL },
    create: { channel: EMAIL_CHANNEL, mailbox, activatedAt: now },
    update: {},
  });
}

// ─────────────────────────────── 3. השולחים ───────────────────────────────

/**
 * הכתובות שמייל מהן עשוי להיקלט (§3.7, EM-04, EM-U04, EM-U06).
 *
 * שלוש הפחתות, ולכל אחת נימוק אחר:
 * - **התיבה עצמה לעולם אינה שולח** (§7 שורה 83). המיילים שהמערכת שולחת
 *   חוזרים לתיבה, ואם כתובתה רשומה כמייל של משתמש — והיא יכולה להיות —
 *   כל תשובה שלנו הייתה נקראת כבקשה חדשה שלו.
 * - **מצב פיילוט הוא חיתוך ולא תוספת** (`emailIntakePilotAddresses`): כך
 *   העלייה לאוויר נעשית על שולח אחד בלי לגעת בהרשאה של איש.
 * - **כתובת שאינה בטוחה בשאילתה נזרקת** (`isQueryableAddress`), כי ערך עם
 *   רווח או סוגר שובר את קבוצת ה-OR ומאבד את כל שלושים השולחים שבה.
 *
 * ההרשאה נגזרת מהמשתמש ולא מרשימה נפרדת: משתמש מושבת או שההרשאה שלו
 * בוטלה נופל כאן בכל כתובותיו (EM-U04), ומשתמש בלי מייל ובלי כתובות
 * נוספות אינו תורם דבר (EM-U06).
 */
async function authorizedSenders(
  mailbox: string,
): Promise<{ senders: string[]; rejected: string[]; pilot: string[] }> {
  const users = await db.user.findMany({
    where: { active: true, emailIntakeEnabled: true },
    select: { email: true, emailAliases: { select: { address: true } } },
  });

  const addresses = new Set<string>();
  for (const user of users) {
    if (user.email) addresses.add(normalizeEmail(user.email));
    for (const alias of user.emailAliases) addresses.add(normalizeEmail(alias.address));
  }
  addresses.delete("");
  addresses.delete(mailbox);

  const pilot = env.emailIntakePilotAddresses();
  const allowed = new Set(pilot);
  const candidates = [...addresses].filter((address) => pilot.length === 0 || allowed.has(address));

  return {
    senders: candidates.filter((address) => isQueryableAddress(address)),
    rejected: candidates.filter((address) => !isQueryableAddress(address)),
    pilot,
  };
}

// ─────────────────────── 5+6. עימוד ורישום ביומן ───────────────────────

type Counts = Omit<EmailPollResult, "status" | "reason">;

const EMPTY_COUNTS: Counts = {
  senders: 0,
  queries: 0,
  pages: 0,
  discovered: 0,
  skipped: 0,
  raced: 0,
  saturated: 0,
  requeued: 0,
  exhausted: 0,
};

/**
 * שאילתה אחת על כל עמודיה, עד התקרה.
 *
 * כל עמוד נרשם ביומן מיד ואינו נצבר בזיכרון: סבב שמת באמצע משאיר את מה
 * שכבר גילה, ולא מתחיל מאפס. `saturated` פירושו שנותר אסימון עמוד אחרי
 * שהתקרה נגמרה — כלומר נשאר דואר שלא הסתכלנו בו בסבב הזה.
 */
async function pollOneQuery(
  source: MailSource,
  query: string,
  counts: Counts,
): Promise<{ pages: number; saturated: boolean }> {
  let pageToken: string | undefined;
  let pages = 0;

  while (pages < MAX_PAGES_PER_QUERY) {
    const page = await source.listIds(query, pageToken ? { pageToken } : undefined);
    pages += 1;

    const recorded = await recordDiscovered(page.ids);
    counts.discovered += recorded.created;
    counts.skipped += recorded.known;
    counts.raced += recorded.raced;

    pageToken = page.nextPageToken;
    if (!pageToken) return { pages, saturated: false };
  }

  return { pages, saturated: true };
}

/**
 * שורת יומן אחת וג׳וב אחד לכל מזהה חדש — **באותה טרנזאקציה**.
 *
 * הכיוון שחייב להיות בלתי אפשרי הוא שורה בלי ג׳וב: היא נראית כמייל
 * ש"נקלט", איש אינו מכריע עליה, והשולח ממתין לתשובה שלא תבוא. הכיוון
 * ההפוך (ג׳וב בלי שורה) אינו קיים כי שניהם נכתבים יחד.
 *
 * הבדיקה המקדימה מול היומן היא קיצור דרך בלבד — **הנכונות היא באינדקס
 * הייחודי**. בין ה-`findMany` ל-`create` יכול סבב אחר (instance שני בזמן
 * פריסה) להקדים, וזה המצב שנבלע כאן בשקט: הפרת ייחודיות פירושה שמישהו
 * אחר כבר עשה את העבודה, וזו הצלחה ולא כשל (§5.ה3 כלל 4, EM-21).
 */
async function recordDiscovered(
  ids: readonly string[],
): Promise<{ created: number; known: number; raced: number }> {
  if (ids.length === 0) return { created: 0, known: 0, raced: 0 };

  const existing = await db.mailboxMessage.findMany({
    where: { gmailMessageId: { in: [...ids] } },
    select: { gmailMessageId: true },
  });
  const seen = new Set(existing.map((row) => row.gmailMessageId));

  let created = 0;
  let known = 0;
  let raced = 0;

  for (const id of ids) {
    if (seen.has(id)) {
      known += 1;
      continue;
    }
    // אותו מזהה פעמיים באותו עמוד אינו אמור לקרות, אבל אם קרה — הוא
    // "כבר ידוע" ולא מרוץ, כדי שהספירה תישאר נאמנה.
    seen.add(id);

    try {
      await db.$transaction(async (tx) => {
        const row = await tx.mailboxMessage.create({
          data: { direction: "INBOUND", state: "PENDING", gmailMessageId: id },
          select: { id: true },
        });
        // `satisfies` ולא הצבה לטיפוס: המטען חייב להישאר ליטרל טרי כדי
        // ש-Prisma יקבל אותו כ-JSON, והבדיקה מול `EmailIntakeJobPayload`
        // היא מה שמונע מזהה בשם אחר משזה שהמטפל קורא.
        await enqueue(tx, JOB_TYPES.emailIntake, { mailboxMessageId: row.id } satisfies EmailIntakeJobPayload);
      });
      created += 1;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      raced += 1;
    }
  }

  return { created, known, raced };
}

/** הפרת האינדקס הייחודי על `gmailMessageId`, כפי ש-Prisma מדווחת אותה */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

// ─────────────────────────── 7. סריקת התקועים ───────────────────────────

/**
 * מחזיר לתור שורה נכנסת שנשארה PENDING בלי ג׳וב חי — **ורק אם הג׳וב נעלם**.
 *
 * **התנאי הוא היעדר ג׳וב, לא גיל השורה לבדו.** שורה ותיקה שיש לה ג׳וב
 * שממתין לניסיון חוזר אינה תקועה — היא בדיוק במסלול הכשל המתוכנן (backoff
 * מול Gmail או מול מנוע החילוץ), והכנסת ג׳וב שני הייתה מריצה עליה שתי
 * הכרעות במקביל.
 *
 * **ג׳וב שמיצה את המכסה אינו ג׳וב שנעלם, ובבסיס הנתונים הם נראים זהים.**
 * שניהם אינם PENDING ואינם RUNNING: אחד מפני שהשורה שלו נמחקה או שהתהליך
 * נפל בין `claimNextJob` ל-`completeJob`, והשני מפני ש-`failJob` נעל אותו
 * ל-FAILED אחרי `MAX_ATTEMPTS`. החייאה על סמך ההיעדר לבדו מבטלת בפועל את
 * מכסת שלושת הניסיונות של התור: הודעה שנכשלת **דטרמיניסטית** (באג פרסור,
 * הפרת אילוץ בטרנזאקציה) הייתה חוזרת לתור בכל סבב, לנצח, בלי שום גג — כ-200
 * ג׳ובים ביום, וכל מחזור מריץ מחדש גם את מה שקודם לטרנזאקציה: `getMessage`,
 * הורדת הקבצים המצורפים, הכתיבה לאחסון והקריאה למנוע החילוץ. זו בדיוק
 * ההכאה בקצב קבוע ש-`queue.ts` קיים כדי למנוע.
 *
 * לכן ג׳וב FAILED הוא **מצב סופי לשורה**: אין החייאה אוטומטית, יש דיווח
 * נפרד (`email.poll.exhausted`) שאומר את האבחנה הנכונה, ו-`email-intake-not-stuck`
 * ב-watchdog ממשיך להצביע על השורה עד שאדם מתקן את הבאג ומכניס ג׳וב מחדש.
 * ההחלטה הזו מעדיפה תקלה **שנשארת גלויה ועומדת** על תקלה שמנסה לרפא את עצמה
 * באותו אופן בדיוק כל שבע דקות.
 *
 * מה שנשאר להחייאה הוא המצב היחיד שאין לו בעלים ולא נשפט: אין לשורה אף ג׳וב
 * חי ואף ג׳וב שמוצה. ההחזרה נכונה שם פעם אחת מעצמה — אחריה יש ג׳וב חי, ולכן
 * הסבב הבא מדלג; ואם גם הוא ייכשל סופית, השורה תיפול לענף ה-FAILED.
 */
async function rescanStuck(now: Date): Promise<{ requeued: number; exhausted: number }> {
  const threshold = new Date(now.getTime() - STUCK_AFTER_MS);

  const candidates = await db.mailboxMessage.findMany({
    where: {
      direction: "INBOUND",
      state: "PENDING",
      createdAt: { lte: threshold },
      // דחייה מתוכננת אינה היתקעות (אותה הבחנה כמו ב-`queue-not-stuck`)
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    select: { id: true },
    take: STUCK_SCAN_LIMIT,
  });

  let requeued = 0;
  let exhausted = 0;

  for (const row of candidates) {
    // שאילתה אחת לשלושת המצבים: מצב הג׳וב הוא שקובע, לא עצם קיומו.
    const jobs = await db.job.findMany({
      where: {
        type: JOB_TYPES.emailIntake,
        status: { in: ["PENDING", "RUNNING", "FAILED"] },
        payload: { path: ["mailboxMessageId"], equals: row.id },
      },
      select: { status: true },
    });

    if (jobs.some((job) => job.status === "PENDING" || job.status === "RUNNING")) continue;
    if (jobs.length > 0) {
      exhausted += 1;
      continue;
    }

    await enqueue(db, JOB_TYPES.emailIntake, { mailboxMessageId: row.id } satisfies EmailIntakeJobPayload);
    requeued += 1;
  }

  if (requeued > 0) {
    logWarn("email.poll.stuck", { requeued, scanned: candidates.length });
    captureThrottled(
      "email-poll-stuck",
      new Error(`${requeued} הודעות נכנסות נשארו PENDING בלי אף ג׳וב — הג׳וב נעלם והוחזר לתור`),
      "stuck-scan",
    );
  }

  // **גם הלוג מושתק כאן, ולא רק הלכידה** — בשונה מ-`email.poll.stuck`.
  // שורה שמוצתה נשארת כך עד שאדם מתערב, ולכן הדיווח עליה חוזר בכל סבב:
  // 1,440 שורות ביום על אותה תקלה. `email.poll.stuck` מגביל את עצמו מאליו,
  // כי אחרי ההחזרה יש לשורה ג׳וב חי והסבב הבא מדלג עליה.
  if (exhausted > 0 && throttled("email-poll-exhausted")) {
    logWarn("email.poll.exhausted", { exhausted, scanned: candidates.length });
    captureError(
      new Error(
        `${exhausted} הודעות נכנסות נשארו PENDING אחרי שהג׳וב שלהן מיצה את ${MAX_ATTEMPTS} הניסיונות — ` +
          "כשל דטרמיניסטי שאינו מוחזר לתור אוטומטית. ראו Job.lastError, ואחרי התיקון יש להכניס ג׳וב מחדש.",
      ),
      { tags: { phase: "stuck-scan", channel: EMAIL_CHANNEL }, fingerprint: ["email-poll-exhausted"] },
    );
  }

  return { requeued, exhausted };
}

// ─────────────────────────────── עזרי סיום ───────────────────────────────

/**
 * רושם את סיבת הכשל על שורת הערוץ — **`updateMany` ולא `upsert`**.
 *
 * בסבב הראשון ייתכן שאין עדיין שורת ערוץ, ויצירתה כאן הייתה קובעת
 * `activatedAt` על סבב שנכשל: הרצפה של EM-22 הייתה נקבעת לפי הכישלון
 * הראשון ולא לפי ההצלחה הראשונה. אפס שורות מעודכנות הוא התוצאה הנכונה —
 * הכשל נרשם ביומן וב-Sentry בכל מקרה.
 */
async function recordPollFailure(now: Date, reason: string): Promise<void> {
  await db.mailChannelState.updateMany({
    where: { channel: EMAIL_CHANNEL },
    data: { lastPollAt: now, lastPollError: reason.slice(0, ERROR_TEXT_LIMIT) },
  });
}

function finishWithFailure(halted: boolean, reason: string, counts: Counts): EmailPollResult {
  if (halted) {
    logError("email.poll.halted", { reason });
    captureThrottled("email-poll-halted", new Error(`סבב קליטת המייל נעצר: ${reason}`), "mailbox-guard");
    return { status: "halted", reason, ...counts };
  }

  logWarn("email.poll.deferred", { reason });
  return { status: "deferred", reason, ...counts };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─────────────────────────────── השתקת חזרות ───────────────────────────────

const lastEventAt = new Map<string, number>();

/**
 * האם מותר לדווח שוב על אירוע חוזר.
 *
 * `Date.now()` ולא ה-`now` המוזרק, בכוונה: החלון מגן על מכסת Sentry
 * האמיתית, ולכן הוא נמדד בזמן אמת. קורא שמעביר שעון משלו (בדיקה, סבב
 * שמריצים ידנית על תאריך ישן) אינו אמור לפתוח מחדש את הברז.
 */
function throttled(key: string, intervalMs: number = CAPTURE_INTERVAL_MS): boolean {
  const nowMs = Date.now();
  const previous = lastEventAt.get(key) ?? 0;
  if (nowMs - previous < intervalMs) return false;
  lastEventAt.set(key, nowMs);
  return true;
}

function captureThrottled(key: string, error: Error, phase: string): void {
  if (!throttled(key)) return;
  captureError(error, { tags: { phase, channel: EMAIL_CHANNEL }, fingerprint: [key] });
}
