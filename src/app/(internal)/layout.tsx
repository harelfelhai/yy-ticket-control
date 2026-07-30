import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { WIDE_WIDTH } from "@/lib/ui";
import { logoutAction } from "../login/actions";

/**
 * קישור בסרגל הניווט.
 *
 * `text-fg` ולא `text-brand`: חמישה קישורים בצבע המותג הפכו את הסרגל לגוש
 * כחול שמתחרה בתוכן, בעוד שצבע המותג שמור לפעולה הראשית של המסך.
 * `shrink-0` ו-`whitespace-nowrap` מונעים שבירת מילים בתוך הסרגל הנגלל.
 */
const NAV_LINK =
  "flex min-h-10 shrink-0 items-center whitespace-nowrap font-medium text-fg";

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
      {/*
        גובה הכותרת קבוע (h-14) ואינו נגזר מהתוכן.
        כותרות הקיבוץ בלוח דביקות מתחתיה (`top-14`), וכותרת שגובהה משתנה לפי
        מספר הקישורים או רוחב המסך הייתה מסיטה אותן בלי שאיש ישים לב.
      */}
      <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-surface px-4">
        <Link href="/board" className="shrink-0 font-bold">
          {he.app.name}
        </Link>
        {/*
          גלילה אופקית ולא גלישה לשורה שנייה. עם חמישה קישורים המילים נשברו
          ל-shell מרופט ש"יציאה" נותרה בו יתומה — פריסה שנקראת כתקלה. גלילה
          שומרת על שורה אחת נקייה ועל גובה יציב.
        */}
        <nav className="flex min-w-0 flex-1 items-center justify-end gap-3 overflow-x-auto text-sm">
          {/* תצוגת הבעלים חוצת-אתרים; למנהל עבודה, המקובע לאתר אחד, אין בה צורך */}
          {user.role !== "SITE_MANAGER" ? (
            <Link href="/overview" className={NAV_LINK}>
              {he.overview.navLink}
            </Link>
          ) : null}
          {/* הזנה מרוכזת מיועדת לדסקטופ (אפיון מסך 5), ולכן מוסתרת במובייל */}
          <Link href="/tickets/batch" className={`hidden md:inline-flex ${NAV_LINK}`}>
            {he.batch.navLink}
          </Link>
          <Link href="/tags" className={NAV_LINK}>
            {he.tag.navLink}
          </Link>
          <Link href="/search" className={NAV_LINK}>
            {he.search.title}
          </Link>
          {/* אזור הניהול — למנהל המערכת הראשי בלבד (אפיון §5.ז) */}
          {user.role === "ADMIN" ? (
            <Link href="/admin" className={NAV_LINK}>
              {he.admin.navLink}
            </Link>
          ) : null}
          {/* שם המשתמש מוסתר במסך צר: הוא מידע ולא פעולה, ובמובייל הוא
              דוחק את הקישורים שכן נלחצים. */}
          <span className="hidden shrink-0 whitespace-nowrap text-muted lg:inline">
            {user.name} · {he.role[user.role]}
          </span>
          {/* היציאה מופרדת בקו: היא אינה ניווט בין מסכים אלא יציאה מהמערכת,
              והיא הפעולה היחידה בסרגל שאי אפשר לבטל בלחיצה חוזרת. */}
          <form action={logoutAction} className="shrink-0 border-s border-border ps-3">
            <button type="submit" className={`${NAV_LINK} text-muted`}>
              {he.login.logout}
            </button>
          </form>
        </nav>
      </header>
      {/*
        רוחב מרבי אחד לכל המסכים הפנימיים, ולא בכל עמוד בנפרד.
        בלעדיו כרטיס פנייה נמתח על פני 1400px כדי להחזיק שתי שורות טקסט,
        ותג הסטטוס נותר במרחק שאינו מאפשר לקשור אותו לכותרת שהוא מתאר.
      */}
      <main className={`flex-1 ${WIDE_WIDTH}`}>{children}</main>
    </div>
  );
}
