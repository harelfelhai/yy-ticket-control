import { notFound } from "next/navigation";
import { TicketStatusChip } from "@/components/status-chip";
import { ThreadBubble, ThreadDaySeparator } from "@/components/thread-bubble";
import { toMediaView } from "@/lib/media-view";
import { buildThreadItems } from "@/lib/thread-items";
import { type ThreadMessageView, toThreadMessageView } from "@/lib/thread-view";
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
import { CONTENT_WIDTH, TITLE_DESCRIPTIVE, TITLE_IDENTIFYING } from "@/lib/ui";
import { DeleteTicket } from "./delete-ticket";
import { DraftCompletion } from "./draft-completion";
import { RecipientEditor } from "./recipient-editor";
import { ResidentName } from "./resident-name";
import { TicketActions } from "./ticket-actions";
import { TicketTags } from "./ticket-tags";
import { ThreadEvent } from "./thread-event";
import { cardClasses } from "@/components/ui/card";
import { chipClasses } from "@/components/ui/chip";

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

  const location = he.ticket.location(ticket.building?.name, ticket.apartment?.number);

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const ageDays = Math.floor((now.getTime() - ticket.createdAt.getTime()) / MS_PER_DAY);

  /**
   * פריטי השרשור: הודעות, אירועי מערכת, ומפרידי יום ביניהם.
   *
   * **תיאור הפנייה הוא ההודעה הראשונה** (אפיון §7 שורה 26) — מאת מי שפתח,
   * בזמן הפתיחה. הוא אינו תכונה של הפנייה אלא ההודעה שפתחה את השיחה, וזה
   * גם מה שמונע ממנו להופיע פעמיים: הוא ירד מהמטא-דאטה ואינו מוצג בפאנל.
   *
   * המדיה ההתחלתית כבר יושבת בשרשור כהודעת MEDIA נפרדת (`attachInitialMedia`),
   * ולכן הבועה הזו נושאת טקסט בלבד.
   */
  const openingMessage: ThreadMessageView | null =
    ticket.description.trim().length > 0
      ? {
          id: `opening-${ticket.id}`,
          authorName: ticket.createdBy.name,
          own: ticket.createdById === user.id,
          text: ticket.description,
          media: [],
          createdAt: ticket.createdAt,
        }
      : null;

  const threadItems = buildThreadItems({
    opening: openingMessage,
    messages: ticket.messages.map((message) => ({
      id: message.id,
      kind: message.kind,
      eventType: message.eventType,
      eventMeta: message.eventMeta,
      createdAt: message.createdAt,
      view: toThreadMessageView(
        message,
        message.media.map((file) => toMediaView(file)),
        { userId: user.id },
      ),
    })),
    now,
    labels: { today: he.ticket.today, yesterday: he.ticket.yesterday },
  });

  return (
    <div className={`flex flex-col gap-4 p-4 ${CONTENT_WIDTH}`}>
      {/*
       * פס עליון קבוע (אפיון מסך 2 אזור א׳, הכרעת 0.3).
       *
       * מחזיק את מה שצריך להיות גלוי **בלי לגלול ובלי לפתוח**: איפה, באיזה
       * מצב, ולמה. שאר המטא-דאטה יורדת לפאנל "פרטים" מתחתיו.
       *
       * ‏`top-14` תלוי ב-`h-14` של סרגל הניווט; `-mx-4 px-4` מותח את הרצועה
       * לקצה המסך, אחרת התוכן הגולל זולג בצדדים. ראו DESIGN.md § אלמנט דביק.
       */}
      <header className="sticky top-14 z-[1] -mx-4 flex flex-col gap-1 border-b border-border bg-bg px-4 py-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className={TITLE_IDENTIFYING}>{location || he.ticket.noLocation}</h1>
          <TicketStatusChip status={status} />
          <span className="text-xs text-muted" dir="ltr">
            #{ticket.seq}
          </span>
          {/* "נפתחה מחדש" אינו סטטוס אלא תג — הפנייה מתנהגת לפי הכללים הרגילים */}
          {ticket.reopenCount > 0 ? (
            <span className={chipClasses("warning")}>{he.ticket.reopenedBadge}</span>
          ) : null}
        </div>
        <p className="text-sm text-muted">
          {ticket.domain?.name ?? he.ticket.noDomain}
          {ticket.room ? ` · ${he.room[ticket.room]}` : ""}
        </p>
        {/*
         * שורת הסיבה נשארת גלויה תמיד ואינה נכנסת לפאנל: בלעדיה פנייה קופצת
         * בין קבוצות הלוח בלי הסבר, וזה שוחק את האמון במיון (אפיון §5.ב).
         * אותו עיצוב כמו בכרטיס הלוח — זה אותו מידע בדיוק.
         */}
        <p className={`text-sm font-medium ${status === "DRAFT" ? "text-danger" : "text-brand"}`}>
          {reason}
        </p>
      </header>

      {/*
       * פאנל "פרטים" (אפיון מסך 2 אזור ב׳).
       *
       * ‏`<details>` נייטיב ולא רכיב לקוח: עובד בלי JavaScript, נשאר מרונדר
       * בשרת, ואינו הופך את העמוד לעמוד לקוח רק כדי לקפל אזור.
       *
       * ‏`open` בטיוטה מגיע **מהשרת** ולא מ-`useEffect`: הצביעה הראשונה
       * הייתה מסתירה את `DraftCompletion` ואז חושפת אותו, והבדיקות היו
       * מהבהבות. בטיוטה הפאנל מחזיק בדיוק את מה שחסר לשיגור.
       */}
      <details open={ticket.isDraft} className={cardClasses("flex flex-col gap-3")}>
        <summary className={`flex min-h-11 cursor-pointer items-center ${TITLE_DESCRIPTIVE}`}>
          {he.ticket.detailsPanel}
        </summary>

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

        <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>
            {he.ticket.openedBy}: {ticket.createdBy.name}
          </span>
          <span>· {he.channel[ticket.channel]}</span>
          <span>· {he.board.ageDays(ageDays)}</span>
          {ticket.handler ? <span>· {he.ticket.handledBy(ticket.handler.name)}</span> : null}
        </p>

        {ticket.isDraft ? (
        canEdit && draftDirectory ? (
          <DraftCompletion
            // key יציב: מונע re-mount של הרכיב (ואיפוס המצב המקומי — למשל
            // נמען שנוצר תוך כדי השלמה) כשהעמוד מתרנדר מחדש אחרי Server Action.
            key={ticket.id}
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
          <p className={cardClasses("text-sm font-semibold text-danger", { tone: "danger" })}>
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

        {/* מחיקה — למנהל מערכת בלבד, בתחתית הפאנל והרחק מפעולות היום-יום.
            בטיוטה המחיקה נעשית דרך "מחק טיוטה" במסך ההשלמה, לא כאן. */}
        {!ticket.isDraft && canDeleteTicket(viewer) ? <DeleteTicket ticketId={ticket.id} /> : null}
      </details>

      {/*
       * השרשור — גוף המסך (אפיון מסך 2 אזור ג׳).
       *
       * ‏`aria-label` ולא כותרת גלויה: 29 אתרי קריאה בחבילות הבדיקה משתמשים
       * בשם "שרשור" כעוגן "הניווט למסך הפנייה הסתיים", והם הועברו לעוגן
       * האזור בקומיט נפרד בעודו חופף לכותרת. כאן הכותרת הגלויה יורדת —
       * השרשור אינו עוד אזור אחד מבין כמה, ולכן אינו זקוק לשלט.
       */}
      <section aria-label={he.ticket.thread} className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          {threadItems.map((item) =>
            item.kind === "day" ? (
              <ThreadDaySeparator key={item.key} label={item.label} />
            ) : item.kind === "event" ? (
              <li key={item.key}>
                <ThreadEvent eventType={item.eventType} meta={item.meta} />
              </li>
            ) : (
              <li key={item.key} className="flex flex-col">
                <ThreadBubble message={item.message} />
              </li>
            ),
          )}
        </ul>
      </section>

      {/*
       * פעולות הפנייה והקומפוזר, צמודים לתחתית (אפיון מסך 2 אזור ד׳).
       *
       * **הפעולות מחוץ לפאנל בכוונה.** תוכן של `<details>` סגור מוסר מעץ
       * הנגישות, ולכן פעולה שנכנסת לשם אינה נגישה למקלדת, לקורא מסך ולבדיקה
       * — וסגירת פנייה היא התוצאה של המסך, לא פרט מנהלי.
       */}
      <TicketActions
        ticketId={ticket.id}
        isClosed={ticket.closedAt !== null}
        // טיוטה אינה נסגרת — משגרים אותה או מוחקים דרך מסך ההשלמה.
        canClose={canCloseTicket(viewer, ticket) && !ticket.isDraft}
        canComment={canCommentOnTicket(viewer, ticket, ticket.assignments)}
        canSetHandler={canSetHandler(viewer, ticket, ticket.assignments)}
        hasHandler={ticket.handlerId !== null}
      />
    </div>
  );
}
