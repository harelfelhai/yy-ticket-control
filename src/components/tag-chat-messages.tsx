import { he } from "@/lib/he";
import { type MediaView, toMediaView } from "@/lib/media-view";
import type { TagMessage } from "@/lib/services/tags";
import { toThreadMessageView } from "@/lib/thread-view";
import { ThreadBubble } from "./thread-bubble";

interface TagChatMessagesProps {
  messages: TagMessage[];
  /** טוקן הנמען, כשהצופה הוא קבלן בפורטל — נכנס לכתובות המדיה */
  token?: string;
}

/**
 * הודעות צ׳אט התגית, בצורה אחת המשמשת גם את המסך הפנימי וגם את הפורטל.
 *
 * מוצג כרכיב שרת: אין כאן אינטראקציה, רק הצגה. שיתוף אותו רכיב בין שני
 * הצדדים מבטיח שהקבלן והמנהל רואים בדיוק את אותו שרשור — וזו כל מטרת
 * הצ׳אט הקבוצתי.
 *
 * מ-0.3 הרכיב הוא **עטיפה דקה מעל `ThreadBubble`** ואינו מרנדר הודעה בעצמו:
 * שני "רכיבים משותפים" מתחרים היו מייצרים בדיוק את הסחיפה שהאיחוד נועד
 * לעצור. מה שנשאר כאן ייחודי לתגית הוא אירועי הגישה (`TAG_GRANTED`).
 */
export function TagChatMessages({ messages, token }: TagChatMessagesProps) {
  if (messages.length === 0) {
    return <p className="text-sm text-muted">{he.tag.chatEmpty}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {messages.map((message) => {
        if (message.kind === "EVENT") {
          return (
            <li key={message.id} className="text-center text-xs text-muted">
              {tagEventText(message.eventType, message.eventMeta)}
            </li>
          );
        }

        const media: MediaView[] = message.media.map((file) => toMediaView(file, token));

        return (
          <li key={message.id} className="flex flex-col">
            <ThreadBubble message={toThreadMessageView(message, media)} />
          </li>
        );
      })}
    </ul>
  );
}

/** נוסח אירוע הפתיחה/ביטול בצ׳אט. ה-meta נשמר כמחרוזות בלבד בעת הכתיבה. */
function tagEventText(eventType: string | null, meta: unknown): string {
  const names = readMeta(meta, "names");
  const name = readMeta(meta, "name");
  if (eventType === "TAG_GRANTED") return he.tag.eventGranted(names);
  if (eventType === "TAG_REVOKED") return he.tag.eventRevoked(name);
  return "";
}

function readMeta(meta: unknown, key: string): string {
  if (meta && typeof meta === "object" && key in meta) {
    const value = (meta as Record<string, unknown>)[key];
    return typeof value === "string" ? value : "";
  }
  return "";
}
