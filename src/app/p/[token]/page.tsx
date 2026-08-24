import Link from "next/link";
import { he } from "@/lib/he";
import { getPortalBoard, resolveToken } from "@/lib/services/portal";
import { listPortalTagChats } from "@/lib/services/tags";
import { ExpiredLink } from "./expired-link";
import { CONTENT_WIDTH, PAGE_X, TITLE_DESCRIPTIVE, TITLE_IDENTIFYING, CARD_LIST} from "@/lib/ui";
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

  // ‏`CONTENT_WIDTH` ולא רוחב מלא, בשונה ממסכי הניהול: הפורטל נפתח כמעט תמיד
  // בטלפון, והוא תצוגה של תוכן שקוראים — לא לוח שסורקים ממנו עשרות שורות.
  return (
    <main className={`flex flex-col gap-3 py-3 ${PAGE_X} ${CONTENT_WIDTH}`}>
      <header>
        <h1 className={TITLE_IDENTIFYING}>{he.portal.greeting(identity.name)}</h1>
        <p className="text-sm text-muted">{he.portal.activeTitle}</p>
      </header>

      {active.length === 0 ? (
        <EmptyState>{he.portal.empty}</EmptyState>
      ) : (
        <ul className={CARD_LIST}>
          {active.map(({ ticket, ...assignment }) => (
            <li key={assignment.id}>
              <Link
                href={`/p/${token}/${ticket.id}`}
                className={cardClasses("flex flex-col gap-1")}
              >
                <span className="font-semibold">
                  {he.ticket.location(ticket.building?.name, ticket.apartment?.number)}
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
          <ul className={CARD_LIST}>
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
          {/*
           * שני תיקונים באותה שורה, ושניהם על הכותרת המתקפלת:
           *
           * ‏1. **אזור מגע.** ‏`py-2` על `text-sm` נותן 36px — מספיק בעכבר,
           *    לא באצבע. הזוג `min-h-9` + `touch:min-h-11` הוא
           *    הניסוח שהתקן דורש (§ אזורי מגע), והפורטל נפתח בטלפון.
           *    בלי `flex`, בכוונה: `display:flex` על `<summary>` מוחק את
           *    משולש הפתיחה הנייטיב, וזה הרמז היחיד שהאזור נפתח.
           * ‏2. **טיפוגרפיה.** ‏14px/700 אינו זוג בסקאלה (§ Typography מזווג
           *    14px ל-500), וארכיון הלוח הפנימי כבר יושב על `TITLE_DESCRIPTIVE`.
           *    אותה כותרת בשני הצדדים — קבלן שרואה ממשק זר חושד בו.
           */}
          <summary
            className={`min-h-9 cursor-pointer py-2 touch:min-h-11 ${TITLE_DESCRIPTIVE}`}
          >
            {he.portal.archiveTitle} · {archived.length}
          </summary>
          <ul className={`mt-2 ${CARD_LIST}`}>
            {archived.map(({ ticket, ...assignment }) => (
              <li key={assignment.id}>
                <Link
                  href={`/p/${token}/${ticket.id}`}
                  className={cardClasses("flex flex-col gap-1 text-muted")}
                >
                  <span className="font-medium">
                    {he.ticket.location(ticket.building?.name, ticket.apartment?.number)}
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
