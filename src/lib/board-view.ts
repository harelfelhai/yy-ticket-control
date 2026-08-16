import type { Channel } from "@/generated/prisma/enums";
import type { BoardSection, DerivedTicketStatus } from "./ticket-status";

/**
 * צורת הנתונים של הלוח וההיגיון הטהור שפועל עליה.
 *
 * מופרד מ-`services/board.ts` (שמדבר עם ה-DB) בכוונה: הקיבוץ למצב סיור
 * הוא חישוב טהור, ובלי ההפרדה בדיקת יחידה עליו הייתה דורשת חיבור לבסיס
 * נתונים — כלומר לא בדיקת יחידה.
 */

/** כרטיס פנייה כפי שהוא מוצג ברשימת הלוח */
export interface BoardCard {
  id: string;
  seq: number;
  buildingName: string | null;
  apartmentNumber: string | null;
  domainName: string | null;
  /** השורה הראשונה בלבד — הכרטיס אינו מקום לקרוא בו תיאור מלא */
  descriptionLine: string;
  channel: Channel;
  recipientNames: string[];
  status: DerivedTicketStatus;
  section: BoardSection;
  reason: string;
  ageDays: number;
  reopened: boolean;
  /** סומן על ידי הג'וב היומי כללא-תנועה — לצלילה ממוקדת מתצוגת הבעלים */
  escalated: boolean;
  createdAt: Date;
}

export interface TourGroup {
  key: string;
  label: string;
  cards: BoardCard[];
}

/**
 * "מצב סיור": קיבוץ לפי בניין ודירה, למנהל שנמצא פיזית באתר ורוצה לסגור
 * כמה פניות בסיבוב אחד.
 *
 * טיוטות ופניות בלי מיקום מלא נשארות מוצמדות לראש ואינן נכנסות לקיבוץ:
 * הצגתן תחת "ללא מיקום" הייתה קוברת בדיוק את מה שדורש השלמה.
 */
export function groupForTour(cards: readonly BoardCard[]): {
  drafts: BoardCard[];
  groups: TourGroup[];
} {
  const drafts: BoardCard[] = [];
  const byLocation = new Map<string, TourGroup>();

  for (const card of cards) {
    if (!card.buildingName || !card.apartmentNumber) {
      drafts.push(card);
      continue;
    }

    const key = `${card.buildingName}|${card.apartmentNumber}`;
    const group = byLocation.get(key);
    if (group) {
      group.cards.push(card);
    } else {
      byLocation.set(key, {
        key,
        label: `${card.buildingName} · דירה ${card.apartmentNumber}`,
        cards: [card],
      });
    }
  }

  // מיון לפי שם הבניין ואז לפי מספר הדירה, כדי שהסדר יתאים למסלול הפיזי
  // של מי שמסתובב באתר ולא לסדר שבו הפניות נפתחו. `numeric` נדרש כדי
  // שדירה 10 תבוא אחרי דירה 2 ולא לפניה.
  const groups = [...byLocation.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "he", { numeric: true }),
  );

  return { drafts, groups };
}

// ────────────────────────── מיון לפי עמודה (0.4) ──────────────────────────

/**
 * העמודות שאפשר למיין לפיהן — בדיוק אלה שהטבלה מציגה.
 *
 * המפתחות נשמרים בכתובת (`?sort=`), ולכן הם שמות יציבים ולא אינדקסים:
 * הוספת עמודה באמצע לא תשנה את משמעותו של קישור שנשמר.
 */
export const SORT_KEYS = ["seq", "location", "domain", "reason", "recipients", "status"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDirection = "asc" | "desc";

export function isSortKey(value: string | undefined): value is SortKey {
  return value !== undefined && (SORT_KEYS as readonly string[]).includes(value);
}

/**
 * סדר הסטטוסים למיון — לפי **דחיפות**, לא לפי אלפבית.
 *
 * מיון אלפביתי על שם הסטטוס היה מסדר "נצפה" לפני "ממתין לאישור" בלי שום
 * היגיון תפעולי. הסדר כאן הוא אותו סדר שבו `deriveTicketStatus` בודק את
 * המצבים, וזה מכוון: שם הוא מבטא קדימות, וכאן אותה קדימות בדיוק היא מה
 * שהמנהל מצפה לראות בראש.
 */
const STATUS_ORDER: Record<DerivedTicketStatus, number> = {
  DRAFT: 0,
  AWAITING_OPENER_APPROVAL: 1,
  PARTIAL: 2,
  NEW: 3,
  VIEWED: 4,
  CLOSED: 5,
};

/** השוואת מחרוזות בעברית. הריקות מטופלת ב-`emptyRank`, לא כאן. */
function compareText(a: string, b: string): number {
  return a.localeCompare(b, "he", { numeric: true });
}

/**
 * ערך חסר מקבל דירוג נפרד, **שאינו מושפע מכיוון המיון**.
 *
 * ‏"אין תחום" אינו ערך קיצון אלא היעדר, ולכן הוא שייך לסוף הרשימה גם
 * בעולה וגם ביורד. הכפלה פשוטה בכיוון הייתה מקפיצה את כל חסרי הערך לראש
 * בלחיצה השנייה — כלומר הופכת את המיון היורד למסך של שורות ריקות.
 */
function emptyRank(key: SortKey, card: BoardCard): number {
  switch (key) {
    case "location":
      return card.buildingName ? 0 : 1;
    case "domain":
      return card.domainName ? 0 : 1;
    case "recipients":
      return card.recipientNames.length > 0 ? 0 : 1;
    case "reason":
      return card.reason ? 0 : 1;
    // ‏seq ו-status קיימים תמיד.
    default:
      return 0;
  }
}

function compareBy(key: SortKey, a: BoardCard, b: BoardCard): number {
  switch (key) {
    case "seq":
      return a.seq - b.seq;
    case "location":
      // בניין ואז דירה, ו-`numeric` כדי שדירה 10 תבוא אחרי 2 — אותו
      // שיקול בדיוק כמו בקיבוץ מצב הסיור.
      return (
        compareText(a.buildingName ?? "", b.buildingName ?? "") ||
        compareText(a.apartmentNumber ?? "", b.apartmentNumber ?? "")
      );
    case "domain":
      return compareText(a.domainName ?? "", b.domainName ?? "");
    case "reason":
      return compareText(a.reason, b.reason);
    case "recipients":
      return compareText(a.recipientNames.join(", "), b.recipientNames.join(", "));
    case "status":
      return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  }
}

/**
 * ממיין קבוצה אחת בלוח (הכרעת 0.4, §7 שורה 30).
 *
 * **`null` מחזיר את הרשימה כפי שהיא** — זהו המצב השלישי במחזור, החזרה
 * לסדר המערכת. בלעדיו המיון הוא דלת חד-כיוונית שמסתירה את דירוג הדחיפות
 * בלי לומר זאת.
 *
 * המיון **יציב**, ולכן שוויון בעמודה שומר על סדר המערכת בין השווים: שתי
 * פניות באותו תחום יישארו מדורגות ביניהן לפי דחיפות. `Array.prototype.sort`
 * מובטח יציב מאז ES2019.
 *
 * מקבל `readonly` ומחזיר מערך חדש: הקוראים מחזיקים את מערכי הקבוצות של
 * הלוח, ומיון במקום היה משנה אותם גם למי שמציג כרטיסים.
 */
export function sortCards(
  cards: readonly BoardCard[],
  sort: { key: SortKey; direction: SortDirection } | null,
): BoardCard[] {
  if (!sort) return [...cards];

  const factor = sort.direction === "desc" ? -1 : 1;
  return [...cards].sort((a, b) => {
    // חסרי ערך יורדים לסוף לפני שהכיוון נכנס לתמונה.
    const missing = emptyRank(sort.key, a) - emptyRank(sort.key, b);
    if (missing !== 0) return missing;
    return factor * compareBy(sort.key, a, b);
  });
}

/**
 * המצב הבא במחזור, בלחיצה על כותרת עמודה.
 *
 * עולה ← יורד ← סדר המערכת. לחיצה על עמודה **אחרת** מתחילה מחדש בעולה
 * ואינה יורשת את הכיוון הקודם: ירידה שנגררת לעמודה חדשה נקראת כתקלה.
 */
export function nextSort(
  current: { key: SortKey; direction: SortDirection } | null,
  clicked: SortKey,
): { key: SortKey; direction: SortDirection } | null {
  if (!current || current.key !== clicked) return { key: clicked, direction: "asc" };
  if (current.direction === "asc") return { key: clicked, direction: "desc" };
  return null;
}
