import Link from "next/link";
import { notFound } from "next/navigation";
import { TagChatMessages } from "@/components/tag-chat-messages";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import { getTagDetail } from "@/lib/services/tags";
import { TagAccessControl } from "./tag-access-control";
import { TagChatBox } from "./tag-chat-box";
import { TITLE_DESCRIPTIVE, TITLE_IDENTIFYING } from "@/lib/ui";
import { cardClasses } from "@/components/ui/card";
import { chipClasses } from "@/components/ui/chip";

/**
 * מסך התגית (מסך 6): צ׳אט קבוצתי לצד רשימת הפניות שבתגית ומונה פתוחות/סגורות.
 *
 * הכול כאן גלוי למנהלים בלבד — המסך תחת `(internal)`, שאיש חיצוני אינו
 * מגיע אליו. הקבלן פוגש את הצ׳אט בפורטל שלו (`/p/[token]/tag/[id]`), ושם
 * אין לו כלל את רשימת הפניות. זו ההפרדה שכל מודל התגית נשען עליה.
 */
export default async function TagPage(props: PageProps<"/tags/[id]">) {
  const { id } = await props.params;
  const user = await requireUser();

  const detail = await getTagDetail(user, id);
  if (!detail) notFound();

  // רשימת המועמדים לפתיחה נטענת רק למי שרשאי לפתוח — אין טעם לשלוף את כל
  // אנשי המקצוע כדי להציג אותם למי שאינו רשאי.
  const grantedIds = new Set(detail.granted.map((g) => g.id));
  const candidates = detail.canManageAccess
    ? (await db.professional.findMany({ orderBy: { name: "asc" } }))
        .filter((p) => !grantedIds.has(p.id))
        .map((p) => ({ id: p.id, label: p.name, hint: p.phone ?? p.email ?? undefined }))
    : [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <Link href="/tags" className="text-sm text-brand">
          ← {he.tag.listTitle}
        </Link>
        <h1 className={TITLE_IDENTIFYING}>{detail.tag.name}</h1>
        <p className="text-sm text-muted">
          {he.tag.ticketCount(detail.openCount, detail.closedCount)}
        </p>
      </header>

      <section className={cardClasses("flex flex-col gap-2")}>
        <div className="flex items-center justify-between">
          <h2 className={TITLE_DESCRIPTIVE}>{he.tag.ticketsHeading}</h2>
          <span className="text-xs text-muted">{he.tag.ticketsManagersOnly}</span>
        </div>
        {detail.tickets.length === 0 ? (
          <p className="text-sm text-muted">{he.tag.ticketsEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.tickets.map((ticket) => (
              <li key={ticket.id}>
                <Link
                  href={`/tickets/${ticket.id}`}
                  className="flex items-center justify-between gap-2 rounded-xl bg-bg p-3 text-sm"
                >
                  <span>
                    {ticket.buildingName ?? he.ticket.noLocation}
                    {ticket.apartmentNumber ? ` · ${he.directory.apartment} ${ticket.apartmentNumber}` : ""}
                    {ticket.domainName ? ` · ${ticket.domainName}` : ""}
                  </span>
                  <span className="shrink-0 text-xs text-muted" dir="ltr">
                    #{ticket.seq}
                    {ticket.closed ? ` · ${he.ticketStatus.CLOSED}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail.canManageAccess ? (
        <TagAccessControl
          tagId={detail.tag.id}
          granted={detail.granted.map((g) => ({ id: g.id, label: g.name }))}
          candidates={candidates}
        />
      ) : (
        <section className={cardClasses("flex flex-col gap-2")}>
          <h2 className={TITLE_DESCRIPTIVE}>{he.tag.accessHeading}</h2>
          {detail.granted.length === 0 ? (
            <p className="text-sm text-muted">{he.tag.accessNobody}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {detail.granted.map((g) => (
                <li
                  key={g.id}
                  className={chipClasses("brand", "soft", "large")}
                >
                  {g.name}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className={cardClasses("flex flex-col gap-3")}>
        <div>
          <h2 className={TITLE_DESCRIPTIVE}>{he.tag.chatHeading}</h2>
          <p className="text-xs text-muted">{he.tag.chatHint}</p>
        </div>
        <TagChatMessages messages={detail.messages} />
        <TagChatBox tagId={detail.tag.id} />
      </section>
    </div>
  );
}
