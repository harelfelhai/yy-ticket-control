import { normalizeEmail } from "@/lib/normalize";

/**
 * מה נשאל את Gmail בכל סבב (אפיון §5.ה3 כללים 3–5).
 *
 * טהור: בלי רשת ובלי שעון — "עכשיו" ומצב הערוץ מגיעים כפרמטרים. כך כל אחד
 * משלושת הכללים שהשאילתה מממשת נבדק ישירות, והם בדיוק הכללים שהפרה שלהם
 * אינה נראית: מייל שהשאילתה לא החזירה פשוט אינו מגיע לשום מקום.
 *
 * **השאילתה היא סינון גס, לא ההחלטה.** היא מצמצמת לשולחים המורשים ולחלון
 * הזמן; האם מייל הוא בקשת פנייה (הכותרת), תשובה (השרשרת) או כבר נקלט
 * (היומן) — נקבע בקוד על כל הודעה שחזרה.
 */

/** כמה שעות אחורה סורק כל סבב, גם כשהסבב הקודם הצליח לפני דקה */
export const POLL_LOOKBACK_HOURS = 48;

/**
 * כמה שולחים בשאילתה אחת.
 *
 * השאילתה נשלחת בכתובת של בקשת GET, שאורכה מוגבל, וקבוצת OR אחת לכל
 * השולחים הייתה גדלה עם כל משתמש שנוסף עד שהבקשה נדחית — וסבב שנדחה אינו
 * קולט דבר. 30 כתובות הן כ-1KB, ועדיין מעט מאוד קריאות לחברה בגודל הזה.
 */
export const SENDERS_PER_QUERY = 30;

const HOUR_MS = 60 * 60 * 1000;

/**
 * כמה שעות לפני הסבב המוצלח האחרון נפתח החלון.
 *
 * `lastPollOkAt` נקבע לפי השעון שלנו ו-`after:` נבדק מול זמן הקבלה של Gmail;
 * שעה של חפיפה מכסה הטיה בין השעונים ומייל שנכנס לאינדקס באיחור.
 */
const OVERLAP_HOURS = 1;

/** מה שנוסף לכל שאילתה, ולמה כל חלק שם */
const QUERY_SUFFIX = [
  // כל התיקיות, כולל ארכיון: מייל שמישהו כבר טיפל בו והעביר נקלט (כלל 4).
  // **לעולם לא `is:unread`** — EasyInv מסמן כנקרא כל מייל עם קובץ מצורף
  // שהוא פותח, גם כשאינו חשבונית, ולכן תלות ב"לא נקרא" הייתה מאבדת פניות
  // בשקט (כלל 4, EM-21).
  "in:anywhere",
  "-in:spam",
  // המיילים שהמערכת עצמה שולחת חוזרים לתיבה; הם לעולם אינם בקשה (§7 שורה 83).
  "-from:me",
].join(" ");

/**
 * מאיזה רגע סורקים בסבב הנוכחי.
 *
 * `max(activatedAt, min(now − 48h, lastPollOkAt − 1h))`, ובלי סבב מוצלח קודם
 * `max(activatedAt, now − 48h)`. שלושה נימוקים, אחד לכל איבר:
 *
 * - **48 שעות בכל סבב, גם כשהקודם הצליח.** מה שכבר נקלט מזוהה ביומן (מזהה
 *   Gmail ייחודי ב-`MailboxMessage`), לא בחלון. לכן היומן הוא המצב היחיד,
 *   וסבב שנפל באמצע, או מייל שהאינדקס של Gmail החזיר באיחור, נאספים בסבב
 *   הבא בלי שום לוגיקת השלמה. המחיר הוא קריאות רשימה חוזרות, זולות.
 * - **`lastPollOkAt − 1h` כשהוא ישן יותר.** אחרי השבתה של יומיים החלון
 *   מתרחב עד הסבב המוצלח האחרון, כך ששום פער אינו נופל בין שני סבבים.
 * - **`activatedAt` רצפה קשיחה.** מיילים שהגיעו לפני הפעלת היכולת אינם
 *   נקלטים (§5.ה3 כלל 5, EM-22): בלי הרצפה, ההפעלה הראשונה הייתה פותחת
 *   טיוטות מההיסטוריה של התיבה ועונה על כל אחת מהן.
 */
export function pollWindowStart(input: { activatedAt: Date; lastPollOkAt: Date | null; now: Date }): Date {
  const activatedAt = timeOf(input.activatedAt, "activatedAt");
  const lookbackStart = timeOf(input.now, "now") - POLL_LOOKBACK_HOURS * HOUR_MS;

  const start =
    input.lastPollOkAt === null
      ? lookbackStart
      : Math.min(lookbackStart, timeOf(input.lastPollOkAt, "lastPollOkAt") - OVERLAP_HOURS * HOUR_MS);

  return new Date(Math.max(activatedAt, start));
}

/**
 * השאילתות לסבב: אחת לכל קבוצה של עד 30 שולחים מורשים.
 *
 * `after:` מקבל שניות מהאפוק (ולא תאריך, שמעוגל ליום שלם ואז גבול ההפעלה
 * מדויק רק ליום). העיגול כלפי מטה מכליל את השנייה שבה החלון מתחיל; חפיפה
 * של פחות משנייה אינה מזיקה, כי היומן מונע קליטה כפולה.
 *
 * **בלי שולחים — בלי שאילתה**, ולא שאילתה בלי `from:`: זו הייתה מחזירה את כל
 * התיבה המשותפת. הסדר ממוין כדי שאותה רשימה תפיק תמיד אותן שאילתות.
 */
export function buildPollQueries(senders: readonly string[], since: Date): string[] {
  const afterSeconds = Math.floor(timeOf(since, "since") / 1000);

  const addresses = [...new Set(senders.map(normalizeEmail))].filter(isQueryableAddress).sort();

  const queries: string[] = [];
  for (let i = 0; i < addresses.length; i += SENDERS_PER_QUERY) {
    const chunk = addresses.slice(i, i + SENDERS_PER_QUERY);
    queries.push(`from:(${chunk.join(" OR ")}) after:${afterSeconds} ${QUERY_SUFFIX}`);
  }
  return queries;
}

/**
 * האם כתובת יכולה להיכנס לשאילתה בלי לשנות את משמעותה.
 *
 * הכתובות מגיעות מכרטיסי משתמשים, שמוקלדים ביד. רווח, מירכאות, סוגריים
 * וסוגריים מסולסלים הם תחביר של חיפוש Gmail, ומקף בתחילת מילה הוא שלילה —
 * ערך כזה היה סוגר את קבוצת ה-OR באמצע או הופך אותה. כתובת בלי חלק מקומי
 * (`@example.com`) הייתה מרחיבה את השאילתה לדומיין שלם.
 *
 * **גם אפוסטרוף נדחה**, אף שהוא חוקי בכתובת (`o'brien@…`): לא נבדק איך
 * Gmail מפרק אותו, ושאילתה שבורה מאבדת את כל שלושים השולחים שבה ולא רק
 * אחד. הפונקציה מיוצאת כדי שהקורא ירשום ביומן כתובת שנדחתה — אחרת משתמש
 * כזה פשוט לא היה נקלט, בלי שאיש יידע למה.
 */
export function isQueryableAddress(value: string): boolean {
  return /^[^\s"'(){}@-][^\s"'(){}@]*@[^\s"'(){}@]+$/.test(normalizeEmail(value));
}

/** זמן במילישניות, או חריגה — תאריך לא תקין היה מייצר `after:NaN`, כלומר בלי רצפה */
function timeOf(date: Date, name: string): number {
  const time = date.getTime();
  if (Number.isNaN(time)) throw new RangeError(`תאריך לא תקין בחישוב חלון הסבב: ${name}`);
  return time;
}
