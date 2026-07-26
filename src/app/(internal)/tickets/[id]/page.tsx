import { notFound } from "next/navigation";
import { MediaAttachments } from "@/components/media-attachments";
import { TicketStatusChip } from "@/components/status-chip";
import { toMediaView } from "@/lib/media-view";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import {
  canCloseTicket,
  canCommentOnTicket,
  canDeleteTicket,
  canEditAssignments,
  canSetHandler,
  canViewTicket,
} from "@/lib/permissions";
import { toViewer } from "@/lib/session";
import { describeDelivery } from "@/lib/services/delivery";
import { listSiteDirectory } from "@/lib/services/directory";
import { listTags, listTicketTags } from "@/lib/services/tags";
import { getTicketDetail, recipientName } from "@/lib/services/tickets";
import { canTagTicket } from "@/lib/permissions";
import { deriveTicketStatus, reasonText } from "@/lib/ticket-status";
import { DeleteTicket } from "./delete-ticket";
import { DraftCompletion } from "./draft-completion";
import { RecipientEditor } from "./recipient-editor";
import { ResidentName } from "./resident-name";
import { TicketActions } from "./ticket-actions";
import { TicketTags } from "./ticket-tags";
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
  const now = new Date();
  const reason = reasonText(
    { ...ticket, handlerName: ticket.handler?.name ?? null },
    assignmentViews,
    now,
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

  // טיוטה: הרשימות הנלמדות ונמעני הטיוטה השמורים, כדי שמסך ההשלמה יציג את
  // השדות החסרים ויאפשר לשגר. נטענים רק כשמדובר בטיוטה שהצופה רשאי לערוך.
  const draftDirectory = ticket.isDraft && canEdit ? await listSiteDirectory(ticket.siteId) : null;
  const draftRecipientOptions = ticket.isDraft
    ? (
        (ticket.draftRecipients as { kind: "professional" | "user"; id: string }[] | null) ?? []
      )
        .map((ref) => available.find((o) => o.id === ref.id && o.kind === ref.kind))
        .filter((o): o is (typeof available)[number] => o !== undefined)
    : [];

  // מצב השליחה נטען במקביל לכל הנמענים: לכל אחד יש שאילתה משלו לקישור,
  // וסדרה טורית של חמש שאילתות מורגשת ברשת סלולרית באתר בנייה.
  // הדגל האחרון (canEdit) קובע אם קישור הקסם ייכלל: הוא סוד גישה, וצופה
  // שאינו רשאי לערוך נמענים אינו אמור לקבלו — גם לא בתוך ה-payload.
  const assignmentRows = await Promise.all(
    ticket.assignments.map(async (a) => ({
      id: a.id,
      name: recipientName(a),
      status: a.status,
      professionalId: a.professionalId,
      ...(await describeDelivery(ticket, a, canEdit)),
    })),
  );

  const canTag = canTagTicket(viewer, ticket);
  // רשימת כל התגיות נטענת רק כשמותר לתייג — למי שרואה בלבד די בתגיות הפנייה.
  const [ticketTags, allTags] = await Promise.all([
    listTicketTags(ticket.id),
    canTag ? listTags() : Promise.resolve([]),
  ]);

  const location = [
    ticket.building?.name,
    ticket.apartment && `${he.directory.apartment} ${ticket.apartment.number}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const ageDays = Math.floor((now.getTime() - ticket.createdAt.getTime()) / MS_PER_DAY);

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
            {/* שם הדייר — מקושר לדירה. מוצג רק כשיש דירה לשייך אליה. */}
            {ticket.apartmentId ? (
              <p className="text-sm text-muted">
                <ResidentName
                  ticketId={ticket.id}
                  initial={ticket.apartment?.residentName ?? null}
                  canEdit={canEdit}
                />
              </p>
            ) : null}
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
          <span>· {he.board.ageDays(ageDays)}</span>
          {ticket.handler ? <span>· {he.ticket.handledBy(ticket.handler.name)}</span> : null}
          {/* "נפתחה מחדש" אינו סטטוס אלא תג — הפנייה מתנהגת לפי הכללים הרגילים */}
          {ticket.reopenCount > 0 ? (
            <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-warning">
              {he.ticket.reopenedBadge}
            </span>
          ) : null}
        </p>
      </header>

      {ticket.isDraft ? (
        canEdit && draftDirectory ? (
          <DraftCompletion
            ticketId={ticket.id}
            siteId={ticket.siteId}
            buildings={draftDirectory.buildings.map((b) => ({
              id: b.id,
              label: b.name,
              apartments: b.apartments.map((a) => ({ id: a.id, label: a.number })),
            }))}
            domains={draftDirectory.domains.map((d) => ({ id: d.id, label: d.name }))}
            recipientOptions={available}
            initial={{
              buildingId: ticket.buildingId,
              apartmentId: ticket.apartmentId,
              domainId: ticket.domainId,
              recipients: draftRecipientOptions,
            }}
            missing={{
              building: !ticket.buildingId,
              apartment: !ticket.apartmentId,
              domain: !ticket.domainId,
              description: ticket.description.trim().length === 0,
              recipients: draftRecipientOptions.length === 0,
            }}
          />
        ) : (
          // בעלים שאינו הפותח רואה טיוטה אך אינו רשאי להשלים אותה.
          <p className="rounded-2xl border border-danger bg-danger/5 p-4 text-sm font-semibold text-danger">
            {he.notices.draftBanner}
          </p>
        )
      ) : (
        <RecipientEditor
          ticketId={ticket.id}
          siteId={ticket.siteId}
          assignments={assignmentRows}
          available={available}
          canEdit={canEdit}
        />
      )}

      <TicketTags
        ticketId={ticket.id}
        initial={ticketTags.map((t) => ({ id: t.id, label: t.name }))}
        all={allTags.map((t) => ({ id: t.id, label: t.name }))}
        canEdit={canTag}
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
                  {message.text ? <p className="whitespace-pre-wrap">{message.text}</p> : null}
                  <MediaAttachments media={message.media.map((file) => toMediaView(file))} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <TicketActions
        ticketId={ticket.id}
        isClosed={ticket.closedAt !== null}
        // טיוטה אינה נסגרת — משגרים אותה או מוחקים דרך מסך ההשלמה.
        canClose={canCloseTicket(viewer, ticket) && !ticket.isDraft}
        canComment={canCommentOnTicket(viewer, ticket, ticket.assignments)}
        canSetHandler={canSetHandler(viewer, ticket, ticket.assignments)}
        hasHandler={ticket.handlerId !== null}
      />

      {/* מחיקה — למנהל מערכת בלבד, בתחתית המסך והרחק מפעולות היום-יום.
          בטיוטה המחיקה נעשית דרך "מחק טיוטה" במסך ההשלמה, לא כאן. */}
      {!ticket.isDraft && canDeleteTicket(viewer) ? <DeleteTicket ticketId={ticket.id} /> : null}
    </div>
  );
}
