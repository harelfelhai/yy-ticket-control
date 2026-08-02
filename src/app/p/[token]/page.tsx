import Link from "next/link";
import { he } from "@/lib/he";
import { getPortalBoard, resolveToken } from "@/lib/services/portal";
import { listPortalTagChats } from "@/lib/services/tags";
import { ExpiredLink } from "./expired-link";
import { CONTENT_WIDTH, TITLE_DESCRIPTIVE, TITLE_IDENTIFYING } from "@/lib/ui";
import { cardClasses } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: `${he.portal.activeTitle} — ${he.app.name}` };

/**
 * הלוח האישי של הנמען החיצוני (מסך 8 באפיון).
 *
 * הקישור אינו מציג פנייה בודדת אלא את **כל** הפניות של הקבלן, מכל
 * האתרים. קבלן משנה עובד בכמה פרויקטים במקביל, ולכן אין לו "אתר משלו".
 *
 * המסך מכוון למי שאינו משתמש קבוע במערכת: בלי תפריטים, בלי סינון, ובלי
 * מונחים פנימיים. רק "מה מחכה לי" ו"מה כבר סגור".
 */
export default async function PortalPage(props: PageProps<"/p/[token]">) {
  const { token } = await props.params;
  const identity = await resolveToken(token);
  if (!identity) return <ExpiredLink />;

  const [{ active, archived }, tagChats] = await Promise.all([
    getPortalBoard(identity.professionalId),
    listPortalTagChats(identity.professionalId),
  ]);

  return (
    <main className={`flex flex-col gap-4 p-4 ${CONTENT_WIDTH}`}>
      <header>
        <h1 className={TITLE_IDENTIFYING}>{he.portal.greeting(identity.name)}</h1>
        <p className="text-sm text-muted">{he.portal.activeTitle}</p>
      </header>

      {active.length === 0 ? (
        <EmptyState>{he.portal.empty}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map(({ ticket, ...assignment }) => (
            <li key={assignment.id}>
              <Link
                href={`/p/${token}/${ticket.id}`}
                className={cardClasses("flex flex-col gap-1")}
              >
                <span className="font-semibold">
                  {ticket.building?.name} · {he.directory.apartment} {ticket.apartment?.number}
                </span>
                <span className="text-sm text-muted">{ticket.domain?.name}</span>
                {ticket.description ? (
                  <span className="truncate text-sm">{ticket.description}</span>
                ) : null}
                <span className="text-xs text-muted">
                  {he.assignmentStatus[assignment.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {tagChats.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className={TITLE_DESCRIPTIVE}>{he.portal.groupChatsTitle}</h2>
          <ul className="flex flex-col gap-2">
            {tagChats.map((tag) => (
              <li key={tag.id}>
                <Link
                  href={`/p/${token}/tag/${tag.id}`}
                  className={cardClasses("flex items-center gap-2 font-medium")}
                >
                  <span aria-hidden>💬</span>
                  {tag.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {archived.length > 0 ? (
        <details>
          <summary className="cursor-pointer py-2 text-sm font-bold">
            {he.portal.archiveTitle} · {archived.length}
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {archived.map(({ ticket, ...assignment }) => (
              <li key={assignment.id}>
                <Link
                  href={`/p/${token}/${ticket.id}`}
                  className={cardClasses("flex flex-col gap-1 text-muted")}
                >
                  <span className="font-medium">
                    {ticket.building?.name} · {he.directory.apartment}{" "}
                    {ticket.apartment?.number}
                  </span>
                  <span className="text-sm">{ticket.domain?.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </main>
  );
}
