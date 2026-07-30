import Link from "next/link";
import { MediaAttachments } from "@/components/media-attachments";
import { AssignmentStatusChip } from "@/components/status-chip";
import { he } from "@/lib/he";
import { toMediaView } from "@/lib/media-view";
import { getPortalTicket, markViewed, resolveToken } from "@/lib/services/portal";
import { ExpiredLink } from "../expired-link";
import { PortalActions } from "./portal-actions";

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

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <Link href={`/p/${token}`} className="text-sm font-medium text-brand">
        ← {he.portal.back}
      </Link>

      <header className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
        {/* אותה שורת כותרת כמו במסך הפנייה הפנימי: תג הסטטוס צמוד לכותרת ולא
            נדחף לקצה. קבלן שרואה ממשק אחר מזה של המנהל חושד בו. */}
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="text-2xl font-bold">
              {ticket.building?.name} · {he.directory.apartment} {ticket.apartment?.number}
            </h1>
            <AssignmentStatusChip status={assignment.status} />
          </div>
          <p className="text-sm text-muted">
            {ticket.domain?.name}
            {ticket.room ? ` · ${he.room[ticket.room]}` : ""}
          </p>
        </div>
        {ticket.description ? <p className="whitespace-pre-wrap">{ticket.description}</p> : null}
      </header>

      <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold">{he.ticket.thread}</h2>
        {ticket.messages.filter((m) => m.kind !== "EVENT").length === 0 ? (
          <p className="text-sm text-muted">{he.ticket.threadEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {ticket.messages
              // אירועי מערכת אינם מוצגים לנמען: "שויך לפנייה" ו"הוסר
              // מהפנייה" הם מידע ניהולי פנימי שאינו נוגע לעבודה שלו.
              .filter((message) => message.kind !== "EVENT")
              .map((message) => (
                <li key={message.id} className="rounded-xl bg-bg p-3">
                  <p className="text-xs font-medium text-muted">
                    {message.authorUser?.name ?? message.authorProfessional?.name ?? ""}
                  </p>
                  {message.text ? <p className="whitespace-pre-wrap">{message.text}</p> : null}
                  {/* הטוקן נכנס לכתובת: לפורטל אין עוגיית סשן, ובלעדיו
                      ה-route שמגיש את הקובץ אינו יודע מי מבקש. */}
                  <MediaAttachments
                    media={message.media.map((file) => toMediaView(file, token))}
                  />
                </li>
              ))}
          </ul>
        )}
      </section>

      <PortalActions
        token={token}
        ticketId={ticket.id}
        status={assignment.status}
        isClosed={ticket.closedAt !== null}
        openerName={ticket.createdBy.name}
      />
    </div>
  );
}
