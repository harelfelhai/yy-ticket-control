import Link from "next/link";
import { notFound } from "next/navigation";
import { TagChatMessages } from "@/components/tag-chat-messages";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import { getTagDetail } from "@/lib/services/tags";
import { TagAccessControl } from "./tag-access-control";
import { TagChatBox } from "./tag-chat-box";
import { CONTENT_WIDTH, LINK, PAGE_X, TITLE_DESCRIPTIVE, TITLE_IDENTIFYING, ROW_LIST} from "@/lib/ui";
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
    ? // מושבת אינו מועמד לפתיחה (0.4) — אותו כלל כמו בבורר הנמענים.
      (await db.professional.findMany({ where: { active: true }, orderBy: { name: "asc" } }))
        .filter((p) => !grantedIds.has(p.id))
        .map((p) => ({ id: p.id, label: p.name, hint: p.phone ?? p.email ?? undefined }))
    : [];

  // רוחב הקריאה נשמר: המסך הוא צ׳אט שקוראים בו ברצף, ולא רשימה שסורקים.
  return (
    <div className={`flex flex-col gap-3 py-3 ${PAGE_X} ${CONTENT_WIDTH}`}>
      <header className="flex flex-col gap-1">
        {/* קו תחתון ולא `text-brand`: בפלטת הגרפיט צבע המותג זהה כמעט לטקסט
            הגוף, וקישור שמסומן בו בלבד מפסיק להיראות לחיץ (`LINK` ב-ui.ts). */}
        <Link href="/tags" className={`text-sm text-fg ${LINK}`}>
          ← {he.tag.listTitle}
        </Link>
        <h1 className={TITLE_IDENTIFYING}>{detail.tag.name}</h1>
        <p className="text-sm text-muted">
          {he.tag.ticketCount(detail.openCount, detail.closedCount)}
        </p>
      </header>

      <section className={cardClasses("flex flex-col gap-2")}>
        {/* ההערה צמודה לכותרת שהיא מסייגת, לא בקצה הנגדי — DESIGN.md § Layout */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className={TITLE_DESCRIPTIVE}>{he.tag.ticketsHeading}</h2>
          <span className="text-xs text-muted">{he.tag.ticketsManagersOnly}</span>
        </div>
        {detail.tickets.length === 0 ? (
          <p className="text-sm text-muted">{he.tag.ticketsEmpty}</p>
        ) : (
          <ul className={ROW_LIST}>
            {detail.tickets.map((ticket) => (
              <li key={ticket.id}>
                {/*
                 * **‏`min-h-8` — גובה של דבר לחיץ, ותיקון של
                 * הפרה שהייתה כאן מזמן.**
                 *
                 * לקישור לא היה `min-h` כלל, וגובהו הגיע מהתוכן: `text-sm`
                 * (שורה של 20px) ועוד `p-2` = **36px**. הרצפה דאז הייתה 44
                 * במגע, כלומר כל שורה ברשימה הזו הייתה יעד קטן מדי. הרצפה
                 * ההיא בוטלה מאז (0.7), אבל `min-h` מפורש נשאר נכון: גובה
                 * שנגזר מאורך הטקסט אינו גובה.
                 *
                 * **למה זה נתפס רק לסירוגין:** התיאור מגיע מהנתונים. תיאור
                 * ארוך גולש לשתי שורות ב-`flex-wrap`, הגובה עובר 44,
                 * והבדיקה עוברת. תיאור קצר נשאר בשורה אחת ונופל. כלומר
                 * הבאג היה תלוי באורך המחרוזת שהבדיקה הגרילה.
                 *
                 * **ולמה אף אוכף סטטי לא תפס:** `layout-guards` בודק
                 * ש-`min-h` נמוך מלווה ברצפת מגע — ולכאן לא היה
                 * ‏`min-h` **בכלל**, כלומר לא היה מה לתפוס. זהו בדיוק
                 * העיוורון שמתועד שם ("הבדיקה אינה מבחינה אם האלמנט לחיץ").
                 * מה שכן תפס הוא `rtl-mobile`, שמודד גובה אמיתי בדפדפן.
                 */}
                <Link
                  href={`/tickets/${ticket.id}`}
                  className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 rounded-sm bg-bg p-2 text-sm"
                >
                  {/*
                   * מספר הפנייה ירד מכאן ב-0.5, כפי שירד מטבלת הלוח: הוא
                   * מזהה גלובלי במסד ואינו אומר דבר למי שסורק רשימה, והוא
                   * נשאר בכותרת מסך הפנייה בלבד.
                   *
                   * **ובמקומו התיאור, לא כלום.** תגית מקבצת את ליקויי אותה
                   * דירה, ולכן מיקום ותחום חוזרים על עצמם — הצילום הראה
                   * ארבע שורות "בניין א · דירה 1 · חשמל" זהות לחלוטין. עד
                   * כה המספר היה ההבדל היחיד ביניהן, וזה בדיוק מה שהוא
                   * החזיק במקום המידע.
                   */}
                  <span className="font-medium">
                    {he.ticket.location(ticket.buildingName, ticket.apartmentNumber) ||
                      he.ticket.noLocation}
                    {ticket.domainName ? (
                      <span className="font-normal text-muted"> · {ticket.domainName}</span>
                    ) : null}
                  </span>
                  {ticket.descriptionLine ? (
                    <span className="text-muted">{ticket.descriptionLine}</span>
                  ) : null}
                  {ticket.closed ? (
                    <span className="shrink-0 text-xs text-muted">{he.ticketStatus.CLOSED}</span>
                  ) : null}
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

      <section className={cardClasses("flex flex-col gap-2")}>
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
