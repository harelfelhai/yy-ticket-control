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
        <span className="font-bold">{he.app.name}</span>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted">
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
