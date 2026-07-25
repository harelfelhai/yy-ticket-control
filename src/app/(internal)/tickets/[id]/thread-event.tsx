import { he } from "@/lib/he";

/**
 * שורת אירוע מערכת בשרשור.
 *
 * מוצגת כשורה נייטרלית ולא כהודעה, כדי שהעין תבחין מיד בין "מה קרה
 * לפנייה" לבין "מה מישהו כתב". השם נשלף מ-eventMeta ולא מהישות החיה, כדי
 * שהשרשור יישאר קריא גם אם איש המקצוע שונה או מוזג עם כפילות מאוחר יותר.
 */
export function ThreadEvent({
  eventType,
  meta,
}: {
  eventType: string | null;
  meta: unknown;
}) {
  const { recipientName = "", userName = "" } = (meta ?? {}) as {
    recipientName?: string;
    userName?: string;
    // ‏fields נשמר ב-meta של FIELDS_EDITED אך אינו מוצג בשורה בכוונה — היא
    // נשארת קצרה, והשינוי עצמו נראה בכותרת הפנייה המעודכנת.
  };

  const text = describe(eventType, recipientName, userName);
  if (!text) return null;

  return <p className="text-sm text-muted">{text}</p>;
}

function describe(eventType: string | null, recipient: string, actor: string): string | null {
  switch (eventType) {
    case "ASSIGNED":
      return he.event.assigned(recipient);
    case "REMOVED":
      return he.event.removed(recipient);
    case "VIEWED":
      return he.event.viewed(recipient);
    case "DONE":
      return he.event.done(recipient);
    case "QUESTION":
      return he.event.question(recipient);
    case "CLOSED":
      return he.event.closed(actor);
    case "REOPENED":
      return he.event.reopened(actor);
    case "HANDLER_SET":
      return he.event.handlerSet(actor);
    case "FIELDS_EDITED":
      // שם השדות שהשתנו נשמר ב-meta אבל אינו מוצג בשורה — היא נשארת קצרה
      // ("דוד עדכן את פרטי הפנייה"), והשינוי עצמו נראה בכותרת המעודכנת.
      return he.event.fieldsEdited(actor);
    default:
      // אירוע שאינו מוכר לא מוצג כלל, ולא כשורה ריקה או כמזהה באנגלית.
      return null;
  }
}
