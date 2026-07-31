import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { CONTENT_WIDTH, TITLE_DESCRIPTIVE } from "@/lib/ui";
import { listTagOverviews } from "@/lib/services/tags";
import { TagRename } from "./tag-rename";
import { cardClasses } from "@/components/ui/card";

export const metadata = { title: `${he.tag.listTitle} — ${he.app.name}` };

/**
 * רשימת התגיות (חלק ממסכי הניהול 11–15).
 *
 * לכל תגית מונה פתוחות/סגורות ומספר הקבלנים שנפתחו — המונים ממודרים לפי
 * אתר הצופה, בדיוק כמו רשימת הפניות שבתוך התגית, כדי שהמספר יתאים למה
 * שהמנהל יראה כשייכנס אליה.
 */
export default async function TagsPage() {
  const user = await requireUser();
  const tags = await listTagOverviews(user);
  // שינוי שם תגית שמור למנהל המערכת, כמו שאר ניהול הרשומות.
  const canManage = user.role === "ADMIN";

  return (
    <div className={`flex flex-col gap-4 p-4 ${CONTENT_WIDTH}`}>
      <h1 className={TITLE_DESCRIPTIVE}>{he.tag.listTitle}</h1>

      {tags.length === 0 ? (
        <p className="py-8 text-center text-muted">{he.tag.listEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className={cardClasses("flex flex-col gap-2")}
            >
              <div className="flex items-center justify-between gap-3">
                <Link href={`/tags/${tag.id}`} className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-semibold">{tag.name}</span>
                  <span className="text-sm text-muted">
                    {he.tag.ticketCount(tag.openCount, tag.closedCount)}
                  </span>
                </Link>
                <span className="shrink-0 text-xs text-muted">
                  {he.tag.grantedCount(tag.grantedCount)}
                </span>
              </div>
              {canManage ? <TagRename id={tag.id} name={tag.name} /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
