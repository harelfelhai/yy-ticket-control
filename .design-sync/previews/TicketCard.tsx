import { TicketCard } from "yy-ticket-control";

/**
 * כרטיס פנייה ברשימת הלוח. הכרטיס כולו הוא קישור אחד — אצבע בכפפה על מסך
 * בשמש לא מכוונת לאזור קטן.
 *
 * **טקסט הסיבה הוא החלק החשוב בכרטיס**: בלי הסבר במילים, פנייה קופצת בין
 * קבוצות בלי שהמשתמש עשה דבר, וזה שוחק אמון במערכת.
 */

const base = {
  seq: 412,
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

/** פנייה רגילה שנשלחה לאיש מקצוע. */
export function Default() {
  return (
    <div className="max-w-md">
      <TicketCard card={{ ...base, id: "1" }} />
    </div>
  );
}

/**
 * טיוטה — מסגרת אדומה מלאה ושורת סיבה אדומה. זהו הסימן היחיד שמבדיל אותה
 * בסריקה מהירה של הלוח, והיא חוסמת שיגור.
 */
export function Draft() {
  return (
    <div className="max-w-md">
      <TicketCard
        card={{
          ...base,
          id: "2",
          status: "DRAFT",
          section: "ACTION_REQUIRED",
          recipientNames: [],
          reason: "טיוטה — חסרים פרטים. לא נשלחה לאיש.",
          descriptionLine: "נזילה במטבח",
          ageDays: 0,
        }}
      />
    </div>
  );
}

/** בלי בניין, בלי דירה ובלי תחום — הכרטיס עדיין נקרא. */
export function Sparse() {
  return (
    <div className="max-w-md">
      <TicketCard
        card={{
          ...base,
          id: "3",
          buildingName: null,
          apartmentNumber: null,
          domainName: null,
          descriptionLine: "",
          recipientNames: [],
          channel: "WHATSAPP",
          status: "PARTIAL",
          reason: "אין נמענים — נדרשת בחירת איש מקצוע",
          ageDays: 1,
        }}
      />
    </div>
  );
}

/** רשימת הלוח — כמה כרטיסים זה מתחת לזה, כולל פנייה שנפתחה מחדש. */
export function InList() {
  return (
    <ul className="flex max-w-md flex-col gap-2">
      <li>
        <TicketCard card={{ ...base, id: "4" }} />
      </li>
      <li>
        <TicketCard
          card={{
            ...base,
            id: "5",
            buildingName: "סוקולוב 3",
            apartmentNumber: "12",
            domainName: "חשמל",
            descriptionLine: "אין חשמל בחדר השינה אחרי הגשם",
            recipientNames: ["אבי כהן", "רונן לוי"],
            channel: "MANAGEMENT",
            status: "VIEWED",
            reason: "נצפתה על ידי אבי כהן",
            ageDays: 5,
            reopened: true,
          }}
        />
      </li>
      <li>
        <TicketCard
          card={{
            ...base,
            id: "6",
            status: "DRAFT",
            section: "ACTION_REQUIRED",
            recipientNames: [],
            reason: "טיוטה — חסרים פרטים. לא נשלחה לאיש.",
            ageDays: 0,
          }}
        />
      </li>
    </ul>
  );
}
