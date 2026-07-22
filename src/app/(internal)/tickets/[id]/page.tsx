import { notFound } from "next/navigation";
import { AssignmentStatusChip, TicketStatusChip } from "@/components/status-chip";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { canViewTicket } from "@/lib/permissions";
import { toViewer } from "@/lib/session";
import { getTicketDetail, recipientName } from "@/lib/services/tickets";
import { deriveTicketStatus, reasonText } from "@/lib/ticket-status";

/**
 * מסך הפנייה והשרשור (מסך 2 באפיון) — ליבת המערכת.
 *
 * הרצועה המרכזית היא **סטטוס אישי לכל נמען**: זו התשובה לשאלה שהמנהל שואל
 * בפועל, "מי כבר טיפל ומי לא". סטטוס יחיד ברמת הפנייה היה מסתיר בדיוק את
 * המידע הזה ברגע שהראשון מסמן "טופל".
 *
 * פעולות (סגירה, פתיחה מחדש, תגובה, עריכת נמענים) נכנסות בשלב הבא.
 */
export default async function TicketPage(props: PageProps<"/tickets/[id]">) {
  const { id } = await props.params;
  const user = await requireUser();

  const ticket = await getTicketDetail(id);
  if (!ticket) notFound();

  if (!canViewTicket(toViewer(user), ticket, ticket.assignments)) notFound();

  const assignmentViews = ticket.assignments.map((a) => ({
    status: a.status,
    recipientName: recipientName(a),
  }));
  const status = deriveTicketStatus(ticket, assignmentViews);
  const reason = reasonText(
    { ...ticket, handlerName: ticket.handler?.name ?? null },
    assignmentViews,
    new Date(),
  );

  const location = [ticket.building?.name, ticket.apartment && `${he.directory.apartment} ${ticket.apartment.number}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold">{location || he.ticket.noLocation}</h1>
            <p className="text-sm text-muted">
              {ticket.domain?.name ?? he.ticket.noDomain}
              {ticket.room ? ` · ${he.room[ticket.room]}` : ""}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <TicketStatusChip status={status} />
            <span className="text-xs text-muted" dir="ltr">
              #{ticket.seq}
            </span>
          </div>
        </div>

        <p className="text-sm text-muted">{reason}</p>

        {ticket.description ? <p className="whitespace-pre-wrap">{ticket.description}</p> : null}

        <p className="text-xs text-muted">
          {he.ticket.openedBy}: {ticket.createdBy.name} · {he.channel[ticket.channel]}
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold">{he.ticket.recipients}</h2>
        {ticket.assignments.length === 0 ? (
          <p className="text-sm text-muted">{he.reason.noRecipients}</p>
        ) : (
          <ul aria-label={he.ticket.recipients} className="flex flex-col gap-2">
            {ticket.assignments.map((assignment) => (
              <li key={assignment.id} className="flex items-center justify-between gap-2">
                <span className={assignment.status === "REMOVED" ? "text-muted" : ""}>
                  {recipientName(assignment)}
                </span>
                <AssignmentStatusChip status={assignment.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold">{he.ticket.thread}</h2>
        {ticket.messages.length === 0 ? (
          <p className="text-sm text-muted">{he.ticket.threadEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {ticket.messages.map((message) => {
              // אירוע מערכת מוצג כשורה נייטרלית ולא כהודעה, כדי שהעין תבחין
              // מיד בין "מה קרה לפנייה" לבין "מה מישהו כתב".
              if (message.kind === "EVENT") {
                const meta = message.eventMeta as { recipientName?: string } | null;
                return (
                  <li key={message.id} className="text-sm text-muted">
                    {he.event.assigned(meta?.recipientName ?? "")}
                  </li>
                );
              }

              const author = message.authorUser?.name ?? message.authorProfessional?.name ?? "";
              return (
                <li key={message.id} className="rounded-xl bg-bg p-3">
                  <p className="text-xs font-medium text-muted">{author}</p>
                  <p className="whitespace-pre-wrap">{message.text}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
