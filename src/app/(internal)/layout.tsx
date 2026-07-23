import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { logoutAction } from "../login/actions";

/**
 * המעטפת של כל המסכים הפנימיים.
 *
 * ‏`requireUser()` כאן ולא בכל מסך בנפרד: מסך חדש שנוסיף מוגן אוטומטית,
 * ואי אפשר לשכוח. הבדיקה פונה ל-DB ומאמתת שהמשתמש עדיין פעיל — `proxy.ts`
 * בודק רק שקיימת עוגייה.
 */
export default async function InternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
        <Link href="/board" className="font-bold">
          {he.app.name}
        </Link>
        <div className="flex items-center gap-3 text-sm">
          {/* תצוגת הבעלים חוצת-אתרים; למנהל עבודה, המקובע לאתר אחד, אין בה צורך */}
          {user.role !== "SITE_MANAGER" ? (
            <Link href="/overview" className="min-h-10 font-medium text-brand">
              {he.overview.navLink}
            </Link>
          ) : null}
          {/* הזנה מרוכזת מיועדת לדסקטופ (אפיון מסך 5), ולכן מוסתרת במובייל */}
          <Link href="/tickets/batch" className="hidden min-h-10 font-medium text-brand md:inline">
            {he.batch.navLink}
          </Link>
          <Link href="/tags" className="min-h-10 font-medium text-brand">
            {he.tag.navLink}
          </Link>
          <Link href="/search" className="min-h-10 font-medium text-brand">
            {he.search.title}
          </Link>
          {/* שם המשתמש מוסתר במסך צר: הוא מידע ולא פעולה, ובמובייל הוא
              דוחק את הקישורים שכן נלחצים. */}
          <span className="hidden text-muted sm:inline">
            {user.name} · {he.role[user.role]}
          </span>
          <form action={logoutAction}>
            <button type="submit" className="min-h-10 px-2 font-medium text-brand">
              {he.login.logout}
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
