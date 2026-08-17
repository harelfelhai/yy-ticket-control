import { TagChatMessages } from "yy-ticket-control";

/**
 * הודעות צ׳אט התגית, בצורה אחת המשמשת גם את המסך הפנימי וגם את פורטל
 * הקבלן. מ-0.3 זו עטיפה דקה מעל `ThreadBubble` — שני "רכיבים משותפים"
 * מתחרים היו מייצרים בדיוק את הסחיפה שהאיחוד נועד לעצור.
 *
 * ייחודי לתגית הם אירועי הגישה (`TAG_GRANTED` / `TAG_REVOKED`), שמוצגים
 * כשורת מרכז ולא כבועה — הם אינם דברי אדם.
 */

const msg = (
  id: string,
  name: string,
  text: string,
  createdAt: string,
  fromProfessional = true,
) => ({
  id,
  kind: "MESSAGE",
  text,
  createdAt: new Date(createdAt),
  eventType: null,
  eventMeta: null,
  media: [],
  authorUser: fromProfessional ? null : { name },
  authorProfessional: fromProfessional ? { name } : null,
});

/** שיחה בתגית, עם אירוע פתיחת גישה בראשה. */
export function Conversation() {
  return (
    <div className="max-w-md">
      <TagChatMessages
        messages={[
          {
            id: "e1",
            kind: "EVENT",
            text: null,
            createdAt: new Date("2026-08-14T07:00:00Z"),
            eventType: "TAG_GRANTED",
            eventMeta: { names: "מוסא דיאב, אבי כהן" },
            media: [],
            authorUser: null,
            authorProfessional: null,
          },
          msg("1", "יוסי — מנהל עבודה", "פתחתי תגית לשיפוץ לובי הכניסה. כל מי שמעורב כאן.", "2026-08-14T07:05:00Z", false),
          msg("2", "מוסא דיאב", "אני מגיע ביום ראשון לפרק את הצנרת הישנה.", "2026-08-14T08:20:00Z"),
          msg("3", "אבי כהן", "אחריו אני מעביר את הכבילה. צריך יום שלם.", "2026-08-14T09:02:00Z"),
        ]}
      />
    </div>
  );
}

/** ריק — לפני שנכתבה הודעה ראשונה. */
export function EmptyThread() {
  return (
    <div className="max-w-md">
      <TagChatMessages messages={[]} />
    </div>
  );
}

/** ביטול גישה — אירוע, לא בועה. */
export function WithRevokeEvent() {
  return (
    <div className="max-w-md">
      <TagChatMessages
        messages={[
          msg("4", "מוסא דיאב", "סיימתי את החלק שלי.", "2026-08-16T14:00:00Z"),
          {
            id: "e2",
            kind: "EVENT",
            text: null,
            createdAt: new Date("2026-08-16T15:00:00Z"),
            eventType: "TAG_REVOKED",
            eventMeta: { name: "מוסא דיאב" },
            media: [],
            authorUser: null,
            authorProfessional: null,
          },
        ]}
      />
    </div>
  );
}
