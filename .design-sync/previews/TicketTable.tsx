import { TicketTable } from "yy-ticket-control";

/**
 * תצוגת הטבלה של הלוח, לחלופין לתצוגת הכרטיסים. כל שורה היא קישור אחד,
 * וכותרות העמודות הן קישורי מיון — המיון משנה את הכתובת, ולכן זו ניווט:
 * הטבלה נשארת רכיב שרת, עובדת בלי JS ותומכת בפתיחה בלשונית.
 */

const base = {
  seq: 400,
  buildingName: "בן גוריון 14",
  apartmentNumber: "4",
  domainName: "אינסטלציה",
  descriptionLine: "נזילה מתחת לכיור במטבח, המים מגיעים למסדרון",
  channel: "SELF" as const,
  recipientNames: ["מוסא דיאב"],
  status: "NEW" as const,
  section: "WITH_RECIPIENTS" as const,
  reason: "נשלחה לאיש מקצוע וממתינה לתגובה",
  ageDays: 2,
  reopened: false,
  escalated: false,
  createdAt: new Date("2026-08-15T08:00:00Z"),
};

const cards = [
  { ...base, id: "1" },
  {
    ...base,
    id: "2",
    buildingName: "סוקולוב 3",
    apartmentNumber: "12",
    domainName: "חשמל",
    descriptionLine: "אין חשמל בחדר השינה אחרי הגשם",
    recipientNames: ["אבי כהן", "רונן לוי"],
    status: "VIEWED" as const,
    reason: "נצפתה על ידי אבי כהן",
    ageDays: 5,
  },
  {
    ...base,
    id: "3",
    buildingName: null,
    apartmentNumber: null,
    domainName: null,
    descriptionLine: "דלת הכניסה לבניין לא ננעלת",
    recipientNames: [],
    status: "DRAFT" as const,
    section: "ACTION_REQUIRED" as const,
    reason: "טיוטה — חסרים פרטים. לא נשלחה לאיש.",
    ageDays: 0,
  },
];

const sortHref = (key: string) => `/board?sort=${key}`;

/** בלי מיון פעיל — הלוח בסדר המערכת. */
export function Unsorted() {
  return <TicketTable cards={cards} sort={null} sortHref={sortHref} />;
}

/** ממוין לפי מיקום — הכותרת הפעילה נושאת חץ כיוון. */
export function Sorted() {
  return (
    <TicketTable cards={cards} sort={{ key: "location", direction: "asc" }} sortHref={sortHref} />
  );
}

/** בלי שורות — הכותרות נשארות, כי הן פקד ולא קישוט. */
export function EmptyRows() {
  return <TicketTable cards={[]} sort={null} sortHref={sortHref} />;
}
