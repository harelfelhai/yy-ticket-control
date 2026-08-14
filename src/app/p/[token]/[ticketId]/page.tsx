import Link from "next/link";
import { AssignmentStatusChip } from "@/components/status-chip";
import { ThreadBubble, ThreadDaySeparator } from "@/components/thread-bubble";
import { he } from "@/lib/he";
import { toMediaView } from "@/lib/media-view";
import { getPortalTicket, markViewed, resolveToken } from "@/lib/services/portal";
import { buildThreadItems } from "@/lib/thread-items";
import { type ThreadMessageView, toThreadMessageView } from "@/lib/thread-view";
import { ExpiredLink } from "../expired-link";
import { PortalActions } from "./portal-actions";
import { CONTENT_WIDTH, TITLE_IDENTIFYING } from "@/lib/ui";
import { cardClasses } from "@/components/ui/card";

/**
 * מסך הפנייה בפורטל הנמען.
 *
 * הנמען רואה את **כל השרשור**, כולל מה שנכתב לפני שצורף: בלי ההקשר הוא
 * מגיע לשטח בלי לדעת מה כבר נבדק ומה כבר נוסה.
 *
 * הפתיחה מסמנת "נצפה" אוטומטית — זו הדרך היחידה שהמנהל יודע שהקישור הגיע
 * ליעדו, בלי לדרוש מהקבלן פעולה נוספת.
 */
export default async function PortalTicketPage(props: PageProps<"/p/[token]/[ticketId]">) {
  const { token, ticketId } = await props.params;

  const identity = await resolveToken(token);
  if (!identity) return <ExpiredLink />;

  const result = await getPortalTicket(identity.professionalId, ticketId);
  // אותה תשובה לפנייה שאינה קיימת ולפנייה שהקבלן הוסר ממנה: אין סיבה
  // לאפשר לו לגלות אילו פניות קיימות במערכת.
  if (!result) return <ExpiredLink />;

  const { ticket, assignment } = result;
  await markViewed(assignment.id);

  const now = new Date();

  /**
   * ‏`own` הוא תמיד `false` כאן, ובכוונה: `getPortalTicket` בוחר `{name}`
   * בלבד ואינו שולף את מזהה הכותב. הקבלן רואה שרשור אחיד — הוא צד אחד
   * מול המערכת, ולא משתתף בשיחה רב-משתתפים שבה יש "שלי" ו"שלהם".
   */
  const opening: ThreadMessageView | null =
    ticket.description.trim().length > 0
      ? {
          id: `opening-${ticket.id}`,
          authorName: ticket.createdBy.name,
          own: false,
          text: ticket.description,
          media: [],
          createdAt: ticket.createdAt,
        }
      : null;

  const threadItems = buildThreadItems({
    opening,
    messages: ticket.messages
      // אירועי מערכת אינם מוצגים לנמען: "שויך לפנייה" ו"הוסר מהפנייה" הם
      // מידע ניהולי פנימי שאינו נוגע לעבודה שלו.
      .filter((message) => message.kind !== "EVENT")
      .map((message) => ({
        id: message.id,
        kind: message.kind,
        eventType: message.eventType,
        eventMeta: message.eventMeta,
        createdAt: message.createdAt,
        // הטוקן נכנס לכתובת: לפורטל אין עוגיית סשן, ובלעדיו ה-route
        // שמגיש את הקובץ אינו יודע מי מבקש.
        view: toThreadMessageView(
          message,
          message.media.map((file) => toMediaView(file, token)),
        ),
      })),
    now,
    labels: { today: he.ticket.today, yesterday: he.ticket.yesterday },
  });

  return (
    <main className={`flex flex-col gap-4 p-4 ${CONTENT_WIDTH}`}>
      <Link href={`/p/${token}`} className="text-sm font-medium text-brand">
        ← {he.portal.back}
      </Link>

      <header className={cardClasses("flex flex-col gap-2")}>
        {/* אותה שורת כותרת כמו במסך הפנייה הפנימי: תג הסטטוס צמוד לכותרת ולא
            נדחף לקצה. קבלן שרואה ממשק אחר מזה של המנהל חושד בו. */}
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className={TITLE_IDENTIFYING}>
              {he.ticket.location(ticket.building?.name, ticket.apartment?.number)}
            </h1>
            <AssignmentStatusChip status={assignment.status} />
          </div>
          <p className="text-sm text-muted">
            {ticket.domain?.name}
            {ticket.room ? ` · ${he.room[ticket.room]}` : ""}
          </p>
        </div>
      </header>

      {/*
       * אותה בועה בדיוק כמו במסך הפנימי (אפיון §2.3: "לשני הצדדים אותה שפה
       * ויזואלית — קבלן שרואה ממשק זר חושד בו"). לפני האיחוד היו כאן
       * ‏`rounded-xl` מול `rounded-lg` בפנימי, בלי חותמת זמן ובלי מפריד יום.
       *
       * תיאור הפנייה הוא ההודעה הראשונה גם כאן, ולא פסקה בכותרת.
       */}
      <section aria-label={he.ticket.thread} className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          {threadItems.map((item) =>
            item.kind === "day" ? (
              <ThreadDaySeparator key={item.key} label={item.label} />
            ) : item.kind === "message" ? (
              <li key={item.key} className="flex flex-col">
                <ThreadBubble message={item.message} />
              </li>
            ) : null,
          )}
        </ul>
      </section>

      <PortalActions
        token={token}
        ticketId={ticket.id}
        status={assignment.status}
        isClosed={ticket.closedAt !== null}
        openerName={ticket.createdBy.name}
      />
    </main>
  );
}
