import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { he } from "@/lib/he";
import { canManageAdmin } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";
import { toViewer } from "@/lib/session";
import { CONTENT_WIDTH, PAGE_X } from "@/lib/ui";

/**
 * מה שרואים כששני מסכי הפתיחה אינם יכולים להיפתח — אין במערכת אף אתר.
 *
 * **הענף הזה אינו "אין לך אתר".** רק מנהל עבודה משויך לאתר
 * (`services/admin.ts`), ולכן מנהל מערכת ובעלים מריצים כאן שאילתה **ללא
 * סינון** על טבלת האתרים. אפס תוצאות פירושו שהטבלה ריקה — לא שהמשתמש
 * חסר שיוך. הנוסח שישב כאן עד 1.0 טעה בזה, וגרוע מכך: הוא אמר למנהל
 * המערכת "פנה למנהל המערכת".
 *
 * **מצב ריק מזמין לפעולה** (DESIGN.md § EmptyState), וזו ההזדמנות הראשונה
 * במערכת שבה ה-prop `action` של `EmptyState` באמת נדרש: כאן הפעולה
 * שממלאת את המסך **אינה** על המסך — היא בכלל במסך אחר. עד היום כל מצב ריק
 * ויתר עליו בצדק, מפני שה-FAB או תיבת החיפוש כבר עמדו לצדו.
 *
 * **הכפתור מותנה בהרשאה ולא רק מוסתר.** `canManageAdmin` הוא אותו פרדיקט
 * שחוסם את `/admin/sites` עצמו (`admin/(manage)/layout.tsx`) ושאותו אוכף
 * `assertAdmin` בשירות. בעלים שילחץ עליו היה מופנה חזרה ללוח בלי הסבר,
 * ולכן הוא מקבל את הנוסח שמפנה אותו לאדם ולא למסך.
 *
 * **רכיב אחד ולא שני עותקים.** שני המסכים החזיקו את הענף הזה מילה במילה,
 * כולל אותה הערה על `CONTENT_WIDTH` — וזה בדיוק סוג הכפילות שנסחפת: הנוסח
 * השגוי היה צריך לתקן בשני מקומות. מה שנשאר שונה בין המסכים הוא הטופס
 * עצמו, ובו לא נגענו.
 */
export function NoSites({ user }: { user: SessionUser }) {
  const canCreate = canManageAdmin(toViewer(user));

  return (
    /*
     * ענף הכשל יורש את הרוחב של המסך שהוא מחליף. בלי קבוע הוא היה משפט
     * בודד שנמתח על מסך שלם מאז שה-`<main>` חדל להגביל — טקסט שנקרא, ולכן
     * `CONTENT_WIDTH` בדיוק כמו הטופס עצמו.
     */
    <div className={`py-3 ${PAGE_X} ${CONTENT_WIDTH}`}>
      <EmptyState
        action={
          canCreate ? (
            /*
             * `?new=1` פותח את דיאלוג ההקמה מיד עם הנחיתה. בלעדיו הכפתור
             * מוביל למסך שממנו יוצרים ולא ליצירה עצמה — ובמערכת ריקה
             * ההבדל הזה הוא כל התוכן של המסך.
             */
            <ButtonLink href="/admin/sites?new=1" size="compact">
              {he.admin.newSiteButton}
            </ButtonLink>
          ) : null
        }
      >
        {canCreate ? he.ticket.noSites : he.ticket.noSitesContactAdmin}
      </EmptyState>
    </div>
  );
}
