import "dotenv/config";

import { rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Prisma } from "@/generated/prisma/client";
import { runDailyEscalation } from "@/jobs/handlers/escalation";
import { db } from "@/lib/db";
import type { Viewer } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";
import { createInternalUser } from "@/lib/services/admin";
import { createProfessional } from "@/lib/services/directory";
import { registerMedia } from "@/lib/services/media";
import {
  addAssignments,
  addMessage,
  closeTicket,
  createTicket,
  removeAssignment,
  reopenTicket,
  setAssignmentStatus,
  type RecipientRef,
} from "@/lib/services/tickets";
import { addTagMessage, addTagToTicket, findOrCreateTag, grantTagAccess } from "@/lib/services/tags";
import { writeLocalObject } from "@/lib/storage/local";

/**
 * נתוני הדגמה לסביבת פיתוח — הרבה פניות, בכל המצבים שהלוח יודע להציג.
 *
 * זהו **לא** ה-seed של המערכת (`prisma/seed.ts`). הוא נשאר מינימלי ואידמפוטנטי
 * כדי שיהיה בטוח להריץ אותו על סביבה חיה. הקובץ הזה, לעומתו, **מוחק ובונה
 * מחדש** את כל תוכן המערכת, ולכן הוא חסום לרוץ על משהו שאינו localhost.
 *
 * שלוש הכרעות שמסבירות את כל המבנה:
 *
 * 1. **הכול נכתב דרך שכבת השירות ולא ישירות ל-DB.** פנייה שנוצרת ב-INSERT
 *    ידני נראית נכון בטבלה ושקרית במסך: חסרים לה אירועי השרשור, קישור הגישה
 *    של הקבלן, והסטטוס הנגזר מהשיוכים. נתוני בדיקה שאינם עוברים את אותו
 *    מסלול כמו נתונים אמיתיים בודקים את המסך מול מציאות שלא קיימת.
 *
 * 2. **הזמנים נדחפים אחורה בסוף, ולא תוך כדי.** לשירותים אין פרמטר "מתי" —
 *    ובצדק, שום מסלול אמיתי לא צריך כזה. לכן כל פנייה נוצרת "עכשיו" ואז כל
 *    הרשומות שלה מתוארכות מחדש (`retimeTicket`) לחלון הזמן שנבחר לה. בלי זה
 *    כל 200 הפניות היו נראות כאילו נפתחו באותה דקה, ומנגנון ההסלמה ("ללא
 *    תנועה 7 ימים") לא היה ניתן לבדיקה כלל.
 *
 * 3. **ההסלמה מסומנת בהרצת הג'וב האמיתי** ולא בכתיבת `escalated: true`. כך
 *    מה שנראה בלוח הוא מה שהמערכת באמת מסמנת, ולא ניחוש שלנו לגביו.
 *
 * הרצה:  npm run db:seed:demo
 */

// ────────────────────────────── מעקה בטיחות ──────────────────────────────

const DATABASE_URL = process.env["DATABASE_URL"] ?? "";
const IS_LOCAL = /@(localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL);

if (process.env["NODE_ENV"] === "production" || !IS_LOCAL) {
  console.error(
    "seed-demo מוחק את כל תוכן המערכת ולכן רץ מול localhost בלבד.\n" +
      `DATABASE_URL הנוכחי אינו מקומי: ${DATABASE_URL.replace(/:[^:@/]*@/, ":***@")}`,
  );
  process.exit(1);
}

// ────────────────────────────── אקראיות דטרמיניסטית ──────────────────────────────

/**
 * ‏mulberry32 עם זרע קבוע, ולא `Math.random`: שתי הרצות מייצרות את אותם
 * נתונים. באג שנראה בפנייה מסוימת חייב להיות ניתן לשחזור אחרי זריעה חוזרת,
 * אחרת אי אפשר לבדוק שהוא תוקן.
 */
let rngState = 0x6d2b79f5;
function random(): number {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

/** בוחר `count` פריטים שונים, או פחות אם אין מספיק */
function pickMany<T>(items: readonly T[], count: number): T[] {
  const pool = [...items];
  const chosen: T[] = [];
  while (chosen.length < count && pool.length > 0) {
    chosen.push(...pool.splice(Math.floor(random() * pool.length), 1));
  }
  return chosen;
}

function chance(probability: number): boolean {
  return random() < probability;
}

function intBetween(min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

// ────────────────────────────── זמן ──────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date();

/** תאריך לפני N ימים, בשעת עבודה סבירה — כדי שהשרשור לא ייראה כאילו נכתב ב-03:00 */
function daysAgo(days: number, hour = intBetween(7, 18)): Date {
  const at = new Date(NOW.getTime() - days * DAY_MS);
  at.setHours(hour, intBetween(0, 59), intBetween(0, 59), 0);
  return at;
}

// ────────────────────────────── תוכן ──────────────────────────────

const ADMIN_PHONE = "0500000000";
const DEMO_PASSWORD = process.env["SEED_ADMIN_PASSWORD"] ?? "dev-admin-1234";

const SITE_PLAN = [
  {
    name: "אתר לדוגמה",
    buildings: [
      { name: "בניין א", apartments: 3 },
      { name: "בניין ב", apartments: 3 },
    ],
  },
  {
    name: "פרויקט הדר · רמת גן",
    buildings: [
      { name: "בניין 1", apartments: 12 },
      { name: "בניין 2", apartments: 12 },
      { name: "בניין 3", apartments: 10 },
    ],
  },
  {
    name: "מגדלי הצפון · חיפה",
    buildings: [
      { name: "מגדל א", apartments: 20 },
      { name: "מגדל ב", apartments: 18 },
    ],
  },
  {
    name: "שכונת גנים · מודיעין",
    buildings: [
      { name: "בית 10", apartments: 6 },
      { name: "בית 12", apartments: 6 },
      { name: "בית 14", apartments: 6 },
      { name: "בית 16", apartments: 6 },
    ],
  },
] as const;

const RESIDENT_NAMES = [
  "משפחת כהן",
  "משפחת לוי",
  "משפחת מזרחי",
  "משפחת פרץ",
  "משפחת ביטון",
  "משפחת אזולאי",
  "משפחת דהן",
  "משפחת אברהם",
  "משפחת פרידמן",
  "משפחת שפירא",
  "משפחת חדד",
  "משפחת אוחיון",
  "משפחת גבאי",
  "משפחת נחום",
  "משפחת סבן",
  "משפחת רוזן",
  "משפחת בן דוד",
  "משפחת שרעבי",
  "משפחת טל",
  "משפחת אלון",
];

/**
 * תיאורי ליקויים לפי תחום, עם החדר שבו הם מתרחשים בדרך כלל.
 * כתובים כפי שמנהל עבודה מקליד אותם בשטח — קצרים, לא מנוסחים.
 */
const DEFECTS: Record<string, { text: string; room: string }[]> = {
  חשמל: [
    { text: "אין חשמל בממ״ד, המפסק קופץ כל כמה דקות", room: "MAMAD" },
    { text: "שקע כפול בסלון לא עובד, בדקנו את המפסק והוא למעלה", room: "SALON" },
    { text: "גוף התאורה במטבח מהבהב ואז נכבה", room: "KITCHEN" },
    { text: "לוח החשמל בכניסה מזמזם חזק", room: "LOBBY" },
    { text: "אין מתח בשקעי המרפסת אחרי הגשם", room: "BALCONY" },
    { text: "תאורת חירום בחדר מדרגות לא נדלקת", room: "STAIRWELL" },
  ],
  אינסטלציה: [
    { text: "נזילה מתחת לכיור במטבח, שמנו דלי בינתיים", room: "KITCHEN" },
    { text: "לחץ המים במקלחת נמוך מאוד, בדירות ליד תקין", room: "BATHROOM" },
    { text: "ניקוז האמבטיה סתום, המים עומדים", room: "BATHROOM" },
    { text: "האסלה מתנדנדת ויש מים על הרצפה", room: "WC" },
    { text: "ריח ביוב חזק בחדר המדרגות בקומה 2", room: "STAIRWELL" },
    { text: "ברז המטבח מטפטף כל הזמן", room: "KITCHEN" },
  ],
  אלומיניום: [
    { text: "חלון הסלון לא נסגר עד הסוף, נכנס אוויר", room: "SALON" },
    { text: "התריס בחדר השינה תקוע באמצע", room: "BEDROOM" },
    { text: "דלת המרפסת שורטת את הריצוף בפתיחה", room: "BALCONY" },
    { text: "רשת נגד יתושים קרועה בחדר הילדים", room: "BEDROOM" },
  ],
  ריצוף: [
    { text: "אריח שבור בכניסה לדירה", room: "LOBBY" },
    { text: "הריצוף תופח ליד המקלחת, נשמע חלול", room: "BATHROOM" },
    { text: "פוגות חסרות לאורך המסדרון", room: "COMMON" },
    { text: "שיפוע הניקוז במרפסת לא תקין, המים עומדים", room: "BALCONY" },
  ],
  "טיח וצבע": [
    { text: "סדק בקיר הסלון מעל החלון, באורך חצי מטר", room: "SALON" },
    { text: "כתם רטיבות בתקרת חדר הרחצה", room: "BATHROOM" },
    { text: "הצבע מתקלף בחדר המדרגות בין קומה 1 ל-2", room: "STAIRWELL" },
    { text: "טיח מתפורר בפינת המטבח ליד החלון", room: "KITCHEN" },
  ],
  נגרות: [
    { text: "דלת ארון המטבח לא נסגרת ישר", room: "KITCHEN" },
    { text: "מגירה יוצאת מהמסילה כל פעם מחדש", room: "KITCHEN" },
    { text: "משקוף דלת חדר השינה שרוט ופגום", room: "BEDROOM" },
  ],
  דלתות: [
    { text: "דלת הכניסה לא ננעלת בסיבוב מלא", room: "LOBBY" },
    { text: "הצילינדר תקוע, המפתח לא מסתובב", room: "LOBBY" },
    { text: "בולם הדלת בלובי שבור והדלת נטרקת", room: "LOBBY" },
  ],
  איטום: [
    { text: "רטיבות בקיר החיצוני אחרי הגשם האחרון", room: "BEDROOM" },
    { text: "נזילה מהמרפסת לדירה שמתחת", room: "BALCONY" },
    { text: "האיטום סביב החלון לא תקין, נכנסים מים", room: "SALON" },
  ],
  מיזוג: [
    { text: "המזגן בסלון מטפטף מים על הרצפה", room: "SALON" },
    { text: "המזגן בחדר השינה לא מקרר בכלל", room: "BEDROOM" },
    { text: "רעש חזק מהמאוורר של המזגן, מפריע בלילה", room: "BEDROOM" },
  ],
  גבס: [
    { text: "תקרת הגבס שקועה בפינה מעל הכניסה", room: "SALON" },
    { text: "סדק בחיבור בין הגבס לקיר", room: "SALON" },
  ],
  מעליות: [
    { text: "המעלית נעצרת בין קומות ונפתחת באיחור", room: "COMMON" },
    { text: "דלת המעלית נסגרת לאט מדי", room: "COMMON" },
    { text: "כפתור קומה 3 לא מגיב", room: "COMMON" },
  ],
  גינון: [
    { text: "מערכת ההשקיה בגינה המשותפת לא עובדת", room: "COMMON" },
    { text: "הדשא הסינתטי מתרומם בכניסה", room: "COMMON" },
  ],
  "פיתוח ותשתיות": [
    { text: "מכסה ביוב שקוע בחניה, רכב נתקע בו", room: "PARKING" },
    { text: "תאורת החצר לא נדלקת בערב", room: "COMMON" },
    { text: "שער החניה נסגר על רכב", room: "PARKING" },
  ],
  מטבחים: [
    { text: "משטח השיש סדוק ליד הכיור", room: "KITCHEN" },
    { text: "חיבור המדיח לא אטום, יש מים מתחת", room: "KITCHEN" },
  ],
  שיש: [
    { text: "אדן חלון שיש שבור בחדר השינה", room: "BEDROOM" },
    { text: "כתם שלא יורד על השיש במטבח", room: "KITCHEN" },
  ],
  אקוסטיקה: [
    { text: "רעש מהדירה השכנה עובר דרך הקיר המשותף", room: "BEDROOM" },
    { text: "הצנרת משמיעה רעש חזק בלילה", room: "WC" },
  ],
};

const MANAGER_LINES = [
  "אנא עדכן מתי אתה מגיע",
  "הדייר ביקש לתאם מראש, יש לו ילד קטן שישן בצהריים",
  "צירפתי תמונה של הליקוי",
  "תזכורת — הפנייה פתוחה כבר שבוע",
  "הדייר מתלונן שוב, אפשר להקדים?",
  "מאשר את העלות, אפשר להזמין את החלק",
  "בדקתי בשטח, זה חוזר על עצמו גם בדירה ליד",
  "נא לתאם מול ועד הבית לפני כניסה לשטח המשותף",
  "אם צריך מפתח למחסן — אצל השומר בכניסה",
];

const PROFESSIONAL_LINES = [
  "אגיע ביום ראשון בין 9 ל-12",
  "צריך חלק חלופי, מגיע בעוד יומיים",
  "תיקנתי, אפשר לסגור",
  "לא היה אף אחד בדירה, נא לתאם מחדש",
  "צריך אישור להחלפת החלק, עלות 450 ש״ח",
  "הייתי בשטח, זה לא בתחום שלי — צריך אינסטלטור",
  "סיימתי את החלק הראשון, נשאר לחזור לצבע אחרי שיתייבש",
  "אפשר להיכנס רק אחרי 16:00, לפני זה אני באתר אחר",
];

const PROFESSIONALS = [
  { name: "יוסי אלקטרו · חשמל", phone: "052-1110001", email: "yossi.electro@example.com" },
  { name: "משה כהן · חשמל", phone: "052-1110002", email: null },
  { name: "אבי דגן אינסטלציה", phone: "053-2220001", email: "avi.dagan@example.com" },
  { name: "רם שרברבות", phone: null, email: "ram.plumbing@example.com" },
  { name: "אלומיניום הדרום", phone: "054-3330001", email: "alum.south@example.com" },
  { name: "ניר תריסים", phone: "054-3330002", email: null },
  { name: "ריצופי הצפון", phone: "050-4440001", email: "north.tiles@example.com" },
  { name: "שלמה שיש וריצוף", phone: "050-4440002", email: null },
  { name: "צבעי אורן", phone: "058-5550001", email: "oren.paint@example.com" },
  { name: "טיח מקצועי בע״מ", phone: null, email: "plaster.pro@example.com" },
  { name: "נגריית בן ארי", phone: "052-6660001", email: "benari.wood@example.com" },
  { name: "דלתות ומנעולים 24", phone: "053-6660002", email: "doors24@example.com" },
  { name: "איטום שלם", phone: "054-7770001", email: "shalem.seal@example.com" },
  { name: "מיזוג אוויר גל", phone: "050-8880001", email: "gal.hvac@example.com" },
  { name: "קור וחום שירותי מיזוג", phone: "050-8880002", email: null },
  { name: "גבס דיזיין", phone: "058-9990001", email: "gypsum.design@example.com" },
  { name: "מעליות ארז שירות", phone: "052-1230001", email: "erez.lifts@example.com" },
  { name: "גינון ותחזוקה ירוק", phone: "053-1230002", email: "green.garden@example.com" },
  { name: "תשתיות מ.ג. עבודות עפר", phone: "054-1230003", email: "mg.infra@example.com" },
  { name: "מטבחי אמיר", phone: "050-1230004", email: "amir.kitchens@example.com" },
  { name: "אקוסטיקה פלוס", phone: "058-1230005", email: "acoustic.plus@example.com" },
  { name: "רפי תיקונים כלליים", phone: "052-1230006", email: null },
];

/** אנשי מקצוע שעזבו — נשארים בהיסטוריה ואינם בבוררי הבחירה */
const INACTIVE_PROFESSIONALS = ["רפי תיקונים כלליים", "קור וחום שירותי מיזוג"];

/** התחום שכל איש מקצוע מתמחה בו, כדי שהשיוכים לא ייראו אקראיים */
const DOMAIN_EXPERTS: Record<string, string[]> = {
  חשמל: ["יוסי אלקטרו · חשמל", "משה כהן · חשמל"],
  אינסטלציה: ["אבי דגן אינסטלציה", "רם שרברבות"],
  אלומיניום: ["אלומיניום הדרום", "ניר תריסים"],
  ריצוף: ["ריצופי הצפון", "שלמה שיש וריצוף"],
  "טיח וצבע": ["צבעי אורן", "טיח מקצועי בע״מ"],
  נגרות: ["נגריית בן ארי", "מטבחי אמיר"],
  דלתות: ["דלתות ומנעולים 24", "נגריית בן ארי"],
  איטום: ["איטום שלם", "טיח מקצועי בע״מ"],
  מיזוג: ["מיזוג אוויר גל", "קור וחום שירותי מיזוג"],
  גבס: ["גבס דיזיין", "צבעי אורן"],
  מעליות: ["מעליות ארז שירות"],
  גינון: ["גינון ותחזוקה ירוק"],
  "פיתוח ותשתיות": ["תשתיות מ.ג. עבודות עפר", "גינון ותחזוקה ירוק"],
  מטבחים: ["מטבחי אמיר", "נגריית בן ארי"],
  שיש: ["שלמה שיש וריצוף", "מטבחי אמיר"],
  אקוסטיקה: ["אקוסטיקה פלוס", "גבס דיזיין"],
};

const TAG_PLAN = [
  "בדק בית · מגדל א דירה 12",
  "ליקויי מסירה · בניין 2",
  "תיקוני חורף 2026",
  "רשימת ועד הבית · הדר",
  "מסירה קומה 5",
  "טיפול שורש · רטיבות",
  "ליקויי חשמל חוזרים",
  "סבב צבע לפני אכלוס",
  "תשתיות חניון",
  "בדק בית · בית 14",
  "פתיחת שנה · מגדלי הצפון",
  "מעקב מעליות",
];

const TICKET_COUNT = 210;

// ────────────────────────────── כלי עזר ──────────────────────────────

function viewerOf(user: SessionUser): Viewer {
  return { kind: "user", id: user.id, role: user.role, siteId: user.siteId };
}

function professionalViewer(id: string): Viewer {
  return { kind: "professional", id };
}

// ────────────────────────────── ניקוי ──────────────────────────────

/**
 * מוחק את כל תוכן המערכת חוץ ממשתמש המנהל הראשי ומרשימת התחומים.
 *
 * הסדר נגזר מהאילוצים ב-schema: `Restrict` הוא ברירת המחדל, ולכן ישות
 * שמישהו מצביע עליה נמחקת אחרונה. שינוי הסדר כאן ייכשל בשגיאת מפתח זר.
 */
async function wipe(): Promise<void> {
  await db.message.deleteMany({});
  await db.mediaFile.deleteMany({});
  await db.assignment.deleteMany({});
  await db.ticketTag.deleteMany({});
  await db.tagAccess.deleteMany({});
  await db.ticket.deleteMany({});
  await db.tag.deleteMany({});
  await db.accessToken.deleteMany({});
  await db.professional.deleteMany({});
  await db.job.deleteMany({});
  await db.rateLimit.deleteMany({});
  await db.user.deleteMany({ where: { phone: { not: ADMIN_PHONE } } });
  await db.apartment.deleteMany({});
  await db.building.deleteMany({});
  await db.site.deleteMany({});

  // קבצי המדיה המקומיים אינם ב-DB, ולכן מחיקת הרשומות לבדה הייתה משאירה
  // אותם יתומים על הדיסק לנצח.
  await rm(path.join(process.cwd(), ".localmedia", "media"), { recursive: true, force: true });
}

// ────────────────────────────── תיארוך מחדש ──────────────────────────────

/**
 * דוחף את כל רשומות הפנייה לחלון הזמן שנבחר לה.
 *
 * אירועי ה-`ASSIGNED` הפותחים נוצרו יחד עם הפנייה ולכן מוצמדים לרגע היצירה;
 * כל השאר נפרשים עד `lastActivityAt`. הסטטוסים של השיוכים מתוארכים לפי
 * **אירוע השרשור המתאים להם** (`recipientName` שב-eventMeta) ולא לפי חישוב
 * נפרד — כך ששורת "נצפה ב-" במסך הפנייה ואירוע "נצפה" בשרשור לעולם אינם
 * סותרים זה את זה.
 */
async function retimeTicket(ticketId: string, createdAt: Date, lastActivityAt: Date): Promise<void> {
  const messages = await db.message.findMany({
    where: { ticketId },
    orderBy: { createdAt: "asc" },
    select: { id: true, eventType: true, eventMeta: true },
  });

  let opening = 0;
  while (opening < messages.length && messages[opening]?.eventType === "ASSIGNED") opening += 1;

  const spread = messages.length - opening;
  const span = Math.max(lastActivityAt.getTime() - createdAt.getTime(), 0);
  const times = new Map<string, Date>();

  messages.forEach((message, index) => {
    if (index < opening) {
      times.set(message.id, new Date(createdAt.getTime() + index * 1000));
      return;
    }
    // הפריט האחרון נוחת בדיוק על lastActivityAt, כדי ש"תנועה אחרונה"
    // שהלוח מציג תהיה באמת זמן ההודעה האחרונה.
    const step = (index - opening + 1) / spread;
    times.set(message.id, new Date(createdAt.getTime() + span * step));
  });

  // מוצהר במפורש: לתוך אותו מערך נדחפים גם עדכוני שיוך, פנייה ומדיה, ובלי
  // ההצהרה TypeScript נועל את הטיפוס על עדכון ההודעה הראשון.
  const updates: Prisma.PrismaPromise<unknown>[] = messages.map((message) =>
    db.message.update({
      where: { id: message.id },
      data: { createdAt: times.get(message.id) as Date },
    }),
  );

  /** זמן האירוע לפי סוג ונמען, לשימוש בתיארוך השיוכים */
  const eventTime = (eventType: string, recipientName: string): Date | null => {
    const match = messages.find((message) => {
      if (message.eventType !== eventType) return false;
      const meta = message.eventMeta as { recipientName?: string } | null;
      return meta?.recipientName === recipientName;
    });
    return match ? (times.get(match.id) as Date) : null;
  };

  const assignments = await db.assignment.findMany({
    where: { ticketId },
    include: {
      professional: { select: { name: true, email: true } },
      user: { select: { name: true } },
    },
  });

  for (const assignment of assignments) {
    const name = assignment.professional?.name ?? assignment.user?.name ?? "";
    const assignedAt = eventTime("ASSIGNED", name) ?? createdAt;
    const viewedAt = eventTime("VIEWED", name);
    const doneAt = eventTime("DONE", name);
    const removedAt = eventTime("REMOVED", name);

    const statusChangedAt =
      assignment.status === "DONE"
        ? (doneAt ?? assignedAt)
        : assignment.status === "REMOVED"
          ? (removedAt ?? assignedAt)
          : assignment.status === "VIEWED"
            ? (viewedAt ?? assignedAt)
            : assignedAt;

    /**
     * ‏notifiedAt הוא "יצאה הודעה בפועל", ובכוונה אינו מלא תמיד: נמען בלי
     * מייל לעולם אינו מקבל התראה אוטומטית, וזה בדיוק המצב שמסך הפנייה אמור
     * להסביר למנהל במקום להשאיר אותו להאמין שנשלח.
     */
    const canBeNotified = Boolean(assignment.professional?.email) || assignment.userId !== null;
    const notifiedAt =
      canBeNotified && chance(0.85)
        ? new Date(assignedAt.getTime() + intBetween(1, 9) * 60_000)
        : null;

    updates.push(
      db.assignment.update({
        where: { id: assignment.id },
        data: {
          createdAt: assignedAt,
          statusChangedAt,
          viewedAt: viewedAt ?? (assignment.viewedAt ? assignedAt : null),
          notifiedAt,
        },
      }),
    );
  }

  const ticket = await db.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { closedAt: true },
  });

  const last = messages[messages.length - 1];
  const lastTime = last ? (times.get(last.id) as Date) : createdAt;
  const closedEvent = messages.filter((message) => message.eventType === "CLOSED").pop();

  updates.push(
    db.ticket.update({
      where: { id: ticketId },
      data: {
        createdAt,
        lastActivityAt: lastTime,
        ...(ticket.closedAt
          ? { closedAt: closedEvent ? (times.get(closedEvent.id) as Date) : lastTime }
          : {}),
      },
    }),
  );

  // המדיה מתוארכת לפי ההודעה שהיא מצורפת אליה — אחרת גלריית הפנייה מציגה
  // תמונות שצולמו לכאורה אחרי שהפנייה נסגרה.
  const media = await db.mediaFile.findMany({
    where: { message: { ticketId } },
    select: { id: true, messageId: true },
  });
  for (const file of media) {
    const at = file.messageId ? times.get(file.messageId) : null;
    if (at) updates.push(db.mediaFile.update({ where: { id: file.id }, data: { createdAt: at } }));
  }

  await db.$transaction(updates);
}

/** מיישר את קישורי הגישה של אנשי המקצוע לזמן השיוך הראשון שלהם */
async function retimeAccessTokens(): Promise<void> {
  const tokens = await db.accessToken.findMany({ select: { id: true, professionalId: true } });

  for (const token of tokens) {
    const first = await db.assignment.findFirst({
      where: { professionalId: token.professionalId },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    if (!first) continue;

    const lastView = await db.assignment.findFirst({
      where: { professionalId: token.professionalId, viewedAt: { not: null } },
      orderBy: { viewedAt: "desc" },
      select: { viewedAt: true },
    });

    await db.accessToken.update({
      where: { id: token.id },
      data: {
        createdAt: new Date(first.createdAt.getTime() - HOUR_MS),
        lastUsedAt: lastView?.viewedAt ?? null,
      },
    });
  }
}

// ────────────────────────────── מדיה ──────────────────────────────

const PHOTO_COLORS = [
  { r: 158, g: 142, b: 122 },
  { r: 122, g: 134, b: 148 },
  { r: 168, g: 160, b: 150 },
  { r: 132, g: 122, b: 112 },
  { r: 146, g: 152, b: 140 },
  { r: 176, g: 168, b: 156 },
];

/**
 * מייצר "צילום מהשטח" — קובץ אמיתי על הדיסק ולא רשומה ריקה.
 *
 * חשוב שהבתים יהיו אמיתיים: מסלול המדיה מגיש קבצים דרך בדיקת הרשאה וקורא
 * אותם מהדיסק, ורשומה שמצביעה על כלום הייתה מייצרת תמונה שבורה בשרשור —
 * כלומר בודקת את המסך מול מצב שאינו קיים במערכת אמיתית.
 */
async function createPhoto(viewer: Viewer, ticketId: string, index: number): Promise<string> {
  const color = pick(PHOTO_COLORS);
  const stripe = await sharp({
    create: {
      width: 1024,
      height: 120,
      channels: 3,
      background: { r: color.r - 40, g: color.g - 40, b: color.b - 40 },
    },
  })
    .png()
    .toBuffer();

  const buffer = await sharp({
    create: { width: 1024, height: 768, channels: 3, background: color },
  })
    .composite([{ input: stripe, top: intBetween(120, 520), left: 0 }])
    .jpeg({ quality: 72 })
    .toBuffer();

  const { mediaId } = await registerMedia(viewer, {
    ticketId,
    mimeType: "image/jpeg",
    sizeBytes: buffer.length,
    originalName: `IMG_${2100 + index}.jpg`,
  });

  const media = await db.mediaFile.findUniqueOrThrow({
    where: { id: mediaId },
    select: { storageKey: true },
  });
  await writeLocalObject(media.storageKey, buffer);

  // מסומן ישירות ולא דרך `confirmUpload`: האישור מכניס לתור ג'וב AI בתשלום,
  // ואין מה לחלץ מריבוע צבע.
  await db.mediaFile.update({
    where: { id: mediaId },
    data: { uploaded: true, aiStatus: "SKIPPED" },
  });

  return mediaId;
}

// ────────────────────────────── בנייה ──────────────────────────────

async function main(): Promise<void> {
  console.log("מנקה את תוכן המערכת…");
  await wipe();

  const admin = await db.user.findUnique({ where: { phone: ADMIN_PHONE } });
  if (!admin) {
    console.error("לא נמצא משתמש מנהל. הרץ תחילה `npm run db:seed`.");
    process.exit(1);
  }
  const adminActor: SessionUser = {
    id: admin.id,
    name: admin.name,
    role: admin.role,
    siteId: admin.siteId,
  };

  // ─── תחומים ───
  // רשימת התחומים היא בדיוק המפתחות של DEFECTS: תחום בלי ליקויים לדוגמה לא
  // היה מקבל אף פנייה, ותיאור ליקוי בלי תחום קיים לא היה ניתן לשיוך.
  for (const name of Object.keys(DEFECTS)) {
    await db.domain.upsert({ where: { name }, update: {}, create: { name } });
  }
  const domainByName = new Map((await db.domain.findMany()).map((domain) => [domain.name, domain]));

  // ─── אתרים, בניינים, דירות ───
  const sites: {
    id: string;
    name: string;
    apartments: { id: string; buildingId: string; number: string }[];
  }[] = [];

  for (const plan of SITE_PLAN) {
    const site = await db.site.create({ data: { name: plan.name } });
    const apartments: { id: string; buildingId: string; number: string }[] = [];

    for (const buildingPlan of plan.buildings) {
      const building = await db.building.create({
        data: { siteId: site.id, name: buildingPlan.name },
      });
      for (let number = 1; number <= buildingPlan.apartments; number += 1) {
        const apartment = await db.apartment.create({
          data: {
            buildingId: building.id,
            number: String(number),
            // ‏70% מהדירות מאוכלסות: דירה בלי דייר היא מצב אמיתי (טרם מסירה),
            // והמסך צריך להיראות נכון גם בלעדיו.
            residentName: chance(0.7) ? pick(RESIDENT_NAMES) : null,
          },
        });
        apartments.push({ id: apartment.id, buildingId: building.id, number: apartment.number });
      }
    }
    sites.push({ id: site.id, name: site.name, apartments });
    console.log(`אתר "${site.name}": ${plan.buildings.length} בניינים, ${apartments.length} דירות`);
  }

  // ─── משתמשים פנימיים ───
  const userPlan = [
    { name: "אבי כהן", phone: "0501111111", email: "avi@example.com", role: "OWNER" as const, site: null },
    { name: "נועה ברק", phone: "0502222222", email: "noa@example.com", role: "ADMIN" as const, site: null },
    { name: "יוסי מזרחי", phone: "0503333333", email: "yossi.m@example.com", role: "SITE_MANAGER" as const, site: 1 },
    { name: "רונית שגב", phone: "0504444444", email: "ronit@example.com", role: "SITE_MANAGER" as const, site: 1 },
    { name: "שירה לוי", phone: "0505555555", email: "shira@example.com", role: "SITE_MANAGER" as const, site: 2 },
    { name: "דני אלמוג", phone: "0506666666", email: "dani@example.com", role: "SITE_MANAGER" as const, site: 3 },
    { name: "איתי בר", phone: "0507777777", email: "itay@example.com", role: "SITE_MANAGER" as const, site: 0 },
  ];

  const users: SessionUser[] = [adminActor];
  const managersBySite = new Map<string, SessionUser[]>();

  for (const plan of userPlan) {
    const siteId = plan.site === null ? null : (sites[plan.site]?.id ?? null);
    const created = await createInternalUser(adminActor, {
      name: plan.name,
      phone: plan.phone,
      email: plan.email,
      role: plan.role,
      siteId,
      password: DEMO_PASSWORD,
    });
    const actor: SessionUser = {
      id: created.id,
      name: created.name,
      role: created.role,
      siteId: created.siteId,
    };
    users.push(actor);
    if (siteId) managersBySite.set(siteId, [...(managersBySite.get(siteId) ?? []), actor]);
  }

  // משתמש מושבת — בדיוק כמו איש מקצוע שעזב, ההיסטוריה שלו נשארת
  await db.user.update({ where: { phone: "0507777777" }, data: { active: false } });
  console.log(`משתמשים פנימיים: ${users.length} (אחד מושבת)`);

  // מנהלי מערכת הם היחידים שרשאים לפעול על **כל** פנייה — לסגור אחת שפתח
  // מישהו אחר (`canCloseTicket`) ולתייג פנייה בכל אתר (`canTagTicket`).
  const adminUsers = users.filter((user) => user.role === "ADMIN");

  // ─── אנשי מקצוע ───
  const professionalByName = new Map<string, { id: string; name: string }>();
  for (const input of PROFESSIONALS) {
    const created = await createProfessional(input);
    professionalByName.set(created.name, { id: created.id, name: created.name });
  }
  for (const name of INACTIVE_PROFESSIONALS) {
    const professional = professionalByName.get(name);
    if (professional) {
      await db.professional.update({ where: { id: professional.id }, data: { active: false } });
    }
  }
  const activeProfessionals = [...professionalByName.values()].filter(
    (professional) => !INACTIVE_PROFESSIONALS.includes(professional.name),
  );
  console.log(`אנשי מקצוע: ${professionalByName.size} (${INACTIVE_PROFESSIONALS.length} מושבתים)`);

  // ─── פניות ───
  const domainNames = Object.keys(DEFECTS);
  const submitted: string[] = [];
  let photos = 0;

  for (let index = 0; index < TICKET_COUNT; index += 1) {
    const site = pick(sites);
    const apartment = pick(site.apartments);
    const domainName = pick(domainNames);
    const domain = domainByName.get(domainName);
    if (!domain) continue;
    const defect = pick(DEFECTS[domainName] as { text: string; room: string }[]);

    const siteManagers = managersBySite.get(site.id) ?? [];
    // רוב הפניות נפתחות בידי מנהל העבודה של האתר; מיעוטן בידי ההנהלה.
    const author =
      siteManagers.length > 0 && chance(0.75) ? pick(siteManagers) : pick(users.slice(0, 3));
    const authorViewer = viewerOf(author);

    const experts = (DOMAIN_EXPERTS[domainName] ?? [])
      .map((name) => professionalByName.get(name))
      .filter((value): value is { id: string; name: string } => Boolean(value))
      .filter((professional) => !INACTIVE_PROFESSIONALS.includes(professional.name));

    const pool = experts.length > 0 ? experts : activeProfessionals;
    const chosen = pickMany(pool, chance(0.25) ? 2 : 1);
    const recipients: RecipientRef[] = chosen.map((professional) => ({
      kind: "professional",
      id: professional.id,
    }));

    // תזכורן: הפותח משייך את הפנייה גם לעצמו, כדי לעקוב אחריה
    if (chance(0.12)) recipients.push({ kind: "user", id: author.id });

    const ageDays = intBetween(0, 95);
    const createdAt = daysAgo(ageDays);

    // ─── טיוטות ───
    if (chance(0.07)) {
      // טיוטה "מלאה" נשמרה במפורש וניתן לשגר אותה; טיוטה חסרה נוצרה כי
      // המנהל לא סיים למלא — שני המסלולים קיימים באפיון §2.5.
      const complete = chance(0.4);
      const { ticket } = await createTicket(author, {
        siteId: site.id,
        buildingId: complete || chance(0.6) ? apartment.buildingId : null,
        apartmentId: complete ? apartment.id : null,
        domainId: complete || chance(0.5) ? domain.id : null,
        room: defect.room as never,
        description: complete || chance(0.7) ? defect.text : "",
        channel: "SELF",
        recipients: complete ? recipients : [],
        saveAsDraft: complete,
      });
      await db.ticket.update({
        where: { id: ticket.id },
        data: { createdAt, lastActivityAt: createdAt },
      });
      continue;
    }

    const { ticket } = await createTicket(author, {
      siteId: site.id,
      buildingId: apartment.buildingId,
      apartmentId: apartment.id,
      domainId: domain.id,
      room: defect.room as never,
      description: defect.text,
      channel: chance(0.15) ? "MANAGEMENT" : chance(0.05) ? "WHATSAPP" : "SELF",
      recipients,
    });
    submitted.push(ticket.id);

    const assignments = await db.assignment.findMany({
      where: { ticketId: ticket.id },
      select: { id: true, professionalId: true },
    });

    // ─── צילום מהשטח ───
    if (chance(0.2)) {
      const mediaIds: string[] = [];
      for (let photo = 0; photo < intBetween(1, 2); photo += 1) {
        mediaIds.push(await createPhoto(authorViewer, ticket.id, index * 10 + photo));
        photos += 1;
      }
      await addMessage(authorViewer, ticket.id, chance(0.6) ? "צילום מהשטח" : "", mediaIds);
    }

    // ─── התקדמות השיוכים ───
    // ‏progress אחד לכל הפנייה ולא הגרלה לכל שיוך: כך נוצרות פניות שבהן
    // חלק מהנמענים סיימו וחלק לא (המצב "חלקי"), ולא רק הקצוות.
    const progress = random();
    for (const assignment of assignments) {
      if (!assignment.professionalId) continue;
      if (progress < 0.2) continue; // איש לא פתח עדיין — "נשלח"

      await setAssignmentStatus(assignment.id, "VIEWED");

      if (progress > 0.45 && chance(0.65)) {
        if (chance(0.6)) {
          await addMessage(
            professionalViewer(assignment.professionalId),
            ticket.id,
            pick(PROFESSIONAL_LINES),
          );
        }
        if (progress > 0.6) await setAssignmentStatus(assignment.id, "DONE");
      }
    }

    // ─── שיחה בשרשור ───
    const withProfessional = assignments.find((assignment) => assignment.professionalId);
    for (let turn = 0; turn < intBetween(0, 3); turn += 1) {
      if (chance(0.55) || !withProfessional?.professionalId) {
        await addMessage(authorViewer, ticket.id, pick(MANAGER_LINES));
      } else {
        await addMessage(
          professionalViewer(withProfessional.professionalId),
          ticket.id,
          pick(PROFESSIONAL_LINES),
        );
      }
    }

    // ─── נמען שנוסף מאוחר, ונמען שהוסר ───
    if (chance(0.1)) {
      const [extra] = pickMany(
        activeProfessionals.filter(
          (professional) => !chosen.some((already) => already.id === professional.id),
        ),
        1,
      );
      if (extra) {
        await addAssignments(authorViewer, ticket.id, [{ kind: "professional", id: extra.id }]);
      }
    }
    if (chance(0.06) && assignments.length > 1) {
      await removeAssignment(authorViewer, assignments[assignments.length - 1]!.id);
    }

    // ─── סגירה ופתיחה מחדש ───
    // סגירה שמורה לפותח הפנייה או למנהל מערכת (`canCloseTicket`) — מנהל
    // עבודה אינו סוגר פנייה שפתח מישהו אחר, גם באתר שלו.
    const closer = chance(0.7) ? author : pick(adminUsers);
    if (progress > 0.62 && chance(0.75)) {
      await closeTicket(viewerOf(closer), ticket.id);

      if (chance(0.15)) {
        await reopenTicket(viewerOf(closer), ticket.id);
        if (chance(0.5)) {
          await addMessage(authorViewer, ticket.id, "הליקוי חזר, פתחתי מחדש");
          await closeTicket(viewerOf(closer), ticket.id);
        }
      }
    }

    /**
     * חלון הזמן של הפנייה. פנייה פעילה מקבלת "תנועה אחרונה" שלעיתים ישנה
     * מ-7 ימים — וזה מה שנותן לג'וב ההסלמה מה לסמן. בלי זה מסלול ההסלמה לא
     * היה ניתן לבדיקה בלי להמתין שבוע.
     */
    const closed = await db.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      select: { closedAt: true },
    });
    const activityAgeDays = closed.closedAt
      ? intBetween(0, ageDays)
      : chance(0.25)
        ? intBetween(8, 30)
        : intBetween(0, 6);

    await retimeTicket(ticket.id, createdAt, daysAgo(Math.min(activityAgeDays, ageDays)));

    if ((index + 1) % 25 === 0) console.log(`  פניות: ${index + 1}/${TICKET_COUNT}`);
  }

  // ─── תגיות ───
  let tagMessages = 0;
  for (const name of TAG_PLAN) {
    // תגית חוצה אתרים לפי טבעה, ולכן בעליה הוא מנהל מערכת: מנהל עבודה יכול
    // לתייג רק פניות באתר שלו, ותגית שנבנתה בידיו הייתה נחסמת באמצע.
    const owner = pick(adminUsers);
    const ownerViewer = viewerOf(owner);
    const tag = await findOrCreateTag(name, owner.id);

    for (const ticketId of pickMany(submitted, intBetween(3, 9))) {
      await addTagToTicket(ownerViewer, ticketId, name);
    }

    const invited = pickMany(activeProfessionals, intBetween(1, 3));
    await grantTagAccess(
      viewerOf(adminActor),
      tag.id,
      invited.map((professional) => professional.id),
    );

    for (let turn = 0; turn < intBetween(1, 5); turn += 1) {
      const fromManager = chance(0.5) || invited.length === 0;
      await addTagMessage(
        fromManager ? ownerViewer : professionalViewer(pick(invited).id),
        tag.id,
        fromManager ? pick(MANAGER_LINES) : pick(PROFESSIONAL_LINES),
      );
      tagMessages += 1;
    }

    // צ׳אט התגית נפרש על החודש-חודשיים האחרונים, כמו שרשור פנייה
    const chat = await db.message.findMany({
      where: { tagId: tag.id },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const start = daysAgo(intBetween(20, 60));
    const end = daysAgo(intBetween(0, 5));
    const span = end.getTime() - start.getTime();

    await db.$transaction([
      ...chat.map((message, position) =>
        db.message.update({
          where: { id: message.id },
          data: {
            createdAt: new Date(start.getTime() + (span * (position + 1)) / chat.length),
          },
        }),
      ),
      db.tag.update({ where: { id: tag.id }, data: { createdAt: start } }),
    ]);
  }
  console.log(`תגיות: ${TAG_PLAN.length}, הודעות בצ׳אטים: ${tagMessages}`);

  // ─── קישורי גישה, הסלמה, ניקוי תור ───
  await retimeAccessTokens();

  const escalated = await runDailyEscalation();
  console.log(`הסלמה יומית: ${escalated} פניות סומנו כתקועות`);

  // ג'ובי ההתראה נוצרו כדין בכל שיוך, אבל אין טעם לשלוח 300 הודעות על פניות
  // מלפני חודשיים. זמני היידוע כבר נכתבו ישירות ל-`notifiedAt`.
  const { count: dropped } = await db.job.deleteMany({});

  // ─── סיכום ───
  const [tickets, open, drafts, closedCount, escalatedCount, messages, media, tags, reopened] =
    await Promise.all([
      db.ticket.count(),
      db.ticket.count({ where: { closedAt: null, isDraft: false } }),
      db.ticket.count({ where: { isDraft: true } }),
      db.ticket.count({ where: { closedAt: { not: null } } }),
      db.ticket.count({ where: { escalated: true } }),
      db.message.count(),
      db.mediaFile.count(),
      db.tag.count(),
      db.ticket.count({ where: { reopenCount: { gt: 0 } } }),
    ]);

  console.log("\n─────────────────────────────────────");
  console.log("נתוני הדגמה נזרעו:");
  console.log(`  פניות:         ${tickets}`);
  console.log(`    פתוחות:      ${open}  (מהן ${escalatedCount} מוסלמות)`);
  console.log(`    סגורות:      ${closedCount}  (${reopened} נפתחו מחדש בעבר)`);
  console.log(`    טיוטות:      ${drafts}`);
  console.log(`  הודעות ואירועים: ${messages}`);
  console.log(`  קבצי מדיה:     ${media} (${photos} צולמו)`);
  console.log(`  תגיות:         ${tags}`);
  console.log(`  אתרים:         ${sites.length}`);
  console.log(`  ג׳ובים שנוקו:  ${dropped}`);
  console.log(`\n  סיסמת כניסה לכל המשתמשים: ${DEMO_PASSWORD}`);
  console.log("─────────────────────────────────────\n");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
