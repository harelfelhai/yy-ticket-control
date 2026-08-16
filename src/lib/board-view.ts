import type { Channel } from "@/generated/prisma/enums";
import type { BoardSection, DerivedTicketStatus } from "./ticket-status";

/**
 * צורת הנתונים של הלוח וההיגיון הטהור שפועל עליה.
 *
 * מופרד מ-`services/board.ts` (שמדבר עם ה-DB) בכוונה: המיון הוא חישוב טהור,
 * ובלי ההפרדה בדיקת יחידה עליו הייתה דורשת חיבור לבסיס נתונים — כלומר לא
 * בדיקת יחידה.
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

// ────────────────────────── מיון לפי עמודה (0.4) ──────────────────────────

/**
 * העמודות שאפשר למיין לפיהן — בדיוק אלה שהטבלה מציגה.
 *
 * המפתחות נשמרים בכתובת (`?sort=`), ולכן הם שמות יציבים ולא אינדקסים:
 * הוספת עמודה באמצע לא תשנה את משמעותו של קישור שנשמר.
 */
export const SORT_KEYS = ["location", "domain", "description", "recipients"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDirection = "asc" | "desc";

export function isSortKey(value: string | undefined): value is SortKey {
  return value !== undefined && (SORT_KEYS as readonly string[]).includes(value);
}

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
    case "description":
      return card.descriptionLine ? 0 : 1;
  }
}

function compareBy(key: SortKey, a: BoardCard, b: BoardCard): number {
  switch (key) {
    case "location":
      // בניין ואז דירה, ו-`numeric` כדי שדירה 10 תבוא אחרי 2 ולא לפניה.
      return (
        compareText(a.buildingName ?? "", b.buildingName ?? "") ||
        compareText(a.apartmentNumber ?? "", b.apartmentNumber ?? "")
      );
    case "domain":
      return compareText(a.domainName ?? "", b.domainName ?? "");
    case "description":
      return compareText(a.descriptionLine, b.descriptionLine);
    case "recipients":
      return compareText(a.recipientNames.join(", "), b.recipientNames.join(", "));
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
