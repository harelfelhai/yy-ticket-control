import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { FULL_WIDTH, PAGE_X, TITLE_DESCRIPTIVE, RECORD_CARD_GRID, RECORD_NAME} from "@/lib/ui";
import { listTagOverviews } from "@/lib/services/tags";
import { deleteTagAction, renameTagAction } from "./actions";
import { DeleteButton } from "@/components/delete-button";
import { InlineRename } from "@/components/inline-rename";
import { cardClasses } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

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

  // ‏`FULL_WIDTH` ולא רוחב קריאה: זהו מסך ניהול שסורקים בו רשומות, ואין בו
  // שורת טקסט אחת שנקראת ברצף. עמודה ממורכזת כאן רק קונה גלילה.
  return (
    <div className={`flex flex-col gap-3 py-3 ${PAGE_X} ${FULL_WIDTH}`}>
      <h1 className={TITLE_DESCRIPTIVE}>{he.tag.listTitle}</h1>

      {tags.length === 0 ? (
        <EmptyState>{he.tag.listEmpty}</EmptyState>
      ) : (
        <ul className={RECORD_CARD_GRID}>
          {tags.map((tag) => (
            <li
              key={tag.id}
              className={cardClasses("flex flex-col gap-2")}
            >
              {/* מונה הקבלנים צמוד לשם התגית ולא נדחף לקצה הנגדי —
                  ראו DESIGN.md § Layout על `justify-between`. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link href={`/tags/${tag.id}`} className="flex min-w-0 flex-col gap-1">
                  <span className={RECORD_NAME}>{tag.name}</span>
                  <span className="text-sm text-muted">
                    {he.tag.ticketCount(tag.openCount, tag.closedCount)}
                  </span>
                </Link>
                <span className="shrink-0 text-xs text-muted">
                  {he.tag.grantedCount(tag.grantedCount)}
                </span>
              </div>
              {canManage ? (
                // ‏`ms-auto` על העיפרון — הפעולות בקצה הכרטיס ולא בתחילתו
                // (§ Layout, החריג הצר). הכרטיס חסום בעמודת גריד, ולכן
                // המרחק שהכלל מונע אינו יכול להיווצר כאן.
                <div className="flex flex-wrap items-start gap-2">
                  <InlineRename
                    className="ms-auto"
                    value={tag.name}
                    action={renameTagAction.bind(null, tag.id)}
                  />
                  <DeleteButton name={tag.name} action={deleteTagAction.bind(null, tag.id)} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
