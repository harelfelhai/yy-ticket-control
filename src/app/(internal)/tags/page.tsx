import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { listTagOverviews } from "@/lib/services/tags";

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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">{he.tag.listTitle}</h1>

      {tags.length === 0 ? (
        <p className="py-8 text-center text-muted">{he.tag.listEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tags.map((tag) => (
            <li key={tag.id}>
              <Link
                href={`/tags/${tag.id}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold">{tag.name}</span>
                  <span className="text-sm text-muted">
                    {he.tag.ticketCount(tag.openCount, tag.closedCount)}
                  </span>
                </div>
                <span className="shrink-0 text-xs text-muted">
                  {he.tag.grantedCount(tag.grantedCount)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
