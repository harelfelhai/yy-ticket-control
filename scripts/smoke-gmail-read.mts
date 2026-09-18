import { pathToFileURL } from "node:url";
import { POLL_LOOKBACK_HOURS, buildPollQueries, isQueryableAddress } from "../src/lib/email-intake/query";
import type { MailSource } from "../src/lib/email-intake/source";
import { normalizeEmail } from "../src/lib/normalize";
import { guardedFetch, listAllIds, type RequestRecord } from "./email-intake-shadow.mjs";

/**
 * האם הטוקן של התיבה עובד ל**קריאה** — ומה בדיוק הוא רשאי לעשות.
 *
 * **מה זה בודק.** מסלול השליחה (`gmail.send`) עבד מ-7.9.2026, ו-`smoke-mail`
 * מאמת אותו. הקריאה היא הרשאה נפרדת שבעל התיבה מעניק במסך נפרד, והכשל
 * האופייני אינו "אין טוקן" אלא **טוקן שהונפק לפני שההיקף נוסף**: הוא ממשיך
 * לשלוח כרגיל, ועל כל קריאה מחזיר 403 עם `insufficientPermissions`. שלושת
 * הדברים שהסקריפט מדפיס הם בדיוק מה שמבדיל בין המצבים: על איזו תיבה הטוקן
 * מצביע, אילו היקפים הוענקו לו בפועל, והאם קריאת רשימה מחזירה משהו.
 *
 * **מה הוא אינו מדפיס — וזה לא קוסמטיקה.** התיבה משותפת עם מערכת החשבוניות,
 * והפלט של סקריפט אבחון מודבק לצ׳אט ולדוחות. לכן: אין כותרות, אין כתובות
 * של שולחים, אין תוכן ואין שמות קבצים — **ספירות בלבד**, ולצדן כתובת התיבה
 * עצמה, שהיא כל מה שמאשר שהטוקן מצביע למקום הנכון.
 *
 * כמו ריצת הצל, כל התעבורה עוברת ב-`guardedFetch` ולכן אינה יכולה לשנות דבר
 * בתיבה (EM-20).
 *
 * הרצה:
 *   npx tsx scripts/smoke-gmail-read.mts [--hours 48] [--sender a@b.com,c@d.com]
 */

// ─────────────────────────────── ארגומנטים ───────────────────────────────

export interface SmokeOptions {
  hours: number;
  /** כתובות מורשות לספירת שאילתת הסבב האמיתית. ריק = ספירת חלון בלבד */
  senders: string[];
  /** שם משתנה הסביבה של ה-refresh token — לחשבון בדיקות אחר */
  tokenVar: string;
}

export function parseArgs(argv: readonly string[]): SmokeOptions {
  const options: SmokeOptions = { hours: POLL_LOOKBACK_HOURS, senders: [], tokenVar: "GMAIL_REFRESH_TOKEN" };

  for (let at = 0; at < argv.length; at++) {
    const flag = argv[at];
    const value = argv[at + 1];
    if (flag === "--hours") {
      const hours = Number(value);
      if (!Number.isFinite(hours) || hours <= 0) throw new Error(`--hours דורש מספר חיובי, התקבל "${value}"`);
      options.hours = hours;
      at++;
    } else if (flag === "--sender") {
      if (value === undefined) throw new Error("--sender דורש כתובת אחת או יותר, מופרדות בפסיק");
      const addresses = value.split(",").map(normalizeEmail).filter(Boolean);
      // כתובת שאינה נכנסת לשאילתה הייתה שוברת את קבוצת ה-OR כולה, ואז
      // הספירה שתודפס אינה של מה שהתבקש. עדיף להיכשל מיד
      const broken = addresses.filter((address) => !isQueryableAddress(address));
      if (broken.length) throw new Error(`כתובת שאינה חוקית לשאילתה: ${broken.length} מהכתובות שנמסרו`);
      options.senders.push(...addresses);
      at++;
    } else if (flag === "--token-var") {
      if (!value) throw new Error("--token-var דורש שם משתנה");
      options.tokenVar = value;
      at++;
    } else {
      throw new Error(`דגל לא מוכר: ${flag}`);
    }
  }
  return options;
}

// ─────────────────────────────── היקפים ───────────────────────────────

/**
 * ההיקפים שהתיבה אמורה להעניק — **ורק הם** (EM-20, `gmail-oauth.mts`).
 *
 * הבדיקה דו-כיוונית בכוונה: חסר `gmail.readonly` פירושו שהצינור לא יוכל
 * לקרוא, ו**היקף עודף** פירושו שהטוקן מסוגל לשנות את התיבה המשותפת — כלומר
 * שההגנה בשכבת היכולת נשברה, ומה שנשאר הוא רק הקוד. השנייה חמורה יותר
 * ואינה נראית בשום מקום אחר.
 */
const EXPECTED_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

/** ההיקפים שמתירים שינוי בתיבה, כולל הגישה המלאה של `mail.google.com` */
const MUTATING_SCOPES = [/gmail\.modify/, /gmail\.labels/, /gmail\.insert/, /gmail\.settings/, /gmail\.compose/, /^https:\/\/mail\.google\.com\/?$/];

export interface ScopeCheck {
  granted: string[];
  canRead: boolean;
  canSend: boolean;
  mutating: string[];
  /** הוענק ואינו באף אחת מהרשימות — לא מסוכן בהכרח, אבל לא מה שהונפק */
  unexpected: string[];
}

export function checkScopes(scope: string): ScopeCheck {
  const granted = scope.split(/\s+/).filter(Boolean);
  return {
    granted,
    canRead: granted.includes("https://www.googleapis.com/auth/gmail.readonly"),
    canSend: granted.includes("https://www.googleapis.com/auth/gmail.send"),
    mutating: granted.filter((value) => MUTATING_SCOPES.some((pattern) => pattern.test(value))),
    unexpected: granted.filter((value) => !EXPECTED_SCOPES.includes(value)),
  };
}

// ─────────────────────────────── השאילתה ───────────────────────────────

/** כתובת שאינה קיימת ואינה יכולה להתקיים (RFC 2606), ולכן אינה מסננת דבר בטעות */
const PROBE_ADDRESS = "probe@example.invalid";

/**
 * שאילתת הסבב **בלי מסנן השולחים** — חסם עליון לחלון.
 *
 * הסיומת (`in:anywhere -in:spam -from:me`, ורגע ה-`after:`) אינה מועתקת
 * לכאן אלא נלקחת מ-`buildPollQueries` עצמה, כי העתקה הייתה מקור אמת שני
 * שמתיישן בשקט ברגע שכלל בשאילתה ישתנה: הספירה הייתה ממשיכה להיראות תקינה
 * ופשוט לא מודדת את מה שהסבב מודד.
 *
 * **מה זה מודד.** כמה הודעות בכלל נכנסו לתיבה בחלון — כולל מכתובות שאינן
 * מורשות. זה חסם עליון על מה שהסבב יראה, והמספר הזה שווה משהו בפני עצמו:
 * אם הוא אפס, הבעיה אינה בשולחים אלא בטוקן או בחלון.
 */
export function windowQuery(since: Date): string {
  const [query] = buildPollQueries([PROBE_ADDRESS], since);
  return query.replace(`from:(${PROBE_ADDRESS}) `, "");
}

// ─────────────────────────────── הריצה ───────────────────────────────

export interface SmokeInput {
  source: MailSource;
  /** היקפי הטוקן, מ-`tokeninfo` של גוגל. מוזרק כדי שבדיקה לא תפנה לרשת */
  tokenInfo: () => Promise<{ scope: string }>;
  senders: readonly string[];
  since: Date;
  /** `GMAIL_USER` — כדי לאשר שהטוקן מצביע על התיבה שהמערכת חושבת שהיא שלה */
  expectedMailbox: string | null;
}

export interface SmokeReport {
  mailbox: string;
  mailboxMatches: boolean | null;
  scopes: ScopeCheck;
  since: Date;
  windowCount: number;
  /** ספירת שאילתות הסבב האמיתיות, או null כשלא נמסרו שולחים */
  pollCount: number | null;
  pollQueries: number;
}

export async function runSmoke(input: SmokeInput): Promise<SmokeReport> {
  const profile = await input.source.getProfile();
  const scopes = checkScopes((await input.tokenInfo()).scope);

  const windowIds = await listAllIds(input.source, windowQuery(input.since));
  const queries = buildPollQueries([...input.senders], input.since);
  const pollIds: string[] = [];
  for (const query of queries) pollIds.push(...(await listAllIds(input.source, query)));

  return {
    mailbox: profile.emailAddress,
    mailboxMatches:
      input.expectedMailbox === null ? null : normalizeEmail(input.expectedMailbox) === normalizeEmail(profile.emailAddress),
    scopes,
    since: input.since,
    windowCount: new Set(windowIds).size,
    pollCount: queries.length === 0 ? null : new Set(pollIds).size,
    pollQueries: queries.length,
  };
}

/** האם הריצה הצליחה: קריאה מותרת, ואין היקף שמסוגל לשנות את התיבה */
export function isHealthy(report: SmokeReport): boolean {
  return report.scopes.canRead && report.scopes.mutating.length === 0 && report.mailboxMatches !== false;
}

export function formatReport(report: SmokeReport, requests: readonly RequestRecord[]): string {
  const { scopes } = report;
  const lines = [
    `[1] תיבה: ${report.mailbox}` +
      (report.mailboxMatches === null ? " (GMAIL_USER אינו מוגדר)" : ` · תואם GMAIL_USER: ${report.mailboxMatches ? "כן" : "לא"}`),
    `[2] היקפים שהוענקו (${scopes.granted.length}): ${scopes.granted.join(" ") || "—"}`,
    `    קריאה: ${scopes.canRead ? "מותרת" : "חסרה — gmail.readonly לא הוענק"} · שליחה: ${scopes.canSend ? "מותרת" : "חסרה"}`,
    `    היקפים שמסוגלים לשנות את התיבה: ${scopes.mutating.length ? scopes.mutating.join(" ") : "אין"}`,
    ...(scopes.unexpected.length && scopes.mutating.length === 0
      ? [`    היקפים שאינם מה שהונפק: ${scopes.unexpected.join(" ")}`]
      : []),
    `[3] חלון: מאז ${report.since.toISOString()}`,
    `    הודעות בתיבה בחלון (חסם עליון, כולל שולחים לא מורשים): ${report.windowCount}`,
    report.pollCount === null
      ? "    שאילתת הסבב לא נמדדה: לא נמסרו שולחים (--sender)"
      : `    שאילתת הסבב (${report.pollQueries} שאילתות, ${report.pollCount} הודעות)`,
    `[4] בקשות: ${requests.length} · כולן GET: ${requests.every((request) => request.method === "GET") ? "כן" : "לא"}`,
  ];
  return lines.join("\n");
}

// ─────────────────────────────── main ───────────────────────────────

const TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo";

async function main(): Promise<void> {
  const { config: loadEnv } = await import("dotenv");
  loadEnv({ path: ".env.local" });
  loadEnv();

  const options = parseArgs(process.argv.slice(2));
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env[options.tokenVar];
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(`חסרים GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / ${options.tokenVar}`);
  }

  const requests: RequestRecord[] = [];
  const request = guardedFetch(fetch, requests);
  const { createAccessTokenProvider } = await import("../src/lib/google/gmail-token");
  const { gmailSource } = await import("../src/lib/email-intake/gmail-source");
  const oauth = { clientId, clientSecret, refreshToken };

  // ספק אחד לשני השימושים: המקור זקוק לטוקן לכל בקשה, ו-`tokeninfo` זקוק
  // לאותו טוקן עצמו כדי לומר מה הוא רשאי לעשות. שני ספקים היו שתי בקשות
  // הנפקה ושתי דרכים להיכשל.
  const getAccessToken = createAccessTokenProvider(oauth);
  const source = gmailSource(oauth, { fetch: request, getAccessToken });

  const tokenInfo = async () => {
    // הטוקן נמסר כפרמטר שאילתה, כפי שגוגל מגדירה. `guardedFetch` רושם את
    // הנתיב בלי השאילתה, ולכן הוא אינו מגיע ליומן שמודפס.
    const response = await request(`${TOKEN_INFO_URL}?access_token=${encodeURIComponent(await getAccessToken())}`);
    if (!response.ok) {
      throw new Error(`tokeninfo החזיר ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    return (await response.json()) as { scope: string };
  };

  const report = await runSmoke({
    source,
    tokenInfo,
    senders: options.senders,
    since: new Date(Date.now() - options.hours * 60 * 60 * 1000),
    expectedMailbox: process.env.GMAIL_USER ?? null,
  });

  console.log("בדיקת קריאה מול תיבת Gmail — ספירות בלבד, בלי כותרות ובלי תוכן\n");
  console.log(formatReport(report, requests));

  if (!isHealthy(report)) {
    console.error("\nהבדיקה נכשלה: ראה [1] ו-[2] למעלה");
    process.exit(1);
  }
  console.log("\nהטוקן קורא את התיבה, ואינו רשאי לשנות בה דבר.");
}

/** רץ רק בהפעלה ישירה — הבדיקות מייבאות מכאן את הליבה הטהורה */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
