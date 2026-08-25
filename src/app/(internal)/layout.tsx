import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { canViewOverview } from "@/lib/permissions";
import { toViewer } from "@/lib/session";
import { FULL_WIDTH, HEADER_HEIGHT } from "@/lib/ui";
import { logoutAction } from "../login/actions";

/**
 * קישור בסרגל הניווט.
 *
 * `text-fg` ולא צבע: הסרגל אינו מקום לצבע — הוא הרקע הקבוע של כל מסך,
 * וכל גוון בו מתחרה במידע שמתחתיו. בפלטת הגרפיט זה ממילא הפך למובן מאליו.
 * `shrink-0` ו-`whitespace-nowrap` מונעים שבירת מילים בתוך הסרגל הנגלל.
 */
const NAV_LINK =
  "flex min-h-8 shrink-0 items-center whitespace-nowrap rounded-sm px-2 font-medium text-fg touch:min-h-11";

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
        גובה הכותרת קבוע ואינו נגזר מהתוכן: כותרות הקיבוץ בלוח דביקות
        מתחתיה, וכותרת שגובהה משתנה לפי מספר הקישורים או רוחב המסך הייתה
        מסיטה אותן בלי שאיש ישים לב. שני הערכים מגיעים מאותו מקום
        (`HEADER_HEIGHT` / `STICKY_UNDER_HEADER`) ולא ממחרוזות שחייבות
        להסכים בשלושה קבצים.
      */}
      <header
        className={`sticky top-0 z-10 flex ${HEADER_HEIGHT} items-center gap-2 border-b border-border bg-surface px-3`}
      >
        <Link href="/board" className="shrink-0 font-bold">
          {he.app.name}
        </Link>
        {/*
          גלילה אופקית ולא גלישה לשורה שנייה. עם חמישה קישורים המילים נשברו
          ל-shell מרופט ש"יציאה" נותרה בו יתומה — פריסה שנקראת כתקלה. גלילה
          שומרת על שורה אחת נקייה ועל גובה יציב.
        */}
        <nav className="flex min-w-0 flex-1 items-center justify-end gap-3 overflow-x-auto text-sm">
          {/*
           * **הזנה מרוכזת אינה כאן, והיא ירדה בכוונה.**
           *
           * היא ישבה בסרגל הגלובלי, כלומר הוצעה בכל מסך במערכת — כולל מסכים
           * שאין לה בהם שום קשר. אבל הזנה מרוכזת היא **דרך ליצור פניות**, לא
           * יעד בפני עצמו, ולכן מקומה לצד יצירת פנייה בודדת: היא עברה לראש
           * מסך "פנייה חדשה" (`tickets/new/create-ticket-form.tsx`).
           *
           * המחיר מוכר: היא ירדה רמת עומק אחת, ופעולה שנעשית מול דוח בדק בית
           * דורשת עכשיו מעבר דרך מסך היצירה. זו ההכרעה — סרגל ניווט שמציע
           * בכל רגע רק את מה שרלוונטי לכל מסך.
           */}
          {/*
           * אזור הניהול. **גם לבעלים ולא למנהל המערכת בלבד**, מאז שסקירת
           * האתרים עברה לראשו: היא נבנתה לבעלים, וקישור שחסום בפניו היה
           * מסתיר ממנו את המסך היחיד שנועד לו. הכפתורים שבתוך המסך נשארים
           * חסומים — ראו `admin/(manage)/layout.tsx`.
           */}
          {canViewOverview(toViewer(user)) ? (
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
        ‏`<main>` אינו מגביל רוחב, וזו הפיכה של ההחלטה הקודמת.

        התקרה של 1024px נועדה למנוע כרטיס פנייה מתוח על פני 1400px — נימוק
        שנשאר נכון, אבל התשובה לו אינה לצמצם את העמוד: מסך של 1920px הראה
        עמודה ברוחב שליש ושני שלישים אפור, במערכת שכל תפקידה הוא לסרוק
        פניות. הריסון עבר **לרכיב** — גריד הכרטיסים חוסם כל עמודה, טבלת
        הפניות חוסמת את עמודת התיאור, ומסך שקוראים בו (שרשור, טופס) בוחר
        `CONTENT_WIDTH` לעצמו.
      */}
      <main className={`flex-1 ${FULL_WIDTH}`}>{children}</main>
    </div>
  );
}
