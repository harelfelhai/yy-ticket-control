import { notFound } from "next/navigation";
import { TicketStatusChip } from "@/components/status-chip";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import {
  canCloseTicket,
  canCommentOnTicket,
  canEditAssignments,
  canSetHandler,
  canViewTicket,
} from "@/lib/permissions";
import { toViewer } from "@/lib/session";
import { getTicketDetail, recipientName } from "@/lib/services/tickets";
import { deriveTicketStatus, reasonText } from "@/lib/ticket-status";
import { RecipientEditor } from "./recipient-editor";
import { TicketActions } from "./ticket-actions";
import { ThreadEvent } from "./thread-event";

/**
 * מסך הפנייה והשרשור (מסך 2 באפיון) — ליבת המערכת.
 *
 * הרצועה המרכזית היא **סטטוס אישי לכל נמען**: זו התשובה לשאלה שהמנהל שואל
 * בפועל, "מי כבר טיפל ומי לא". סטטוס יחיד ברמת הפנייה היה מסתיר בדיוק את
 * המידע הזה ברגע שהראשון מסמן "טופל".
 */
export default async function TicketPage(props: PageProps<"/tickets/[id]">) {
  const { id } = await props.params;
  const user = await requireUser();
  const viewer = toViewer(user);

  const ticket = await getTicketDetail(id);
  if (!ticket) notFound();
  if (!canViewTicket(viewer, ticket, ticket.assignments)) notFound();

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

  const canEdit = canEditAssignments(viewer, ticket);
  const alreadyAssigned = new Set(
    ticket.assignments
      .filter((a) => a.status !== "REMOVED")
      .map((a) => a.professionalId ?? a.userId),
  );

  // רשימת המועמדים נטענת רק כשמותר לערוך — אין טעם לשלוף עשרות אנשי מקצוע
  // כדי להציג אותם למי שאינו רשאי לשייך.
  const available = canEdit
    ? [
        ...(await db.professional.findMany({ orderBy: { name: "asc" } }))
          .filter((p) => !alreadyAssigned.has(p.id))
          .map((p) => ({
            id: p.id,
            label: p.name,
            hint: p.phone ?? p.email ?? undefined,
            kind: "professional" as const,
          })),
        ...(
          await db.user.findMany({
            where: { active: true, OR: [{ siteId: ticket.siteId }, { siteId: null }] },
            orderBy: { name: "asc" },
          })
        )
          .filter((u) => !alreadyAssigned.has(u.id))
          .map((u) => ({
            id: u.id,
            label: u.name,
            hint: he.role[u.role],
            kind: "user" as const,
          })),
      ]
    : [];

  const location = [
    ticket.building?.name,
    ticket.apartment && `${he.directory.apartment} ${ticket.apartment.number}`,
  ]
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

        <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>
            {he.ticket.openedBy}: {ticket.createdBy.name}
          </span>
          <span>· {he.channel[ticket.channel]}</span>
          {ticket.handler ? <span>· {he.ticket.handledBy(ticket.handler.name)}</span> : null}
          {/* "נפתחה מחדש" אינו סטטוס אלא תג — הפנייה מתנהגת לפי הכללים הרגילים */}
          {ticket.reopenCount > 0 ? (
            <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-warning">
              {he.ticket.reopenedBadge}
            </span>
          ) : null}
        </p>
      </header>

      <RecipientEditor
        ticketId={ticket.id}
        assignments={ticket.assignments.map((a) => ({
          id: a.id,
          name: recipientName(a),
          status: a.status,
          professionalId: a.professionalId,
        }))}
        available={available}
        canEdit={canEdit}
      />

      <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold">{he.ticket.thread}</h2>
        {ticket.messages.length === 0 ? (
          <p className="text-sm text-muted">{he.ticket.threadEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {ticket.messages.map((message) => {
              if (message.kind === "EVENT") {
                return (
                  <li key={message.id}>
                    <ThreadEvent eventType={message.eventType} meta={message.eventMeta} />
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

      <TicketActions
        ticketId={ticket.id}
        isClosed={ticket.closedAt !== null}
        canClose={canCloseTicket(viewer, ticket)}
        canComment={canCommentOnTicket(viewer, ticket, ticket.assignments)}
        canSetHandler={canSetHandler(viewer, ticket, ticket.assignments)}
        hasHandler={ticket.handlerId !== null}
      />
    </div>
  );
}
