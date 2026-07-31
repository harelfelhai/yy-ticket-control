import Link from "next/link";
import { TagChatMessages } from "@/components/tag-chat-messages";
import { he } from "@/lib/he";
import { resolveToken } from "@/lib/services/portal";
import { getPortalTagChat } from "@/lib/services/tags";
import { ExpiredLink } from "../../expired-link";
import { PortalTagChatBox } from "./portal-tag-chat-box";
import { TITLE_IDENTIFYING } from "@/lib/ui";
import { cardClasses } from "@/components/ui/card";

/**
 * צ׳אט קבוצתי בפורטל הקבלן.
 *
 * זהו כל מה שהקבלן רואה מהתגית — **הצ׳אט בלבד, לעולם לא הפניות** (אפיון
 * §5.ה). `getPortalTagChat` אינו יודע כלל לשלוף פניות, ולכן ההפרדה אינה
 * תלויה בכך שהמסך יזכור לא להציג אותן.
 */
export default async function PortalTagPage(props: PageProps<"/p/[token]/tag/[tagId]">) {
  const { token, tagId } = await props.params;

  const identity = await resolveToken(token);
  if (!identity) return <ExpiredLink />;

  const chat = await getPortalTagChat(identity.professionalId, tagId);
  // אותה תשובה לתגית שאינה קיימת ולתגית שלא נפתחה לו: אין סיבה לאפשר לו
  // לגלות אילו תגיות קיימות במערכת.
  if (!chat) return <ExpiredLink />;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <Link href={`/p/${token}`} className="text-sm font-medium text-brand">
        ← {he.portal.back}
      </Link>

      <header>
        <h1 className={TITLE_IDENTIFYING}>{chat.tag.name}</h1>
        <p className="text-sm text-muted">{he.portal.groupChatsTitle}</p>
      </header>

      <section className={cardClasses("flex flex-col gap-3")}>
        <TagChatMessages messages={chat.messages} token={token} />
        <PortalTagChatBox token={token} tagId={tagId} />
      </section>
    </div>
  );
}
